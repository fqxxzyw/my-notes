<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LiveMarkdown from './LiveMarkdown.vue'
import ChapterMarkdown from './ChapterMarkdown.vue'
import FindReplaceBar from './FindReplaceBar.vue'
import MermaidVisualModal from './MermaidVisualModal.vue'
import MathVisualModal from './MathVisualModal.vue'
import { toggleInlineFormat } from './inlineFormatting.js'
import { MERMAID_TEMPLATES } from './mermaidRenderer'
import { applyHeadingLevel, toggleTyporaInline } from './typoraKeymap'
import { computeDocumentStats } from './markdownStats'
import { applyImageUrls } from './imageUrls'
import { useAppSettings } from './appSettings'

export type EditorDisplayMode = 'read' | 'visual' | 'source' | 'split'

const props = defineProps<{
  modelValue: string
  readonly?: boolean
  showReadOption?: boolean
  displayMode?: EditorDisplayMode
  attachmentContext?: string
  imageUrls?: Readonly<Record<string, string>>
  savePastedImages?: (files: File[]) => Promise<string[]>
  onPasteStatus?: (message: string) => void
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:displayMode': [mode: EditorDisplayMode]
  'navigate-link': [href: string]
  'toggle-task': [index: number]
}>()

const editor = ref<InstanceType<typeof LiveMarkdown> | null>(null)
const findBar = ref<InstanceType<typeof FindReplaceBar> | null>(null)
const imageFileInput = ref<HTMLInputElement | null>(null)
const splitSourcePane = ref<HTMLElement | null>(null)
const splitPreviewPane = ref<HTMLElement | null>(null)
const { settings, update: updateSettings } = useAppSettings()

const internalMode = ref<EditorDisplayMode>(props.displayMode || 'visual')
const activeMode = computed<EditorDisplayMode>({
  get: () => props.displayMode ?? internalMode.value,
  set: next => {
    internalMode.value = next
    emit('update:displayMode', next)
  }
})
const liveMode = computed<'source' | 'visual'>(() => (activeMode.value === 'visual' ? 'visual' : 'source'))
const toolbarCollapsed = ref(settings.value.toolbarCollapsed)
watch(() => settings.value.toolbarCollapsed, value => { toolbarCollapsed.value = value })

function toggleToolbarCollapsed() {
  toolbarCollapsed.value = !toolbarCollapsed.value
  updateSettings({ toolbarCollapsed: toolbarCollapsed.value })
}

let scrollSyncLock: 'source' | 'preview' | null = null
let scrollSyncFrame = 0
function syncSplitScroll(origin: 'source' | 'preview') {
  if (scrollSyncLock && scrollSyncLock !== origin) return
  const fromEl = origin === 'source' ? splitSourcePane.value : splitPreviewPane.value
  const toEl = origin === 'source' ? splitPreviewPane.value : splitSourcePane.value
  if (!fromEl || !toEl) return
  const maxFrom = Math.max(1, fromEl.scrollHeight - fromEl.clientHeight)
  const maxTo = Math.max(0, toEl.scrollHeight - toEl.clientHeight)
  const ratio = Math.max(0, Math.min(1, fromEl.scrollTop / maxFrom))
  scrollSyncLock = origin
  toEl.scrollTop = Math.round(ratio * maxTo)
  cancelAnimationFrame(scrollSyncFrame)
  scrollSyncFrame = requestAnimationFrame(() => { scrollSyncLock = null })
}

function hydrateSplitImages() {
  if (activeMode.value !== 'split' || !splitPreviewPane.value || !props.imageUrls) return
  applyImageUrls(splitPreviewPane.value, props.imageUrls)
}
watch([activeMode, () => props.modelValue, () => props.imageUrls], () => {
  void nextTick(hydrateSplitImages)
}, { flush: 'post' })

const editorFallback = ref(false)
const mermaidVisualModal = ref<null | { from: number; to: number; code: string; isNew: boolean }>(null)
const mathVisualModal = ref<null | { from: number; to: number; tex: string; block: boolean; isNew: boolean }>(null)

function openVisualMermaid(payload?: { from: number; to: number; code: string }) {
  if (props.readonly) return
  if (payload) {
    mermaidVisualModal.value = { ...payload, isNew: false }
    return
  }
  const field = editor.value
  const range = field?.selectionRange() ?? { start: 0, end: 0 }
  const selected = field?.currentText().slice(range.start, range.end).trim() || ''
  const template = MERMAID_TEMPLATES.find(item => item.id === mermaidTemplateId.value) || MERMAID_TEMPLATES[0]
  mermaidVisualModal.value = { from: range.start, to: range.end, code: selected || template.code, isNew: true }
}

function applyVisualMermaid(nextCode: string) {
  const modal = mermaidVisualModal.value
  const field = editor.value
  mermaidVisualModal.value = null
  if (!modal || !field || props.readonly) return
  const source = field.currentText()
  if (modal.isNew) {
    const before = modal.from > 0 && source[modal.from - 1] !== '\n' ? '\n\n' : modal.from > 0 && source[modal.from - 2] !== '\n' ? '\n' : ''
    const after = modal.to < source.length && source[modal.to] !== '\n' ? '\n\n' : '\n'
    const snippet = `${before}\`\`\`mermaid\n${nextCode}\n\`\`\`${after}`
    field.replace(modal.from, modal.to, snippet, modal.from + before.length, modal.from + snippet.length, true)
  } else {
    const snippet = `\`\`\`mermaid\n${nextCode}\n\`\`\``
    field.replace(modal.from, modal.to, snippet, modal.from, modal.from + snippet.length, true)
  }
}

function openVisualMath(payload?: { from: number; to: number; tex: string; block: boolean }) {
  if (props.readonly) return
  if (payload) {
    mathVisualModal.value = { ...payload, isNew: false }
    return
  }
  const field = editor.value
  const range = field?.selectionRange() ?? { start: 0, end: 0 }
  const selected = field?.currentText().slice(range.start, range.end).trim() || ''
  mathVisualModal.value = { from: range.start, to: range.end, tex: selected, block: mathKind.value === 'block', isNew: true }
}

function applyVisualMath(result: { tex: string; block: boolean }) {
  const modal = mathVisualModal.value
  const field = editor.value
  mathVisualModal.value = null
  if (!modal || !field || props.readonly) return
  const source = field.currentText()
  if (result.block) {
    const before = modal.isNew && modal.from > 0 && source[modal.from - 1] !== '\n' ? '\n\n' : ''
    const after = modal.isNew && modal.to < source.length && source[modal.to] !== '\n' ? '\n\n' : ''
    const snippet = `${before}$$\n${result.tex}\n$$${after}`
    field.replace(modal.from, modal.to, snippet, modal.from + before.length, modal.from + snippet.length, true)
  } else {
    const snippet = `$${result.tex}$`
    field.replace(modal.from, modal.to, snippet, modal.from, modal.from + snippet.length, true)
  }
}
const codeLanguage = ref('')
const mermaidTemplateId = ref(MERMAID_TEMPLATES[0].id)
const calloutKind = ref<'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'>('NOTE')
const mathKind = ref<'block' | 'inline'>('block')
const findOpen = ref(false)
const replaceOpen = ref(false)
const focusMode = ref(false)
const typewriterMode = ref(false)
const isMac = ref(false)
const formatError = ref('')
const selectionAnchor = ref<{ left: number; top: number; bottom: number } | null>(null)

const stats = computed(() => computeDocumentStats(props.modelValue))

type Action =
  | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'sub' | 'sup'
  | 'inline-code' | 'code-block' | 'link' | 'unordered' | 'ordered' | 'task'
  | 'quote' | 'callout' | 'table' | 'mermaid' | 'math' | 'inline-math'
  | 'toc' | 'footnote' | 'hr'

const selectionTools: { action: Action; label: string; title: string }[] = [
  { action: 'h1', label: 'H1', title: '一级标题' },
  { action: 'h2', label: 'H2', title: '二级标题' },
  { action: 'h3', label: 'H3', title: '三级标题' },
  { action: 'bold', label: 'B', title: '粗体' },
  { action: 'italic', label: 'I', title: '斜体' },
  { action: 'underline', label: 'U', title: '下划线' },
  { action: 'strike', label: 'S', title: '删除线' },
  { action: 'highlight', label: '==', title: '高亮文本' },
  { action: 'inline-code', label: '</>', title: '行内代码' },
  { action: 'inline-math', label: '$', title: '行内公式' },
  { action: 'code-block', label: '{ }', title: '代码块' },
  { action: 'unordered', label: '•≡', title: '无序列表' },
  { action: 'ordered', label: '1.', title: '有序列表' },
  { action: 'task', label: '☑', title: '任务清单' },
  { action: 'quote', label: '❝', title: '引用' },
  { action: 'table', label: '▦', title: '插入表格' },
  { action: 'mermaid', label: '⬡', title: '插入节点图' },
  { action: 'link', label: '↗', title: '插入链接' },
]

function floatingStyle() {
  const rect = selectionAnchor.value!
  const width = Math.min(window.innerWidth - 24, selectionTools.length * 28 + 8)
  const rows = Math.ceil(selectionTools.length / Math.max(1, Math.floor((width - 8) / 28)))
  const height = rows * 28 + 8
  const safeTop = (document.querySelector('.editor-toolbar-sticky')?.getBoundingClientRect().bottom || 0) + 6
  const below = rect.top - height - 6 < safeTop
  const halfWidth = width / 2
  return {
    left: `${Math.max(halfWidth + 12, Math.min(window.innerWidth - halfWidth - 12, rect.left))}px`,
    top: `${below ? Math.min(window.innerHeight - height - 6, rect.bottom + 6) : rect.top - 6}px`,
    transform: `translate(-50%, ${below ? '0' : '-100%'})`
  }
}

const shortcut = (keys: string) => `${isMac.value ? '⌘' : 'Ctrl'}+${isMac.value ? keys.replace('Alt', 'Option') : keys}`

function openFind(withReplace = false) {
  findOpen.value = true
  replaceOpen.value = withReplace && !props.readonly
  findBar.value?.focusFind(withReplace)
}

function handleGlobalShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.isComposing) return
  const key = event.key.toLowerCase()
  if (!event.altKey && !event.shiftKey && key === 'f') {
    event.preventDefault()
    openFind(false)
  } else if (!event.altKey && !event.shiftKey && key === 'h' && !props.readonly) {
    event.preventDefault()
    openFind(true)
  }
}

onMounted(() => {
  isMac.value = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
  window.addEventListener('keydown', handleGlobalShortcut)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(scrollSyncFrame)
  window.removeEventListener('keydown', handleGlobalShortcut)
})

function apply(action: Action) {
  const field = editor.value
  if (!field || props.readonly) return
  formatError.value = ''
  const source = field.currentText()
  const { start, end } = field.selectionRange()
  const selected = source.slice(start, end)
  let replaceStart = start
  let replaceEnd = end
  let replacement = ''
  let selectionStart = 0
  let selectionEnd = 0

  if (action === 'p' || action === 'h1' || action === 'h2' || action === 'h3' || action === 'h4' || action === 'h5' || action === 'h6') {
    const level = (action === 'p' ? 0 : Number(action.slice(1))) as 0 | 1 | 2 | 3 | 4 | 5 | 6
    const edit = applyHeadingLevel(source, start, end, level)
    field.replace(edit.from, edit.to, edit.insert, edit.selectionStart, edit.selectionEnd)
    return
  }

  if (action === 'highlight' || action === 'underline' || action === 'sub' || action === 'sup' || action === 'inline-math') {
    const edit = toggleTyporaInline(source, start, end, action)
    field.replace(edit.from, edit.to, edit.insert, edit.selectionStart, edit.selectionEnd, true)
    return
  }

  if (action === 'math') {
    if (mathKind.value === 'inline') {
      const edit = toggleTyporaInline(source, start, end, 'inline-math')
      field.replace(edit.from, edit.to, edit.insert, edit.selectionStart, edit.selectionEnd, true)
      return
    }
    const body = selected.trim() || '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}'
    const before = start > 0 && source[start - 1] !== '\n' ? '\n\n' : start > 0 && source[start - 2] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n\n' : '\n'
    replacement = `${before}$$\n${body}\n$$${after}`
    selectionStart = replaceStart + before.length + '$$\n'.length
    selectionEnd = selectionStart + body.length
  } else if (action === 'callout') {
    const body = selected.trim() || '在这里填写提示内容…'
    const quoted = body.split('\n').map(line => `> ${line}`).join('\n')
    const before = start > 0 && source[start - 1] !== '\n' ? '\n\n' : start > 0 && source[start - 2] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n\n' : '\n'
    replacement = `${before}> [!${calloutKind.value}]\n${quoted}${after}`
    selectionStart = replaceStart + before.length + `> [!${calloutKind.value}]\n> `.length
    selectionEnd = selectionStart + body.length
  } else if (action === 'toc') {
    replaceStart = end
    const before = end > 0 && source[end - 1] !== '\n' ? '\n\n' : '\n'
    const after = end < source.length && source[end] !== '\n' ? '\n\n' : '\n'
    replacement = `${before}[TOC]${after}`
    selectionStart = selectionEnd = end + replacement.length
  } else if (action === 'footnote') {
    const existing = Array.from(source.matchAll(/\[\^(\d+)\]/g), m => Number(m[1]))
    const nextNum = existing.length ? Math.max(...existing) + 1 : 1
    const refTag = `[^${nextNum}]`
    const defText = `\n\n[^${nextNum}]: ${selected.trim() || '脚注说明'}`
    const full = source.slice(0, end) + refTag + source.slice(end) + defText
    const defStart = full.length - (selected.trim() || '脚注说明').length
    field.replace(0, source.length, full, defStart, full.length, true)
    return
  } else if (action === 'unordered' || action === 'ordered' || action === 'task' || action === 'quote') {
    replaceStart = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1
    const lastSelected = end > start && source[end - 1] === '\n' ? end - 1 : end
    const nextLine = source.indexOf('\n', lastSelected)
    replaceEnd = nextLine === -1 ? source.length : nextLine
    const lines = source.slice(replaceStart, replaceEnd).split('\n')
    const prefix = action === 'unordered' ? '- ' : action === 'task' ? '- [ ] ' : action === 'quote' ? '> ' : ''
    replacement = lines.map((line, index) => {
      const clean = line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)/, '')
      return (action === 'ordered' ? `${index + 1}. ` : prefix) + clean
    }).join('\n')
    selectionStart = replaceStart + (start === end ? replacement.length : 0)
    selectionEnd = replaceStart + replacement.length
  } else if (action === 'code-block') {
    const fence = '`'.repeat(Math.max(3, ...Array.from(selected.matchAll(/`+/g), match => match[0].length + 1)))
    const before = start > 0 && source[start - 1] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n' : ''
    replacement = `${before}${fence}${codeLanguage.value}\n${selected}\n${fence}${after}`
    selectionStart = replaceStart + before.length + fence.length + codeLanguage.value.length + 1
    selectionEnd = selectionStart + selected.length
  } else if (action === 'mermaid') {
    const template = MERMAID_TEMPLATES.find(item => item.id === mermaidTemplateId.value) || MERMAID_TEMPLATES[0]
    const diagramBody = selected.trim() ? selected : template.code
    const before = start > 0 && source[start - 1] !== '\n' ? '\n\n' : start > 0 && source[start - 2] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n\n' : '\n'
    replacement = `${before}\`\`\`mermaid\n${diagramBody}\n\`\`\`${after}`
    selectionStart = replaceStart + before.length + '```mermaid\n'.length
    selectionEnd = selectionStart + diagramBody.length
  } else if (action === 'table') {
    replaceStart = end
    const before = end > 0 && source[end - 1] !== '\n' ? '\n\n' : end > 0 && source[end - 2] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n\n' : '\n'
    replacement = `${before}| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |${after}`
    selectionStart = end + before.length + 2
    selectionEnd = selectionStart + 3
  } else if (action === 'hr') {
    replaceStart = end
    const before = end > 0 && source[end - 1] !== '\n' ? '\n\n' : '\n'
    const after = end < source.length && source[end] !== '\n' ? '\n\n' : '\n'
    replacement = `${before}---${after}`
    selectionStart = selectionEnd = end + replacement.length
  } else if (action === 'link') {
    const label = selected || '链接文字'
    replacement = `[${label}](https://)`
    selectionStart = start + label.length + 3
    selectionEnd = selectionStart + 'https://'.length
  } else {
    const change = toggleInlineFormat(source, start, end, action)
    if (!change) { formatError.value = '选区跨越复杂格式或段落，请调整选区或切换源代码编辑。'; return }
    field.replace(change.from, change.to, change.text, change.selectionStart, change.selectionEnd, true)
    return
  }

  field.replace(replaceStart, replaceEnd, replacement, selectionStart, selectionEnd)
}

function onHeadingSelect(event: Event) {
  const select = event.target as HTMLSelectElement
  const value = select.value as Action
  if (value) apply(value)
  select.value = ''
}

function triggerInsertImage() {
  if (props.readonly) return
  imageFileInput.value?.click()
}

function onImageFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (files.length) editor.value?.insertImageFiles(files)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  const key = event.key.toLowerCase()

  // Typora Strikethrough: Alt+Shift+5
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'Digit5') {
    event.preventDefault()
    apply('strike')
    return
  }

  if (!(event.ctrlKey || event.metaKey)) return
  let action: Action | undefined
  if (!event.altKey && !event.shiftKey) {
    if (key === 'b') action = 'bold'
    else if (key === 'i') action = 'italic'
    else if (key === 'u') action = 'underline'
    else if (key === 'k') action = 'link'
    else if (key === 'e') action = 'inline-code'
    else if (key === 't') action = 'table'
    else if (key === 'f') { event.preventDefault(); openFind(false); return }
    else if (key === 'h') { event.preventDefault(); openFind(true); return }
    else if (event.code === 'Digit0') action = 'p'
    else if (/^Digit[1-6]$/.test(event.code)) action = `h${event.code.slice(-1)}` as Action
  } else if (!event.altKey && event.shiftKey) {
    if (key === 'c' || key === 'k') action = 'code-block'
    else if (key === 'm') { mathKind.value = 'block'; action = 'math' }
    else if (key === 'q') action = 'quote'
    else if (key === 'h') action = 'highlight'
  } else if (event.altKey && !event.shiftKey && /^Digit[1-6]$/.test(event.code)) {
    action = `h${event.code.slice(-1)}` as Action
  }
  if (action) {
    event.preventDefault()
    apply(action)
  }
}

function handleFindJump(match: { from: number; to: number }) {
  editor.value?.selectRange(match.from, match.to)
}
function handleReplaceOne(payload: { from: number; to: number; insert: string }) {
  editor.value?.replace(payload.from, payload.to, payload.insert, payload.from, payload.from + payload.insert.length, true)
}
function handleReplaceAll(nextText: string) {
  const field = editor.value
  if (!field) return
  const current = field.currentText()
  field.replace(0, current.length, nextText, 0, 0, true)
}

function focusHeading(offset: number) { editor.value?.focusHeading(offset) }
function applyOutlineChange(before: string, after: string, focus: number): string {
  const field = editor.value
  if (!field?.canReorganize() || props.readonly) return '当前编辑器暂不支持调整标题，请稍后重试。'
  if (field.currentText() !== before) return '正文已经发生变化，请重新调整标题。'
  if (before === after) return ''
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let suffix = 0
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  field.replace(start, before.length - suffix, after.slice(start, after.length - suffix), focus, focus, true)
  return ''
}
defineExpose({ focusHeading, applyOutlineChange, openFind })
</script>

<template>
  <div class="markdown-editor">
    <div class="editor-toolbar-sticky" :class="{ 'is-collapsed': toolbarCollapsed }">
      <div class="editor-header">
        <span class="editor-caption">Markdown <small>· Typora 兼容 · 自动保存草稿</small></span>
        <div class="editor-header-right">
          <button
            type="button"
            class="editor-mini-toggle"
            :class="{ active: !toolbarCollapsed }"
            :aria-expanded="!toolbarCollapsed"
            :title="toolbarCollapsed ? '展开格式工具栏' : '收起格式工具栏'"
            @click="toggleToolbarCollapsed"
          >{{ toolbarCollapsed ? '展开工具栏 ▾' : '收起工具栏 ▴' }}</button>
          <button v-if="activeMode === 'visual'" type="button" class="editor-mini-toggle" :class="{ active: focusMode }" title="专注模式：淡化非当前段落" @click="focusMode = !focusMode">专注</button>
          <button v-if="activeMode !== 'read'" type="button" class="editor-mini-toggle" :class="{ active: typewriterMode }" title="打字机模式：光标行保持居中" @click="typewriterMode = !typewriterMode">打字机</button>
          <button v-if="activeMode !== 'read'" type="button" class="editor-mini-toggle" :class="{ active: findOpen }" :title="`查找与替换 (${shortcut('F')} / ${shortcut('H')})`" @click="findOpen ? (findOpen = false) : openFind(false)">查找</button>
          <div class="editor-modes" role="group" aria-label="编辑器显示方式">
            <button v-if="showReadOption" type="button" :aria-pressed="activeMode === 'read'" @click="activeMode = 'read'">阅读</button>
            <button type="button" :disabled="editorFallback" :aria-pressed="activeMode === 'visual'" @click="activeMode = 'visual'">所见即写</button>
            <button type="button" :aria-pressed="activeMode === 'source'" @click="activeMode = 'source'">源代码</button>
            <button type="button" :aria-pressed="activeMode === 'split'" title="左侧源代码，右侧实时渲染，滚轮同步对齐" @click="activeMode = 'split'">双栏对照</button>
          </div>
        </div>
      </div>

      <div v-show="!toolbarCollapsed" class="markdown-toolbar" role="toolbar" aria-label="Markdown 格式">
        <div class="code-tool">
          <button type="button" :disabled="readonly" :title="`一级标题 (${shortcut('1')})`" @mousedown.prevent @click="apply('h1')">H1</button>
          <button type="button" :disabled="readonly" :title="`二级标题 (${shortcut('2')})`" @mousedown.prevent @click="apply('h2')">H2</button>
          <button type="button" :disabled="readonly" :title="`三级标题 (${shortcut('3')})`" @mousedown.prevent @click="apply('h3')">H3</button>
          <select :disabled="readonly" aria-label="更多标题级别" title="选择 H1–H6 或清除标题 (Ctrl+0)" @change="onHeadingSelect">
            <option value="">标题</option>
            <option value="p">正文 (Ctrl+0)</option>
            <option value="h1">H1 一级</option>
            <option value="h2">H2 二级</option>
            <option value="h3">H3 三级</option>
            <option value="h4">H4 四级</option>
            <option value="h5">H5 五级</option>
            <option value="h6">H6 六级</option>
          </select>
        </div>

        <button type="button" :disabled="readonly" :title="`粗体 (${shortcut('B')})`" @mousedown.prevent @click="apply('bold')"><strong>B</strong></button>
        <button type="button" :disabled="readonly" :title="`斜体 (${shortcut('I')})`" @mousedown.prevent @click="apply('italic')"><em>I</em></button>
        <button type="button" :disabled="readonly" :title="`下划线 (${shortcut('U')})`" @mousedown.prevent @click="apply('underline')"><u>U</u></button>
        <button type="button" :disabled="readonly" title="删除线 (Alt+Shift+5)" @mousedown.prevent @click="apply('strike')"><s>S</s></button>
        <button type="button" :disabled="readonly" :title="`高亮文本 (${shortcut('Shift+H')})`" @mousedown.prevent @click="apply('highlight')">== 高亮</button>
        <button type="button" :disabled="readonly" :title="`行内代码 (${shortcut('E')})`" @mousedown.prevent @click="apply('inline-code')">`代码`</button>

        <div class="code-tool">
          <button type="button" :disabled="readonly" :title="`代码块 (${shortcut('Shift+K')})`" @mousedown.prevent @click="apply('code-block')">&lt;/&gt; 代码块</button>
          <select v-model="codeLanguage" :disabled="readonly" aria-label="代码块语言" title="选择代码块语言">
            <option value="">语言</option>
            <option v-for="language in ['mermaid', 'python', 'javascript', 'typescript', 'java', 'go', 'rust', 'cpp', 'csharp', 'bash', 'powershell', 'sql', 'json', 'yaml', 'html', 'css', 'diff', 'markdown']"
              :key="language" :value="language">{{ language }}</option>
          </select>
        </div>

        <div class="code-tool">
          <button type="button" :disabled="readonly" title="打开可视化节点图编辑器" @mousedown.prevent @click="openVisualMermaid()">⬡ 节点图</button>
          <select v-model="mermaidTemplateId" :disabled="readonly" aria-label="节点图模板" title="选择节点图模板">
            <option v-for="tpl in MERMAID_TEMPLATES" :key="tpl.id" :value="tpl.id">{{ tpl.label }}</option>
          </select>
        </div>

        <div class="code-tool">
          <button type="button" :disabled="readonly" :title="`打开可视化公式编辑器 (${shortcut('Shift+M')})`" @mousedown.prevent @click="openVisualMath()">∑ 公式</button>
          <select v-model="mathKind" :disabled="readonly" aria-label="公式类型" title="选择公式块或行内公式">
            <option value="block">公式块 $$</option>
            <option value="inline">行内公式 $</option>
          </select>
        </div>

        <div class="code-tool">
          <button type="button" :disabled="readonly" title="插入 GitHub / Typora 提示块" @mousedown.prevent @click="apply('callout')">⚠ 提示块</button>
          <select v-model="calloutKind" :disabled="readonly" aria-label="提示块类型" title="选择提示块类型">
            <option value="NOTE">NOTE 备注</option>
            <option value="TIP">TIP 提示</option>
            <option value="IMPORTANT">IMPORTANT 重要</option>
            <option value="WARNING">WARNING 警告</option>
            <option value="CAUTION">CAUTION 注意</option>
          </select>
        </div>

        <button type="button" :disabled="readonly" title="无序列表" @mousedown.prevent @click="apply('unordered')">• 列表</button>
        <button type="button" :disabled="readonly" title="有序列表" @mousedown.prevent @click="apply('ordered')">1. 有序</button>
        <button type="button" :disabled="readonly" title="任务清单" @mousedown.prevent @click="apply('task')">☑ 任务</button>
        <button type="button" :disabled="readonly" :title="`引用 (${shortcut('Shift+Q')})`" @mousedown.prevent @click="apply('quote')">❝ 引用</button>
        <button type="button" :disabled="readonly" :title="`插入表格 (${shortcut('T')})`" @mousedown.prevent @click="apply('table')">▦ 表格</button>
        <button type="button" :disabled="readonly" title="插入本地图片（也支持粘贴或拖拽图片到正文）" @mousedown.prevent @click="triggerInsertImage">🖼 图片</button>
        <button type="button" :disabled="readonly" title="插入自动目录 [TOC]" @mousedown.prevent @click="apply('toc')">☰ 目录</button>
        <button type="button" :disabled="readonly" title="插入脚注 [^1]" @mousedown.prevent @click="apply('footnote')">[^] 脚注</button>
        <button type="button" :disabled="readonly" title="插入水平分割线" @mousedown.prevent @click="apply('hr')">― 分割线</button>
        <button type="button" :disabled="readonly" :title="`插入链接 (${shortcut('K')})`" @mousedown.prevent @click="apply('link')">链接</button>
        <input ref="imageFileInput" class="sr-only" hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple @change="onImageFilePicked">
      </div>

      <FindReplaceBar
        ref="findBar"
        :text="modelValue"
        :open="findOpen"
        :replace-open="replaceOpen"
        :readonly="readonly"
        @close="findOpen = false"
        @jump="handleFindJump"
        @replace-one="handleReplaceOne"
        @replace-all="handleReplaceAll"
      />

      <p v-show="!toolbarCollapsed" class="markdown-shortcuts">快捷键：{{ shortcut('1') }}–{{ shortcut('6') }} 标题 · {{ shortcut('0') }} 正文 · {{ shortcut('B') }}/{{ shortcut('I') }}/{{ shortcut('U') }} 粗斜下划线 · {{ shortcut('Shift+H') }} 高亮 · {{ shortcut('Shift+M') }} 公式 · {{ shortcut('T') }} 表格 · {{ shortcut('F') }}/{{ shortcut('H') }} 查找替换 · Ctrl+点击链接跳转</p>
      <p v-if="formatError" class="markdown-error" role="alert">{{ formatError }}</p>
      <p v-if="editorFallback" class="markdown-error" role="alert">排版编辑器无法启动，已切换到源代码编辑；正文和草稿没有改变。</p>
    </div>

    <div class="editor-panes" :class="{ 'is-split': activeMode === 'split' }">
      <div
        v-if="activeMode === 'split'"
        ref="splitSourcePane"
        class="editor-pane split-pane-scroll split-source-pane"
        @scroll="syncSplitScroll('source')"
      >
        <span class="pane-heading">源代码 · 滚轮与右侧实时预览同步</span>
        <LiveMarkdown
          ref="editor"
          :model-value="modelValue"
          mode="source"
          :readonly="readonly"
          :show-line-numbers="settings.showLineNumbers"
          :typewriter-mode="false"
          :attachment-context="attachmentContext"
          :image-urls="imageUrls"
          :save-pasted-images="savePastedImages"
          :on-paste-status="onPasteStatus"
          @update:model-value="emit('update:modelValue', $event)"
          @keydown="handleKeydown"
          @selection="selectionAnchor = $event"
          @navigate-link="emit('navigate-link', $event)"
          @failure="editorFallback = true; activeMode = 'source'"
        />
      </div>
      <div
        v-if="activeMode === 'split'"
        ref="splitPreviewPane"
        class="editor-pane split-pane-scroll split-preview-pane"
        @scroll="syncSplitScroll('preview')"
      >
        <span class="pane-heading">实时渲染预览</span>
        <ChapterMarkdown
          :source="modelValue"
          :editable-tasks="!readonly"
          @navigate-link="emit('navigate-link', $event)"
          @toggle-task="emit('toggle-task', $event)"
        />
      </div>
      <div v-if="activeMode !== 'split'" class="editor-pane">
        <span class="pane-heading">正文 <span v-if="activeMode === 'visual'">· 点击文字、公式、表格或节点图直接编辑；支持粘贴/拖入图片</span></span>
        <LiveMarkdown
          ref="editor"
          :model-value="modelValue"
          :mode="liveMode"
          :readonly="readonly"
          :show-line-numbers="settings.showLineNumbers"
          :focus-mode="focusMode"
          :typewriter-mode="typewriterMode"
          :attachment-context="attachmentContext"
          :image-urls="imageUrls"
          :save-pasted-images="savePastedImages"
          :on-paste-status="onPasteStatus"
          @update:model-value="emit('update:modelValue', $event)"
          @keydown="handleKeydown"
          @selection="selectionAnchor = $event"
          @navigate-link="emit('navigate-link', $event)"
          @visual-edit-mermaid="openVisualMermaid"
          @visual-edit-math="openVisualMath"
          @failure="editorFallback = true; activeMode = 'source'"
        />
      </div>
    </div>

    <MermaidVisualModal
      :open="!!mermaidVisualModal"
      :initial-code="mermaidVisualModal?.code || ''"
      @close="mermaidVisualModal = null"
      @apply="applyVisualMermaid"
    />
    <MathVisualModal
      :open="!!mathVisualModal"
      :initial-tex="mathVisualModal?.tex || ''"
      :initial-block="mathVisualModal?.block ?? true"
      @close="mathVisualModal = null"
      @apply="applyVisualMath"
    />

    <div class="typora-status-bar" aria-label="文档字数统计">
      <span>{{ stats.words }} 词（中文 {{ stats.cjkChars }} 字）</span>
      <span>{{ stats.chars }} 字符</span>
      <span>{{ stats.lines }} 行</span>
      <span>预计阅读 {{ stats.readingMinutes }} 分钟</span>
    </div>

    <div v-if="selectionAnchor && !readonly" class="selection-toolbar" role="toolbar" aria-label="选中文本格式" :style="floatingStyle()" @mousedown.prevent>
      <button v-for="tool in selectionTools" :key="tool.action" type="button" :class="`selection-${tool.action}`" :title="tool.title" :aria-label="tool.title" @click="apply(tool.action)">{{ tool.label }}</button>
    </div>
  </div>
</template>

<style scoped src="./editor-toolbar.css"></style>
<style scoped>
.editor-header-right { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.editor-mini-toggle {
  padding: 5px 9px;
  border: 1.5px solid var(--line, #111);
  border-radius: 6px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.editor-mini-toggle:hover,
.editor-mini-toggle.active {
  background: var(--ink, #111);
  color: var(--panel, #fff);
}
.typora-status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
  padding: 6px 10px;
  border-top: 1px dashed color-mix(in srgb, var(--line, #111) 35%, transparent);
  color: var(--muted, #555);
  font: 500 12px/1.4 ui-monospace, Consolas, "Microsoft YaHei", sans-serif;
}
.selection-toolbar { position: fixed; z-index: 1000; display: flex; flex-wrap: wrap; width: max-content; max-width: calc(100vw - 24px); align-items: center; padding: 3px; border: 1.5px solid var(--ink, #111); border-radius: 6px; color: var(--ink, #111); background: var(--panel, #fff); box-shadow: 2px 2px 0 var(--depth-edge, #111); white-space: nowrap; }
.selection-toolbar button { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; border: 0; border-radius: 3px; color: inherit; background: transparent; font: 700 12px/1 ui-monospace, monospace; cursor: pointer; }
.selection-toolbar button:hover, .selection-toolbar button:focus-visible { color: var(--panel, #fff); background: var(--ink, #111); outline: none; }
.selection-italic { font-style: italic !important; }
.selection-strike { text-decoration: line-through !important; }
.selection-underline { text-decoration: underline !important; }
:deep(.live-markdown-paste-error) { color: #a12626; margin: 10px 0; font-size: 13px; }
</style>
