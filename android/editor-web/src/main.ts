import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, findClusterBreak, type Range } from '@codemirror/state'
import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap, indentLess, insertTab, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view'
import { markdownBlocks, markdownEnvironment, renderInlineMarkdown, revealInlineMarker, sourceOffsetForText, tableCellRange, type MarkdownBlock } from '../../../docs/.vitepress/theme/liveMarkdown'
import { emptyInlineDeletion, visibleInlineEditPosition } from '../../../docs/.vitepress/theme/inlineDeletion.js'
import { markdownEditorLanguage, sourceMarkdownHighlight, visualCodeHighlight } from '../../../docs/.vitepress/theme/editorHighlight.js'
import { toggleInlineFormat } from '../../../docs/.vitepress/theme/inlineFormatting.js'
import { renderSafeHtmlImage } from '../../../docs/.vitepress/theme/safeHtmlImage'

declare global {
  interface Window {
    AndroidBridge?: {
      onReady(): void
      onContentChanged(content: string, canUndo: boolean, canRedo: boolean): void
      onSelectionChanged(hasSelection: boolean, selectionLength: number): void
      onFormatError(message: string): void
      onMissingImageClicked(src: string): void
      onWebImagePaste(mime: string, base64Data: string): void
    }
    PaperEditor?: {
      setDocument(content: string, docKey: string, imageBaseUrl: string): void
      setMode(mode: 'visual' | 'source'): void
      setTheme(theme: 'day' | 'night' | 'green' | 'yellow'): void
      setReadOnly(readonly: boolean): void
      applyFormat(action: string, codeLanguage: string): void
      insertText(snippet: string): void
      undo(): void
      redo(): void
      focusHeading(offset: number): void
      refreshImages(): void
      getText(): string
    }
  }
}

type EditorMode = 'visual' | 'source'

const modeCompartment = new Compartment()
const readonlyCompartment = new Compartment()
const refreshVisual = StateEffect.define<null>()

let view: EditorView | null = null
let currentMode: EditorMode = 'visual'
let currentReadOnly = false
let currentDocKey = ''
let currentImageBaseUrl = ''
let imageRevision = 0
let composing = false
let pointerSelecting = false
let selectionTimer: number | undefined

const rootEl = document.getElementById('editor-root')!
const legacyBanner = document.getElementById('legacy-banner')!

function resolveLocalImageUrl(rawSrc: string): { url: string | null; isRelativeAsset: boolean } {
  const src = rawSrc.trim()
  if (/^(?:\.\/)?assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/i.test(src)) {
    const clean = src.replace(/^\.\//, '')
    if (!currentImageBaseUrl) return { url: null, isRelativeAsset: true }
    return { url: `${currentImageBaseUrl}${clean}?v=${imageRevision}`, isRelativeAsset: true }
  }
  if (/^https?:\/\//i.test(src) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)) {
    return { url: src, isRelativeAsset: false }
  }
  // Unresolved local / Typora relative path (needs image repair!)
  return { url: null, isRelativeAsset: true }
}

function hydrateImages(container: HTMLElement) {
  for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('img'))) {
    const originalSrc = img.dataset.paperOriginalSrc || img.getAttribute('src') || ''
    if (!originalSrc) continue
    img.dataset.paperOriginalSrc = originalSrc
    const { url, isRelativeAsset } = resolveLocalImageUrl(originalSrc)
    const showMissing = () => {
      const box = document.createElement('span')
      box.className = 'cm-paper-image-missing'
      const title = document.createElement('strong')
      title.textContent = '图片暂不可用或缺失'
      const pathLine = document.createElement('span')
      pathLine.textContent = originalSrc
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = '补齐图片 / 检查附件'
      btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation() })
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        window.AndroidBridge?.onMissingImageClicked(originalSrc)
      })
      box.append(title, pathLine, btn)
      img.replaceWith(box)
    }

    if (!url) {
      if (isRelativeAsset) showMissing()
      continue
    }
    img.setAttribute('src', url)
    img.onerror = () => showMissing()
  }
}

class RenderedBlock extends WidgetType {
  constructor(private readonly block: MarkdownBlock, private readonly rev: number) { super() }
  eq(other: RenderedBlock) {
    return this.block.from === other.block.from &&
      this.block.to === other.block.to &&
      this.block.html === other.block.html &&
      this.rev === other.rev
  }
  toDOM(editor: EditorView) {
    const element = document.createElement('div')
    element.className = 'cm-paper-rendered'
    element.innerHTML = this.block.html
    hydrateImages(element)

    if (this.block.type === 'table_open') {
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
            status = document.createElement('p')
            status.className = 'cm-paper-widget-notice'
            element.prepend(status)
          }
          status.textContent = editor.state.readOnly ? '当前内容为只读。' : '此单元格含复杂格式，请切换源代码编辑。'
          return
        }
        const input = document.createElement('input')
        input.className = 'cm-paper-cell-input'
        input.value = range.text
        cell.replaceChildren(input)
        let done = false
        const finish = (commit: boolean) => {
          if (done) return
          done = true
          const value = input.value.replace(/[\r\n]+/g, ' ')
          if (commit && value !== range.text && editor.state.doc.sliceString(this.block.from, this.block.to) === this.block.source) {
            editor.dispatch({
              changes: {
                from: this.block.from + range.from,
                to: this.block.from + range.to,
                insert: value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
              }
            })
          } else {
            cell.textContent = range.text
          }
        }
        input.addEventListener('pointerdown', e => e.stopPropagation())
        input.addEventListener('keydown', e => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); editor.focus() }
          if (e.key === 'Escape') { e.preventDefault(); finish(false); editor.focus() }
        })
        input.addEventListener('blur', () => finish(true))
        input.focus()
      })
      return element
    }

    element.addEventListener('click', event => event.preventDefault())
    element.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation()
      const position = this.block.from + sourceOffsetForText(this.block.source, '')
      editor.dispatch({ selection: EditorSelection.cursor(position) })
      editor.focus()
    })
    return element
  }
  ignoreEvent() { return true }
}

class InlineMarker extends WidgetType {
  constructor(private readonly text: string) { super() }
  eq(other: InlineMarker) { return this.text === other.text }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-paper-marker'
    el.textContent = this.text
    return el
  }
}

class InlineImage extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly to: number,
    private readonly html: string,
    private readonly rev: number
  ) { super() }
  eq(other: InlineImage) {
    return this.source === other.source && this.from === other.from && this.to === other.to && this.html === other.html && this.rev === other.rev
  }
  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-paper-image'
    wrapper.innerHTML = this.html
    hydrateImages(wrapper)
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
    ranges.push(Decoration.line({
      class: `cm-paper-code-line${isFirst ? ' cm-paper-code-open' : ''}${closed ? ' cm-paper-code-close' : ''}${revealFence ? ' cm-paper-code-revealed' : ''}`,
      attributes: isFirst ? { 'data-language': language } : undefined
    }).range(line.from))
    if (fenceLine && !revealFence && line.to > fenceStart) ranges.push(Decoration.replace({}).range(fenceStart, line.to))
  }
}

function renderedDecorations(state: EditorState): DecorationSet {
  try {
    const selection = state.selection.ranges
    const text = state.doc.toString()
    const hasLegacyCr = /\r(?!\n)/.test(text)
    legacyBanner.hidden = !(currentMode === 'visual' && hasLegacyCr)
    if (hasLegacyCr) return Decoration.none

    const blocks = markdownBlocks(text)
    const environment = markdownEnvironment(text)
    const ranges: Range<Decoration>[] = []
    for (const block of blocks) {
      const active = selection.some(range => range.from <= block.to && range.to >= block.from)
      if (block.type === 'fence') {
        addFenceDecorations(state, selection, ranges, block.from, block.to)
        continue
      }
      if (block.type === 'code_block') {
        const first = state.doc.lineAt(block.from).number, last = state.doc.lineAt(block.to).number
        for (let n = first; n <= last; n++) {
          ranges.push(Decoration.line({
            class: `cm-paper-code-line${n === first ? ' cm-paper-code-indented-start' : ''}${n === last ? ' cm-paper-code-indented-end' : ''}`
          }).range(state.doc.line(n).from))
        }
        continue
      }
      if (block.type === 'table_open' || (!active && !block.direct)) {
        ranges.push(Decoration.replace({ widget: new RenderedBlock(block, imageRevision), block: true }).range(block.from, block.to))
        continue
      }
      for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
        const line = state.doc.line(n)
        ranges.push(Decoration.line({ class: `cm-paper-prose${block.type === 'blockquote_open' ? ' cm-paper-quote' : ''}` }).range(line.from))
      }
      syntaxTree(state).iterate({
        from: block.from, to: block.to,
        enter(node) {
          if (node.name === 'FencedCode') { addFenceDecorations(state, selection, ranges, node.from, node.to); return false }
          if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
            const source = state.doc.sliceString(node.from, node.to)
            const image = renderSafeHtmlImage(source)
            if (image) {
              ranges.push(Decoration.replace({ widget: new InlineImage(source, node.from, node.to, image, imageRevision) }).range(node.from, node.to))
              return false
            }
          }
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
              if (!selection.some(range => range.from <= end && range.to >= marker.from)) {
                ranges.push(Decoration.replace({}).range(marker.from, end))
              }
            }
          }
          if (node.name === 'Link') {
            const marks = node.node.getChildren('LinkMark')
            const open = marks[0], labelEnd = marks[1]
            if (open && labelEnd && open.to < labelEnd.from) {
              ranges.push(Decoration.mark({ class: 'cm-paper-link' }).range(open.to, labelEnd.from))
              for (const [from, to] of [[open.from, open.to], [labelEnd.from, node.to]]) {
                if (!revealInlineMarker(selection, from, to)) ranges.push(Decoration.replace({}).range(from, to))
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
          const inlineClass = node.name === 'StrongEmphasis' ? 'cm-paper-strong'
            : node.name === 'Emphasis' ? 'cm-paper-emphasis'
            : node.name === 'Strikethrough' ? 'cm-paper-strike'
            : node.name === 'InlineCode' ? 'cm-paper-code' : ''
          if (!inlineClass) return
          const first = node.node.firstChild, last = node.node.lastChild
          if (!first || !last || first === last || first.to >= last.from) return
          ranges.push(Decoration.mark({ class: inlineClass }).range(first.to, last.from))
          for (const mark of [first, last]) {
            if (!revealInlineMarker(selection, mark.from, mark.to)) ranges.push(Decoration.replace({}).range(mark.from, mark.to))
          }
        }
      })
    }
    return Decoration.set(ranges, true)
  } catch {
    return Decoration.none
  }
}

const renderedField = StateField.define<DecorationSet>({
  create: renderedDecorations,
  update(value, tr) {
    if (composing && (tr.docChanged || tr.selection)) return value.map(tr.changes)
    return tr.docChanged || tr.selection || tr.effects.some(e => e.is(refreshVisual))
      ? renderedDecorations(tr.state)
      : value
  },
  provide: field => EditorView.decorations.from(field)
})

function displayExtension(mode: EditorMode) {
  return mode === 'visual'
    ? [renderedField, syntaxHighlighting(visualCodeHighlight)]
    : [syntaxHighlighting(sourceMarkdownHighlight)]
}

function editableExtension(ro: boolean) {
  return [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]
}

function deleteVisibleInline(target: EditorView, direction: -1 | 1): boolean {
  if (currentMode !== 'visual' || composing || target.state.readOnly || target.state.selection.ranges.length !== 1) return false
  const selection = target.state.selection.main
  if (!selection.empty) return false
  const empty = emptyInlineDeletion(target.state, selection.head, direction)
  if (empty) {
    const insert = empty.text || ''
    target.dispatch({
      changes: { from: empty.from, to: empty.to, insert },
      selection: EditorSelection.cursor(empty.from + insert.length),
      annotations: isolateHistory.of('full')
    })
    return true
  }
  const position = visibleInlineEditPosition(target.state, selection.head, direction)
  if (position === null) return false
  const line = target.state.doc.lineAt(position)
  const offset = position - line.from
  if ((direction === -1 && offset === 0) || (direction === 1 && offset === line.text.length)) {
    target.dispatch({ selection: EditorSelection.cursor(position) })
    return (direction === -1 ? deleteCharBackward(target) : deleteCharForward(target)) || true
  }
  const boundary = line.from + findClusterBreak(line.text, offset, direction === 1)
  const from = Math.min(position, boundary), to = Math.max(position, boundary)
  target.dispatch({
    changes: { from, to, insert: '' },
    selection: EditorSelection.cursor(from),
    userEvent: direction === -1 ? 'delete.backward' : 'delete.forward'
  })
  return true
}

function scheduleSelectionReport() {
  window.clearTimeout(selectionTimer)
  selectionTimer = window.setTimeout(() => {
    if (!view || pointerSelecting || composing || currentReadOnly) {
      window.AndroidBridge?.onSelectionChanged(false, 0)
      return
    }
    const sel = view.state.selection.main
    const len = sel.to - sel.from
    window.AndroidBridge?.onSelectionChanged(len > 0, len)
  }, 120)
}

function handlePaste(event: ClipboardEvent): boolean {
  if (currentReadOnly) return false
  const items = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
  if (!items.length) return false
  event.preventDefault()
  const file = items[0].getAsFile()
  if (!file) return true
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : ''
    const comma = dataUrl.indexOf(',')
    if (comma > 0) {
      window.AndroidBridge?.onWebImagePaste(file.type, dataUrl.slice(comma + 1))
    }
  }
  reader.readAsDataURL(file)
  return true
}

function createState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      EditorState.lineSeparator.of('\n'),
      history(),
      markdownEditorLanguage,
      keymap.of([
        { key: 'Backspace', run: t => deleteVisibleInline(t, -1) },
        { key: 'Delete', run: t => deleteVisibleInline(t, 1) },
        { key: 'Tab', run: t => !t.state.readOnly && insertTab(t), shift: indentLess },
        ...defaultKeymap,
        ...historyKeymap
      ]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': '正文',
        'aria-multiline': 'true',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off'
      }),
      Prec.high(EditorView.domEventHandlers({
        pointerdown() { pointerSelecting = true; window.AndroidBridge?.onSelectionChanged(false, 0); return false },
        touchstart() { pointerSelecting = true; window.AndroidBridge?.onSelectionChanged(false, 0); return false },
        paste(event) { return handlePaste(event) },
        compositionstart() { composing = true; window.AndroidBridge?.onSelectionChanged(false, 0); return false },
        compositionend(_event, instance) {
          composing = false
          requestAnimationFrame(() => {
            if (view === instance) {
              instance.dispatch({ effects: refreshVisual.of(null) })
              scheduleSelectionReport()
            }
          })
          return false
        }
      })),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          window.AndroidBridge?.onContentChanged(
            update.state.doc.toString(),
            undoDepth(update.state) > 0,
            redoDepth(update.state) > 0
          )
        }
        if (update.selectionSet || update.docChanged) {
          scheduleSelectionReport()
        }
      }),
      modeCompartment.of(displayExtension(currentMode)),
      readonlyCompartment.of(editableExtension(currentReadOnly))
    ]
  })
}

window.addEventListener('pointerup', () => { pointerSelecting = false; scheduleSelectionReport() })
window.addEventListener('pointercancel', () => { pointerSelecting = false; scheduleSelectionReport() })
window.addEventListener('touchend', () => { pointerSelecting = false; scheduleSelectionReport() })
window.addEventListener('touchcancel', () => { pointerSelecting = false; scheduleSelectionReport() })

function ensureView(initialText = '') {
  if (!view) {
    view = new EditorView({ state: createState(initialText), parent: rootEl })
  }
}

function applyFormat(action: string, codeLanguage = '') {
  if (!view || currentReadOnly) return
  const source = view.state.doc.toString()
  const sel = view.state.selection.main
  const start = sel.from
  const end = sel.to
  const selected = source.slice(start, end)

  if (['h1', 'h2', 'h3', 'unordered', 'ordered', 'task', 'quote'].includes(action)) {
    const replaceStart = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1
    const lastSelected = end > start && source[end - 1] === '\n' ? end - 1 : end
    const nextLine = source.indexOf('\n', lastSelected)
    const replaceEnd = nextLine === -1 ? source.length : nextLine
    const lines = source.slice(replaceStart, replaceEnd).split('\n')
    const prefix = action === 'h1' ? '# ' : action === 'h2' ? '## ' : action === 'h3' ? '### '
      : action === 'unordered' ? '- ' : action === 'task' ? '- [ ] ' : action === 'quote' ? '> ' : ''
    const replacement = lines.map((line, index) => {
      const clean = line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)/, '')
      return (action === 'ordered' ? `${index + 1}. ` : prefix) + clean
    }).join('\n')
    const selectionStart = replaceStart + (start === end ? replacement.length : 0)
    const selectionEnd = replaceStart + replacement.length
    view.dispatch({
      changes: { from: replaceStart, to: replaceEnd, insert: replacement },
      selection: { anchor: selectionStart, head: selectionEnd },
      scrollIntoView: true
    })
    view.focus()
    return
  }

  if (action === 'code-block') {
    const fence = '`'.repeat(Math.max(3, ...Array.from(selected.matchAll(/`+/g), m => m[0].length + 1)))
    const before = start > 0 && source[start - 1] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n' : ''
    const replacement = `${before}${fence}${codeLanguage}\n${selected}\n${fence}${after}`
    const selectionStart = start + before.length + fence.length + codeLanguage.length + 1
    view.dispatch({
      changes: { from: start, to: end, insert: replacement },
      selection: { anchor: selectionStart, head: selectionStart + selected.length },
      scrollIntoView: true
    })
    view.focus()
    return
  }

  if (action === 'table') {
    const before = end > 0 && source[end - 1] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n' : ''
    const replacement = `${before}| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n${after}`
    const selectionStart = end + before.length + 2
    view.dispatch({
      changes: { from: end, to: end, insert: replacement },
      selection: { anchor: selectionStart, head: selectionStart + 2 },
      scrollIntoView: true
    })
    view.focus()
    return
  }

  if (action === 'link') {
    const label = selected || '链接文字'
    const replacement = `[${label}](https://)`
    const selectionStart = start + label.length + 3
    view.dispatch({
      changes: { from: start, to: end, insert: replacement },
      selection: { anchor: selectionStart, head: selectionStart + 'https://'.length },
      scrollIntoView: true
    })
    view.focus()
    return
  }

  const change = toggleInlineFormat(source, start, end, action)
  if (!change) {
    window.AndroidBridge?.onFormatError('选区跨越复杂格式或段落，请调整选区或切换源代码编辑。')
    return
  }
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.text },
    selection: { anchor: change.selectionStart, head: change.selectionEnd },
    scrollIntoView: true,
    annotations: isolateHistory.of('full')
  })
  view.focus()
}

window.PaperEditor = {
  setDocument(content: string, docKey: string, imageBaseUrl: string) {
    currentImageBaseUrl = imageBaseUrl
    ensureView(content)
    if (docKey !== currentDocKey || view!.state.doc.toString() !== content) {
      currentDocKey = docKey
      composing = false
      view!.setState(createState(content))
      window.AndroidBridge?.onContentChanged(
        content,
        undoDepth(view!.state) > 0,
        redoDepth(view!.state) > 0
      )
    } else {
      imageRevision++
      view!.dispatch({ effects: refreshVisual.of(null) })
    }
  },
  setMode(mode: EditorMode) {
    if (currentMode === mode) return
    currentMode = mode
    legacyBanner.hidden = true
    view?.dispatch({ effects: modeCompartment.reconfigure(displayExtension(mode)) })
  },
  setTheme(theme: 'day' | 'night' | 'green' | 'yellow') {
    document.body.dataset.theme = theme
  },
  setReadOnly(ro: boolean) {
    currentReadOnly = ro
    view?.dispatch({ effects: readonlyCompartment.reconfigure(editableExtension(ro)) })
  },
  applyFormat,
  insertText(snippet: string) {
    if (!view || currentReadOnly) return
    const sel = view.state.selection.main
    const insert = snippet
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: EditorSelection.cursor(sel.from + insert.length),
      scrollIntoView: true,
      annotations: isolateHistory.of('full')
    })
    view.focus()
  },
  undo() {
    if (!view || currentReadOnly) return
    undo(view)
    view.focus()
    window.AndroidBridge?.onContentChanged(
      view.state.doc.toString(),
      undoDepth(view.state) > 0,
      redoDepth(view.state) > 0
    )
  },
  redo() {
    if (!view || currentReadOnly) return
    redo(view)
    view.focus()
    window.AndroidBridge?.onContentChanged(
      view.state.doc.toString(),
      undoDepth(view.state) > 0,
      redoDepth(view.state) > 0
    )
  },
  focusHeading(offset: number) {
    if (!view) return
    const pos = Math.max(0, Math.min(view.state.doc.length, Math.trunc(offset)))
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 28 })
    })
    view.focus()
  },
  refreshImages() {
    imageRevision++
    view?.dispatch({ effects: refreshVisual.of(null) })
  },
  getText() {
    return view?.state.doc.toString() ?? ''
  }
}

ensureView('')
window.AndroidBridge?.onReady()
