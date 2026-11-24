<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

export interface FindMatch {
  from: number
  to: number
}

const props = defineProps<{
  text: string
  open: boolean
  replaceOpen?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  close: []
  jump: [match: FindMatch]
  'replace-one': [payload: { from: number; to: number; insert: string }]
  'replace-all': [nextText: string]
}>()

const findInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const useRegex = ref(false)
const showReplace = ref(false)
const activeIndex = ref(0)

watch(() => props.open, isOpen => {
  if (isOpen) {
    showReplace.value = !!props.replaceOpen && !props.readonly
    void nextTick(() => {
      findInput.value?.focus()
      findInput.value?.select()
    })
  }
})
watch(() => props.replaceOpen, val => {
  if (props.open && !props.readonly) showReplace.value = !!val
})

const matchResult = computed<{ matches: FindMatch[]; error: string }>(() => {
  if (!query.value) return { matches: [], error: '' }
  try {
    const flags = caseSensitive.value ? 'g' : 'gi'
    const pattern = useRegex.value
      ? new RegExp(query.value, flags)
      : new RegExp(query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    const matches: FindMatch[] = []
    let m: RegExpExecArray | null
    while ((m = pattern.exec(props.text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue }
      matches.push({ from: m.index, to: m.index + m[0].length })
      if (matches.length >= 2000) break
    }
    return { matches, error: '' }
  } catch {
    return { matches: [], error: '正则表达式无效' }
  }
})

watch(() => [query.value, caseSensitive.value, useRegex.value], () => {
  activeIndex.value = 0
  const first = matchResult.value.matches[0]
  if (first) emit('jump', first)
})

function step(delta: number) {
  const list = matchResult.value.matches
  if (!list.length) return
  activeIndex.value = (activeIndex.value + delta + list.length) % list.length
  emit('jump', list[activeIndex.value])
}

function replaceCurrent() {
  if (props.readonly) return
  const list = matchResult.value.matches
  if (!list.length) return
  const idx = Math.min(activeIndex.value, list.length - 1)
  const target = list[idx]
  let insert = replacement.value
  if (useRegex.value) {
    try {
      const flags = caseSensitive.value ? '' : 'i'
      insert = props.text.slice(target.from, target.to).replace(new RegExp(query.value, flags), replacement.value)
    } catch { return }
  }
  emit('replace-one', { from: target.from, to: target.to, insert })
  void nextTick(() => {
    const nextList = matchResult.value.matches
    if (nextList.length) {
      activeIndex.value = idx % nextList.length
      emit('jump', nextList[activeIndex.value])
    }
  })
}

function replaceAllMatches() {
  if (props.readonly || !query.value || !matchResult.value.matches.length) return
  try {
    const flags = caseSensitive.value ? 'g' : 'gi'
    const pattern = useRegex.value
      ? new RegExp(query.value, flags)
      : new RegExp(query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    const next = useRegex.value
      ? props.text.replace(pattern, replacement.value)
      : props.text.replace(pattern, () => replacement.value)
    if (next !== props.text) emit('replace-all', next)
  } catch { /* invalid regex already reported */ }
}

function focusFind(withReplace = false) {
  showReplace.value = withReplace && !props.readonly
  void nextTick(() => {
    findInput.value?.focus()
    findInput.value?.select()
  })
}

defineExpose({ focusFind })
</script>

<template>
  <div v-if="open" class="find-bar" role="search" aria-label="文内查找与替换" @keydown.esc.stop="emit('close')">
    <div class="find-row">
      <button
        v-if="!readonly"
        type="button"
        class="find-toggle"
        :title="showReplace ? '隐藏替换' : '展开替换 (Ctrl+H)'"
        @click="showReplace = !showReplace"
      >{{ showReplace ? '▾' : '▸' }}</button>
      <input
        ref="findInput"
        v-model="query"
        type="text"
        class="find-input"
        placeholder="查找内容…"
        aria-label="查找内容"
        @keydown.enter.exact.prevent="step(1)"
        @keydown.shift.enter.prevent="step(-1)"
      >
      <button type="button" class="find-flag" :class="{ active: caseSensitive }" title="区分大小写" @click="caseSensitive = !caseSensitive">Aa</button>
      <button type="button" class="find-flag" :class="{ active: useRegex }" title="正则表达式" @click="useRegex = !useRegex">.*</button>
      <span class="find-count" :class="{ error: !!matchResult.error }">
        <template v-if="matchResult.error">{{ matchResult.error }}</template>
        <template v-else-if="!query">0 / 0</template>
        <template v-else-if="!matchResult.matches.length">无匹配</template>
        <template v-else>{{ Math.min(activeIndex + 1, matchResult.matches.length) }} / {{ matchResult.matches.length }}</template>
      </span>
      <button type="button" class="find-btn" :disabled="!matchResult.matches.length" title="上一个 (Shift+Enter)" @click="step(-1)">↑</button>
      <button type="button" class="find-btn" :disabled="!matchResult.matches.length" title="下一个 (Enter)" @click="step(1)">↓</button>
      <button type="button" class="find-btn" aria-label="关闭查找" title="关闭 (Esc)" @click="emit('close')">×</button>
    </div>
    <div v-if="showReplace && !readonly" class="find-row">
      <span class="find-spacer" aria-hidden="true"></span>
      <input
        v-model="replacement"
        type="text"
        class="find-input"
        placeholder="替换为…"
        aria-label="替换为"
        @keydown.enter.exact.prevent="replaceCurrent"
      >
      <button type="button" class="find-action" :disabled="!matchResult.matches.length" @click="replaceCurrent">替换</button>
      <button type="button" class="find-action" :disabled="!matchResult.matches.length" @click="replaceAllMatches">全部替换</button>
    </div>
  </div>
</template>

<style scoped>
.find-bar {
  display: grid;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 7px;
  background: var(--theme-soft, #f4f3f0);
}
.find-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.find-toggle,
.find-spacer {
  width: 22px;
  flex: none;
}
.find-toggle {
  height: 26px;
  border: 1px solid var(--theme-edge, #111);
  border-radius: 4px;
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
  font-size: 12px;
  cursor: pointer;
}
.find-input {
  flex: 1 1 180px;
  min-width: 120px;
  padding: 4px 8px;
  border: 1px solid var(--theme-edge, #111);
  border-radius: 4px;
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
  font-size: 13px;
}
.find-flag,
.find-btn,
.find-action {
  padding: 4px 8px;
  border: 1px solid var(--theme-edge, #111);
  border-radius: 4px;
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
  font: 600 11px/1.3 ui-monospace, Consolas, "Microsoft YaHei", sans-serif;
  cursor: pointer;
}
.find-flag.active,
.find-flag:hover,
.find-btn:hover:not(:disabled),
.find-action:hover:not(:disabled) {
  background: var(--theme-ink, #111);
  color: var(--theme-paper, #fff);
}
.find-btn:disabled,
.find-action:disabled {
  opacity: 0.45;
  cursor: default;
}
.find-count {
  min-width: 56px;
  text-align: center;
  font: 600 11px/1.3 ui-monospace, Consolas, monospace;
  color: var(--theme-muted, #555);
}
.find-count.error {
  color: #a12626;
}
</style>
