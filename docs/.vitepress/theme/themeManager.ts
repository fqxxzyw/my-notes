export type ThemePreference = 'day' | 'night' | 'green' | 'yellow' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>
export const themeKey = 'paper-notes-theme'
const preferences: ThemePreference[] = ['day', 'night', 'green', 'yellow', 'system']

/** Keeps the selected preference (including system) separate from its current appearance. */
export function createThemeManager(onChange: (preference: ThemePreference) => void) {
  const root = document.documentElement
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  let preference: ThemePreference = 'day'
  let stored: string | null = null
  try { stored = localStorage.getItem(themeKey) } catch { /* storage can be unavailable */ }
  if (stored && preferences.includes(stored as ThemePreference)) preference = stored as ThemePreference
  const apply = () => {
    const resolved: ResolvedTheme = preference === 'system' ? (media?.matches ? 'night' : 'day') : preference
    root.classList.toggle('paper-night', resolved === 'night')
    root.classList.toggle('paper-theme-green', resolved === 'green')
    root.classList.toggle('paper-theme-yellow', resolved === 'yellow')
    root.dataset.paperTheme = resolved
    onChange(preference)
  }
  const handleSystemChange = () => { if (preference === 'system') apply() }
  media?.addEventListener('change', handleSystemChange)
  apply()
  return {
    select(next: ThemePreference) {
      if (!preferences.includes(next)) return
      preference = next
      try { localStorage.setItem(themeKey, next) } catch { /* appearance still applies */ }
      apply()
    },
    dispose() { media?.removeEventListener('change', handleSystemChange) }
  }
}
