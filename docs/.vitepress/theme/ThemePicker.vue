<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { createThemeManager, type ThemePreference } from './themeManager'

const open = ref(false)
const selected = ref<ThemePreference>('day')
const trigger = ref<HTMLButtonElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
let manager: ReturnType<typeof createThemeManager> | undefined
const choices: { id: ThemePreference; label: string; hint: string }[] = [
  { id: 'day', label: '日间', hint: '纯白纸面' },
  { id: 'night', label: '夜间', hint: '深色纸面' },
  { id: 'green', label: '护眼', hint: '浅绿色' },
  { id: 'yellow', label: '阅读', hint: '浅黄色' },
  { id: 'system', label: '跟随系统', hint: '自动切换' }
]
function show() { open.value = true; void nextTick(() => closeButton.value?.focus()) }
function close() { open.value = false; void nextTick(() => trigger.value?.focus()) }
function choose(value: ThemePreference) { manager?.select(value) }
function trapFocus(event: KeyboardEvent) {
  const buttons = Array.from(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
  if (!buttons.length) return
  const active = document.activeElement
  if (event.shiftKey && (active === buttons[0] || !dialog.value?.contains(active))) { event.preventDefault(); buttons[buttons.length - 1].focus() }
  else if (!event.shiftKey && (active === buttons[buttons.length - 1] || !dialog.value?.contains(active))) { event.preventDefault(); buttons[0].focus() }
}
onMounted(() => { manager = createThemeManager(value => { selected.value = value }) })
onBeforeUnmount(() => { manager?.dispose() })
</script>

<template>
  <button ref="trigger" type="button" class="theme-toggle" aria-haspopup="dialog" :aria-expanded="open" @click="show"><span aria-hidden="true">◐</span><span>主题</span></button>
  <Teleport to="body">
    <div v-if="open" class="paper-theme-modal" @click.self="close" @keydown.esc.prevent.stop="close" @keydown.tab="trapFocus">
      <section ref="dialog" class="paper-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-title">
        <header class="paper-theme-heading"><div><span class="paper-theme-kicker">PAPER · APPEARANCE</span><h2 id="theme-title">选择主题</h2></div><button ref="closeButton" type="button" aria-label="关闭主题设置" @click="close">×</button></header>
        <p class="paper-theme-description">选择适合此刻的纸面颜色。</p>
        <div class="paper-theme-options" role="group" aria-label="主题">
          <button v-for="choice in choices" :key="choice.id" type="button" class="paper-theme-option" :class="{ 'is-selected': selected === choice.id }" :aria-pressed="selected === choice.id" @click="choose(choice.id)">
            <span class="paper-theme-swatch" :class="`paper-theme-swatch--${choice.id}`" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="paper-theme-option-copy"><strong>{{ choice.label }}</strong><small>{{ choice.hint }}</small></span><span class="paper-theme-check" aria-hidden="true">{{ selected === choice.id ? '●' : '○' }}</span>
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
