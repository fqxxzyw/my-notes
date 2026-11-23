import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash, webcrypto } from 'node:crypto'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/rewriteImportedImages.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { rewriteImportedImages } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
const destination = `assets/${'a'.repeat(32)}.png`

test('rewrites only real images and preserves adjacent links, titles, fenced examples and line endings', () => {
  const source = '![描述](<./笔记.assets/图%20片.png> "标题")\r\n[普通链接](./笔记.assets/图%20片.png)\r\n\r\n```md\r\n![示例](./笔记.assets/图%20片.png)\r\n```\r\n'
  const target = './%E7%AC%94%E8%AE%B0.assets/%E5%9B%BE%20%E7%89%87.png'
  const result = rewriteImportedImages(source, new Map([[target, destination]]))
  assert.equal(result.content, source.replace('<./笔记.assets/图%20片.png>', `<${destination}>`))
  assert.deepEqual(result.replaced, [target])
})

test('rewrites reference images only, preserving shared reference definitions', () => {
  const source = '![图][pic]\n[下载][pic]\n\n[pic]: images/a.png "文字"\n'
  const result = rewriteImportedImages(source, new Map([['images/a.png', destination]]))
  assert.equal(result.content, `![图](${destination} "文字")\n[下载][pic]\n\n[pic]: images/a.png "文字"\n`)
})

test('does not modify missing, external, HTML or malformed images', () => {
  const source = '![外链](https://example.com/x.png)\n![丢失](x.png)\n<img src="x.png">\n'
  assert.equal(rewriteImportedImages(source, new Map([['y.png', destination]])).content, source)
})

test('finds images beyond the editor background parsing viewport', () => {
  const source = `${'很长的 Markdown 正文。\n\n'.repeat(10000)}![末尾图片](folder/a.png)\n`
  const result = rewriteImportedImages(source, new Map([['folder/a.png', destination]]))
  assert.ok(result.content.endsWith(`![末尾图片](${destination})\n`))
  assert.deepEqual(result.replaced, ['folder/a.png'])
})

test('a repaired edited draft syncs with its imported image and both restore byte-for-byte', async () => {
  globalThis.crypto ??= webcrypto
  const load = async path => {
    const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
  }
  const { readDroppedMarkdown } = await load('docs/.vitepress/theme/readDroppedMarkdown.ts')
  const { createNotebookStore } = await load('docs/.vitepress/theme/notebookStore.ts')
  const { attachmentReferences } = await load('docs/.vitepress/theme/attachmentReferences.ts')
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4])
  const original = new File(['# 标题\n![图](note.assets/picture.png)'], 'note.md')
  const picture = new File([png], 'picture.png')
  Object.defineProperty(original, 'webkitRelativePath', { value: 'book/note.md' })
  Object.defineProperty(picture, 'webkitRelativePath', { value: 'book/note.assets/picture.png' })
  const imported = await readDroppedMarkdown({ files: [original, picture] })
  assert.equal(imported.images.length, 1)
  const path = `docs/notebooks/book/${destination}`
  const draft = '# 标题\n\n用户编辑的内容应保留。\n\n![图](note.assets/picture.png)'
  const repaired = rewriteImportedImages(draft, new Map([[imported.images[0].references[0].target, destination]])).content
  assert.match(repaired, /用户编辑的内容应保留/)
  assert.deepEqual(attachmentReferences(repaired, 'book').map(ref => ref.path), [path])
  const sha = value => value.repeat(40)
  const hash = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }, { path: 'chapter.md', type: 'blob', mode: '100644', sha: sha('1') }]
  }
  let uploaded = '', submitted, patches = 0
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname, route = pathname.split('/git/')[1], method = options.method || 'GET'
    if (route === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (route === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (route?.startsWith('trees/') && method === 'GET') return Response.json({ tree: trees[route.slice(6)] })
    if (route === 'blobs' && method === 'POST') { uploaded = JSON.parse(options.body).content; return Response.json({ sha: hash(Buffer.from(uploaded, 'base64')) }) }
    if (route === 'trees' && method === 'POST') { submitted = JSON.parse(options.body).tree; return Response.json({ sha: sha('2') }) }
    if (route === 'commits' && method === 'POST') return Response.json({ sha: sha('3') })
    if (route === 'refs/heads/main' && method === 'PATCH') { patches++; return Response.json({}) }
    if (pathname.endsWith('/contents/' + path)) return Response.json({ type: 'file', sha: hash(png), encoding: 'base64', content: uploaded })
    if (pathname.endsWith('/contents/docs/notebooks/book/chapter.md')) return Response.json({ type: 'file', sha: hash(Buffer.from(repaired)), encoding: 'base64', content: Buffer.from(repaired).toString('base64') })
    throw new Error(`unexpected ${method} ${pathname}`)
  }
  try {
    const store = createNotebookStore('example/repo'); store.setToken('fake')
    await store.syncBatch([], [{ bookId: 'book', id: 'chapter', title: '标题', sha: sha('1'), content: repaired }], undefined, [], [{ path, bytes: imported.images[0].bytes }])
    assert.equal(patches, 1)
    assert.equal(submitted.find(item => item.path.endsWith('chapter.md')).content, repaired)
    assert.equal(submitted.find(item => item.path === path).sha, hash(png))
    assert.equal((await store.readChapter('book', 'chapter')).content, repaired)
    assert.deepEqual((await store.readAttachment(path)).bytes, png)
  } finally { globalThis.fetch = oldFetch }
})
