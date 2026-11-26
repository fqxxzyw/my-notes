export type ThemePreference = 'day' | 'night' | 'green' | 'yellow' | 'blue' | 'custom' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>
export interface CustomThemeColors {
  paper: string
  ink: string
  edge: string
}

export const themeKey = 'paper-notes-theme'
export const customThemeKey = 'paper-notes-custom-theme'
export const defaultCustomTheme: CustomThemeColors = {
  paper: '#f4f1ea',
  ink: '#26231e',
  edge: '#5a5042'
}

const preferences: ThemePreference[] = ['day', 'night', 'green', 'yellow', 'blue', 'custom', 'system']

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

function sanitizeHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim()) ? value.trim().toLowerCase() : fallback
}

function parseHex(hex: string): [number, number, number] {
  const clean = sanitizeHex(hex, '#ffffff')
  return [
    parseInt(clean.slice(1, 3), 16),
    parseInt(clean.slice(3, 5), 16),
    parseInt(clean.slice(5, 7), 16)
  ]
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`
}

function mixHex(a: string, b: string, weightB: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  const w = Math.max(0, Math.min(1, weightB))
  return toHex(ar + (br - ar) * w, ag + (bg - ag) * w, ab + (bb - ab) * w)
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function loadCustomTheme(): CustomThemeColors {
  try {
    const raw = localStorage.getItem(customThemeKey)
    if (!raw) return { ...defaultCustomTheme }
    const parsed = JSON.parse(raw) as Partial<CustomThemeColors>
    return {
      paper: sanitizeHex(parsed.paper, defaultCustomTheme.paper),
      ink: sanitizeHex(parsed.ink, defaultCustomTheme.ink),
      edge: sanitizeHex(parsed.edge, defaultCustomTheme.edge)
    }
  } catch {
    return { ...defaultCustomTheme }
  }
}

export function saveCustomTheme(colors: CustomThemeColors): CustomThemeColors {
  const clean: CustomThemeColors = {
    paper: sanitizeHex(colors.paper, defaultCustomTheme.paper),
    ink: sanitizeHex(colors.ink, defaultCustomTheme.ink),
    edge: sanitizeHex(colors.edge, defaultCustomTheme.edge)
  }
  try {
    localStorage.setItem(customThemeKey, JSON.stringify(clean))
  } catch { /* storage can be unavailable */ }
  return clean
}

export function deriveCustomThemeVars(colors: CustomThemeColors): Record<string, string> {
  const paper = sanitizeHex(colors.paper, defaultCustomTheme.paper)
  const ink = sanitizeHex(colors.ink, defaultCustomTheme.ink)
  const edge = sanitizeHex(colors.edge, defaultCustomTheme.edge)
  const isDark = relativeLuminance(paper) < 0.35
  const bg = mixHex(paper, isDark ? '#000000' : edge, isDark ? 0.14 : 0.05)
  const soft = mixHex(paper, ink, isDark ? 0.12 : 0.08)
  const muted = mixHex(ink, paper, 0.34)
  const divider = mixHex(edge, paper, 0.32)
  return {
    'color-scheme': isDark ? 'dark' : 'light',
    '--theme-ink': ink,
    '--theme-paper': paper,
    '--theme-soft': soft,
    '--theme-muted': muted,
    '--theme-edge': edge,
    '--vp-c-bg': bg,
    '--vp-c-bg-alt': paper,
    '--vp-c-bg-soft': soft,
    '--vp-c-text-1': ink,
    '--vp-c-text-2': muted,
    '--vp-c-divider': divider
  }
}

const CUSTOM_VAR_KEYS = [
  'color-scheme',
  '--theme-ink', '--theme-paper', '--theme-soft', '--theme-muted', '--theme-edge',
  '--vp-c-bg', '--vp-c-bg-alt', '--vp-c-bg-soft', '--vp-c-text-1', '--vp-c-text-2', '--vp-c-divider'
]

/** Keeps the selected preference (including system) separate from its current appearance. */
export function createThemeManager(
  onChange: (preference: ThemePreference) => void,
  onCustomChange?: (colors: CustomThemeColors) => void
) {
  const root = document.documentElement
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  let preference: ThemePreference = 'day'
  let customColors: CustomThemeColors = loadCustomTheme()
  let stored: string | null = null
  try { stored = localStorage.getItem(themeKey) } catch { /* storage can be unavailable */ }
  if (stored && preferences.includes(stored as ThemePreference)) preference = stored as ThemePreference
  const apply = () => {
    const resolved: ResolvedTheme = preference === 'system' ? (media?.matches ? 'night' : 'day') : preference
    root.classList.toggle('paper-night', resolved === 'night')
    root.classList.toggle('paper-theme-green', resolved === 'green')
    root.classList.toggle('paper-theme-yellow', resolved === 'yellow')
    root.classList.toggle('paper-theme-blue', resolved === 'blue')
    root.classList.toggle('paper-theme-custom', resolved === 'custom')
    if (resolved === 'custom') {
      const vars = deriveCustomThemeVars(customColors)
      for (const [key, value] of Object.entries(vars)) root.style?.setProperty(key, value)
    } else {
      for (const key of CUSTOM_VAR_KEYS) root.style?.removeProperty(key)
    }
    root.dataset.paperTheme = resolved
    onChange(preference)
    onCustomChange?.({ ...customColors })
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
    setCustomColors(next: Partial<CustomThemeColors>) {
      customColors = saveCustomTheme({ ...customColors, ...next })
      preference = 'custom'
      try { localStorage.setItem(themeKey, 'custom') } catch { /* appearance still applies */ }
      apply()
    },
    resetCustomColors() {
      customColors = saveCustomTheme({ ...defaultCustomTheme })
      apply()
    },
    getCustomColors() { return { ...customColors } },
    dispose() { media?.removeEventListener('change', handleSystemChange) }
  }
}
