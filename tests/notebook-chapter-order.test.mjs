import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}
const { readNotebookChapterOrder, writeNotebookChapterOrder, sortChapters } = await load('docs/.vitepress/theme/notebookChapterOrder.ts')
const { readNotebookDescription, writeNotebookDescription } = await load('docs/.vitepress/theme/notebookDescription.ts')
const { createNotebookStore } = await load('docs/.vitepress/theme/notebookStore.ts')
const { readRemoteCache, writeRemoteCache } = await load('docs/.vitepress/theme/remoteCache.ts')

test('ordering and description coexist and preserve existing content and CRLF', () => {
  const original = '# 笔记\r\n\r\n用户内容与链接。\r\n'
  const withDescription = writeNotebookDescription(original, '书的介绍')
  const withBoth = writeNotebookChapterOrder(withDescription, ['c-2', 'c_1'])
  assert.ok(withBoth.startsWith(original))
  assert.equal(readNotebookDescription(withBoth), '书的介绍')
  assert.deepEqual(readNotebookChapterOrder(withBoth), ['c-2', 'c_1'])
  assert.equal(writeNotebookChapterOrder(withBoth, ['c-2', 'c_1']), withBoth)
  const renamed = writeNotebookDescription(withBoth, '新介绍')
  assert.deepEqual(readNotebookChapterOrder(renamed), ['c-2', 'c_1'])
  assert.equal(readNotebookDescription(renamed), '新介绍')
  assert.deepEqual(readNotebookChapterOrder(writeNotebookDescription(renamed, '')), ['c-2', 'c_1'])
  const firstOrder = writeNotebookChapterOrder(original, ['a'])
  assert.deepEqual(readNotebookChapterOrder(writeNotebookDescription(firstOrder, '后添加')), ['a'])
  assert.equal(writeNotebookChapterOrder(original, undefined), original)
})

test('uncontrolled comments remain intact and malformed or duplicate terminal metadata refuses overwrite', () => {
  const human = '# 说明\n<!-- paper-notes-chapter-order:my example -->\n\n用户后续正文\n'
  const withOrder = writeNotebookChapterOrder(human, ['a', 'b'])
  assert.ok(withOrder.startsWith(human))
  assert.deepEqual(readNotebookChapterOrder(withOrder), ['a', 'b'])
  for (const invalid of ['<!-- paper-notes-chapter-order:oops -->', '<!-- paper-notes-chapter-order:["a"]', '<!-- paper-notes-chapter-order:["a","a"] -->', '<!-- paper-notes-chapter-order:["../x"] -->']) {
    assert.throws(() => writeNotebookChapterOrder(`# 书\n${invalid}\n`, ['b']), /章节顺序/)
  }
  const duplicate = '# 书\n<!-- paper-notes-chapter-order:["a"] -->\n<!-- paper-notes-chapter-order:["b"] -->\n'
  assert.throws(() => writeNotebookChapterOrder(duplicate, ['c']), /重复/)
})

test('ordering excludes absent chapters and keeps unlisted chapters stable', () => {
  const chapters = [{ id: 'one' }, { id: 'new' }, { id: 'two' }, { id: 'newer' }]
  assert.deepEqual(sortChapters(chapters, ['two', 'deleted', 'one']).map(item => item.id), ['two', 'one', 'new', 'newer'])
  assert.deepEqual(chapters.map(item => item.id), ['one', 'new', 'two', 'newer'])
})

test('one atomic index write carries description and order; remote version mismatch refuses writes', async () => {
  const sha = value => value.repeat(40), original = '# 笔记\n\n保留正文。\n'
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }]
  }
  let submitted = [], writes = 0
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.split('/git/')[1], method = options.method || 'GET'
    if (path === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (path === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (path?.startsWith('trees/') && method === 'GET') return Response.json({ tree: trees[path.slice(6)] })
    if (path === 'trees' && method === 'POST') { writes++; submitted = JSON.parse(options.body).tree; return Response.json({ sha: sha('2') }) }
    if (path === 'commits' && method === 'POST') return Response.json({ sha: sha('3') })
    if (path === 'refs/heads/main' && method === 'PATCH') return Response.json({})
    throw new Error(`unexpected ${method} ${path}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  const entry = { id: 'book', title: '笔记', sha: sha('f'), indexContent: original, description: '新简介', chapterOrder: ['second', 'first'] }
  const result = await store.syncBatch([entry], [])
  assert.equal(submitted.length, 1)
  assert.ok(submitted[0].content.startsWith(original))
  assert.equal(readNotebookDescription(submitted[0].content), '新简介')
  assert.deepEqual(readNotebookChapterOrder(submitted[0].content), ['second', 'first'])
  assert.equal(result.books[0].indexContent, submitted[0].content)
  writes = 0
  await assert.rejects(store.syncBatch([{ ...entry, sha: sha('1') }], []), error => error.code === 'conflict')
  assert.equal(writes, 0)
  await assert.rejects(store.syncBatch([{ ...entry, chapterOrder: undefined, indexContent: '# 笔记\n<!-- paper-notes-chapter-order:bad -->\n' }], []), /章节顺序标记损坏/)
  assert.equal(writes, 0)
})

test('embedded clipboard image survives fake GitHub sync and restore as exact Markdown', async () => {
  const sha = value => value.repeat(40)
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }, { path: 'chapter.md', type: 'blob', mode: '100644', sha: sha('1') }]
  }
  let uploaded = '', restoredSha = ''
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname, path = pathname.split('/git/')[1], method = options.method || 'GET'
    if (path === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (path === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (path?.startsWith('trees/') && method === 'GET') return Response.json({ tree: trees[path.slice(6)] })
    if (path === 'trees' && method === 'POST') { uploaded = JSON.parse(options.body).tree[0].content; return Response.json({ sha: sha('2') }) }
    if (path === 'commits' && method === 'POST') return Response.json({ sha: sha('3') })
    if (path === 'refs/heads/main' && method === 'PATCH') return Response.json({})
    if (pathname.endsWith('/contents/docs/notebooks/book/chapter.md')) return Response.json({ type: 'file', sha: restoredSha, encoding: 'base64', content: Buffer.from(uploaded).toString('base64') })
    throw new Error(`unexpected ${method} ${pathname}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  const content = '# 图片测试\n\n![图片](data:image/png;base64,iVBORw0KGgo=)\n'
  const result = await store.syncBatch([], [{ bookId: 'book', id: 'chapter', title: '图片测试', sha: sha('1'), content }])
  restoredSha = result.chapters[0].sha
  assert.equal(uploaded, content)
  assert.equal((await store.readChapter('book', 'chapter')).content, content)
})

test('offline snapshots retain order and accept old snapshots with no ordering', () => {
  const sha = 'a'.repeat(40), values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const snapshot = { head: sha, books: [{ id: 'book', title: '笔记', sha, chapterOrder: ['b', 'a'] }], chapters: { book: [] }, catalog: { catalog: { cabinets: [{ id: 'general', title: '默认书柜' }], assignments: {} }, sha: '' } }
  writeRemoteCache(snapshot, 'example/repo', storage)
  assert.deepEqual(readRemoteCache('example/repo', storage).books[0].chapterOrder, ['b', 'a'])
  delete snapshot.books[0].chapterOrder
  snapshot.books[0].indexContent = writeNotebookChapterOrder('# 笔记\n', ['b', 'a'])
  writeRemoteCache(snapshot, 'example/repo', storage)
  assert.deepEqual(readRemoteCache('example/repo', storage).books[0].chapterOrder, ['b', 'a'])
  snapshot.books[0].indexContent = '# 笔记\n<!-- paper-notes-chapter-order:damaged -->\n'
  writeRemoteCache(snapshot, 'example/repo', storage)
  assert.equal(readRemoteCache('example/repo', storage).stale, true)
  assert.equal(readRemoteCache('example/repo', storage).books[0].id, 'book')
  delete snapshot.books[0].indexContent
  writeRemoteCache(snapshot, 'example/repo', storage)
  assert.equal(readRemoteCache('example/repo', storage).books[0].chapterOrder, undefined)
})

test('fresh remote listing restores the ordering and reports corrupt metadata instead of returning an empty library', async () => {
  const sha = 'a'.repeat(40)
  let index = writeNotebookChapterOrder(writeNotebookDescription('# 书\n', '介绍'), ['c2', 'c1'])
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    if (path.endsWith('/contents/docs/notebooks')) return Response.json([{ type: 'dir', name: 'book' }])
    if (path.endsWith('/contents/docs/notebooks/book/index.md')) return Response.json({ type: 'file', sha, encoding: 'base64', content: Buffer.from(index).toString('base64') })
    throw new Error(`unexpected path ${path}`)
  }
  const store = createNotebookStore('example/repo')
  let books = await store.listNotebooks()
  assert.equal(books.length, 1)
  assert.deepEqual(books[0].chapterOrder, ['c2', 'c1'])
  assert.equal(books[0].description, '介绍')
  index = '# 书\n<!-- paper-notes-chapter-order:damaged -->\n'
  await assert.rejects(store.listNotebooks(), /章节顺序标记损坏/)
})
