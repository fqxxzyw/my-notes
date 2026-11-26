<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useAppSettings } from './appSettings'
import { playBookHover } from './shelfAudio'

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
const { settings, update, reset } = useAppSettings()

function show() {
  open.value = true
  void nextTick(() => closeButton.value?.focus())
}

function close() {
  open.value = false
  void nextTick(() => trigger.value?.focus())
}

function toggleSound() {
  const next = !settings.value.soundEnabled
  update({ soundEnabled: next })
  if (next) playBookHover()
}

function toggleLineNumbers() {
  update({ showLineNumbers: !settings.value.showLineNumbers })
}

function toggleToolbarCollapsed() {
  update({ toolbarCollapsed: !settings.value.toolbarCollapsed })
}

function changeFontSize(delta: number) {
  update({ editorFontSize: settings.value.editorFontSize + delta })
}

function trapFocus(event: KeyboardEvent) {
  const focusables = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])
  if (!focusables.length) return
  const active = document.activeElement
  if (event.shiftKey && (active === focusables[0] || !dialog.value?.contains(active))) {
    event.preventDefault()
    focusables[focusables.length - 1].focus()
  } else if (!event.shiftKey && (active === focusables[focusables.length - 1] || !dialog.value?.contains(active))) {
    event.preventDefault()
    focusables[0].focus()
  }
}

defineExpose({ show })
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="theme-toggle settings-toggle"
    aria-haspopup="dialog"
    :aria-expanded="open"
    title="常规设置"
    @click="show"
  >
    <span aria-hidden="true">⚙</span><span>设置</span>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      class="paper-theme-modal"
      @click.self="close"
      @keydown.esc.prevent.stop="close"
      @keydown.tab="trapFocus"
    >
      <section
        ref="dialog"
        class="paper-theme-dialog paper-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header class="paper-theme-heading">
          <div>
            <span class="paper-theme-kicker">PAPER · PREFERENCES</span>
            <h2 id="settings-title">常规设置</h2>
          </div>
          <button ref="closeButton" type="button" aria-label="关闭设置" @click="close">×</button>
        </header>

        <div class="paper-settings-list">
          <div class="paper-settings-row">
            <div class="paper-settings-copy">
              <strong>书架与翻页音效</strong>
              <small>滑动书脊、悬停书本及抵达书架边缘时的纸张声效</small>
            </div>
            <button
              type="button"
              class="paper-settings-switch"
              role="switch"
              :aria-checked="settings.soundEnabled"
              @click="toggleSound"
            >
              {{ settings.soundEnabled ? '已开启' : '已静音' }}
            </button>
          </div>

          <div class="paper-settings-row">
            <div class="paper-settings-copy">
              <strong>显示行号</strong>
              <small>在代码块、源代码模式、双栏对照及纯文本编辑框中显示行号</small>
            </div>
            <button
              type="button"
              class="paper-settings-switch"
              role="switch"
              :aria-checked="settings.showLineNumbers"
              @click="toggleLineNumbers"
            >
              {{ settings.showLineNumbers ? '显示' : '隐藏' }}
            </button>
          </div>

          <div class="paper-settings-row">
            <div class="paper-settings-copy">
              <strong>默认收起编辑工具栏</strong>
              <small>打开编辑器时收起上方格式按钮栏，留出更大写作空间</small>
            </div>
            <button
              type="button"
              class="paper-settings-switch"
              role="switch"
              :aria-checked="settings.toolbarCollapsed"
              @click="toggleToolbarCollapsed"
            >
              {{ settings.toolbarCollapsed ? '收起' : '展开' }}
            </button>
          </div>

          <div class="paper-settings-row">
            <div class="paper-settings-copy">
              <strong>编辑与代码字号</strong>
              <small>调整写作区域与代码块的基准字体大小（13px – 20px）</small>
            </div>
            <div class="paper-settings-stepper">
              <button type="button" :disabled="settings.editorFontSize <= 13" aria-label="减小字号" @click="changeFontSize(-1)">A-</button>
              <span>{{ settings.editorFontSize }}px</span>
              <button type="button" :disabled="settings.editorFontSize >= 20" aria-label="增大字号" @click="changeFontSize(1)">A+</button>
            </div>
          </div>
        </div>

        <footer class="paper-settings-footer">
          <button type="button" class="paper-settings-reset" @click="reset">恢复默认设置</button>
          <button type="button" class="paper-settings-done" @click="close">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
