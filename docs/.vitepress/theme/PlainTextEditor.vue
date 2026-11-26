<script setup lang="ts">
import { computed, ref } from 'vue'
import FindReplaceBar from './FindReplaceBar.vue'
import { useAppSettings } from './appSettings'

const props = defineProps<{ modelValue: string; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const gutterRef = ref<HTMLElement | null>(null)
const findBar = ref<InstanceType<typeof FindReplaceBar> | null>(null)
const copied = ref(false)
const findOpen = ref(false)
const replaceOpen = ref(false)
const { settings } = useAppSettings()

const lineCount = computed(() => (props.modelValue ? props.modelValue.split(/\r?\n/).length : 1))
const lineNumbers = computed(() => Array.from({ length: lineCount.value }, (_, i) => i + 1))

function syncGutterScroll() {
  if (gutterRef.value && textareaRef.value) {
    gutterRef.value.scrollTop = textareaRef.value.scrollTop
  }
}

function openFind(withReplace = false) {
  findOpen.value = true
  replaceOpen.value = withReplace && !props.readonly
  findBar.value?.focusFind(withReplace)
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase()
    if (key === 'f') { event.preventDefault(); openFind(false); return }
    if (key === 'h' && !props.readonly) { event.preventDefault(); openFind(true); return }
  }
  if (event.key !== 'Tab' || props.readonly || !textareaRef.value) return
  event.preventDefault()
  const el = textareaRef.value
  const start = el.selectionStart
  const end = el.selectionEnd
  const value = props.modelValue
  const next = `${value.slice(0, start)}\t${value.slice(end)}`
  emit('update:modelValue', next)
  requestAnimationFrame(() => {
    if (textareaRef.value === el) {
      el.selectionStart = el.selectionEnd = start + 1
    }
  })
}

function jumpToMatch(match: { from: number; to: number }) {
  const el = textareaRef.value
  if (!el) return
  el.focus()
  el.setSelectionRange(match.from, match.to)
}

function replaceOne(payload: { from: number; to: number; insert: string }) {
  const next = props.modelValue.slice(0, payload.from) + payload.insert + props.modelValue.slice(payload.to)
  emit('update:modelValue', next)
}

function copyAll() {
  navigator.clipboard?.writeText(props.modelValue).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  }).catch(() => {})
}
</script>

<template>
  <div class="plain-text-editor">
    <div class="plain-text-bar">
      <span class="plain-text-caption">纯文本 (.txt) <small>· 自动保存本机草稿，不解析 Markdown 语法</small></span>
      <div class="plain-text-actions">
        <span class="plain-text-meta">{{ lineCount }} 行 · {{ modelValue.length }} 字符</span>
        <button type="button" class="plain-text-btn" @click="findOpen ? (findOpen = false) : openFind(false)">查找</button>
        <button type="button" class="plain-text-btn" @click="copyAll">{{ copied ? '已复制' : '复制全文' }}</button>
      </div>
    </div>
    <FindReplaceBar
      ref="findBar"
      :text="modelValue"
      :open="findOpen"
      :replace-open="replaceOpen"
      :readonly="readonly"
      @close="findOpen = false"
      @jump="jumpToMatch"
      @replace-one="replaceOne"
      @replace-all="emit('update:modelValue', $event)"
    />
    <div class="plain-text-frame">
      <div v-if="settings.showLineNumbers" ref="gutterRef" class="plain-text-gutter" aria-hidden="true">
        <span v-for="n in lineNumbers" :key="n">{{ n }}</span>
      </div>
      <textarea
        ref="textareaRef"
        class="plain-text-area"
        aria-label="纯文本正文"
        :value="modelValue"
        :readonly="readonly"
        spellcheck="false"
        placeholder="在此输入纯文本内容…"
        @scroll="syncGutterScroll"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @keydown="handleKeydown"
      />
    </div>
  </div>
</template>

<style scoped>
.plain-text-editor { min-width: 0; }
.plain-text-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 8px;
  background: var(--theme-soft, #f4f3f0);
}
.plain-text-caption { font-size: 13px; font-weight: 700; color: var(--theme-ink, #111); }
.plain-text-caption small { font-size: 12px; font-weight: 400; color: var(--theme-muted, #555); }
.plain-text-actions { display: flex; align-items: center; gap: 8px; }
.plain-text-meta { font: 600 11px/1.3 ui-monospace, Consolas, monospace; color: var(--theme-muted, #555); }
.plain-text-btn {
  padding: 4px 10px;
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 5px;
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.plain-text-btn:hover { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.plain-text-frame {
  display: flex;
  align-items: stretch;
  margin-top: 10px;
  border: 2px solid var(--theme-edge, #111);
  border-radius: 9px;
  background: var(--theme-paper, #fff);
  overflow: hidden;
}
.plain-text-frame:focus-within { box-shadow: 3px 3px 0 var(--theme-edge, #111); }
.plain-text-gutter {
  flex: 0 0 auto;
  min-width: 44px;
  padding: 20px 10px 20px 8px;
  border-right: 1px solid color-mix(in srgb, var(--theme-edge, #111) 25%, transparent);
  background: var(--theme-soft, #f4f3f0);
  color: var(--theme-muted, #666);
  font: var(--paper-editor-font-size, 15px)/1.85 ui-monospace, Consolas, "Microsoft YaHei", monospace;
  text-align: right;
  user-select: none;
  overflow: hidden;
}
.plain-text-gutter span { display: block; }
.plain-text-area {
  flex: 1 1 auto;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: max(65vh, 520px);
  padding: 20px clamp(16px, 3vw, 32px);
  border: 0;
  background: transparent;
  color: var(--theme-ink, #111);
  font: var(--paper-editor-font-size, 15px)/1.85 ui-monospace, Consolas, "Microsoft YaHei", monospace;
  resize: vertical;
  outline: none;
  tab-size: 4;
}
</style>
