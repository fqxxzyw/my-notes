import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['docs/.vitepress/theme/welcomeStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { addWelcomeNotebook } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
const templates = { './builtin/index.md': '# 使用手册', './builtin/00-welcome.md': '# 欢迎\n\n开始使用', './builtin/01-writing.md': '# 编写\n\n记录内容' }
const localKey = 'paper-notes:v2:local:paper-notes-local-collection'
const repoKey = 'paper-notes:v2:repo:alice%2Fnotes:paper-notes-local-collection'
function memory(initial = {}) {
  const map = new Map(Object.entries(initial))
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map }
}

test('fresh local welcome is editable and never reappears after deletion', () => {
  const storage = memory()
  const created = addWelcomeNotebook(storage, '', templates, () => 'guide_one')
  assert.equal(created.book.sha, '')
  assert.ok(created.chapters.every(chapter => chapter.sha === '' && chapter.bookId === created.book.id))
  const saved = JSON.parse(storage.getItem(localKey))
  assert.equal(saved.welcomeInitialized, true)
  assert.equal(saved.welcomeBookId, 'guide_one')
  // The normal deletion flow preserves collection metadata, including the marker.
  saved.books = []; saved.chapters = []
  storage.setItem(localKey, JSON.stringify(saved))
  assert.equal(addWelcomeNotebook(storage, '', templates, () => 'guide_two'), null)
  assert.deepEqual(JSON.parse(storage.getItem(localKey)).books, [])
})

test('connected repositories never automatically seed, and manual addition is isolated', () => {
  const storage = memory()
  assert.equal(addWelcomeNotebook(storage, 'Alice/Notes', templates, () => 'guide_one'), null)
  assert.equal(storage.getItem(repoKey), null)
  const created = addWelcomeNotebook(storage, 'Alice/Notes', templates, () => 'guide_one', true)
  assert.equal(created.book.id, 'guide_one')
  assert.equal(storage.getItem(localKey), null)
  assert.equal(JSON.parse(storage.getItem(repoKey)).books.length, 1)
  assert.equal(addWelcomeNotebook(storage, 'Bob/Notes', templates, () => 'guide_two'), null)
})

test('existing content is preserved and failed writes do not replace it', () => {
  const old = JSON.stringify({ books: [{ id: 'mybook', title: '笔记', sha: '' }], chapters: [], synced: { keep: 1 } })
  const storage = memory({ [localKey]: old })
  addWelcomeNotebook(storage, '', templates, () => 'guide_one')
  const saved = JSON.parse(storage.getItem(localKey))
  assert.equal(saved.books[0].id, 'mybook')
  assert.deepEqual(saved.synced, { keep: 1 })
  const failing = { getItem: () => old, setItem: () => { throw new Error('quota') } }
  assert.throws(() => addWelcomeNotebook(failing, '', templates, () => 'guide_one'), /quota/)
  assert.equal(failing.getItem(localKey), old)
  assert.throws(() => addWelcomeNotebook(memory({ [localKey]: 'bad json' }), '', templates, () => 'guide_one'))
})
