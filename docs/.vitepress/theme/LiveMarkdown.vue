<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Range } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentLess, insertTab, isolateHistory } from '@codemirror/commands'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view'
import { applyTextareaChange, markdownBlocks, markdownEnvironment, rawOffsetForTextarea, renderInlineMarkdown, replaceInlineImage, sourceOffsetForText, tableCellRange, textareaOffsetForRaw, type MarkdownBlock } from './liveMarkdown'
import { markdownEditorLanguage, sourceMarkdownHighlight, visualCodeHighlight } from './editorHighlight.js'
import { applyImageUrls, originalImageSource } from './imageUrls'

const props = defineProps<{ modelValue: string; mode: 'source' | 'visual'; readonly?: boolean; attachmentContext?: string; imageUrls?: Readonly<Record<string, string>>; savePastedImages?: (files: File[]) => Promise<string[]>; onPasteStatus?: (message: string) => void }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; keydown: [event: KeyboardEvent]; failure: []; selection: [rect: { left: number; top: number; bottom: number } | null] }>()
const host = ref<HTMLElement | null>(null)
const fallback = ref<HTMLTextAreaElement | null>(null)
const failed = ref(false)
const pasteError = ref('')
const legacyNewlines = computed(() => /\r(?!\n)/.test(props.modelValue))
const modeCompartment = new Compartment()
const readonlyCompartment = new Compartment()
let view: EditorView | null = null
let composing = false
let selectionFrame = 0
let imageRevision = 0
let pointerSelecting = false
let keyboardSelecting = false
const refreshVisual = StateEffect.define<null>()

function reportSelection() {
  cancelAnimationFrame(selectionFrame)
  selectionFrame = requestAnimationFrame(() => {
    if (pointerSelecting || keyboardSelecting || composing || props.readonly) { emit('selection', null); return }
    const current = view
    if (!current && fallback.value) {
      const field = fallback.value
      if (document.activeElement !== field || field.selectionStart === field.selectionEnd) { emit('selection', null); return }
      const box = field.getBoundingClientRect()
      emit('selection', { left: box.left + Math.min(box.width / 2, 100), top: box.top, bottom: box.top + 24 })
      return
    }
    if (!current || !current.hasFocus || current.state.selection.main.empty) { emit('selection', null); return }
    const coords = current.coordsAtPos(current.state.selection.main.head)
    emit('selection', coords ? { left: coords.left, top: coords.top, bottom: coords.bottom } : null)
  })
}

function beginPointerSelection(event: PointerEvent) {
  if (event.button !== 0 || props.readonly) return
  pointerSelecting = true
  emit('selection', null)
}
function endPointerSelection() {
  if (!pointerSelecting) return
  pointerSelecting = false
  reportSelection()
}
function selectionKeydown(event: KeyboardEvent) {
  if (event.shiftKey && /^(?:Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)) {
    keyboardSelecting = true
    emit('selection', null)
  }
}
function selectionKeyup(event: KeyboardEvent) {
  if (keyboardSelecting && (event.key === 'Shift' || !event.shiftKey)) { keyboardSelecting = false; reportSelection() }
}

// The parent persists files before their portable relative URLs are inserted.
// A failed write never leaves a reference to an image that doesn't exist.
function handleImagePaste(event: ClipboardEvent): boolean {
  if (props.readonly) return false
  const items = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
  if (!items.length) return false
  event.preventDefault()
  const files = items.map(item => item.getAsFile())
  const supported = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  if (files.some(file => !file || !supported.has(file.type))) {
    pasteError.value = '仅支持粘贴 PNG、JPEG、GIF 或 WebP 图片。'
    return true
  }
  if (files.some(file => (file?.size || 0) > 20 * 1024 * 1024)) {
    pasteError.value = '单张图片不能超过 20 MiB，请压缩后重试。'
    return true
  }
  const saveImages = props.savePastedImages
  if (!saveImages || !props.attachmentContext) {
    pasteError.value = '当前笔记的图片存储不可用，请稍后重试。'
    return true
  }
  const before = currentText(), selection = selectionRange(), originalView = view, originalFallback = fallback.value
  const originalContext = props.attachmentContext
  // Keep a stable parent callback even if the editor unmounts while a large
  // image is being written. The parent can then show a visible page notice.
  const reportStatus = props.onPasteStatus
  const report = (message: string) => { if (reportStatus) reportStatus(message); else pasteError.value = message }
  pasteError.value = ''
  let saved: Promise<string[]>
  try { saved = Promise.resolve(saveImages(files as File[])) }
  catch (error) { saved = Promise.reject(error) }
  saved.then(images => {
    const now = selectionRange()
    if (props.attachmentContext !== originalContext || view !== originalView || fallback.value !== originalFallback) {
      report('图片处理期间已离开原章节，未插入正文；请回到原章节重新粘贴。')
      return
    }
    if (props.readonly) {
      report('图片已保存到本机，但编辑器正忙，未插入正文；请在同步或恢复结束后重新粘贴。')
      return
    }
    if (currentText() !== before || now.start !== selection.start || now.end !== selection.end) {
      pasteError.value = '读取图片时正文或选区已改变，请在目标位置重新粘贴。'
      return
    }
    if (images.length !== files.length || images.some(image => !/^assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/.test(image))) {
      pasteError.value = '图片保存结果无效，请重新粘贴。'
      return
    }
    const insert = images.map((image, index) => `![图片${images.length > 1 ? index + 1 : ''}](${image})`).join('\n')
    replace(selection.start, selection.end, insert, selection.start + insert.length, selection.start + insert.length, true)
  }).catch((error: unknown) => {
    report(error instanceof Error && error.message ? `图片未插入正文：${error.message}` : '无法保存图片，请检查本地存储空间后重试。')
  })
  return true
}

class RenderedBlock extends WidgetType {
  constructor(private readonly block: MarkdownBlock, private readonly imageVersion: number) { super() }
  eq(other: RenderedBlock) { return this.block.from === other.block.from && this.block.to === other.block.to && this.block.html === other.block.html && this.imageVersion === other.imageVersion }
  toDOM(editor: EditorView) {
    const element = document.createElement('div')
    element.className = 'cm-paper-rendered vp-doc'
    element.innerHTML = this.block.html
    applyImageUrls(element, props.imageUrls)
    element.title = '点击此处编辑 Markdown'
    if (this.block.type === 'table_open') {
      element.title = '点击普通单元格编辑；复杂格式可在源代码中修改'
      element.addEventListener('pointerdown', event => {
        const target = event.target as HTMLElement | null
        const cell = target?.closest('td, th') as HTMLTableCellElement | null
        const table = cell?.closest('table')
        if (!cell || !table || target?.tagName === 'INPUT') return
        event.preventDefault(); event.stopPropagation()
        const row = Array.from(table.querySelectorAll('tr')).indexOf(cell.parentElement as HTMLTableRowElement)
        const column = Array.from(cell.parentElement?.children || []).indexOf(cell)
        const range = tableCellRange(this.block.source, row, column)
        if (!range || editor.state.readOnly) {
          let status = element.querySelector<HTMLElement>('.cm-paper-widget-notice')
          if (!status) {
            status = document.createElement('p'); status.className = 'cm-paper-widget-notice'; status.setAttribute('role', 'status')
            element.prepend(status)
          }
          status.textContent = editor.state.readOnly ? '当前内容为只读。' : '此单元格含复杂格式，请切换源代码编辑以保留格式。'
          return
        }
        const input = document.createElement('input')
        input.className = 'cm-paper-cell-input'
        input.value = range.text
        input.setAttribute('aria-label', '编辑表格单元格，回车保存，Esc 取消')
        cell.replaceChildren(input)
        let done = false
        const finish = (commit: boolean) => {
          if (done) return
          done = true
          const value = input.value.replace(/[\r\n]+/g, ' ')
          const start = this.block.from + range.from, end = this.block.from + range.to
          if (commit && value !== range.text) {
            if (editor.state.doc.sliceString(this.block.from, this.block.to) !== this.block.source) {
              done = false; input.setAttribute('title', '正文已改变，请先复制修改内容，再重新编辑。'); input.focus(); input.select(); return
            }
            editor.dispatch({ changes: { from: start, to: end, insert: value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|') } })
          } else cell.textContent = range.text
        }
        input.addEventListener('pointerdown', e => e.stopPropagation())
        input.addEventListener('keydown', e => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); requestAnimationFrame(() => { if (editor.dom.isConnected) editor.focus() }) }
          if (e.key === 'Escape') { e.preventDefault(); finish(false); requestAnimationFrame(() => { if (editor.dom.isConnected) editor.focus() }) }
        })
        input.addEventListener('blur', () => finish(true))
        input.focus(); input.select()
      })
      return element
    }
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
      // Replacing a rich block with editable source changes its height. Keep
      // its top at the same viewport coordinate instead of scrolling to the
      // caret (which otherwise makes the page visibly jump on each click).
      const originalTop = element.getBoundingClientRect().top
      editor.dispatch({ selection: EditorSelection.cursor(position) })
      editor.focus()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (editor.dom.isConnected) {
          const coords = editor.coordsAtPos(this.block.from)
          if (coords) window.scrollBy(0, coords.top - originalTop)
        }
      }))
    })
    return element
  }
  ignoreEvent() { return true }
}

class InlineMarker extends WidgetType {
  constructor(private readonly text: string) { super() }
  eq(other: InlineMarker) { return this.text === other.text }
  toDOM() {
    const element = document.createElement('span')
    element.className = 'cm-paper-marker'
    element.textContent = this.text
    return element
  }
}

class InlineImage extends WidgetType {
  constructor(private readonly source: string, private readonly from: number, private readonly to: number, private readonly html: string, private readonly imageVersion: number) { super() }
  eq(other: InlineImage) { return this.source === other.source && this.from === other.from && this.to === other.to && this.html === other.html && this.imageVersion === other.imageVersion }
  toDOM(editor: EditorView) {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-paper-image'
    wrapper.innerHTML = this.html
    applyImageUrls(wrapper, props.imageUrls)
    const img = wrapper.querySelector('img')
    if (!img) return wrapper
    img.title = '点击图片编辑地址与描述'
    img.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation() })
    img.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation()
      if (wrapper.querySelector('form') || editor.state.readOnly) return
      const form = document.createElement('form')
      form.className = 'cm-paper-image-form'
      form.setAttribute('aria-label', '编辑图片')
      const alt = document.createElement('input')
      alt.value = img.alt; alt.placeholder = '图片描述'; alt.setAttribute('aria-label', '图片描述')
      const url = document.createElement('input')
      url.value = originalImageSource(img); url.placeholder = '图片地址'; url.setAttribute('aria-label', '图片地址')
      const save = document.createElement('button')
      save.type = 'submit'; save.textContent = '保存'
      const cancel = document.createElement('button')
      cancel.type = 'button'; cancel.textContent = '取消'
      const status = document.createElement('span')
      status.setAttribute('role', 'status')
      form.append(alt, url, save, cancel, status)
      form.addEventListener('pointerdown', e => e.stopPropagation())
      form.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); form.remove(); editor.focus() } })
      cancel.addEventListener('click', () => { form.remove(); editor.focus() })
      form.addEventListener('submit', e => {
        e.preventDefault(); e.stopPropagation()
        if (alt.value === img.alt && url.value === originalImageSource(img)) { form.remove(); editor.focus(); return }
        const replacement = replaceInlineImage(this.source, alt.value, url.value)
        if (!replacement) { status.textContent = '此图片格式暂不支持在此修改，请切换源代码。'; return }
        if (editor.state.doc.sliceString(this.from, this.to) !== this.source) { status.textContent = '正文已改变，请重新打开图片编辑。'; return }
        editor.dispatch({ changes: { from: this.from, to: this.to, insert: replacement } })
        requestAnimationFrame(() => { if (editor.dom.isConnected) editor.focus() })
      })
      wrapper.append(form)
      url.focus()
    })
    return wrapper
  }
  ignoreEvent() { return true }
}

function addFenceDecorations(state: EditorState, selection: readonly { from: number; to: number }[], ranges: Range<Decoration>[], from: number, to: number) {
  const first = state.doc.lineAt(from), last = state.doc.lineAt(to)
  const match = /^\s*(`{3,}|~{3,})([^\r\n]*)/.exec(state.doc.sliceString(from, first.to))
  if (!match) return
  const language = (match[2].trim().split(/\s+/)[0] || '代码').slice(0, 40)
  const openingFence = match[1]
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n), isFirst = n === first.number
    const closing = /^\s*(`+|~+)\s*\r?$/.exec(line.text)?.[1] || ''
    const closed = n === last.number && n > first.number && closing[0] === openingFence[0] && closing.length >= openingFence.length
    const fenceLine = isFirst || closed
    const fenceStart = isFirst ? from : closed ? line.from + line.text.indexOf(closing) : line.from
    const revealFence = fenceLine && selection.some(range => range.from <= line.to && range.to >= fenceStart)
    ranges.push(Decoration.line({ class: `cm-paper-code-line${isFirst ? ' cm-paper-code-open' : ''}${closed ? ' cm-paper-code-close' : ''}${revealFence ? ' cm-paper-code-revealed' : ''}`, attributes: isFirst ? { 'data-language': language } : undefined }).range(line.from))
    if (fenceLine && !revealFence && line.to > fenceStart) ranges.push(Decoration.replace({}).range(fenceStart, line.to))
  }
}

function renderedDecorations(state: EditorState): DecorationSet {
  try {
    const selection = state.selection.ranges
    const text = state.doc.toString()
    // CodeMirror's line separator is LF to preserve the exact saved bytes.
    // Standalone CRs cannot safely be represented as separate editor lines;
    // do not apply decorations at misleading positions.
    if (/\r(?!\n)/.test(text)) return Decoration.none
    const blocks = markdownBlocks(text)
    const environment = markdownEnvironment(text)
    const ranges: Range<Decoration>[] = []
    for (const block of blocks) {
      const active = selection.some(range => range.from <= block.to && range.to >= block.from)
      if (block.type === 'fence') {
        // Code stays the same editable CodeMirror lines in both active and
        // inactive states, preserving selection, layout and undo history.
        addFenceDecorations(state, selection, ranges, block.from, block.to)
        continue
      }
      if (block.type === 'code_block') {
        const first = state.doc.lineAt(block.from).number, last = state.doc.lineAt(block.to).number
        for (let n = first; n <= last; n++) {
          ranges.push(Decoration.line({ class: `cm-paper-code-line${n === first ? ' cm-paper-code-indented-start' : ''}${n === last ? ' cm-paper-code-indented-end' : ''}` }).range(state.doc.line(n).from))
        }
        continue
      }
      if (block.type === 'table_open' || (!active && !block.direct)) {
        ranges.push(Decoration.replace({ widget: new RenderedBlock(block, imageRevision), block: true }).range(block.from, block.to))
        continue
      }
      // Plain text and headings remain editable lines at all times. This
      // avoids replacing ordinary paragraphs when the caret moves between them.
      for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
        const line = state.doc.line(n)
        ranges.push(Decoration.line({ class: `cm-paper-prose${block.type === 'blockquote_open' ? ' cm-paper-quote' : ''}` }).range(line.from))
      }
      // Keep the active Markdown editable, but apply light live formatting to
      // headings and inline emphasis. Markers reappear when the caret enters
      // them, so they remain directly accessible and can always be edited.
      syntaxTree(state).iterate({ from: block.from, to: block.to, enter(node) {
        if (node.name === 'FencedCode') { addFenceDecorations(state, selection, ranges, node.from, node.to); return false }
        if (node.name === 'Image') {
          const source = state.doc.sliceString(node.from, node.to)
          ranges.push(Decoration.replace({ widget: new InlineImage(source, node.from, node.to, renderInlineMarkdown(source, environment), imageRevision) }).range(node.from, node.to))
          return false
        }
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
        if (node.name === 'Link') {
          const marks = node.node.getChildren('LinkMark')
          const open = marks[0], labelEnd = marks[1]
          if (open && labelEnd && open.to < labelEnd.from) {
            ranges.push(Decoration.mark({ class: 'cm-paper-link' }).range(open.to, labelEnd.from))
            for (const [from, to] of [[open.from, open.to], [labelEnd.from, node.to]]) {
              if (!selection.some(range => range.from <= to && range.to >= from)) ranges.push(Decoration.replace({}).range(from, to))
            }
          }
          return
        }
        if (node.name === 'ListMark' || node.name === 'TaskMarker' || node.name === 'QuoteMark') {
          if (selection.some(range => range.from <= node.to && range.to >= node.from)) return
          const raw = state.doc.sliceString(node.from, node.to)
          const marker = node.name === 'ListMark' && /^[-*+]$/.test(raw) ? '•' : node.name === 'TaskMarker' ? (/x/i.test(raw) ? '☑' : '☐') : node.name === 'QuoteMark' ? '' : raw
          ranges.push(Decoration.replace(marker ? { widget: new InlineMarker(marker) } : {}).range(node.from, node.to))
          return
        }
        const inlineClass = node.name === 'StrongEmphasis' ? 'cm-paper-strong' : node.name === 'Emphasis' ? 'cm-paper-emphasis' : node.name === 'Strikethrough' ? 'cm-paper-strike' : node.name === 'InlineCode' ? 'cm-paper-code' : ''
        if (!inlineClass) return
        const first = node.node.firstChild, last = node.node.lastChild
        if (!first || !last || first === last || first.to >= last.from) return
        ranges.push(Decoration.mark({ class: inlineClass }).range(first.to, last.from))
        for (const mark of [first, last]) {
          const intersects = selection.some(range => range.from === range.to
            ? range.from >= mark.from && range.from <= mark.to
            : range.from < mark.to && range.to > mark.from)
          if (!intersects) ranges.push(Decoration.replace({}).range(mark.from, mark.to))
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
  update(value, transaction) {
    // Rebuilding replacement widgets during IME composition can discard the
    // browser's live composition DOM. Map existing decorations until the IME
    // commits, then explicitly rebuild once on compositionend.
    if (composing && (transaction.docChanged || transaction.selection)) return value.map(transaction.changes)
    return transaction.docChanged || transaction.selection || transaction.effects.some(effect => effect.is(refreshVisual)) ? renderedDecorations(transaction.state) : value
  },
  provide: field => EditorView.decorations.from(field)
})

function displayExtension(mode: 'source' | 'visual') {
  return mode === 'visual' ? [renderedField, syntaxHighlighting(visualCodeHighlight)] : [syntaxHighlighting(sourceMarkdownHighlight)]
}
function editableExtension(readonly: boolean) { return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)] }
function stateFor(value: string) {
  return EditorState.create({
    doc: value,
    extensions: [
      // Splitting on LF only keeps CR characters intact, including mixed line endings.
      EditorState.lineSeparator.of('\n'), history(), markdownEditorLanguage,
      // Escape then Tab remains available for leaving the editor by keyboard.
      keymap.of([{ key: 'Tab', run: target => !target.state.readOnly && insertTab(target), shift: indentLess }, ...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': '正文', 'aria-multiline': 'true', spellcheck: 'false' }),
      Prec.high(EditorView.domEventHandlers({
        keydown(event) { selectionKeydown(event); emit('keydown', event); return event.defaultPrevented },
        keyup(event) { selectionKeyup(event); return false },
        pointerdown(event) { beginPointerSelection(event); return false },
        paste(event) { return handleImagePaste(event) },
        focus() { reportSelection(); return false },
        blur() { keyboardSelecting = false; emit('selection', null); return false },
        compositionstart() { composing = true; emit('selection', null); return false },
        compositionend(_event, instance) {
          composing = false
          requestAnimationFrame(() => { if (view === instance) { instance.dispatch({ effects: refreshVisual.of(null) }); reportSelection() } })
          return false
        }
      })),
      EditorView.updateListener.of(update => { if (update.docChanged) emit('update:modelValue', update.state.doc.toString()); if (update.selectionSet || update.docChanged || update.viewportChanged) reportSelection() }),
      modeCompartment.of(displayExtension(props.mode)), readonlyCompartment.of(editableExtension(!!props.readonly))
    ]
  })
}

function useFallback() {
  composing = false
  view?.destroy()
  view = null
  failed.value = true
  emit('failure')
}
onMounted(() => {
  if (!host.value) return
  try { view = new EditorView({ state: stateFor(props.modelValue), parent: host.value }) }
  catch { useFallback() }
  window.addEventListener('scroll', reportSelection, true)
  window.addEventListener('resize', reportSelection)
  window.addEventListener('pointerup', endPointerSelection)
  window.addEventListener('pointercancel', endPointerSelection)
})
onBeforeUnmount(() => { composing = false; cancelAnimationFrame(selectionFrame); window.removeEventListener('scroll', reportSelection, true); window.removeEventListener('resize', reportSelection); window.removeEventListener('pointerup', endPointerSelection); window.removeEventListener('pointercancel', endPointerSelection); view?.destroy(); view = null })
watch(() => props.modelValue, value => {
  // A changed parent value is a different loaded chapter. Reset history so an
  // undo in one chapter can never reinsert content from the previous chapter.
  if (view && view.state.doc.toString() !== value) {
    try { view.setState(stateFor(value)) } catch { useFallback() }
  }
})
watch(() => props.mode, mode => { try { view?.dispatch({ effects: modeCompartment.reconfigure(displayExtension(mode)) }) } catch { useFallback() } })
watch(() => props.readonly, value => { try { view?.dispatch({ effects: readonlyCompartment.reconfigure(editableExtension(!!value)) }) } catch { useFallback() } })
watch(() => props.imageUrls, () => {
  imageRevision++
  try { view?.dispatch({ effects: refreshVisual.of(null) }) } catch { useFallback() }
})

function currentText() { return view?.state.doc.toString() ?? props.modelValue }
function selectionRange() {
  const selection = view?.state.selection.main
  if (selection) return { start: selection.from, end: selection.to }
  return { start: rawOffsetForTextarea(props.modelValue, fallback.value?.selectionStart ?? 0), end: rawOffsetForTextarea(props.modelValue, fallback.value?.selectionEnd ?? 0) }
}
function replace(from: number, to: number, insert: string, selectionStart: number, selectionEnd: number, isolated = false) {
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
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: selectionStart, head: selectionEnd }, scrollIntoView: true, ...(isolated ? { annotations: isolateHistory.of('full') } : {}) })
  view.focus()
}
function fallbackKeydown(event: KeyboardEvent) {
  selectionKeydown(event)
  emit('keydown', event)
  if (event.defaultPrevented || event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || props.readonly || !fallback.value) return
  const field = fallback.value
  const before = props.modelValue
  let state = EditorState.create({ doc: before, extensions: [EditorState.lineSeparator.of('\n')], selection: {
    anchor: rawOffsetForTextarea(before, field.selectionStart), head: rawOffsetForTextarea(before, field.selectionEnd)
  } })
  const handled = (event.shiftKey ? indentLess : insertTab)({ state, dispatch: transaction => { state = transaction.state } })
  if (!handled) return
  event.preventDefault()
  const result = state.doc.toString(), selection = state.selection.main
  emit('update:modelValue', result)
  void nextTick(() => { if (fallback.value === field) field.setSelectionRange(textareaOffsetForRaw(result, selection.from), textareaOffsetForRaw(result, selection.to)) })
}
function visibleEditorTop() {
  const header = document.querySelector('.archive-header')?.getBoundingClientRect().bottom || 0
  const toolbar = document.querySelector('.editor-toolbar-sticky')?.getBoundingClientRect().bottom || 0
  return Math.max(0, header, toolbar) + 12
}
function revealBelowToolbar(top: number, bottom: number) {
  const safeTop = visibleEditorTop()
  const safeBottom = window.innerHeight - 20
  if (top < safeTop) window.scrollBy(0, top - safeTop)
  else if (bottom > safeBottom) window.scrollBy(0, bottom - safeBottom)
}
function focusHeading(offset: number) {
  if (!view && fallback.value) {
    const position = textareaOffsetForRaw(props.modelValue, Math.max(0, Math.min(props.modelValue.length, Math.trunc(offset))))
    fallback.value.focus(); fallback.value.setSelectionRange(position, position)
    const line = fallback.value.value.slice(0, position).split('\n').length - 1
    const lineHeight = parseFloat(getComputedStyle(fallback.value).lineHeight) || 24
    fallback.value.scrollTop = Math.max(0, line * lineHeight - fallback.value.clientHeight / 3)
    const field = fallback.value
    field.scrollIntoView({ block: 'center' })
    requestAnimationFrame(() => {
      if (fallback.value !== field) return
      const top = field.getBoundingClientRect().top + line * lineHeight - field.scrollTop
      revealBelowToolbar(top, top + lineHeight)
    })
    return
  }
  if (!view) return
  const position = Math.max(0, Math.min(view.state.doc.length, Math.trunc(offset)))
  const targetView = view
  targetView.dispatch({ selection: EditorSelection.cursor(position), effects: EditorView.scrollIntoView(position, { y: 'center' }) })
  targetView.focus()
  // The fixed navigation and toolbar are outside CodeMirror's scroll model.
  // Measure after its scroll and rendering, then keep the selected title below them.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (view !== targetView) return
    const bounds = targetView.coordsAtPos(position)
    if (bounds) revealBelowToolbar(bounds.top, bounds.bottom)
  }))
}
function canReorganize() { return !!view && !props.readonly }
defineExpose({ currentText, selectionRange, replace, focusHeading, canReorganize })
</script>

<template>
  <p v-if="mode === 'visual' && legacyNewlines" class="live-markdown-legacy" role="status">本文含旧式 CR 换行，暂以源码显示以保留原文。</p>
  <p v-if="pasteError" class="live-markdown-paste-error" role="alert">{{ pasteError }}</p>
  <div v-show="!failed" ref="host" class="live-markdown" />
  <textarea v-if="failed" ref="fallback" class="live-markdown-fallback" aria-label="正文" :value="modelValue" :readonly="readonly" spellcheck="false"
    @input="emit('update:modelValue', applyTextareaChange(modelValue, ($event.target as HTMLTextAreaElement).value))" @keydown="fallbackKeydown" @keyup="selectionKeyup" @pointerdown="beginPointerSelection" @select="reportSelection" @paste="handleImagePaste" />
</template>
