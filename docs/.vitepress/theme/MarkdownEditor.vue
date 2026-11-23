<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LiveMarkdown from './LiveMarkdown.vue'

const props = defineProps<{ modelValue: string; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const editor = ref<InstanceType<typeof LiveMarkdown> | null>(null)
const mode = ref<'source' | 'visual'>('visual')
const editorFallback = ref(false)
const codeLanguage = ref('')
const isMac = ref(false)
const selectionAnchor = ref<{ left: number; top: number; bottom: number } | null>(null)
const selectionTools: { action: Action; label: string; title: string }[] = [
  { action: 'bold', label: 'B', title: '粗体' },
  { action: 'italic', label: 'I', title: '斜体' },
  { action: 'inline-code', label: '</>', title: '行内代码' },
  { action: 'code-block', label: '{ }', title: '代码块' },
]
function floatingStyle() {
  const rect = selectionAnchor.value!
  const safeTop = (document.querySelector('.editor-toolbar-sticky')?.getBoundingClientRect().bottom || 0) + 8
  const below = rect.top - 56 < safeTop
  return { left: `${Math.max(95, Math.min(window.innerWidth - 95, rect.left))}px`, top: `${below ? rect.bottom + 8 : rect.top - 8}px`, transform: `translate(-50%, ${below ? '0' : '-100%'})` }
}
onMounted(() => { isMac.value = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) })

type Action = 'h1' | 'h2' | 'h3' | 'bold' | 'italic' | 'strike' | 'inline-code' | 'code-block' | 'link' | 'unordered' | 'ordered' | 'task' | 'quote' | 'table'
const tools: { action: Action; label: string; description: string; keys?: string }[] = [
  { action: 'h1', label: 'H1', description: '一级标题', keys: 'Alt+1' },
  { action: 'h2', label: 'H2', description: '二级标题', keys: 'Alt+2' },
  { action: 'h3', label: 'H3', description: '三级标题', keys: 'Alt+3' },
  { action: 'code-block', label: '</> 代码块', description: '将选中内容变为代码块', keys: 'Shift+C' },
  { action: 'inline-code', label: '`代码`', description: '行内代码', keys: 'E' },
  { action: 'bold', label: 'B', description: '粗体', keys: 'B' },
  { action: 'italic', label: 'I', description: '斜体', keys: 'I' },
  { action: 'strike', label: 'S', description: '删除线' },
  { action: 'unordered', label: '• 列表', description: '无序列表' },
  { action: 'ordered', label: '1. 有序', description: '有序列表' },
  { action: 'task', label: '☑ 任务', description: '任务清单' },
  { action: 'quote', label: '❝ 引用', description: '引用' },
  { action: 'table', label: '▦ 表格', description: '插入表格' },
  { action: 'link', label: '链接', description: '插入链接', keys: 'K' },
]
const shortcut = (keys: string) => `${isMac.value ? '⌘' : 'Ctrl'}+${isMac.value ? keys.replace('Alt', 'Option') : keys}`

function apply(action: Action) {
  const field = editor.value
  if (!field || props.readonly) return
  const source = field.currentText()
  const { start, end } = field.selectionRange()
  const selected = source.slice(start, end)
  let replaceStart = start
  let replaceEnd = end
  let replacement = ''
  let selectionStart = 0
  let selectionEnd = 0

  if (action === 'h1' || action === 'h2' || action === 'h3' || action === 'unordered' || action === 'ordered' || action === 'task' || action === 'quote') {
    replaceStart = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1
    const lastSelected = end > start && source[end - 1] === '\n' ? end - 1 : end
    const nextLine = source.indexOf('\n', lastSelected)
    replaceEnd = nextLine === -1 ? source.length : nextLine
    const lines = source.slice(replaceStart, replaceEnd).split('\n')
    const prefix = action === 'h1' ? '# ' : action === 'h2' ? '## ' : action === 'h3' ? '### ' : action === 'unordered' ? '- ' : action === 'task' ? '- [ ] ' : action === 'quote' ? '> ' : ''
    replacement = lines.map((line, index) => {
      const clean = line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)/, '')
      return (action === 'ordered' ? `${index + 1}. ` : prefix) + clean
    }).join('\n')
    selectionStart = replaceStart + (start === end ? replacement.length : 0)
    selectionEnd = replaceStart + replacement.length
  } else if (action === 'code-block') {
    // Choose a fence longer than any backtick sequence inside the selection.
    const fence = '`'.repeat(Math.max(3, ...Array.from(selected.matchAll(/`+/g), match => match[0].length + 1)))
    const before = start > 0 && source[start - 1] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n' : ''
    replacement = `${before}${fence}${codeLanguage.value}\n${selected}\n${fence}${after}`
    selectionStart = replaceStart + before.length + fence.length + codeLanguage.value.length + 1
    selectionEnd = selectionStart + selected.length
  } else if (action === 'table') {
    // Keep selected text intact when inserting a table after it.
    replaceStart = end
    const before = end > 0 && source[end - 1] !== '\n' ? '\n' : ''
    const after = end < source.length && source[end] !== '\n' ? '\n' : ''
    replacement = `${before}| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n${after}`
    selectionStart = end + before.length + 2
    selectionEnd = selectionStart + 2
  } else if (action === 'link') {
    const label = selected || '链接文字'
    replacement = `[${label}](https://)`
    selectionStart = start + label.length + 3
    selectionEnd = selectionStart + 'https://'.length
  } else {
    const delimiter = action === 'bold' ? '**' : action === 'italic' ? '*' : action === 'strike' ? '~~' : '`'
    const placeholder = selected || (action === 'inline-code' ? '代码' : '文字')
    replacement = `${delimiter}${placeholder}${delimiter}`
    selectionStart = start + delimiter.length
    selectionEnd = selectionStart + placeholder.length
  }

  field.replace(replaceStart, replaceEnd, replacement, selectionStart, selectionEnd)
}

function handleKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.isComposing) return
  const key = event.key.toLowerCase()
  let action: Action | undefined
  if (!event.altKey && !event.shiftKey) {
    if (key === 'b') action = 'bold'
    else if (key === 'i') action = 'italic'
    else if (key === 'k') action = 'link'
    else if (key === 'e') action = 'inline-code'
  } else if (!event.altKey && event.shiftKey && key === 'c') {
    action = 'code-block'
  } else if (event.altKey && !event.shiftKey && /^Digit[123]$/.test(event.code)) {
    action = `h${event.code.slice(-1)}` as Action
  }
  if (action) {
    event.preventDefault()
    apply(action)
  }
}
function focusHeading(offset: number) { editor.value?.focusHeading(offset) }
/** Apply one isolated editor transaction, keeping existing undo history intact. */
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
defineExpose({ focusHeading, applyOutlineChange })
</script>

<template>
  <div class="markdown-editor">
    <div class="editor-toolbar-sticky">
    <div class="editor-header">
      <span class="editor-caption">Markdown <small>· 自动保存本机草稿</small></span>
      <div class="editor-modes" role="group" aria-label="编辑器显示方式">
        <button type="button" :aria-pressed="mode === 'source'" @click="mode = 'source'">源代码</button>
        <button type="button" :disabled="editorFallback" :aria-pressed="mode === 'visual'" @click="mode = 'visual'">所见即写</button>
      </div>
    </div>
    <div class="markdown-toolbar" role="toolbar" aria-label="Markdown 格式">
      <template v-for="tool in tools" :key="tool.action">
        <div v-if="tool.action === 'code-block'" class="code-tool">
          <button type="button" :disabled="readonly" :title="`${tool.description}（${shortcut(tool.keys!)}）`"
            :aria-label="`${tool.description}，${shortcut(tool.keys!)}`" @mousedown.prevent @click="apply(tool.action)">
            {{ tool.label }} <span v-if="tool.keys" class="kbd-tag">{{ shortcut(tool.keys) }}</span>
          </button>
          <select v-model="codeLanguage" :disabled="readonly" aria-label="代码块语言" title="选择代码块语言">
            <option value="">语言</option>
            <option v-for="language in ['python', 'javascript', 'typescript', 'java', 'bash', 'sql', 'json', 'cpp', 'html', 'css', 'markdown']"
              :key="language" :value="language">{{ language }}</option>
          </select>
        </div>
        <button v-else type="button" :disabled="readonly"
          :title="tool.keys ? `${tool.description}（${shortcut(tool.keys)}）` : tool.description"
          :aria-label="tool.keys ? `${tool.description}，${shortcut(tool.keys)}` : tool.description"
          @mousedown.prevent @click="apply(tool.action)">
          {{ tool.label }} <span v-if="tool.keys" class="kbd-tag">{{ shortcut(tool.keys) }}</span>
        </button>
      </template>
    </div>
    <p class="markdown-shortcuts">快捷键：{{ shortcut('B') }} 粗体 · {{ shortcut('I') }} 斜体 · {{ shortcut('E') }} 行内代码 · {{ shortcut('Shift+C') }} 代码块 · {{ shortcut('K') }} 链接 · {{ shortcut('Alt+1') }}–{{ shortcut('Alt+3') }} 标题</p>
    <p v-if="editorFallback" class="markdown-error" role="alert">排版编辑器无法启动，已切换到源代码编辑；正文和草稿没有改变。</p>
    </div>
    <div class="editor-panes">
      <div class="editor-pane">
        <span class="pane-heading">正文 <span v-if="mode === 'visual'">· 点击文字直接编辑</span></span>
        <LiveMarkdown ref="editor" :model-value="modelValue" :mode="mode" :readonly="readonly"
          @update:model-value="emit('update:modelValue', $event)" @keydown="handleKeydown" @selection="selectionAnchor = $event" @failure="editorFallback = true; mode = 'source'" />
      </div>
    </div>
    <div v-if="selectionAnchor && !readonly" class="selection-toolbar" role="toolbar" aria-label="选中文本格式" :style="floatingStyle()" @mousedown.prevent>
      <button v-for="tool in selectionTools" :key="tool.action" type="button" :class="`selection-${tool.action}`" :title="tool.title" :aria-label="tool.title" @click="apply(tool.action)">{{ tool.label }}</button>
    </div>
  </div>
</template>

<style scoped src="./editor-toolbar.css"></style>
<style scoped>
.selection-toolbar { position: fixed; z-index: 1000; display: flex; align-items: center; gap: 2px; padding: 4px; border: 1.5px solid var(--ink, #111); border-radius: 7px; color: var(--ink, #111); background: var(--panel, #fff); box-shadow: 3px 3px 0 var(--depth-edge, #111); white-space: nowrap; }
.selection-toolbar button { display: grid; place-items: center; width: 36px; height: 32px; border: 0; border-radius: 4px; color: inherit; background: transparent; font: 700 15px/1 ui-monospace, monospace; cursor: pointer; }
.selection-toolbar button:hover, .selection-toolbar button:focus-visible { color: var(--panel, #fff); background: var(--ink, #111); outline: none; }
.selection-italic { font-style: italic !important; }
:deep(.live-markdown-paste-error) { color: #a12626; margin: 10px 0; font-size: 13px; }
</style>
