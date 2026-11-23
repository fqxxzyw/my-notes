import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['docs/.vitepress/theme/notebookStore.ts', 'docs/.vitepress/theme/remoteCache.ts', 'docs/.vitepress/theme/repository.ts'], bundle: true, platform: 'node', format: 'esm', write: false, outdir: 'out', plugins: [{ name: 'snapshot', setup(build) {
  build.onLoad({ filter: /notebookStore\.ts$/ }, async ({ path }) => {
    let contents = await readFile(path, 'utf8')
    contents = contents.replace(/const snapshotFiles = import\.meta\.glob<string>\([\s\S]*?\n\}\)/, 'const snapshotFiles: Record<string, string> = {}')
    contents = contents.replace(/const snapshotCatalogFile = import\.meta\.glob<string>\([\s\S]*?\n\}\)/, 'const snapshotCatalogFile: Record<string, string> = {}')
    return { contents, loader: 'ts', resolveDir: path.replace(/[\\/][^\\/]+$/, '') }
  })
} }] })
const load = async name => import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles.find(file => file.path.endsWith(`${name}.js`)).contents).toString('base64')}`)
const { createNotebookStore } = await load('notebookStore')
const { readRemoteCache, writeRemoteCache, clearRemoteCache } = await load('remoteCache')
const { namespaceKey } = await load('repository')
const sha = char => char.repeat(40)

test('fake GitHub: expired credential, same-repository reconnect, restore, deletion and restart preserve drafts', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const draftKey = namespaceKey('paper-notes-draft', 'alice/notes') + ':book1:chapter1'
  const localKey = namespaceKey('paper-notes-local-collection', 'alice/notes')
  const draft = JSON.stringify({ base: { bookId: 'book1', id: 'chapter1', sha: sha('c') }, content: '未同步的重要草稿' })
  const local = JSON.stringify({ books: [], chapters: [], bookDescriptionDrafts: { book1: { description: '本机简介' } } })
  storage.setItem(draftKey, draft); storage.setItem(localKey, local)
  let deleted = false
  const calls = []
  const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  const missing = () => new Response('{}', { status: 404 })
  const blob = (content, id) => ({ type: 'file', sha: sha(id), encoding: 'base64', content: Buffer.from(content).toString('base64') })
  globalThis.fetch = async (url, options = {}) => {
    const request = new URL(url), method = options.method || 'GET', auth = options.headers?.Authorization
    calls.push({ path: request.pathname, method })
    if (auth === 'Bearer expired') return new Response('{}', { status: 401 })
    assert.equal(auth, 'Bearer fresh')
    assert.equal(method, 'GET', 'reconnect/restore must never write to GitHub')
    if (request.pathname === '/repos/alice/notes') return json({})
    if (request.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: deleted ? sha('d') : sha('a') } })
    if (request.pathname.endsWith('/contents/docs/notebooks')) return json(deleted ? [] : [{ name: 'book1', type: 'dir' }])
    if (request.pathname.endsWith('/contents/docs/notebooks/book1/index.md')) return json(blob('# 笔记本\n', 'b'))
    if (request.pathname.endsWith('/contents/docs/notebooks/book1')) return json([{ name: 'index.md', type: 'file' }, { name: 'chapter1.md', type: 'file' }])
    if (request.pathname.endsWith('/contents/docs/notebooks/book1/chapter1.md')) return json(blob('# 第一章\n远端正文', 'c'))
    if (request.pathname.endsWith('/contents/docs/cabinets.json') || request.pathname.endsWith('/contents/docs/pages')) return missing()
    throw new Error(`Unexpected fake GitHub request: ${request.pathname}`)
  }
  const store = createNotebookStore('Alice/Notes')
  store.setToken('expired')
  await assert.rejects(store.verifyRepository(), error => error.code === 'auth')
  store.setToken('fresh')
  await store.verifyRepository()
  const restore = async () => {
    const head = await store.readHead()
    const [books, catalog, pages] = await Promise.all([store.listNotebooks(), store.readCatalog(false), store.listPages()])
    const chapters = Object.fromEntries(await Promise.all(books.map(async book => [book.id, await store.listChapters(book.id)])))
    assert.equal(await store.readHead(), head)
    writeRemoteCache({ head, books, chapters, pages, catalog }, 'alice/notes', storage)
    return { books, chapters }
  }
  const first = await restore()
  assert.deepEqual(first.books.map(book => book.id), ['book1'])
  assert.equal(first.chapters.book1[0].content, '# 第一章\n远端正文')
  assert.equal(readRemoteCache('ALICE/NOTES', storage).books.length, 1)
  assert.equal(storage.getItem(draftKey), draft)
  assert.equal(storage.getItem(localKey), local)
  // Remote deletion becomes the next complete revision, never changes the separate draft.
  deleted = true
  assert.deepEqual((await restore()).books, [])
  assert.deepEqual(readRemoteCache('alice/notes', storage).books, [])
  assert.equal(storage.getItem(draftKey), draft)
  assert.equal(storage.getItem(localKey), local)
  clearRemoteCache('alice/notes', storage)
  assert.equal(readRemoteCache('alice/notes', storage), null)
  assert.equal(storage.getItem(draftKey), draft)
  assert.ok(calls.every(call => call.method === 'GET'))
})
