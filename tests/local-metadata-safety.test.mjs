import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const module = await build({ entryPoints: ['docs/.vitepress/theme/localMetadataSafety.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { restoreBookMetadataDrafts, assertLocalMetadataWritable, restoreNotebookBase, prepareLocalCollection } = await import(`data:text/javascript;base64,${Buffer.from(module.outputFiles[0].contents).toString('base64')}`)

test('bad ordering locks writes but still restores unrelated valid drafts', () => {
  const base = id => ({ id, sha: 'a'.repeat(40), indexContent: '# 书\n' })
  const raw = { good: { base: base('good'), description: 'ok', chapterOrder: ['a', 'b'] }, bad: { base: base('bad'), description: '', chapterOrder: ['x', 'x'] } }
  const original = JSON.stringify(raw)
  const result = restoreBookMetadataDrafts(raw)
  assert.equal(result.damaged, true)
  assert.deepEqual(result.drafts.good.chapterOrder, ['a', 'b'])
  assert.throws(() => assertLocalMetadataWritable(result.damaged), /暂停写入/)
  assert.equal(JSON.stringify(raw), original)
  assert.doesNotThrow(() => assertLocalMetadataWritable(restoreBookMetadataDrafts(undefined).damaged))
})

test('discarding order restores an old snapshot that omitted the order key', () => {
  const current = { id: 'book', chapterOrder: ['b', 'a'], title: '书' }
  const oldSnapshot = { id: 'book', title: '书' }
  assert.equal(restoreNotebookBase(current, oldSnapshot).chapterOrder, undefined)
  assert.deepEqual(restoreNotebookBase(current, { ...oldSnapshot, chapterOrder: ['a', 'b'] }).chapterOrder, ['a', 'b'])
})

test('startup never seeds a welcome notebook into damaged or malformed existing data', () => {
  const base = { id: 'book', sha: 'a'.repeat(40), indexContent: '# 书\n' }
  for (const original of [JSON.stringify({ books: [{ id: 'book' }], chapters: [{ id: 'chapter' }], bookDescriptionDrafts: { book: { base, description: '', chapterOrder: ['x', 'x'] } } }), '{broken json', JSON.stringify({ books: {}, chapters: [] })]) {
    let stored = original, writes = 0
    const storage = { getItem: () => stored, setItem: (_key, value) => { writes++; stored = value } }
    const result = prepareLocalCollection(storage, 'collection', () => { storage.setItem('collection', '{}'); return 'welcome' })
    assert.equal(result.damaged, true)
    assert.equal(result.added, null)
    assert.equal(writes, 0)
    assert.equal(stored, original)
    if (original.startsWith('{"books":[')) assert.equal(result.saved.chapters[0].id, 'chapter')
  }
  let stored = null, writes = 0
  const storage = { getItem: () => stored, setItem: (_key, value) => { writes++; stored = value } }
  const result = prepareLocalCollection(storage, 'collection', () => { storage.setItem('collection', JSON.stringify({ books: [{ id: 'welcome' }], chapters: [] })); return 'welcome' })
  assert.equal(result.damaged, false)
  assert.equal(result.added, 'welcome')
  assert.equal(result.saved.books[0].id, 'welcome')
  assert.equal(writes, 1)
})
