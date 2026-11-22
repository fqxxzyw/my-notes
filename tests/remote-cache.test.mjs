import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundled = await build({ entryPoints: ['docs/.vitepress/theme/remoteCache.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { readRemoteCache, writeRemoteCache, clearRemoteCache } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
const sha = char => char.repeat(40)
const snapshot = {
  head: sha('a'),
  books: [{ id: 'book1', title: '一本书', sha: sha('b') }],
  chapters: { book1: [{ bookId: 'book1', id: 'chapter1', title: '第一章', content: '# 第一章\n', sha: sha('c') }] },
  catalog: { catalog: { cabinets: [{ id: 'general', title: '常用书柜' }], assignments: { book1: 'general' } }, sha: sha('d') }
}

function fakeStorage() {
  const values = new Map()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) }
  }
}

test('a complete remote snapshot survives reload without storing unrelated fields', () => {
  const storage = fakeStorage()
  storage.values.set('paper-notes-draft:book1/chapter1', 'unsynchronized draft')
  writeRemoteCache({ ...snapshot, token: 'fake-secret' }, storage)
  const loaded = readRemoteCache(storage)
  assert.equal(loaded.head, snapshot.head)
  assert.equal(loaded.chapters.book1[0].content, snapshot.chapters.book1[0].content)
  assert.equal(JSON.stringify([...storage.values.values()]).includes('fake-secret'), false)
  clearRemoteCache(storage)
  assert.equal(readRemoteCache(storage), null)
  assert.equal(storage.values.get('paper-notes-draft:book1/chapter1'), 'unsynchronized draft')
})

test('invalid or incomplete new snapshots never replace the previous cache', () => {
  const storage = fakeStorage()
  writeRemoteCache(snapshot, storage)
  const before = [...storage.values.values()][0]
  assert.throws(() => writeRemoteCache({ ...snapshot, chapters: {} }, storage))
  assert.throws(() => writeRemoteCache({ ...snapshot, head: 'not-a-sha' }, storage))
  assert.equal([...storage.values.values()][0], before)
  assert.equal(readRemoteCache(storage).head, snapshot.head)
})

test('a storage quota failure preserves the previous snapshot', () => {
  const storage = fakeStorage()
  writeRemoteCache(snapshot, storage)
  const before = [...storage.values.values()][0]
  storage.setItem = () => { throw new Error('quota') }
  assert.throws(() => writeRemoteCache({ ...snapshot, head: sha('e') }, storage), /quota/)
  assert.equal([...storage.values.values()][0], before)
})

test('bad cache contents cannot be mistaken for a valid snapshot', () => {
  const storage = fakeStorage()
  storage.values.set('paper-notes-remote-snapshot-v1', '{bad json')
  assert.equal(readRemoteCache(storage), null)
  assert.equal(storage.values.size, 1)
})

test('known stale snapshots remain marked stale without losing notes', () => {
  const storage = fakeStorage()
  writeRemoteCache({ ...snapshot, stale: true }, storage)
  assert.equal(readRemoteCache(storage).stale, true)
  assert.equal(readRemoteCache(storage).chapters.book1.length, 1)
  assert.throws(() => writeRemoteCache({ ...snapshot, stale: 'yes' }, storage))
  assert.equal(readRemoteCache(storage).stale, true)
})
