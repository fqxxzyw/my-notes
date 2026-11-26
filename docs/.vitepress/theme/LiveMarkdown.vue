<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, findClusterBreak, type Range } from '@codemirror/state'
import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap, indentLess, insertTab, isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, keymap, lineNumbers, WidgetType, type DecorationSet } from '@codemirror/view'
import { applyTextareaChange, markdownBlocks, markdownEnvironment, rawOffsetForTextarea, renderInlineMarkdown, replaceInlineImage, revealInlineMarker, sourceOffsetForText, textareaOffsetForRaw, type MarkdownBlock } from './liveMarkdown'
import { emptyInlineDeletion, visibleInlineEditPosition } from './inlineDeletion.js'
import { markdownEditorLanguage, sourceMarkdownHighlight, visualCodeHighlight } from './editorHighlight.js'
import { renderSafeHtmlImage } from './safeHtmlImage'
import { applyImageUrls, originalImageSource } from './imageUrls'
import { currentPaperTheme, extractMermaidFence, mountMermaidCard } from './mermaidRenderer'
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, parseMarkdownTable, serializeMarkdownTable, setTableColumnAlign, updateTableCell, type TableAlignment } from './markdownTable'
import { extractDisplayMathBlock, renderKatexMath } from './markdownTypora'
import { handleTyporaEnter, handleTyporaListIndent, smartPasteUrl } from './typoraKeymap'

const props = defineProps<{
  modelValue: string
  mode: 'source' | 'visual'
  readonly?: boolean
  focusMode?: boolean
  typewriterMode?: boolean
  showLineNumbers?: boolean
  attachmentContext?: string
  imageUrls?: Readonly<Record<string, string>>
  savePastedImages?: (files: File[]) => Promise<string[]>
  onPasteStatus?: (message: string) => void
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  keydown: [event: KeyboardEvent]
  failure: []
  selection: [rect: { left: number; top: number; bottom: number } | null]
  'navigate-link': [href: string]
  'visual-edit-mermaid': [payload: { from: number; to: number; code: string }]
  'visual-edit-math': [payload: { from: number; to: number; tex: string; block: boolean }]
}>()

const host = ref<HTMLElement | null>(null)
const fallback = ref<HTMLTextAreaElement | null>(null)
const failed = ref(false)
const pasteError = ref('')
const legacyNewlines = computed(() => /\r(?!\n)/.test(props.modelValue))
const modeCompartment = new Compartment()
const readonlyCompartment = new Compartment()
const lineNumbersCompartment = new Compartment()
let view: EditorView | null = null
let composing = false
let selectionFrame = 0
let typewriterFrame = 0
let imageRevision = 0
let themeRevision = 0
let themeObserver: MutationObserver | undefined
let pointerSelecting = false
let keyboardSelecting = false
let rawTableBlockFrom: number | null = null
let pendingTableFocus: { blockFrom: number; row: number; col: number; edit: boolean } | null = null
const activeTableCells = new Map<number, { row: number; col: number }>()
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

function centerTypewriterCaret() {
  if (!props.typewriterMode || !view || !view.hasFocus || composing) return
  cancelAnimationFrame(typewriterFrame)
  typewriterFrame = requestAnimationFrame(() => {
    if (!view || !props.typewriterMode) return
    const coords = view.coordsAtPos(view.state.selection.main.head)
    if (!coords) return
    const targetY = window.innerHeight * 0.45
    const delta = coords.top - targetY
    if (Math.abs(delta) > 28) window.scrollBy(0, delta)
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

function insertImageFiles(files: File[], targetRange?: { start: number; end: number }): boolean {
  if (props.readonly || !files.length) return false
  const supported = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  if (files.some(file => !file || !supported.has(file.type))) {
    pasteError.value = '仅支持插入 PNG、JPEG、GIF 或 WebP 图片。'
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
  const before = currentText(), selection = targetRange || selectionRange(), originalView = view, originalFallback = fallback.value
  const originalContext = props.attachmentContext
  const reportStatus = props.onPasteStatus
  const report = (message: string) => { if (reportStatus) reportStatus(message); else pasteError.value = message }
  pasteError.value = ''
  let saved: Promise<string[]>
  try { saved = Promise.resolve(saveImages(files)) }
  catch (error) { saved = Promise.reject(error) }
  saved.then(images => {
    const now = targetRange || selectionRange()
    if (props.attachmentContext !== originalContext || view !== originalView || fallback.value !== originalFallback) {
      report('图片处理期间已离开原章节，未插入正文；请回到原章节重新插入。')
      return
    }
    if (props.readonly) {
      report('图片已保存到本机，但编辑器正忙，未插入正文；请在同步或恢复结束后重试。')
      return
    }
    if (currentText() !== before || now.start !== selection.start || now.end !== selection.end) {
      pasteError.value = '读取图片时正文或选区已改变，请在目标位置重新插入。'
      return
    }
    if (images.length !== files.length || images.some(image => !/^assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/.test(image))) {
      pasteError.value = '图片保存结果无效，请重新插入。'
      return
    }
    const insert = images.map((image, index) => {
      const cleanAlt = (files[index]?.name || '').replace(/\.[^.]+$/, '').replace(/[\[\]\r\n]/g, '') || `图片${images.length > 1 ? index + 1 : ''}`
      return `![${cleanAlt}](${image})`
    }).join('\n')
    replace(selection.start, selection.end, insert, selection.start + insert.length, selection.start + insert.length, true)
  }).catch((error: unknown) => {
    report(error instanceof Error && error.message ? `图片未插入正文：${error.message}` : '无法保存图片，请检查本地存储空间后重试。')
  })
  return true
}

function handlePaste(event: ClipboardEvent): boolean {
  if (props.readonly) return false
  const items = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
  if (items.length) {
    event.preventDefault()
    const files = items.map(item => item.getAsFile()).filter((f): f is File => f !== null)
    return insertImageFiles(files)
  }
  // Typora Smart URL Paste: pasting a URL over selected text turns it into [text](url).
  const text = event.clipboardData?.getData('text/plain') || ''
  if (text && view) {
    const sel = view.state.selection.main
    const edit = smartPasteUrl(view.state.doc.toString(), sel.from, sel.to, text)
    if (edit) {
      event.preventDefault()
      replace(edit.from, edit.to, edit.insert, edit.selectionStart, edit.selectionEnd, true)
      return true
    }
  }
  return false
}

function handleImageDrop(event: DragEvent, instance: EditorView): boolean {
  if (props.readonly) return false
  const files = Array.from(event.dataTransfer?.files || [])
  if (!files.length || !files.every(file => file.type.startsWith('image/'))) return false
  event.preventDefault()
  event.stopPropagation()
  const pos = instance.posAtCoords({ x: event.clientX, y: event.clientY })
  const caret = pos ?? instance.state.selection.main.head
  return insertImageFiles(files, { start: caret, end: caret })
}

class MermaidBlockWidget extends WidgetType {
  private dispose?: () => void
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly code: string,
    private readonly themeVersion: number
  ) { super() }
  eq(other: MermaidBlockWidget) {
    return this.from === other.from && this.to === other.to && this.code === other.code && this.themeVersion === other.themeVersion
  }
  toDOM(editor: EditorView) {
    const host = document.createElement('div')
    const enterEdit = () => {
      if (editor.state.readOnly) return
      const firstLine = editor.state.doc.lineAt(this.from)
      const targetPos = firstLine.to < this.to ? Math.min(this.to, firstLine.to + 1) : this.from
      editor.dispatch({ selection: EditorSelection.cursor(targetPos) })
      editor.focus()
    }
    this.dispose = mountMermaidCard(host, this.code, {
      theme: currentPaperTheme(),
      showSourceToggle: false,
      onVisualEdit: editor.state.readOnly ? undefined : () => emit('visual-edit-mermaid', { from: this.from, to: this.to, code: this.code }),
      onEdit: editor.state.readOnly ? undefined : enterEdit,
      editLabel: '源码'
    })
    host.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation()
      if (!editor.state.readOnly) emit('visual-edit-mermaid', { from: this.from, to: this.to, code: this.code })
    })
    return host
  }
  destroy() { this.dispose?.(); this.dispose = undefined }
  ignoreEvent() { return true }
}

class MermaidLivePreviewWidget extends WidgetType {
  private dispose?: () => void
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly code: string,
    private readonly themeVersion: number
  ) { super() }
  eq(other: MermaidLivePreviewWidget) { return this.from === other.from && this.to === other.to && this.code === other.code && this.themeVersion === other.themeVersion }
  toDOM(editor: EditorView) {
    const host = document.createElement('div')
    this.dispose = mountMermaidCard(host, this.code, {
      theme: currentPaperTheme(),
      showSourceToggle: false,
      compact: true,
      onVisualEdit: editor.state.readOnly ? undefined : () => emit('visual-edit-mermaid', { from: this.from, to: this.to, code: this.code })
    })
    return host
  }
  destroy() { this.dispose?.(); this.dispose = undefined }
  ignoreEvent() { return true }
}

class MathLivePreviewWidget extends WidgetType {
  constructor(private readonly from: number, private readonly to: number, private readonly tex: string) { super() }
  eq(other: MathLivePreviewWidget) { return this.from === other.from && this.to === other.to && this.tex === other.tex }
  toDOM(editor: EditorView) {
    const box = document.createElement('div')
    box.className = 'cm-paper-math-preview'
    const head = document.createElement('div')
    head.className = 'cm-paper-math-preview-head'
    const label = document.createElement('span')
    label.className = 'cm-paper-math-preview-label'
    label.textContent = 'LATEX · 实时预览'
    head.append(label)
    if (!editor.state.readOnly) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'paper-mermaid-btn is-primary'
      btn.textContent = '可视化编辑公式'
      btn.addEventListener('pointerdown', e => e.stopPropagation())
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation()
        emit('visual-edit-math', { from: this.from, to: this.to, tex: this.tex, block: true })
      })
      head.append(btn)
    }
    const body = document.createElement('div')
    body.innerHTML = renderKatexMath(this.tex, true)
    box.append(head, body)
    return box
  }
  ignoreEvent() { return true }
}

class InlineMathWidget extends WidgetType {
  constructor(private readonly from: number, private readonly to: number, private readonly tex: string) { super() }
  eq(other: InlineMathWidget) { return this.from === other.from && this.to === other.to && this.tex === other.tex }
  toDOM(editor: EditorView) {
    const span = document.createElement('span')
    span.className = 'cm-paper-inline-math'
    span.title = '单击编辑源码 · 双击打开可视化公式编辑器'
    span.innerHTML = renderKatexMath(this.tex, false)
    span.addEventListener('dblclick', event => {
      if (editor.state.readOnly) return
      event.preventDefault()
      event.stopPropagation()
      emit('visual-edit-math', { from: this.from, to: this.to, tex: this.tex, block: false })
    })
    span.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      editor.dispatch({ selection: EditorSelection.cursor(this.from + 1) })
      editor.focus()
    })
    return span
  }
  ignoreEvent() { return true }
}

class TableBlockWidget extends WidgetType {
  constructor(private readonly block: MarkdownBlock, private readonly imageVersion: number) { super() }
  eq(other: TableBlockWidget) {
    return this.block.from === other.block.from && this.block.to === other.block.to &&
      this.block.source === other.block.source && this.block.html === other.block.html &&
      this.imageVersion === other.imageVersion
  }
  toDOM(editor: EditorView) {
    const container = document.createElement('div')
    container.className = 'cm-paper-table-widget vp-doc'

    const parsed = parseMarkdownTable(this.block.source)
    const totalRows = parsed ? parsed.rows.length + 1 : 0
    const totalCols = parsed ? parsed.headers.length : 0

    let activeCell = activeTableCells.get(this.block.from) || { row: 0, col: 0 }
    if (parsed) {
      activeCell = {
        row: Math.max(0, Math.min(totalRows - 1, activeCell.row)),
        col: Math.max(0, Math.min(totalCols - 1, activeCell.col))
      }
      activeTableCells.set(this.block.from, activeCell)
    }

    const commitTable = (nextTable: ReturnType<typeof parseMarkdownTable>, nextFocus?: { row: number; col: number; edit: boolean }) => {
      if (!nextTable || editor.state.readOnly) return
      if (editor.state.doc.sliceString(this.block.from, this.block.to) !== this.block.source) return
      const serialized = serializeMarkdownTable(nextTable)
      if (nextFocus) {
        activeTableCells.set(this.block.from, { row: nextFocus.row, col: nextFocus.col })
        pendingTableFocus = { blockFrom: this.block.from, ...nextFocus }
      }
      if (serialized !== this.block.source) {
        editor.dispatch({ changes: { from: this.block.from, to: this.block.to, insert: serialized } })
      } else if (nextFocus?.edit) {
        openCellEditor(nextFocus.row, nextFocus.col)
      }
    }

    const bar = document.createElement('div')
    bar.className = 'cm-paper-table-bar'
    const meta = document.createElement('span')
    meta.className = 'cm-paper-table-meta'
    meta.textContent = parsed ? `表格 · ${totalRows} 行 × ${totalCols} 列` : '表格'
    const tools = document.createElement('div')
    tools.className = 'cm-paper-table-tools'

    const addTool = (label: string, title: string, onClick: () => void, disabled = false, active = false) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = label
      btn.title = title
      btn.disabled = disabled || editor.state.readOnly
      if (active) btn.classList.add('is-active')
      btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation() })
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick() })
      tools.append(btn)
      return btn
    }
    const addSep = () => {
      const sep = document.createElement('span')
      sep.className = 'cm-paper-table-sep'
      sep.setAttribute('aria-hidden', 'true')
      tools.append(sep)
    }

    const alignButtons: Partial<Record<TableAlignment, HTMLButtonElement>> = {}
    const updateActiveHighlight = () => {
      const allRows = scrollWrap.querySelectorAll('tr')
      allRows.forEach((tr, rIdx) => {
        Array.from(tr.children).forEach((td, cIdx) => {
          td.classList.toggle('is-active-cell', rIdx === activeCell.row && cIdx === activeCell.col)
        })
      })
      if (parsed) {
        const align = parsed.alignments[activeCell.col] || 'none'
        alignButtons.left?.classList.toggle('is-active', align === 'left')
        alignButtons.center?.classList.toggle('is-active', align === 'center')
        alignButtons.right?.classList.toggle('is-active', align === 'right')
      }
    }

    if (parsed) {
      addTool('+ 上行', '在当前行上方插入一行', () => {
        const insertIdx = Math.max(0, activeCell.row - 1)
        commitTable(insertTableRow(parsed, insertIdx), { row: insertIdx + 1, col: activeCell.col, edit: true })
      })
      addTool('+ 下行', '在当前行下方插入一行', () => {
        const insertIdx = activeCell.row === 0 ? 0 : activeCell.row
        commitTable(insertTableRow(parsed, insertIdx), { row: insertIdx + 1, col: activeCell.col, edit: true })
      })
      addTool('− 删行', '删除当前数据行', () => {
        if (parsed.rows.length === 0) return
        const bodyIdx = activeCell.row > 0 ? activeCell.row - 1 : parsed.rows.length - 1
        commitTable(deleteTableRow(parsed, bodyIdx), { row: Math.max(0, Math.min(parsed.rows.length - 1, bodyIdx)), col: activeCell.col, edit: false })
      }, parsed.rows.length === 0)
      addSep()
      addTool('+ 左列', '在当前列左侧插入一列', () => {
        commitTable(insertTableColumn(parsed, activeCell.col), { row: 0, col: activeCell.col, edit: true })
      })
      addTool('+ 右列', '在当前列右侧插入一列', () => {
        commitTable(insertTableColumn(parsed, activeCell.col + 1), { row: 0, col: activeCell.col + 1, edit: true })
      })
      addTool('− 删列', '删除当前列', () => {
        if (parsed.headers.length <= 1) return
        commitTable(deleteTableColumn(parsed, activeCell.col), { row: activeCell.row, col: Math.max(0, activeCell.col - 1), edit: false })
      }, parsed.headers.length <= 1)
      addSep()
      const toggleAlign = (target: TableAlignment) => {
        const current = parsed.alignments[activeCell.col] || 'none'
        commitTable(setTableColumnAlign(parsed, activeCell.col, current === target ? 'none' : target), { row: activeCell.row, col: activeCell.col, edit: false })
      }
      alignButtons.left = addTool('左对齐', '设置当前列左对齐', () => toggleAlign('left'))
      alignButtons.center = addTool('居中', '设置当前列居中对齐', () => toggleAlign('center'))
      alignButtons.right = addTool('右对齐', '设置当前列右对齐', () => toggleAlign('right'))
      addSep()
    }

    const sourceBtn = addTool('源码', '以 Markdown 源码编辑此表格', () => {
      rawTableBlockFrom = this.block.from
      editor.dispatch({ selection: EditorSelection.cursor(this.block.from), effects: refreshVisual.of(null) })
      editor.focus()
    })
    sourceBtn.disabled = false

    bar.append(meta, tools)

    const scrollWrap = document.createElement('div')
    scrollWrap.className = 'paper-table-scroll'
    scrollWrap.innerHTML = this.block.html
    applyImageUrls(scrollWrap, props.imageUrls)

    const hint = document.createElement('p')
    hint.className = 'cm-paper-table-hint'
    hint.textContent = '点击任意单元格编辑（支持粗体/代码/公式/链接）；Tab 切换下一格（末格自动增行），Enter 换行，Esc 取消'

    container.append(bar, scrollWrap, hint)

    const openCellEditor = (row: number, col: number) => {
      if (!parsed || editor.state.readOnly) return
      const rows = Array.from(scrollWrap.querySelectorAll('tr'))
      const tr = rows[row]
      const cell = tr?.children[col] as HTMLTableCellElement | undefined
      if (!cell || cell.querySelector('input')) return
      activeCell = { row, col }
      activeTableCells.set(this.block.from, activeCell)
      updateActiveHighlight()

      const originalRaw = row === 0 ? (parsed.headers[col] ?? '') : (parsed.rows[row - 1]?.[col] ?? '')
      const originalHtml = cell.innerHTML
      const input = document.createElement('input')
      input.className = 'cm-paper-cell-input'
      input.value = originalRaw
      input.setAttribute('aria-label', '编辑表格单元格，Tab 下一格，Enter 下一行，Esc 取消')
      cell.replaceChildren(input)

      let done = false
      const finish = (commit: boolean, nextNav?: { row: number; col: number; edit: boolean; appendRow?: boolean }) => {
        if (done) return
        done = true
        const nextValue = input.value.replace(/\r?\n/g, ' ')
        const changed = commit && nextValue !== originalRaw
        if (changed || nextNav?.appendRow) {
          let updated = changed ? updateTableCell(parsed, row, col, nextValue) : parsed
          if (nextNav?.appendRow) updated = insertTableRow(updated, updated.rows.length)
          commitTable(updated, nextNav ? { row: nextNav.row, col: nextNav.col, edit: nextNav.edit } : { row, col, edit: false })
        } else {
          cell.innerHTML = originalHtml
          applyImageUrls(cell, props.imageUrls)
          if (nextNav) {
            if (nextNav.edit) openCellEditor(nextNav.row, nextNav.col)
            else { activeCell = { row: nextNav.row, col: nextNav.col }; activeTableCells.set(this.block.from, activeCell); updateActiveHighlight() }
          }
        }
      }

      input.addEventListener('pointerdown', e => e.stopPropagation())
      input.addEventListener('keydown', e => {
        e.stopPropagation()
        if (e.isComposing) return
        if (e.key === 'Tab') {
          e.preventDefault()
          if (e.shiftKey) {
            if (col > 0) finish(true, { row, col: col - 1, edit: true })
            else if (row > 0) finish(true, { row: row - 1, col: totalCols - 1, edit: true })
            else finish(true)
          } else {
            if (col + 1 < totalCols) finish(true, { row, col: col + 1, edit: true })
            else if (row + 1 < totalRows) finish(true, { row: row + 1, col: 0, edit: true })
            else finish(true, { row: totalRows, col: 0, edit: true, appendRow: true })
          }
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (row + 1 < totalRows) finish(true, { row: row + 1, col, edit: true })
          else { finish(true); requestAnimationFrame(() => { if (editor.dom.isConnected) editor.focus() }) }
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
          requestAnimationFrame(() => { if (editor.dom.isConnected) editor.focus() })
        }
      })
      input.addEventListener('blur', () => finish(true))
      input.focus()
      input.select()
    }

    scrollWrap.addEventListener('click', event => event.preventDefault())
    scrollWrap.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT') return
      const cell = target?.closest('td, th') as HTMLTableCellElement | null
      const table = cell?.closest('table')
      if (!cell || !table) return
      event.preventDefault()
      event.stopPropagation()
      const row = Array.from(table.querySelectorAll('tr')).indexOf(cell.parentElement as HTMLTableRowElement)
      const col = Array.from(cell.parentElement?.children || []).indexOf(cell)
      if (!parsed) {
        rawTableBlockFrom = this.block.from
        editor.dispatch({ selection: EditorSelection.cursor(this.block.from), effects: refreshVisual.of(null) })
        editor.focus()
        return
      }
      openCellEditor(row, col)
    })

    updateActiveHighlight()
    if (pendingTableFocus && pendingTableFocus.blockFrom === this.block.from) {
      const target = pendingTableFocus
      pendingTableFocus = null
      requestAnimationFrame(() => {
        if (!container.isConnected) return
        if (target.edit) openCellEditor(target.row, target.col)
        else { activeCell = { row: target.row, col: target.col }; activeTableCells.set(this.block.from, activeCell); updateActiveHighlight() }
      })
    }

    return container
  }
  ignoreEvent() { return true }
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

class TaskToggleWidget extends WidgetType {
  constructor(private readonly from: number, private readonly to: number, private readonly checked: boolean) { super() }
  eq(other: TaskToggleWidget) { return this.from === other.from && this.to === other.to && this.checked === other.checked }
  toDOM(editor: EditorView) {
    const span = document.createElement('span')
    span.className = 'cm-paper-task-toggle'
    span.setAttribute('role', 'checkbox')
    span.setAttribute('aria-checked', String(this.checked))
    span.title = this.checked ? '点击取消完成' : '点击标记完成'
    span.textContent = this.checked ? '☑' : '☐'
    span.addEventListener('pointerdown', event => {
      if (event.button !== 0 || editor.state.readOnly) return
      event.preventDefault()
      event.stopPropagation()
      const current = editor.state.doc.sliceString(this.from, this.to)
      if (!/^\[[ xX]\]$/.test(current)) return
      const next = this.checked ? '[ ]' : '[x]'
      editor.dispatch({ changes: { from: this.from, to: this.to, insert: next } })
    })
    return span
  }
  ignoreEvent() { return true }
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
    img.title = '点击图片编辑地址、描述与缩放比例'
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

      // Typora-style quick zoom buttons (25% / 50% / 75% / 100%)
      const zoomRow = document.createElement('div')
      zoomRow.className = 'cm-paper-image-zoom'
      const zoomLabel = document.createElement('span')
      zoomLabel.textContent = '缩放：'
      zoomRow.append(zoomLabel)
      for (const pct of [25, 50, 75, 100]) {
        const zBtn = document.createElement('button')
        zBtn.type = 'button'
        zBtn.textContent = `${pct}%`
        zBtn.addEventListener('click', () => {
          const cleanSrc = url.value.trim()
          if (!cleanSrc || /["'<>\r\n]/.test(cleanSrc)) { status.textContent = '图片地址含不支持字符。'; return }
          if (editor.state.doc.sliceString(this.from, this.to) !== this.source) { status.textContent = '正文已改变，请重新打开。'; return }
          const cleanAlt = alt.value.replace(/["<>\r\n]/g, '')
          const nextTag = pct === 100
            ? `![${cleanAlt.replace(/\]/g, '\\]')}](${cleanSrc})`
            : `<img src="${cleanSrc}" alt="${cleanAlt}" style="zoom:${pct}%;" />`
          editor.dispatch({ changes: { from: this.from, to: this.to, insert: nextTag } })
          requestAnimationFrame(() => { if (editor.dom.isConnected) editor.focus() })
        })
        zoomRow.append(zBtn)
      }

      form.append(alt, url, save, cancel, zoomRow, status)
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
  const blockActive = selection.some(range => range.from <= to && range.to >= from)
  const match = /^\s*(`{3,}|~{3,})([^\r\n]*)/.exec(state.doc.sliceString(from, first.to))
  if (!match) return
  const language = (match[2].trim().split(/\s+/)[0] || '代码').slice(0, 40)
  const openingFence = match[1]
  let codeLineNo = 0
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n), isFirst = n === first.number
    const closing = /^\s*(`+|~+)\s*\r?$/.exec(line.text)?.[1] || ''
    const closed = n === last.number && n > first.number && closing[0] === openingFence[0] && closing.length >= openingFence.length
    const fenceLine = isFirst || closed
    if (!fenceLine) codeLineNo++
    const fenceStart = isFirst ? from : closed ? line.from + line.text.indexOf(closing) : line.from
    const revealFence = fenceLine && selection.some(range => range.from <= line.to && range.to >= fenceStart)
    const attrs: Record<string, string> | undefined = isFirst
      ? { 'data-language': language }
      : !fenceLine
        ? { 'data-code-line': String(codeLineNo) }
        : undefined
    ranges.push(Decoration.line({ class: `cm-paper-code-line${isFirst ? ' cm-paper-code-open' : ''}${closed ? ' cm-paper-code-close' : ''}${revealFence ? ' cm-paper-code-revealed' : ''}${blockActive ? ' cm-paper-focus-active' : ''}`, attributes: attrs }).range(line.from))
    if (fenceLine && !revealFence && line.to > fenceStart) ranges.push(Decoration.replace({}).range(fenceStart, line.to))
  }
}

/** Add live Typora inline decorations for $math$ and ==highlight== on non-code segments of a block. */
function addTyporaInlineDecorations(
  state: EditorState,
  selection: readonly { from: number; to: number }[],
  ranges: Range<Decoration>[],
  blockFrom: number,
  blockTo: number,
  codeSpans: Array<[number, number]>
) {
  const inCode = (from: number, to: number) => codeSpans.some(([cFrom, cTo]) => from < cTo && to > cFrom)
  const firstLine = state.doc.lineAt(blockFrom).number
  const lastLine = state.doc.lineAt(blockTo).number
  for (let n = firstLine; n <= lastLine; n++) {
    const line = state.doc.line(n)
    const text = line.text

    // 1. Inline math: $...$ (never cross another unescaped $, preserving currency like $100 and $200)
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '$' || text[i + 1] === '$' || (i > 0 && text[i - 1] === '\\')) continue
      if (!text[i + 1] || /\s/.test(text[i + 1])) continue
      let j = i + 1
      let matched = -1
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === '$') {
          const validClose = Boolean(
            text[j - 1] &&
            !/\s/.test(text[j - 1]) &&
            text[j + 1] !== '$' &&
            !(text[j + 1] && /[0-9]/.test(text[j + 1]))
          )
          const inner = text.slice(i + 1, j)
          if (validClose && inner.length > 0 && !/^\d[\d,]*(?:\.\d+)?\s*[，。；：、！？]/.test(inner)) {
            matched = j
          }
          break
        }
        j++
      }
      if (matched > i + 1) {
        const absFrom = line.from + i
        const absTo = line.from + matched + 1
        if (!inCode(absFrom, absTo) && !selection.some(r => r.from <= absTo && r.to >= absFrom)) {
          ranges.push(Decoration.replace({ widget: new InlineMathWidget(absFrom, absTo, text.slice(i + 1, matched)) }).range(absFrom, absTo))
        }
        i = matched
      }
    }

    // 2. Highlight: ==text==
    const markPattern = /==([^\s=](?:[^=\r\n]*[^\s=])?)==/g
    let match: RegExpExecArray | null
    while ((match = markPattern.exec(text))) {
      const absFrom = line.from + match.index
      const absTo = absFrom + match[0].length
      if (inCode(absFrom, absTo)) continue
      ranges.push(Decoration.mark({ class: 'cm-paper-mark' }).range(absFrom + 2, absTo - 2))
      if (!revealInlineMarker(selection, absFrom, absFrom + 2)) ranges.push(Decoration.replace({}).range(absFrom, absFrom + 2))
      if (!revealInlineMarker(selection, absTo - 2, absTo)) ranges.push(Decoration.replace({}).range(absTo - 2, absTo))
    }
  }
}

function renderedDecorations(state: EditorState): DecorationSet {
  try {
    ensureSyntaxTree(state, Math.min(state.doc.length, 60000), 60)
    const selection = state.selection.ranges
    // Only reveal raw Markdown markers for a collapsed caret; drag-selecting text
    // must keep rendered prose intact instead of expanding back into raw syntax.
    const caretSelections = selection.filter(range => range.from === range.to)
    const text = state.doc.toString()
    if (/\r(?!\n)/.test(text)) return Decoration.none
    const blocks = markdownBlocks(text)
    const environment = markdownEnvironment(text)
    const ranges: Range<Decoration>[] = []
    if (rawTableBlockFrom !== null) {
      const stillInside = blocks.some(b => b.type === 'table_open' && b.from === rawTableBlockFrom && selection.some(r => r.from <= b.to && r.to >= b.from))
      if (!stillInside) rawTableBlockFrom = null
    }
    for (const block of blocks) {
      const active = selection.some(range => range.from <= block.to && range.to >= block.from)
      if (block.type === 'fence') {
        const mermaidFence = extractMermaidFence(block.source)
        if (mermaidFence) {
          if (!active) {
            ranges.push(Decoration.replace({ widget: new MermaidBlockWidget(block.from, block.to, mermaidFence.code, themeRevision), block: true }).range(block.from, block.to))
            continue
          }
          addFenceDecorations(state, selection, ranges, block.from, block.to)
          ranges.push(Decoration.widget({ widget: new MermaidLivePreviewWidget(block.from, block.to, mermaidFence.code, themeRevision), side: 1, block: true }).range(block.to))
          continue
        }
        addFenceDecorations(state, selection, ranges, block.from, block.to)
        continue
      }
      if (block.type === 'paper_math_block') {
        if (!active) {
          ranges.push(Decoration.replace({ widget: new RenderedBlock(block, imageRevision), block: true }).range(block.from, block.to))
          continue
        }
        const first = state.doc.lineAt(block.from).number, last = state.doc.lineAt(block.to).number
        for (let n = first; n <= last; n++) {
          ranges.push(Decoration.line({ class: `cm-paper-code-line${active ? ' cm-paper-focus-active' : ''}` }).range(state.doc.line(n).from))
        }
        const tex = extractDisplayMathBlock(block.source)
        if (tex) ranges.push(Decoration.widget({ widget: new MathLivePreviewWidget(block.from, block.to, tex), side: 1, block: true }).range(block.to))
        continue
      }
      if (block.type === 'code_block') {
        const first = state.doc.lineAt(block.from).number, last = state.doc.lineAt(block.to).number
        for (let n = first; n <= last; n++) {
          ranges.push(Decoration.line({ class: `cm-paper-code-line${n === first ? ' cm-paper-code-indented-start' : ''}${n === last ? ' cm-paper-code-indented-end' : ''}${active ? ' cm-paper-focus-active' : ''}` }).range(state.doc.line(n).from))
        }
        continue
      }
      if (block.type === 'table_open') {
        if (rawTableBlockFrom === block.from && active) {
          for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
            ranges.push(Decoration.line({ class: 'cm-paper-code-line cm-paper-focus-active' }).range(state.doc.line(n).from))
          }
          continue
        }
        ranges.push(Decoration.replace({ widget: new TableBlockWidget(block, imageRevision), block: true }).range(block.from, block.to))
        continue
      }
      // Typora Callouts (> [!NOTE] etc.) render cleanly as styled callout card when inactive.
      const isCallout = block.type === 'blockquote_open' && /^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(block.source)
      if (!active && (!block.direct || isCallout)) {
        ranges.push(Decoration.replace({ widget: new RenderedBlock(block, imageRevision), block: true }).range(block.from, block.to))
        continue
      }
      for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
        const line = state.doc.line(n)
        ranges.push(Decoration.line({ class: `cm-paper-prose${block.type === 'blockquote_open' ? ' cm-paper-quote' : ''}${active ? ' cm-paper-focus-active' : ''}` }).range(line.from))
      }
      const codeSpans: Array<[number, number]> = []
      syntaxTree(state).iterate({ from: block.from, to: block.to, enter(node) {
        if (node.name === 'FencedCode') { codeSpans.push([node.from, node.to]); addFenceDecorations(state, selection, ranges, node.from, node.to); return false }
        if (node.name === 'InlineCode') { codeSpans.push([node.from, node.to]) }
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
            if (!caretSelections.some(range => range.from <= end && range.to >= marker.from)) ranges.push(Decoration.replace({}).range(marker.from, end))
          }
        }
        if (node.name === 'Link') {
          const marks = node.node.getChildren('LinkMark')
          const open = marks[0], labelEnd = marks[1]
          if (open && labelEnd && open.to < labelEnd.from) {
            ranges.push(Decoration.mark({ class: 'cm-paper-link' }).range(open.to, labelEnd.from))
            for (const [from, to] of [[open.from, open.to], [labelEnd.from, node.to]]) {
              if (!revealInlineMarker(caretSelections, from, to)) ranges.push(Decoration.replace({}).range(from, to))
            }
          }
          return
        }
        if (node.name === 'TaskMarker') {
          if (caretSelections.some(range => range.from <= node.to && range.to >= node.from)) return
          const raw = state.doc.sliceString(node.from, node.to)
          ranges.push(Decoration.replace({ widget: new TaskToggleWidget(node.from, node.to, /x/i.test(raw)) }).range(node.from, node.to))
          return
        }
        if (node.name === 'ListMark' || node.name === 'QuoteMark') {
          if (caretSelections.some(range => range.from <= node.to && range.to >= node.from)) return
          const raw = state.doc.sliceString(node.from, node.to)
          const marker = node.name === 'ListMark' && /^[-*+]$/.test(raw) ? '•' : node.name === 'QuoteMark' ? '' : raw
          ranges.push(Decoration.replace(marker ? { widget: new InlineMarker(marker) } : {}).range(node.from, node.to))
          return
        }
        const inlineClass = node.name === 'StrongEmphasis' ? 'cm-paper-strong' : node.name === 'Emphasis' ? 'cm-paper-emphasis' : node.name === 'Strikethrough' ? 'cm-paper-strike' : node.name === 'InlineCode' ? 'cm-paper-code' : ''
        if (!inlineClass) return
        const first = node.node.firstChild, last = node.node.lastChild
        if (!first || !last || first === last || first.to >= last.from) return
        ranges.push(Decoration.mark({ class: inlineClass }).range(first.to, last.from))
        for (const mark of [first, last]) {
          if (!revealInlineMarker(caretSelections, mark.from, mark.to)) ranges.push(Decoration.replace({}).range(mark.from, mark.to))
        }
      } })
      addTyporaInlineDecorations(state, caretSelections, ranges, block.from, block.to, codeSpans)
    }
    return Decoration.set(ranges, true)
  } catch { return Decoration.none }
}

const renderedField = StateField.define<DecorationSet>({
  create: renderedDecorations,
  update(value, transaction) {
    if (composing && (transaction.docChanged || transaction.selection)) return value.map(transaction.changes)
    const treeUpdated = syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
    return transaction.docChanged || transaction.selection || treeUpdated || transaction.effects.some(effect => effect.is(refreshVisual))
      ? renderedDecorations(transaction.state)
      : value
  },
  provide: field => EditorView.decorations.from(field)
})

function displayExtension(mode: 'source' | 'visual') {
  return mode === 'visual' ? [renderedField, syntaxHighlighting(visualCodeHighlight)] : [syntaxHighlighting(sourceMarkdownHighlight)]
}
function lineNumbersExtension(mode: 'source' | 'visual', enabled: boolean) {
  return mode === 'source' && enabled ? [lineNumbers()] : []
}
function editableExtension(readonly: boolean) { return [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)] }

function runTyporaEnter(target: EditorView): boolean {
  if (composing || target.state.readOnly || target.state.selection.ranges.length !== 1) return false
  const sel = target.state.selection.main
  if (!sel.empty) return false
  const edit = handleTyporaEnter(target.state.doc.toString(), sel.head)
  if (!edit) return false
  target.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: EditorSelection.cursor(edit.selectionStart), scrollIntoView: true })
  return true
}

function runTyporaTab(target: EditorView, outdent: boolean): boolean {
  if (composing || target.state.readOnly) return false
  const sel = target.state.selection.main
  const edit = handleTyporaListIndent(target.state.doc.toString(), sel.from, sel.to, outdent)
  if (edit) {
    target.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.selectionStart, head: edit.selectionEnd } })
    return true
  }
  return outdent ? indentLess(target) : insertTab(target)
}

function deleteVisibleInline(target: EditorView, direction: -1 | 1): boolean {
  if (props.mode !== 'visual' || composing || target.state.readOnly || target.state.selection.ranges.length !== 1) return false
  const selection = target.state.selection.main
  if (!selection.empty) return false
  const empty = emptyInlineDeletion(target.state, selection.head, direction)
  if (empty) {
    const insert = empty.text || ''
    target.dispatch({ changes: { from: empty.from, to: empty.to, insert }, selection: EditorSelection.cursor(empty.from + insert.length), annotations: isolateHistory.of('full') })
    return true
  }
  const position = visibleInlineEditPosition(target.state, selection.head, direction)
  if (position === null) return false
  const line = target.state.doc.lineAt(position)
  const offset = position - line.from
  if (direction === -1 && offset === 0 || direction === 1 && offset === line.text.length) {
    target.dispatch({ selection: EditorSelection.cursor(position) })
    return (direction === -1 ? deleteCharBackward(target) : deleteCharForward(target)) || true
  }
  const boundary = line.from + findClusterBreak(line.text, offset, direction === 1)
  const from = Math.min(position, boundary), to = Math.max(position, boundary)
  target.dispatch({ changes: { from, to, insert: '' }, selection: EditorSelection.cursor(from), userEvent: direction === -1 ? 'delete.backward' : 'delete.forward' })
  return true
}
function stateFor(value: string) {
  return EditorState.create({
    doc: value,
    extensions: [
      EditorState.lineSeparator.of('\n'), history(), markdownEditorLanguage,
      keymap.of([
        { key: 'Enter', run: runTyporaEnter },
        { key: 'Backspace', run: target => deleteVisibleInline(target, -1) },
        { key: 'Delete', run: target => deleteVisibleInline(target, 1) },
        { key: 'Tab', run: target => runTyporaTab(target, false), shift: target => runTyporaTab(target, true) },
        ...defaultKeymap,
        ...historyKeymap
      ]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': '正文', 'aria-multiline': 'true', spellcheck: 'false' }),
      Prec.high(EditorView.domEventHandlers({
        keydown(event) { selectionKeydown(event); emit('keydown', event); return event.defaultPrevented },
        keyup(event) { selectionKeyup(event); return false },
        pointerdown(event, instance) {
          if ((event.ctrlKey || event.metaKey) && event.button === 0) {
            const pos = instance.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos !== null) {
              let foundHref = ''
              syntaxTree(instance.state).iterate({
                from: pos,
                to: pos,
                enter(node) {
                  if (node.name !== 'Link') return
                  const urlNode = node.node.getChild('URL')
                  if (urlNode) {
                    foundHref = instance.state.doc.sliceString(urlNode.from, urlNode.to).replace(/^<|>$/g, '').trim()
                    return false
                  }
                }
              })
              if (foundHref) {
                event.preventDefault()
                emit('navigate-link', foundHref)
                return true
              }
            }
          }
          beginPointerSelection(event)
          return false
        },
        paste(event) { return handlePaste(event) },
        drop(event, instance) { return handleImageDrop(event, instance) },
        focus() { reportSelection(); return false },
        blur() { keyboardSelecting = false; emit('selection', null); return false },
        compositionstart() { composing = true; emit('selection', null); return false },
        compositionend(_event, instance) {
          composing = false
          requestAnimationFrame(() => { if (view === instance) { instance.dispatch({ effects: refreshVisual.of(null) }); reportSelection() } })
          return false
        }
      })),
      EditorView.updateListener.of(update => {
        if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        if (update.selectionSet || update.docChanged || update.viewportChanged) reportSelection()
        if (update.selectionSet || update.docChanged) centerTypewriterCaret()
      }),
      modeCompartment.of(displayExtension(props.mode)),
      readonlyCompartment.of(editableExtension(!!props.readonly)),
      lineNumbersCompartment.of(lineNumbersExtension(props.mode, props.showLineNumbers !== false))
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
  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      themeRevision++
      try { view?.dispatch({ effects: refreshVisual.of(null) }) } catch { /* ignore */ }
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-paper-theme'] })
  }
  window.addEventListener('scroll', reportSelection, true)
  window.addEventListener('resize', reportSelection)
  window.addEventListener('pointerup', endPointerSelection)
  window.addEventListener('pointercancel', endPointerSelection)
})
onBeforeUnmount(() => {
  composing = false
  cancelAnimationFrame(selectionFrame)
  cancelAnimationFrame(typewriterFrame)
  themeObserver?.disconnect()
  window.removeEventListener('scroll', reportSelection, true)
  window.removeEventListener('resize', reportSelection)
  window.removeEventListener('pointerup', endPointerSelection)
  window.removeEventListener('pointercancel', endPointerSelection)
  view?.destroy()
  view = null
})
watch(() => props.modelValue, value => {
  if (view && view.state.doc.toString() !== value) {
    rawTableBlockFrom = null
    activeTableCells.clear()
    try { view.setState(stateFor(value)) } catch { useFallback() }
  }
})
watch(() => props.mode, mode => {
  rawTableBlockFrom = null
  try {
    view?.dispatch({
      effects: [
        modeCompartment.reconfigure(displayExtension(mode)),
        lineNumbersCompartment.reconfigure(lineNumbersExtension(mode, props.showLineNumbers !== false))
      ]
    })
  } catch { useFallback() }
})
watch(() => props.showLineNumbers, enabled => {
  try {
    view?.dispatch({
      effects: lineNumbersCompartment.reconfigure(lineNumbersExtension(props.mode, enabled !== false))
    })
  } catch { /* ignore */ }
})
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
function selectRange(from: number, to: number) {
  if (!view && fallback.value) {
    fallback.value.focus()
    fallback.value.setSelectionRange(textareaOffsetForRaw(props.modelValue, from), textareaOffsetForRaw(props.modelValue, to))
    return
  }
  if (!view) return
  const clampedFrom = Math.max(0, Math.min(view.state.doc.length, from))
  const clampedTo = Math.max(clampedFrom, Math.min(view.state.doc.length, to))
  view.dispatch({ selection: { anchor: clampedFrom, head: clampedTo }, effects: EditorView.scrollIntoView(clampedFrom, { y: 'center' }) })
  requestAnimationFrame(() => {
    const bounds = view?.coordsAtPos(clampedFrom)
    if (bounds) revealBelowToolbar(bounds.top, bounds.bottom)
  })
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
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (view !== targetView) return
    const bounds = targetView.coordsAtPos(position)
    if (bounds) revealBelowToolbar(bounds.top, bounds.bottom)
  }))
}
function canReorganize() { return !!view && !props.readonly }
defineExpose({ currentText, selectionRange, replace, selectRange, focusHeading, canReorganize, insertImageFiles })
</script>

<template>
  <p v-if="mode === 'visual' && legacyNewlines" class="live-markdown-legacy" role="status">本文含旧式 CR 换行，暂以源码显示以保留原文。</p>
  <p v-if="pasteError" class="live-markdown-paste-error" role="alert">{{ pasteError }}</p>
  <div v-show="!failed" ref="host" class="live-markdown" :class="{ 'is-focus-mode': focusMode && mode === 'visual', 'is-typewriter-mode': typewriterMode }" />
  <textarea v-if="failed" ref="fallback" class="live-markdown-fallback" aria-label="正文" :value="modelValue" :readonly="readonly" spellcheck="false"
    @input="emit('update:modelValue', applyTextareaChange(modelValue, ($event.target as HTMLTextAreaElement).value))" @keydown="fallbackKeydown" @keyup="selectionKeyup" @pointerdown="beginPointerSelection" @select="reportSelection" @paste="handlePaste" />
</template>
