import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['docs/.vitepress/theme/welcomeDuplicate.ts', 'docs/.vitepress/theme/welcomeStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false, outdir: 'out' })
const load = async name => import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles.find(file => file.path.endsWith(`${name}.js`)).contents).toString('base64')}`)
const { addWelcomeNotebook } = await load('welcomeStore')
const { findPristineWelcomeDuplicate, prepareWelcomeImport } = await load('welcomeDuplicate')
const templates = { './builtin/index.md': '# 手册', './builtin/00-start.md': '# 欢迎\n\n开始', './builtin/01-write.md': '# 写作\n\n记录' }
const key = 'paper-notes:v2:local:paper-notes-local-collection'
function fixture() {
  const map = new Map()
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
  const { book, chapters } = addWelcomeNotebook(storage, '', templates, () => 'guide_local')
  const remote = [{ book: { ...book, id: 'guide_remote', sha: 'a'.repeat(40), indexContent: '# 使用说明与教程\n' }, chapters: chapters.map(chapter => ({ ...chapter, bookId: 'guide_remote', sha: 'b'.repeat(40) })) }]
  return { entries: [...map], remote }
}
function modify(entries, fn) {
  return entries.map(([k, value]) => { if (k !== key) return [k, value]; const data = JSON.parse(value); fn(data); return [k, JSON.stringify(data)] })
}

test('copies only the pristine duplicate, retaining the original workspace', () => {
  const { entries, remote } = fixture()
  const original = JSON.stringify(entries)
  const extra = modify(entries, data => { data.books.push({ id: 'note', title: '用户笔记', sha: '' }); data.chapters.push({ bookId: 'note', id: 'one', title: '其他', content: '保留', sha: '' }) })
  const result = prepareWelcomeImport(extra, templates, remote)
  assert.deepEqual(result.duplicate, { localBookId: 'guide_local', remoteBookId: 'guide_remote' })
  const copied = JSON.parse(result.entries[0][1])
  assert.deepEqual(copied.books.map(book => book.id), ['note'])
  assert.equal(copied.chapters[0].content, '保留')
  assert.equal(copied.welcomeBookId, 'guide_remote')
  assert.equal(JSON.stringify(entries), original)
  assert.equal(JSON.parse(extra[0][1]).books.length, 2)
})

test('never suppresses modified, incomplete, unavailable or same-ID notes', () => {
  const { entries, remote } = fixture()
  const modified = [
    modify(entries, d => { d.books[0].title = '修改' }),
    modify(entries, d => { d.books[0].description = '简介' }),
    modify(entries, d => { d.books[0].chapterOrder = ['01-write', '00-start'] }),
    modify(entries, d => { d.chapters[0].content += '修改' }),
    modify(entries, d => { d.chapters.pop() }),
    modify(entries, d => { d.chapters.push({ ...d.chapters[0] }) }),
    modify(entries, d => { d.bookDescriptionDrafts = { guide_local: { description: '草稿' } } }),
    modify(entries, d => { d.bookDescriptionDrafts = { guide_local: { base: d.books[0], description: '', chapterOrder: ['01-write', '00-start'] } } }),
    modify(entries, d => { d.bookVersions = { guide_local: 'a'.repeat(40) } }),
    modify(entries, d => { d.synced = { 'guide_local/00-start': '原版' } }),
    [...entries, ['paper-notes:v2:local:paper-notes-draft:guide_local:00-start', '草稿']],
    [...entries, ['paper-notes:v2:local:paper-notes:cabinets:v1', '{"moves":{"guide_local":"other"}}']],
    [[key, 'invalid']]
  ]
  for (const input of modified) assert.equal(findPristineWelcomeDuplicate(input, templates, remote), null)
  assert.equal(findPristineWelcomeDuplicate(entries, templates, null), null)
  assert.equal(findPristineWelcomeDuplicate(entries, templates, []), null)
  const different = structuredClone(remote); different[0].chapters[0].content += 'edited'
  assert.equal(findPristineWelcomeDuplicate(entries, templates, different), null)
  const description = structuredClone(remote); description[0].book.description = '简介'
  assert.equal(findPristineWelcomeDuplicate(entries, templates, description), null)
  const order = structuredClone(remote); order[0].book.chapterOrder = ['00-start', '01-write']
  assert.equal(findPristineWelcomeDuplicate(entries, templates, order), null)
  const customIndex = structuredClone(remote); customIndex[0].book.indexContent += '<!-- user-owned -->\n'
  assert.equal(findPristineWelcomeDuplicate(entries, templates, customIndex), null)
  const sameId = structuredClone(remote); sameId[0].book.id = 'guide_local'
  assert.equal(findPristineWelcomeDuplicate(entries, templates, sameId), null)
})

test('same-title unrelated notebooks remain independent', () => {
  const { entries, remote } = fixture()
  const other = modify(entries, data => { data.books.push({ id: 'mine', title: '使用说明与教程', sha: '' }); data.chapters.push({ bookId: 'mine', id: 'my-page', title: '自写', content: '重要', sha: '' }) })
  const result = prepareWelcomeImport(other, templates, remote)
  assert.deepEqual(JSON.parse(result.entries[0][1]).books.map(book => book.id), ['mine'])
  assert.equal(JSON.parse(result.entries[0][1]).chapters[0].content, '重要')
})
