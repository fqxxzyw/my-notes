import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const compiled = await build({ entryPoints: ['docs/.vitepress/theme/themeManager.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { createThemeManager, themeKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
function fixture(initial, dark = false) {
  const values = new Map(initial ? [[themeKey, initial]] : [])
  const classes = new Set()
  const root = { dataset: {}, classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name) } } }
  let listener
  const media = { matches: dark, addEventListener(_, fn) { listener = fn }, removeEventListener(_, fn) { if (listener === fn) listener = undefined } }
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
  globalThis.document = { documentElement: root }
  globalThis.window = { matchMedia: () => media }
  return { values, classes, root, media, change() { listener?.() }, hasListener() { return !!listener } }
}
test('keeps legacy selection and persists each new theme', () => {
  const f = fixture('night'); let selected
  const manager = createThemeManager(value => { selected = value })
  assert.equal(selected, 'night'); assert.equal(f.root.dataset.paperTheme, 'night'); assert.ok(f.classes.has('paper-night'))
  manager.select('green'); assert.equal(f.values.get(themeKey), 'green'); assert.equal(f.root.dataset.paperTheme, 'green'); assert.ok(f.classes.has('paper-theme-green')); assert.ok(!f.classes.has('paper-night'))
  manager.select('yellow'); assert.equal(f.root.dataset.paperTheme, 'yellow'); assert.ok(f.classes.has('paper-theme-yellow')); assert.ok(!f.classes.has('paper-theme-green'))
  manager.dispose(); assert.equal(f.hasListener(), false)
})
test('system preference survives reload and follows system changes', () => {
  const f = fixture('system', false); let selected
  let manager = createThemeManager(value => { selected = value })
  assert.equal(selected, 'system'); assert.equal(f.root.dataset.paperTheme, 'day')
  f.media.matches = true; f.change(); assert.equal(f.root.dataset.paperTheme, 'night'); assert.equal(selected, 'system')
  manager.dispose(); manager = createThemeManager(value => { selected = value })
  assert.equal(selected, 'system'); assert.equal(f.root.dataset.paperTheme, 'night')
  f.media.matches = false; f.change(); assert.equal(f.root.dataset.paperTheme, 'day')
  manager.select('green'); f.media.matches = true; f.change(); assert.equal(f.root.dataset.paperTheme, 'green')
  manager.dispose()
})
