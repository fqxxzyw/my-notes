import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['docs/.vitepress/theme/useCabinets.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { useCabinets } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
globalThis.crypto ??= webcrypto
const key = 'paper-notes:v2:local:paper-notes:cabinets:v1'
function memory(initial = {}) {
  const state = new Map(Object.entries(initial))
  let fail = false
  globalThis.localStorage = {
    getItem: name => state.get(name) ?? null,
    setItem: (name, value) => { if (fail) throw new Error('quota'); state.set(name, String(value)) },
    removeItem: name => state.delete(name)
  }
  return { state, fail: value => { fail = value } }
}
const old = { sha: 'a'.repeat(40), catalog: { cabinets: [{ id: 'general', title: '常用书柜' }, { id: 'reading', title: '阅读' }], assignments: { book1: 'reading' } } }
const modern = { sha: 'b'.repeat(40), catalog: { schemaVersion: 2, cabinets: [{ id: 'general', title: '默认书柜' }, { id: 'new', title: '新书柜' }], assignments: { book1: 'new' } } }

test('cabinet journals remain isolated by repository identity', () => {
  const store = memory({ 'paper-notes:cabinets:v1': JSON.stringify({ created: { old: '旧柜' }, moves: {} }) })
  const alice = useCabinets('Alice/Notes'); alice.restore(modern)
  const localId = alice.create('Alice 的本机柜')
  const same = useCabinets('alice/notes'); same.restore(modern)
  const bob = useCabinets('bob/notes'); bob.restore(modern)
  assert.ok(same.cabinets.value.some(c => c.id === localId))
  assert.ok(!bob.cabinets.value.some(c => c.id === localId))
  assert.ok(!bob.cabinets.value.some(c => c.id === 'old'))
  assert.ok(store.state.has('paper-notes:cabinets:v1'))
})

test('old snapshot and journal migrate once; later new cabinet remains after restart', () => {
  memory({ [key]: JSON.stringify({ created: { oldlocal: '旧本机柜' }, moves: { draft: { from: 'general', to: 'oldlocal' } }, saved: old, snapshotSha: old.sha }) })
  const first = useCabinets(); first.restore(old)
  assert.deepEqual(first.cabinets.value.map(c => c.id), ['general'])
  assert.equal(first.assigned('book1'), 'general'); assert.equal(first.assigned('draft'), 'general')
  const newId = first.create('新的本机柜'); first.move('draft', newId)
  const restarted = useCabinets(); restarted.restore(old)
  assert.deepEqual(restarted.cabinets.value.map(c => c.id), ['general', newId])
  assert.equal(restarted.assigned('draft'), newId)
  restarted.latest(modern)
  assert.ok(restarted.cabinets.value.some(c => c.id === 'new'))
  assert.equal(restarted.assigned('book1'), 'new')
  // A later old-client update is a distinct revision, not the cached reset target.
  const laterLegacy = { ...old, sha: 'c'.repeat(40) }
  restarted.latest(laterLegacy)
  assert.ok(restarted.cabinets.value.some(c => c.id === 'reading'))
})

test('v2 remote data remains on first use, and migration storage failure preserves old journal', () => {
  const initial = JSON.stringify({ created: { oldlocal: '旧本机柜' }, moves: { draft: { from: 'general', to: 'oldlocal' } } })
  const store = memory({ [key]: initial }); store.fail(true)
  const failed = useCabinets(); assert.throws(() => failed.restore(modern), /保留/)
  assert.equal(store.state.get(key), initial)
  store.fail(false)
  const ok = useCabinets(); ok.restore(modern)
  assert.ok(ok.cabinets.value.some(c => c.id === 'new')); assert.equal(ok.assigned('book1'), 'new')
  assert.equal(ok.assigned('draft'), 'general')
})

test('remove cabinet migrates its books without deleting notes; prepare and acknowledge removal', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  desk.move('local', 'new')
  assert.throws(() => desk.remove('general'), /不能删除/)
  desk.remove('new')
  assert.deepEqual(desk.cabinets.value.map(c => c.id), ['general'])
  assert.equal(desk.assigned('book1'), 'general'); assert.equal(desk.assigned('local'), 'general')
  const change = desk.prepare([], ['new'])
  assert.equal(change.catalog.schemaVersion, 2)
  assert.deepEqual(change.catalog.cabinets.map(c => c.id), ['general'])
  assert.equal(change.catalog.assignments.book1, undefined)
  desk.acknowledge({ catalog: change.catalog, sha: 'd'.repeat(40) })
  assert.equal(desk.pending.value, 0)
})

test('batch move and delete roll back atomically if local persistence fails', () => {
  const store = memory(); const desk = useCabinets(); desk.restore(modern)
  store.fail(true)
  assert.throws(() => desk.moveMany(['book1', 'book2'], 'general'), /无法保存/)
  assert.equal(desk.assigned('book1'), 'new'); assert.equal(desk.assigned('book2'), 'general')
  assert.throws(() => desk.remove('new'), /无法保存/)
  assert.ok(desk.cabinets.value.some(c => c.id === 'new'))
  store.fail(false)
  desk.moveMany(['book1', 'book2'], 'general')
  assert.equal(desk.assigned('book1'), 'general')
})

test('removing an unsynced cabinet keeps its local books in the default cabinet', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  const local = desk.create('未同步书柜')
  desk.moveMany(['draft1', 'draft2'], local)
  desk.remove(local)
  assert.equal(desk.assigned('draft1'), 'general')
  assert.equal(desk.assigned('draft2'), 'general')
  assert.equal(desk.pending.value, 0)
})

test('remote catalog changes during pending cabinet removal refuse to overwrite new assignments', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  desk.remove('new')
  desk.latest({ sha: 'c'.repeat(40), catalog: { ...modern.catalog, assignments: { ...modern.catalog.assignments, addedElsewhere: 'new' } } })
  assert.throws(() => desk.prepare([], ['new']), /远程书柜内容已变化/)
  assert.ok(desk.journal.value.removed.new)
  // If a previous uncertain submission actually completed, retry can acknowledge it.
  desk.latest({ sha: 'd'.repeat(40), catalog: { schemaVersion: 2, cabinets: [{ id: 'general', title: '默认书柜' }], assignments: {} } })
  const retry = desk.prepare([], ['new'])
  desk.acknowledge({ catalog: retry.catalog, sha: 'd'.repeat(40) })
  assert.equal(desk.pending.value, 0)
})

test('undo cabinet removal restores redirected pending moves without clobbering subsequent changes', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  const other = desk.create('另一个柜')
  desk.move('draft1', 'new'); desk.move('draft2', 'new')
  desk.remove('new')
  desk.move('draft2', other)
  desk.undoRemove('new')
  assert.ok(desk.cabinets.value.some(c => c.id === 'new'))
  assert.equal(desk.assigned('book1'), 'new')
  assert.equal(desk.assigned('draft1'), 'new')
  assert.equal(desk.assigned('draft2'), other)
})
