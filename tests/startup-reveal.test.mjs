import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/startupReveal.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { beginDesktopReveal } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)

function setup(hostname = 'paper.local') {
  const classes = new Set(), timers = new Map(), frames = new Map(), sent = [], listeners = new Set()
  let sequence = 0
  const bridge = {
    postMessage: message => sent.push(message),
    addEventListener: (_, handler) => listeners.add(handler),
    removeEventListener: (_, handler) => listeners.delete(handler)
  }
  globalThis.document = { documentElement: { classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)) } } }
  globalThis.window = {
    location: { protocol: 'https:', hostname, pathname: '/my-notes/index.html' }, chrome: { webview: bridge },
    setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id)
  }
  return { classes, timers, frames, sent, listeners }
}

test('desktop waits for reveal without consuming unrelated bridge messages', () => {
  const state = setup()
  const dispose = beginDesktopReveal()
  assert.equal(state.classes.has('paper-desktop-starting'), true)
  const runFrame = () => { const [id, fn] = state.frames.entries().next().value; state.frames.delete(id); fn() }
  runFrame(); runFrame()
  assert.deepEqual(state.sent, [{ channel: 'paper-notes', action: 'ui.ready' }])
  for (const listener of state.listeners) listener({ data: { channel: 'paper-notes', id: 'token-request', token: 'test' } })
  assert.equal(state.classes.has('paper-desktop-starting'), true)
  for (const listener of state.listeners) listener({ data: { channel: 'paper-notes', action: 'ui.reveal' } })
  assert.equal(state.classes.has('paper-desktop-starting'), false)
  assert.equal(state.classes.has('paper-desktop-revealed'), true)
  assert.equal(state.listeners.size, 0)
  dispose()
  assert.equal(state.classes.size, 0)
})

test('desktop makes progress without animation frames and reveals if host does not reply', () => {
  const state = setup()
  beginDesktopReveal()
  const timer = delay => [...state.timers.values()].find(item => item.delay === delay).fn()
  timer(150)
  assert.equal(state.sent[0].action, 'ui.ready')
  timer(8000)
  assert.equal(state.classes.has('paper-desktop-revealed'), true)
  assert.equal(state.listeners.size, 0)
})

test('ordinary websites are never hidden or messaged', () => {
  const state = setup('example.com')
  beginDesktopReveal()
  assert.equal(state.classes.size, 0)
  assert.equal(state.listeners.size, 0)
  assert.equal(state.timers.size, 0)
})
