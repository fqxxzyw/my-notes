<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createThemeManager,
  defaultCustomTheme,
  type CustomThemeColors,
  type ThemePreference
} from './themeManager'

const open = ref(false)
const selected = ref<ThemePreference>('day')
const customColors = ref<CustomThemeColors>({ ...defaultCustomTheme })
const trigger = ref<HTMLButtonElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
let manager: ReturnType<typeof createThemeManager> | undefined

const choices: { id: ThemePreference; label: string; hint: string }[] = [
  { id: 'day', label: '日间', hint: '纯白纸面' },
  { id: 'night', label: '夜间', hint: '深色纸面' },
  { id: 'green', label: '护眼', hint: '浅绿色' },
  { id: 'yellow', label: '阅读', hint: '浅黄色' },
  { id: 'blue', label: '淡蓝', hint: '清透淡蓝' },
  { id: 'custom', label: '自定义', hint: '自由调色' },
  { id: 'system', label: '跟随系统', hint: '自动切换' }
]

const customPresets: { label: string; colors: CustomThemeColors }[] = [
  { label: '雾霾蓝', colors: { paper: '#eef4fa', ink: '#1f3347', edge: '#46688a' } },
  { label: '樱花笺', colors: { paper: '#fdf2f4', ink: '#43252d', edge: '#8f5262' } },
  { label: '丁香紫', colors: { paper: '#f5f1fb', ink: '#2f2442', edge: '#66508a' } },
  { label: '薄荷青', colors: { paper: '#eef8f6', ink: '#1c3b36', edge: '#3b746b' } },
  { label: '羊皮纸', colors: { paper: '#f5efe2', ink: '#3d3122', edge: '#7d684a' } },
  { label: '深海夜', colors: { paper: '#18222e', ink: '#e3ecf5', edge: '#7a9ec2' } }
]

function show() { open.value = true; void nextTick(() => closeButton.value?.focus()) }
function close() { open.value = false; void nextTick(() => trigger.value?.focus()) }
function choose(value: ThemePreference) { manager?.select(value) }
function updateColor(key: keyof CustomThemeColors, event: Event) {
  const value = (event.target as HTMLInputElement).value
  manager?.setCustomColors({ [key]: value })
}
function applyPreset(colors: CustomThemeColors) {
  manager?.setCustomColors(colors)
}
function resetCustom() {
  manager?.resetCustomColors()
}
function trapFocus(event: KeyboardEvent) {
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])
  if (!controls.length) return
  const active = document.activeElement
  if (event.shiftKey && (active === controls[0] || !dialog.value?.contains(active))) { event.preventDefault(); controls[controls.length - 1].focus() }
  else if (!event.shiftKey && (active === controls[controls.length - 1] || !dialog.value?.contains(active))) { event.preventDefault(); controls[0].focus() }
}
onMounted(() => {
  manager = createThemeManager(
    value => { selected.value = value },
    colors => { customColors.value = colors }
  )
})
onBeforeUnmount(() => { manager?.dispose() })
defineExpose({ show })
</script>

<template>
  <button ref="trigger" type="button" class="theme-toggle" aria-haspopup="dialog" :aria-expanded="open" @click="show"><span aria-hidden="true">◐</span><span>主题</span></button>
  <Teleport to="body">
    <div v-if="open" class="paper-theme-modal" @click.self="close" @keydown.esc.prevent.stop="close" @keydown.tab="trapFocus">
      <section ref="dialog" class="paper-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-title">
        <header class="paper-theme-heading"><div><span class="paper-theme-kicker">PAPER · APPEARANCE</span><h2 id="theme-title">选择主题</h2></div><button ref="closeButton" type="button" aria-label="关闭主题设置" @click="close">×</button></header>
        <p class="paper-theme-description">选择适合此刻的纸面颜色，或自由调配专属色盘。</p>
        <div class="paper-theme-options" role="group" aria-label="主题">
          <button v-for="choice in choices" :key="choice.id" type="button" class="paper-theme-option" :class="{ 'is-selected': selected === choice.id }" :aria-pressed="selected === choice.id" @click="choose(choice.id)">
            <span
              class="paper-theme-swatch"
              :class="`paper-theme-swatch--${choice.id}`"
              :style="choice.id === 'custom' ? { background: customColors.paper, borderColor: customColors.edge } : undefined"
              aria-hidden="true"
            >
              <i :style="choice.id === 'custom' ? { background: customColors.ink } : undefined"></i>
              <i :style="choice.id === 'custom' ? { background: customColors.ink } : undefined"></i>
              <i :style="choice.id === 'custom' ? { background: customColors.edge } : undefined"></i>
            </span>
            <span class="paper-theme-option-copy"><strong>{{ choice.label }}</strong><small>{{ choice.hint }}</small></span><span class="paper-theme-check" aria-hidden="true">{{ selected === choice.id ? '●' : '○' }}</span>
          </button>
        </div>

        <div v-if="selected === 'custom'" class="paper-custom-panel">
          <div class="paper-custom-header">
            <strong>自定义色盘</strong>
            <button type="button" class="paper-custom-reset" @click="resetCustom">恢复默认</button>
          </div>
          <div class="paper-custom-pickers">
            <label class="paper-color-field">
              <span>纸面背景</span>
              <div class="paper-color-input-wrap">
                <input type="color" :value="customColors.paper" @input="updateColor('paper', $event)" />
                <code>{{ customColors.paper }}</code>
              </div>
            </label>
            <label class="paper-color-field">
              <span>文字墨色</span>
              <div class="paper-color-input-wrap">
                <input type="color" :value="customColors.ink" @input="updateColor('ink', $event)" />
                <code>{{ customColors.ink }}</code>
              </div>
            </label>
            <label class="paper-color-field">
              <span>边框线条</span>
              <div class="paper-color-input-wrap">
                <input type="color" :value="customColors.edge" @input="updateColor('edge', $event)" />
                <code>{{ customColors.edge }}</code>
              </div>
            </label>
          </div>
          <div class="paper-custom-presets" aria-label="快捷色盘">
            <button
              v-for="preset in customPresets"
              :key="preset.label"
              type="button"
              class="paper-preset-chip"
              :style="{ background: preset.colors.paper, color: preset.colors.ink, borderColor: preset.colors.edge }"
              @click="applyPreset(preset.colors)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
