import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

// Bundle the actual store; snapshot imports are only used for offline reading.
const bundled = await build({
  entryPoints: ['docs/.vitepress/theme/notebookStore.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'empty-snapshot', setup(build) {
    build.onLoad({ filter: /notebookStore\.ts$/ }, async ({ path }) => {
      let contents = await readFile(path, 'utf8')
      contents = contents.replace(/const snapshotFiles = import\.meta\.glob<string>\([\s\S]*?\n\}\)/, 'const snapshotFiles: Record<string, string> = {}')
      contents = contents.replace(/const snapshotCatalogFile = import\.meta\.glob<string>\([\s\S]*?\n\}\)/, 'const snapshotCatalogFile: Record<string, string> = {}')
      return { contents, loader: 'ts', resolveDir: path.replace(/[\\/][^\\/]+$/, '') }
    })
  } }]
})
const { createNotebookStore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
globalThis.crypto ??= webcrypto

const sha = char => char.repeat(40)
const id = { parent: sha('a'), root: sha('b'), docs: sha('c'), notebooks: sha('d'), book: sha('e'), index: sha('f'), chapter: sha('1'), catalog: sha('2'), nextTree: sha('3'), nextCommit: sha('4') }
const book = { id: 'book1', title: '测试', sha: id.index }
const chapter = { bookId: 'book1', id: 'chapter1', title: '第一章', content: '# 第一章', sha: id.chapter }
const catalog = { cabinets: [{ id: 'general', title: '常用书柜' }], assignments: { book1: 'general', keep: 'general' } }

function mockGit({ extra = false, changed = false, rejectRef = false } = {}) {
  const calls = []
  const trees = {
    [id.root]: [{ path: 'docs', type: 'tree', mode: '040000', sha: id.docs }],
    [id.docs]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: id.notebooks }, { path: 'cabinets.json', type: 'blob', mode: '100644', sha: id.catalog }],
    [id.notebooks]: [{ path: 'book1', type: 'tree', mode: '040000', sha: id.book }],
    [id.book]: [
      { path: 'index.md', type: 'blob', mode: '100644', sha: id.index },
      { path: 'chapter1.md', type: 'blob', mode: '100644', sha: changed ? sha('5') : id.chapter },
      ...(extra ? [{ path: 'attachment.png', type: 'blob', mode: '100644', sha: sha('6') }] : [])
    ]
  }
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.split('/git/')[1]
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ path, method, body })
    const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method === 'GET' && path === 'ref/heads/main') return response({ object: { sha: id.parent } })
    if (method === 'GET' && path === `commits/${id.parent}`) return response({ tree: { sha: id.root } })
    if (method === 'GET' && path.startsWith('trees/')) return response({ tree: trees[path.slice(6)] })
    if (method === 'GET' && path === `blobs/${id.catalog}`) return response({ encoding: 'base64', content: Buffer.from(JSON.stringify(catalog)).toString('base64') })
    if (method === 'POST' && path === 'trees') return response({ sha: id.nextTree })
    if (method === 'POST' && path === 'commits') return response({ sha: id.nextCommit })
    if (method === 'PATCH' && path === 'refs/heads/main') return rejectRef ? new Response('{}', { status: 409 }) : response({})
    throw new Error(`Unexpected request: ${method} ${path}`)
  }
  const store = createNotebookStore('example/repo')
  store.setToken('fake-token')
  return { calls, store }
}

test('delete a notebook and its catalog assignment together in one commit', async () => {
  const { calls, store } = mockGit()
  const result = await store.deleteBatch([{ book, chapters: [chapter] }], [])
  assert.equal(result.parent, id.parent)
  assert.equal(result.head, id.nextCommit)
  const requests = calls.filter(call => call.method === 'POST' && call.path === 'trees')
  assert.equal(requests.length, 1)
  const updates = requests[0].body.tree
  assert.deepEqual(updates.filter(item => item.sha === null).map(item => item.path).sort(), ['docs/notebooks/book1/chapter1.md', 'docs/notebooks/book1/index.md'])
  const nextCatalog = JSON.parse(updates.find(item => item.path === 'docs/cabinets.json').content)
  assert.deepEqual(nextCatalog.assignments, { keep: 'general' })
  assert.equal(result.catalog.catalog.assignments.keep, 'general')
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1)
})

test('refuse deletion of a book containing an unseen attachment', async () => {
  const { calls, store } = mockGit({ extra: true })
  await assert.rejects(store.deleteBatch([{ book, chapters: [chapter] }], []), error => error.code === 'conflict')
  assert.equal(calls.some(call => call.method !== 'GET'), false)
})

test('refuse a chapter whose remote content changed', async () => {
  const { calls, store } = mockGit({ changed: true })
  await assert.rejects(store.deleteBatch([], [chapter]), error => error.code === 'conflict')
  assert.equal(calls.some(call => call.method !== 'GET'), false)
})

test('a concurrent main update fails without a forced ref update', async () => {
  const { calls, store } = mockGit({ rejectRef: true })
  await assert.rejects(store.deleteBatch([], [chapter]), error => error.code === 'conflict')
  const patch = calls.find(call => call.method === 'PATCH')
  assert.equal(patch.body.force, false)
})

test('network failures distinguish reads from write requests', async () => {
  const { store } = mockGit()
  const mock = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline') }
  await assert.rejects(store.readHead(), error => error.code === 'network' && !error.message.includes('提交结果'))
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST') throw new Error('offline during write')
    return mock(url, options)
  }
  await assert.rejects(store.deleteBatch([], [chapter]), error => error.code === 'network' && error.message.includes('提交结果可能未知'))
})
