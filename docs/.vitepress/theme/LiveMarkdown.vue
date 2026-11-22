<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorSelection, EditorState, Prec, StateField, type Range } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view'
import { applyTextareaChange, markdownBlocks, rawOffsetForTextarea, sourceOffsetForText, textareaOffsetForRaw, type MarkdownBlock } from './liveMarkdown'

const props = defineProps<{ modelValue: string; mode: 'source' | 'visual'; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; keydown: [event: KeyboardEvent]; failure: [] }>()
const host = ref<HTMLElement | null>(null)
const fallback = ref<HTMLTextAreaElement | null>(null)
const failed = ref(false)
const modeCompartment = new Compartment()
const readonlyCompartment = new Compartment()
let view: EditorView | null = null

class RenderedBlock extends WidgetType {
  constructor(private readonly block: MarkdownBlock) { super() }
  eq(other: RenderedBlock) { return this.block.from === other.block.from && this.block.to === other.block.to && this.block.html === other.block.html }
  toDOM(editor: EditorView) {
    const element = document.createElement('div')
    element.className = 'cm-paper-rendered vp-doc'
    element.innerHTML = this.block.html
    element.title = '点击此处编辑 Markdown'
    // A preview widget is never a navigation surface: a click focuses the
    // underlying Markdown instead, including when the click is on a link.
    element.addEventListener('click', event => event.preventDefault())
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      let prefix = ''
      try {
        const doc = element.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
        const caret = doc.caretPositionFromPoint?.(event.clientX, event.clientY)
        const existing = caret ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY)
        const node = caret?.offsetNode || existing?.startContainer
        const offset = caret?.offset ?? existing?.startOffset
        if (node && offset !== undefined && element.contains(node)) {
          const range = doc.createRange()
          range.selectNodeContents(element)
          range.setEnd(node, offset)
          prefix = range.toString()
        }
      } catch { /* Focusing the start remains safe if the browser has no caret API. */ }
      const position = this.block.from + sourceOffsetForText(this.block.source, prefix)
      editor.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true })
      editor.focus()
    })
    return element
  }
  ignoreEvent() { return true }
}

function renderedDecorations(state: EditorState): DecorationSet {
  try {
    const selection = state.selection.ranges
    const blocks = markdownBlocks(state.doc.toString())
    const ranges: Range<Decoration>[] = []
    for (const block of blocks) {
      const active = selection.some(range => range.from <= block.to && range.to >= block.from)
      if (!active) {
        ranges.push(Decoration.replace({ widget: new RenderedBlock(block), block: true }).range(block.from, block.to))
        continue
      }
      // Keep the active Markdown editable, but apply light live formatting to
      // headings and inline emphasis. Markers reappear when the caret enters
      // them, so they remain directly accessible and can always be edited.
      syntaxTree(state).iterate({ from: block.from, to: block.to, enter(node) {
        if (/^ATXHeading[1-6]$/.test(node.name)) {
          const line = state.doc.lineAt(node.from)
          const level = node.name.slice(-1)
          ranges.push(Decoration.line({ class: `cm-paper-heading cm-paper-h${level}` }).range(line.from))
          const marker = node.node.firstChild
          if (marker?.name === 'HeaderMark') {
            let end = marker.to
            while (end < line.to && /[ \t]/.test(state.doc.sliceString(end, end + 1))) end++
            if (!selection.some(range => range.from <= end && range.to >= marker.from)) ranges.push(Decoration.replace({}).range(marker.from, end))
          }
        }
        const inlineClass = node.name === 'StrongEmphasis' ? 'cm-paper-strong' : node.name === 'Emphasis' ? 'cm-paper-emphasis' : node.name === 'InlineCode' ? 'cm-paper-code' : ''
        if (!inlineClass) return
        const first = node.node.firstChild, last = node.node.lastChild
        if (!first || !last || first === last || first.to >= last.from) return
        ranges.push(Decoration.mark({ class: inlineClass }).range(first.to, last.from))
        for (const mark of [first, last]) {
          if (!selection.some(range => range.from <= mark.to && range.to >= mark.from)) ranges.push(Decoration.replace({}).range(mark.from, mark.to))
        }
      } })
    }
    return Decoration.set(ranges, true)
  } catch { return Decoration.none }
}

// Block replacements change vertical layout, so CodeMirror requires them to
// come from a state field, not from a viewport-dependent view plugin.
const renderedField = StateField.define<DecorationSet>({
  create: renderedDecorations,
  update(value, transaction) { return transaction.docChanged || transaction.selection ? renderedDecorations(transaction.state) : value },
  provide: field => EditorView.decorations.from(field)
})

function displayExtension(mode: 'source' | 'visual') { return mode === 'visual' ? [renderedField] : [] }
function editableExtension(readonly: boolean) { return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)] }
function stateFor(value: string) {
  return EditorState.create({
    doc: value,
    extensions: [
      // Splitting on LF only keeps CR characters intact, including mixed line endings.
      EditorState.lineSeparator.of('\n'), history(), markdown(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': '正文', 'aria-multiline': 'true', spellcheck: 'false' }),
      Prec.high(EditorView.domEventHandlers({ keydown(event) { emit('keydown', event); return event.defaultPrevented } })),
      EditorView.updateListener.of(update => { if (update.docChanged) emit('update:modelValue', update.state.doc.toString()) }),
      modeCompartment.of(displayExtension(props.mode)), readonlyCompartment.of(editableExtension(!!props.readonly))
    ]
  })
}

function useFallback() {
  view?.destroy()
  view = null
  failed.value = true
  emit('failure')
}
onMounted(() => {
  if (!host.value) return
  try { view = new EditorView({ state: stateFor(props.modelValue), parent: host.value }) }
  catch { useFallback() }
})
onBeforeUnmount(() => { view?.destroy(); view = null })
watch(() => props.modelValue, value => {
  // A changed parent value is a different loaded chapter. Reset history so an
  // undo in one chapter can never reinsert content from the previous chapter.
  if (view && view.state.doc.toString() !== value) {
    try { view.setState(stateFor(value)) } catch { useFallback() }
  }
})
watch(() => props.mode, mode => { try { view?.dispatch({ effects: modeCompartment.reconfigure(displayExtension(mode)) }) } catch { useFallback() } })
watch(() => props.readonly, value => { try { view?.dispatch({ effects: readonlyCompartment.reconfigure(editableExtension(!!value)) }) } catch { useFallback() } })

function currentText() { return view?.state.doc.toString() ?? props.modelValue }
function selectionRange() {
  const selection = view?.state.selection.main
  if (selection) return { start: selection.from, end: selection.to }
  return { start: rawOffsetForTextarea(props.modelValue, fallback.value?.selectionStart ?? 0), end: rawOffsetForTextarea(props.modelValue, fallback.value?.selectionEnd ?? 0) }
}
function replace(from: number, to: number, insert: string, selectionStart: number, selectionEnd: number) {
  if (props.readonly) return
  if (!view && fallback.value) {
    const text = props.modelValue.slice(0, from) + insert + props.modelValue.slice(to)
    emit('update:modelValue', text)
    void nextTick(() => {
      fallback.value?.focus()
      fallback.value?.setSelectionRange(textareaOffsetForRaw(text, selectionStart), textareaOffsetForRaw(text, selectionEnd))
    })
    return
  }
  if (!view) return
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: selectionStart, head: selectionEnd }, scrollIntoView: true })
  view.focus()
}
function focusHeading(offset: number) {
  if (!view && fallback.value) {
    const position = textareaOffsetForRaw(props.modelValue, Math.max(0, Math.min(props.modelValue.length, Math.trunc(offset))))
    fallback.value.focus(); fallback.value.setSelectionRange(position, position)
    const line = fallback.value.value.slice(0, position).split('\n').length - 1
    const lineHeight = parseFloat(getComputedStyle(fallback.value).lineHeight) || 24
    fallback.value.scrollTop = Math.max(0, line * lineHeight - fallback.value.clientHeight / 3)
    fallback.value.scrollIntoView({ block: 'nearest' })
    return
  }
  if (!view) return
  const position = Math.max(0, Math.min(view.state.doc.length, Math.trunc(offset)))
  view.dispatch({ selection: EditorSelection.cursor(position), scrollIntoView: true })
  view.focus()
}
defineExpose({ currentText, selectionRange, replace, focusHeading })
</script>

<template>
  <div v-show="!failed" ref="host" class="live-markdown" />
  <textarea v-if="failed" ref="fallback" class="live-markdown-fallback" aria-label="正文" :value="modelValue" :readonly="readonly" spellcheck="false"
    @input="emit('update:modelValue', applyTextareaChange(modelValue, ($event.target as HTMLTextAreaElement).value))" @keydown="emit('keydown', $event)" />
</template>
