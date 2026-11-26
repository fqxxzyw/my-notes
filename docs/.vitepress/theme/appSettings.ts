import { ref, onMounted, onBeforeUnmount } from 'vue'
import { isSoundEnabled, onSoundChange, setSoundEnabled } from './shelfAudio'

export interface AppSettings {
  soundEnabled: boolean
  showLineNumbers: boolean
  editorFontSize: number
  toolbarCollapsed: boolean
}

export const settingsStorageKey = 'paper-notes-settings'

export const defaultAppSettings: AppSettings = {
  soundEnabled: true,
  showLineNumbers: true,
  editorFontSize: 15,
  toolbarCollapsed: false
}

const listeners = new Set<(settings: AppSettings) => void>()

function clampFontSize(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return defaultAppSettings.editorFontSize
  return Math.max(13, Math.min(20, Math.round(num)))
}

function readStoredSettings(): AppSettings {
  const base: AppSettings = {
    ...defaultAppSettings,
    soundEnabled: isSoundEnabled()
  }
  if (typeof window === 'undefined') return base
  try {
    const raw = window.localStorage.getItem(settingsStorageKey)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      soundEnabled: isSoundEnabled(),
      showLineNumbers: typeof parsed.showLineNumbers === 'boolean' ? parsed.showLineNumbers : base.showLineNumbers,
      editorFontSize: clampFontSize(parsed.editorFontSize),
      toolbarCollapsed: typeof parsed.toolbarCollapsed === 'boolean' ? parsed.toolbarCollapsed : base.toolbarCollapsed
    }
  } catch {
    return base
  }
}

let currentSettings: AppSettings = readStoredSettings()

function applySettingsToRoot(settings: AppSettings): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--paper-editor-font-size', `${settings.editorFontSize}px`)
  document.documentElement.classList.toggle('paper-line-numbers-off', !settings.showLineNumbers)
}

function notify(): void {
  applySettingsToRoot(currentSettings)
  const snapshot = { ...currentSettings }
  listeners.forEach(fn => {
    try { fn(snapshot) } catch { /* ignore subscriber errors */ }
  })
}

if (typeof window !== 'undefined') {
  applySettingsToRoot(currentSettings)
  onSoundChange(enabled => {
    if (currentSettings.soundEnabled !== enabled) {
      currentSettings = { ...currentSettings, soundEnabled: enabled }
      notify()
    }
  })
}

export function getAppSettings(): AppSettings {
  return { ...currentSettings }
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = {
    soundEnabled: typeof patch.soundEnabled === 'boolean' ? patch.soundEnabled : currentSettings.soundEnabled,
    showLineNumbers: typeof patch.showLineNumbers === 'boolean' ? patch.showLineNumbers : currentSettings.showLineNumbers,
    editorFontSize: patch.editorFontSize !== undefined ? clampFontSize(patch.editorFontSize) : currentSettings.editorFontSize,
    toolbarCollapsed: typeof patch.toolbarCollapsed === 'boolean' ? patch.toolbarCollapsed : currentSettings.toolbarCollapsed
  }
  currentSettings = next
  if (typeof patch.soundEnabled === 'boolean' && patch.soundEnabled !== isSoundEnabled()) {
    setSoundEnabled(patch.soundEnabled)
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(settingsStorageKey, JSON.stringify({
        showLineNumbers: next.showLineNumbers,
        editorFontSize: next.editorFontSize,
        toolbarCollapsed: next.toolbarCollapsed
      }))
    } catch { /* ignore storage errors */ }
  }
  notify()
  return { ...currentSettings }
}

export function resetAppSettings(): AppSettings {
  return updateAppSettings({ ...defaultAppSettings })
}

export function onAppSettingsChange(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useAppSettings() {
  const settings = ref<AppSettings>(getAppSettings())
  let unsub: (() => void) | undefined
  onMounted(() => {
    settings.value = getAppSettings()
    applySettingsToRoot(settings.value)
    unsub = onAppSettingsChange(next => { settings.value = next })
  })
  onBeforeUnmount(() => { unsub?.() })
  return {
    settings,
    update: updateAppSettings,
    reset: resetAppSettings
  }
}
