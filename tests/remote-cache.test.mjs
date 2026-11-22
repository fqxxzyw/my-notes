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
  writeRemoteCache({ ...snapshot, token: 'fake-secret' }, 'example/repo', storage)
  const loaded = readRemoteCache('example/repo', storage)
  assert.equal(loaded.head, snapshot.head)
  assert.equal(loaded.chapters.book1[0].content, snapshot.chapters.book1[0].content)
  assert.equal(JSON.stringify([...storage.values.values()]).includes('fake-secret'), false)
  clearRemoteCache('example/repo', storage)
  assert.equal(readRemoteCache('example/repo', storage), null)
  assert.equal(storage.values.get('paper-notes-draft:book1/chapter1'), 'unsynchronized draft')
})

test('standalone pages survive offline reload while legacy snapshots remain readable', () => {
  const storage = fakeStorage()
  writeRemoteCache(snapshot, 'old/repo', storage)
  assert.equal(readRemoteCache('old/repo', storage).pages, undefined)
  const pages = [{ id: 'page1', title: '独立书页', content: '原文\r\n', sha: sha('f') }]
  writeRemoteCache({ ...snapshot, pages }, 'new/repo', storage)
  assert.deepEqual(readRemoteCache('new/repo', storage).pages, pages)
  assert.throws(() => writeRemoteCache({ ...snapshot, pages: [pages[0], pages[0]] }, 'new/repo', storage))
  assert.deepEqual(readRemoteCache('new/repo', storage).pages, pages)
})

test('book descriptions and their source remain available offline, while old snapshots still load', () => {
  const storage = fakeStorage()
  const book = { ...snapshot.books[0], description: '笔记简介', indexContent: '# 原标题\n\n原有正文\n' }
  writeRemoteCache({ ...snapshot, books: [book] }, 'example/repo', storage)
  assert.deepEqual(readRemoteCache('example/repo', storage).books[0], book)
  assert.throws(() => writeRemoteCache({ ...snapshot, books: [{ ...book, indexContent: 5 }] }, 'example/repo', storage))
  assert.deepEqual(readRemoteCache('example/repo', storage).books[0], book)
  writeRemoteCache(snapshot, 'old/repo', storage)
  assert.deepEqual(readRemoteCache('old/repo', storage).books[0], snapshot.books[0])
})

test('invalid or incomplete new snapshots never replace the previous cache', () => {
  const storage = fakeStorage()
  writeRemoteCache(snapshot, 'example/repo', storage)
  const before = [...storage.values.values()][0]
  assert.throws(() => writeRemoteCache({ ...snapshot, chapters: {} }, 'example/repo', storage))
  assert.throws(() => writeRemoteCache({ ...snapshot, head: 'not-a-sha' }, 'example/repo', storage))
  assert.equal([...storage.values.values()][0], before)
  assert.equal(readRemoteCache('example/repo', storage).head, snapshot.head)
})

test('a storage quota failure preserves the previous snapshot', () => {
  const storage = fakeStorage()
  writeRemoteCache(snapshot, 'example/repo', storage)
  const before = [...storage.values.values()][0]
  storage.setItem = () => { throw new Error('quota') }
  assert.throws(() => writeRemoteCache({ ...snapshot, head: sha('e') }, 'example/repo', storage), /quota/)
  assert.equal([...storage.values.values()][0], before)
})

test('bad cache contents cannot be mistaken for a valid snapshot', () => {
  const storage = fakeStorage()
  storage.values.set('paper-notes:v2:repo:example%2Frepo:paper-notes-remote-snapshot-v1', '{bad json')
  assert.equal(readRemoteCache('example/repo', storage), null)
  assert.equal(storage.values.size, 1)
})

test('known stale snapshots remain marked stale without losing notes', () => {
  const storage = fakeStorage()
  writeRemoteCache({ ...snapshot, stale: true }, 'example/repo', storage)
  assert.equal(readRemoteCache('example/repo', storage).stale, true)
  assert.equal(readRemoteCache('example/repo', storage).chapters.book1.length, 1)
  assert.throws(() => writeRemoteCache({ ...snapshot, stale: 'yes' }, 'example/repo', storage))
  assert.equal(readRemoteCache('example/repo', storage).stale, true)
})

test('cached notes and old unscoped data never leak across repository profiles', () => {
  const storage = fakeStorage()
  storage.values.set('paper-notes-remote-snapshot-v1', JSON.stringify({ version: 1, snapshot }))
  assert.equal(readRemoteCache('alice/notes', storage), null)
  writeRemoteCache(snapshot, 'alice/notes', storage)
  assert.equal(readRemoteCache('Alice/Notes', storage).head, snapshot.head)
  assert.equal(readRemoteCache('bob/notes', storage), null)
  clearRemoteCache('bob/notes', storage)
  assert.equal(readRemoteCache('alice/notes', storage).head, snapshot.head)
  assert.ok(storage.values.has('paper-notes-remote-snapshot-v1'))
})
