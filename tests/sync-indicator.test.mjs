import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/syncIndicator.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { createSyncIndicator } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)

function setup() {
  const states = []
  const scheduled = []
  const cancelled = []
  const signal = createSyncIndicator(state => states.push(state), {
    schedule: (callback, delay) => { const job = { callback, delay }; scheduled.push(job); return job },
    cancel: job => cancelled.push(job)
  })
  return { states, scheduled, cancelled, signal }
}

test('confirmed sync shows completion then settles into the original line', () => {
  const { states, scheduled, signal } = setup()
  signal.success(42)
  assert.deepEqual(states, [])
  const id = signal.start('sync'); signal.success(id)
  assert.deepEqual(states, [{ phase: 'running', kind: 'sync' }, { phase: 'success', kind: 'sync' }])
  assert.equal(scheduled[0].delay, 1400)
  scheduled[0].callback()
  assert.deepEqual(states.at(-1), { phase: 'settling', kind: 'sync' })
  assert.equal(scheduled[1].delay, 650)
  scheduled[1].callback()
  assert.deepEqual(states.at(-1), { phase: 'idle' })
})

test('failure never shows completion and stale timers cannot hide a new restore', () => {
  const { states, scheduled, cancelled, signal } = setup()
  const first = signal.start('sync'); signal.success(first)
  const oldTimer = scheduled[0]
  const second = signal.start('restore')
  assert.equal(cancelled.includes(oldTimer), true)
  oldTimer.callback()
  assert.deepEqual(states.at(-1), { phase: 'running', kind: 'restore' })
  signal.fail(second); signal.success(second)
  assert.deepEqual(states.at(-1), { phase: 'idle' })
})

test('overlapping operations do not hide or complete each other', () => {
  const { states, signal } = setup()
  const sync = signal.start('sync')
  const restore = signal.start('restore')
  signal.success(sync)
  assert.deepEqual(states.at(-1), { phase: 'running', kind: 'restore' })
  signal.fail(restore)
  assert.deepEqual(states.at(-1), { phase: 'idle' })
  signal.success(sync)
  assert.deepEqual(states.at(-1), { phase: 'idle' })
})

test('a new invalid or empty attempt can dismiss old success without hiding active work', () => {
  const { states, scheduled, signal } = setup()
  const done = signal.start('sync'); signal.success(done)
  const oldTimer = scheduled[0]
  signal.dismissCompletion()
  oldTimer.callback()
  assert.deepEqual(states.at(-1), { phase: 'idle' })
  const active = signal.start('restore')
  signal.dismissCompletion()
  assert.deepEqual(states.at(-1), { phase: 'running', kind: 'restore' })
  signal.fail(active)
  assert.deepEqual(states.at(-1), { phase: 'idle' })
})
