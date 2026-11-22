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

test('renaming the default and an existing cabinet survives restart and syncs without moving notes', () => {
  memory(); const desk = useCabinets('alice/notes'); desk.restore(modern)
  desk.rename('general', '  个人笔记  '); desk.rename('new', '阅读资料')
  assert.equal(desk.cabinets.value.find(c => c.id === 'general').title, '个人笔记')
  assert.equal(desk.pending.value, 2)
  const restarted = useCabinets('alice/notes'); restarted.restore(modern)
  assert.equal(restarted.cabinets.value.find(c => c.id === 'new').title, '阅读资料')
  const change = restarted.prepare([], ['general', 'new'])
  assert.deepEqual(change.catalog.cabinets.map(c => c.title), ['个人笔记', '阅读资料'])
  assert.equal(change.catalog.assignments.book1, 'new')
  restarted.acknowledge({ catalog: change.catalog, sha: 'd'.repeat(40) })
  assert.equal(restarted.pending.value, 0)
  assert.throws(() => restarted.remove('general'), /不能删除/)
})

test('rename of an unsynced cabinet updates its creation and changing back cancels a remote rename', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  const id = desk.create('草稿柜'); desk.rename(id, '新名称')
  assert.equal(desk.journal.value.created[id], '新名称')
  assert.equal(desk.pending.value, 1)
  desk.rename('new', '临时名称'); desk.rename('new', '新书柜')
  assert.equal(desk.pending.value, 1)
  const change = desk.prepare([], [id])
  assert.equal(change.catalog.cabinets.find(c => c.id === id).title, '新名称')
})

test('rename rejects invalid input and rolls back when local persistence fails', () => {
  const storage = memory(); const desk = useCabinets(); desk.restore(modern)
  for (const title of ['', '   ', '一\n二', 'x'.repeat(121)]) assert.throws(() => desk.rename('new', title), /名称/)
  assert.throws(() => desk.rename('missing', '新名称'), /不存在/)
  storage.fail(true)
  assert.throws(() => desk.rename('new', '新名称'), /无法保存/)
  assert.equal(desk.cabinets.value.find(c => c.id === 'new').title, '新书柜')
  assert.equal(desk.pending.value, 0)
})

test('renames reject conflicting remote changes but permit idempotent retry after an uncertain response', () => {
  memory(); const desk = useCabinets(); desk.restore(modern); desk.rename('new', '本机名称')
  desk.latest({ sha: 'c'.repeat(40), catalog: { ...modern.catalog, cabinets: modern.catalog.cabinets.map(c => c.id === 'new' ? { ...c, title: '远程名称' } : c) } })
  assert.throws(() => desk.prepare([], ['new']), /远程书柜名称已更改/)
  desk.latest(modern)
  const first = desk.prepare([], ['new'])
  assert.throws(() => desk.rename('new', '同步期间'), /同步正在进行/)
  desk.fail()
  desk.latest({ sha: 'd'.repeat(40), catalog: first.catalog })
  const retry = desk.prepare([], ['new'])
  desk.acknowledge({ catalog: retry.catalog, sha: 'd'.repeat(40) })
  assert.equal(desk.pending.value, 0)
})

test('deleting and undoing a renamed cabinet preserves the unsynced name', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  desk.rename('new', '待读')
  desk.remove('new')
  assert.equal(desk.journal.value.renamed.new, undefined)
  desk.undoRemove('new')
  assert.equal(desk.cabinets.value.find(c => c.id === 'new').title, '待读')
  const change = desk.prepare([], ['new'])
  assert.equal(change.catalog.cabinets.find(c => c.id === 'new').title, '待读')
})

test('renaming a newly created cabinet after an uncertain successful create clears the acknowledged creation', () => {
  memory(); const desk = useCabinets(); desk.restore(modern)
  const id = desk.create('最初名称')
  const attempted = desk.prepare([], [id]); desk.fail()
  // The server accepted the first commit even though the response was lost.
  desk.latest({ sha: 'c'.repeat(40), catalog: attempted.catalog })
  desk.rename(id, '更新名称')
  const change = desk.prepare([], [id])
  desk.acknowledge({ catalog: change.catalog, sha: 'd'.repeat(40) })
  assert.equal(desk.cabinets.value.find(c => c.id === id).title, '更新名称')
  assert.equal(desk.journal.value.created[id], undefined)
  assert.equal(desk.pending.value, 0)
})
