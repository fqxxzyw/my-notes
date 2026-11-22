<script setup lang="ts">
import { nextTick, ref } from 'vue'
import ChapterMarkdown from './ChapterMarkdown.vue'

const props = defineProps<{ modelValue: string; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const editor = ref<HTMLTextAreaElement | null>(null)
const mode = ref<'edit' | 'split' | 'preview'>('edit')
const codeLanguage = ref('')

type Action = 'h1' | 'h2' | 'h3' | 'bold' | 'italic' | 'strike' | 'inline-code' | 'code-block' | 'link' | 'unordered' | 'ordered' | 'task' | 'quote' | 'table'
const tools: { action: Action; label: string; description: string; shortcut?: string; hint?: string }[] = [
  { action: 'h1', label: 'H1', description: '一级标题', shortcut: 'Ctrl/⌘ Alt 1', hint: '⌃⌥1' },
  { action: 'h2', label: 'H2', description: '二级标题', shortcut: 'Ctrl/⌘ Alt 2', hint: '⌃⌥2' },
  { action: 'h3', label: 'H3', description: '三级标题', shortcut: 'Ctrl/⌘ Alt 3', hint: '⌃⌥3' },
  { action: 'code-block', label: '</> 代码块', description: '将选中内容变为代码块', shortcut: 'Ctrl/⌘ Shift C', hint: '⌃⇧C' },
  { action: 'inline-code', label: '`代码`', description: '行内代码', shortcut: 'Ctrl/⌘ E', hint: '⌃E' },
  { action: 'bold', label: 'B', description: '粗体', shortcut: 'Ctrl/⌘ B', hint: '⌃B' },
  { action: 'italic', label: 'I', description: '斜体', shortcut: 'Ctrl/⌘ I', hint: '⌃I' },
  { action: 'strike', label: 'S', description: '删除线' },
  { action: 'unordered', label: '• 列表', description: '无序列表' },
  { action: 'ordered', label: '1. 有序', description: '有序列表' },
  { action: 'task', label: '☑ 任务', description: '任务清单' },
  { action: 'quote', label: '❝ 引用', description: '引用' },
  { action: 'table', label: '▦ 表格', description: '插入表格' },
  { action: 'link', label: '链接', description: '插入链接', shortcut: 'Ctrl/⌘ K' },
]

function apply(action: Action) {
  const field = editor.value
  if (!field || props.readonly) return
  const source = props.modelValue
  const start = field.selectionStart
  const end = field.selectionEnd
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

  emit('update:modelValue', source.slice(0, replaceStart) + replacement + source.slice(replaceEnd))
  void nextTick(() => {
    field.focus()
    field.setSelectionRange(selectionStart, selectionEnd)
  })
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
  } else if (event.altKey && !event.shiftKey && ['1', '2', '3'].includes(key)) {
    action = `h${key}` as Action
  }
  if (action) {
    event.preventDefault()
    apply(action)
  }
}
</script>

<template>
  <div class="markdown-editor">
    <div class="editor-header">
      <span class="editor-caption">Markdown <small>· 自动保存本机草稿</small></span>
      <div class="editor-modes" role="group" aria-label="编辑器显示方式">
        <button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'">仅编辑</button>
        <button type="button" :aria-pressed="mode === 'split'" @click="mode = 'split'">分栏</button>
        <button type="button" :aria-pressed="mode === 'preview'" @click="mode = 'preview'">纯预览</button>
      </div>
    </div>
    <div v-show="mode !== 'preview'" class="markdown-toolbar" role="toolbar" aria-label="Markdown 格式">
      <template v-for="tool in tools" :key="tool.action">
        <div v-if="tool.action === 'code-block'" class="code-tool">
          <button type="button" :disabled="readonly" :title="`${tool.description}（${tool.shortcut}）`"
            :aria-label="`${tool.description}，${tool.shortcut}`" @mousedown.prevent @click="apply(tool.action)">
            {{ tool.label }} <span v-if="tool.hint" class="kbd-tag">{{ tool.hint }}</span>
          </button>
          <select v-model="codeLanguage" :disabled="readonly" aria-label="代码块语言" title="选择代码块语言">
            <option value="">语言</option>
            <option v-for="language in ['python', 'javascript', 'typescript', 'java', 'bash', 'sql', 'json', 'cpp', 'html', 'css', 'markdown']"
              :key="language" :value="language">{{ language }}</option>
          </select>
        </div>
        <button v-else type="button" :disabled="readonly"
          :title="tool.shortcut ? `${tool.description}（${tool.shortcut}）` : tool.description"
          :aria-label="tool.shortcut ? `${tool.description}，${tool.shortcut}` : tool.description"
          @mousedown.prevent @click="apply(tool.action)">
          {{ tool.label }} <span v-if="tool.hint" class="kbd-tag">{{ tool.hint }}</span>
        </button>
      </template>
    </div>
    <p v-show="mode !== 'preview'" class="markdown-shortcuts">快捷键：Ctrl/⌘ B 粗体 · Ctrl/⌘ I 斜体 · Ctrl/⌘ E 行内代码 · Ctrl/⌘ Shift C 代码块 · Ctrl/⌘ K 链接 · Ctrl/⌘ Alt 1–3 标题</p>
    <div class="editor-panes" :class="{ 'editor-panes--split': mode === 'split' }">
      <div v-show="mode !== 'preview'" class="editor-pane">
        <label class="pane-heading" for="chapter-content">正文</label>
        <textarea
          id="chapter-content"
          ref="editor"
          :value="modelValue"
          :readonly="readonly"
          spellcheck="false"
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
          @keydown="handleKeydown"
        ></textarea>
      </div>
      <section v-show="mode !== 'edit'" class="editor-preview" aria-label="Markdown 实时预览">
        <p class="pane-heading">实时预览</p>
        <ChapterMarkdown :source="modelValue" />
        <p v-if="!modelValue.trim()" class="preview-empty">输入内容后在这里预览。</p>
      </section>
    </div>
  </div>
</template>

<style scoped src="./editor-toolbar.css"></style>
