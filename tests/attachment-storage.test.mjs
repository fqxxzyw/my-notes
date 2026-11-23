import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}
const { validateAttachment, validateAttachmentPath, newAttachmentPath, MAX_ATTACHMENT_BYTES } = await load('docs/.vitepress/theme/attachmentStore.ts')
const { createNotebookStore } = await load('docs/.vitepress/theme/notebookStore.ts')
const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4])
const path = `docs/notebooks/book/assets/${'1'.repeat(32)}.png`
const hash = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')

test('managed image paths reject traversal, wrong formats and oversized payloads', () => {
  assert.match(newAttachmentPath('book', 'image/png'), /^docs\/notebooks\/book\/assets\/[a-f0-9]{32}\.png$/)
  assert.match(newAttachmentPath(null, 'image/jpeg'), /^docs\/pages\/assets\/[a-f0-9]{32}\.jpg$/)
  assert.throws(() => newAttachmentPath('../book', 'image/png'))
  assert.throws(() => validateAttachmentPath('docs/notebooks/book/assets/../../other.png'))
  assert.throws(() => validateAttachment({ path: path.replace('.png', '.jpg'), bytes }))
  assert.throws(() => validateAttachment({ path, bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }))
  assert.doesNotThrow(() => validateAttachment({ path, bytes }))
})

test('binary image and Markdown share a commit and restore byte-for-byte', async () => {
  const sha = value => value.repeat(40)
  const largeImage = new Uint8Array(1100 * 1024)
  largeImage.set(bytes)
  largeImage[largeImage.length - 1] = 0x7f
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }, { path: 'chapter.md', type: 'blob', mode: '100644', sha: sha('1') }]
  }
  let submitted, uploaded = '', patches = 0
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname, route = pathname.split('/git/')[1], method = options.method || 'GET'
    if (route === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (route === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (route?.startsWith('trees/') && method === 'GET') return Response.json({ tree: trees[route.slice(6)] })
    if (route === 'blobs' && method === 'POST') { const payload = JSON.parse(options.body); assert.equal(payload.encoding, 'base64'); uploaded = payload.content; return Response.json({ sha: hash(Buffer.from(uploaded, 'base64')) }) }
    if (route === 'trees' && method === 'POST') { submitted = JSON.parse(options.body).tree; return Response.json({ sha: sha('2') }) }
    if (route === 'commits' && method === 'POST') return Response.json({ sha: sha('3') })
    if (route === 'refs/heads/main' && method === 'PATCH') { patches++; return Response.json({}) }
    if (pathname.endsWith('/contents/' + path)) return Response.json({ type: 'file', sha: hash(largeImage), encoding: 'none' })
    if (route === `blobs/${hash(largeImage)}`) return Response.json({ sha: hash(largeImage), encoding: 'base64', content: uploaded })
    throw new Error(`unexpected ${method} ${pathname}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  const text = `# 图\n\n![图](assets/${'1'.repeat(32)}.png)\n`
  const result = await store.syncBatch([], [{ bookId: 'book', id: 'chapter', title: '图', sha: sha('1'), content: text }], undefined, [], [{ path, bytes: largeImage }])
  assert.equal(result.head, sha('3'))
  assert.equal(patches, 1)
  assert.equal(submitted.find(item => item.path.endsWith('chapter.md')).content, text)
  assert.equal(submitted.find(item => item.path === path).sha, hash(largeImage))
  assert.deepEqual((await store.readAttachment(path)).bytes, largeImage)
})

test('different existing image conflicts before any GitHub write', async () => {
  const sha = value => value.repeat(40)
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }, { path: 'chapter.md', type: 'blob', mode: '100644', sha: sha('1') }, { path: 'assets', type: 'tree', mode: '040000', sha: sha('2') }],
    [sha('2')]: [{ path: `${'1'.repeat(32)}.png`, type: 'blob', mode: '100644', sha: sha('3') }]
  }
  let writes = 0
  globalThis.fetch = async (url, options = {}) => {
    const route = new URL(url).pathname.split('/git/')[1]
    if (options.method && options.method !== 'GET') { writes++; return Response.json({}) }
    if (route === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (route === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (route?.startsWith('trees/')) return Response.json({ tree: trees[route.slice(6)] })
    throw new Error('unexpected request')
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  await assert.rejects(store.syncBatch([], [{ bookId: 'book', id: 'chapter', title: '图', sha: sha('1'), content: '# 图' }], undefined, [], [{ path, bytes }]), error => error.code === 'conflict')
  assert.equal(writes, 0)
})

test('deleting a notebook leaves managed shared images and ignores the assets-only directory', async () => {
  const sha = value => value.repeat(40)
  const image = `${'1'.repeat(32)}.png`
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }, { path: 'chapter.md', type: 'blob', mode: '100644', sha: sha('1') }, { path: 'assets', type: 'tree', mode: '040000', sha: sha('2') }],
    [sha('2')]: [{ path: image, type: 'blob', mode: '100644', sha: hash(bytes) }]
  }
  let deleted
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname, route = pathname.split('/git/')[1], method = options.method || 'GET'
    if (route === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (route === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (route?.startsWith('trees/') && method === 'GET') return Response.json({ tree: trees[route.slice(6)] })
    if (route === 'trees' && method === 'POST') { deleted = JSON.parse(options.body).tree; return Response.json({ sha: sha('3') }) }
    if (route === 'commits' && method === 'POST') return Response.json({ sha: sha('4') })
    if (route === 'refs/heads/main' && method === 'PATCH') return Response.json({})
    if (pathname.endsWith('/contents/docs/notebooks')) return Response.json([{ type: 'dir', name: 'book' }])
    if (pathname.endsWith('/contents/docs/notebooks/book/index.md')) return new Response('', { status: 404 })
    if (pathname.endsWith('/contents/docs/notebooks/book/assets')) return Response.json([{ type: 'file', name: image }])
    if (pathname.endsWith('/contents/docs/notebooks/book')) return Response.json([{ type: 'dir', name: 'assets' }])
    throw new Error(`unexpected ${method} ${pathname}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  await store.deleteBatch([{ book: { id: 'book', title: '图', sha: sha('f') }, chapters: [{ bookId: 'book', id: 'chapter', title: '图', sha: sha('1'), content: '# 图' }] }], [])
  assert.deepEqual(deleted.map(item => item.path).sort(), ['docs/notebooks/book/chapter.md', 'docs/notebooks/book/index.md'])
  assert.deepEqual(await store.listNotebooks(), [])
})
