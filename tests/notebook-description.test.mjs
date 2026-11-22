import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}
const { readNotebookDescription, writeNotebookDescription } = await load('docs/.vitepress/theme/notebookDescription.ts')
const { createNotebookStore } = await load('docs/.vitepress/theme/notebookStore.ts')

test('description preserves arbitrary index content and safely escapes comment terminators', () => {
  const original = '# 现有标题\r\n\r\n已有正文和链接。\r\n'
  const description = '自己的介绍 --> 不闭合\n第二行'
  const first = writeNotebookDescription(original, description)
  assert.ok(first.startsWith(original))
  assert.equal(readNotebookDescription(first), description)
  const next = writeNotebookDescription(first, '更新')
  assert.ok(next.startsWith(original))
  assert.equal(readNotebookDescription(next), '更新')
  assert.equal(readNotebookDescription(writeNotebookDescription(next, '')), '')
  assert.ok(writeNotebookDescription(`${first}${first}`, 'x').startsWith(first))
  assert.equal(writeNotebookDescription(original, ''), original)
})

test('updating an existing description checks the index SHA before writing', async () => {
  const sha = value => value.repeat(40)
  const original = '# 旧笔记本\n\n用户自己写的索引内容\n'
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }]
  }
  let posted = false
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.split('/git/')[1]
    if (options.method === 'POST' || options.method === 'PATCH') { posted = true; throw new Error('must not write') }
    if (path === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (path === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (path?.startsWith('trees/')) return Response.json({ tree: trees[path.slice(6)] })
    throw new Error(`unexpected path ${path}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  await assert.rejects(store.syncBatch([{ id: 'book', title: '旧笔记本', sha: sha('1'), indexContent: original, description: '修改' }], []), error => error.code === 'conflict')
  assert.equal(posted, false)
  await assert.rejects(store.syncBatch([{ id: 'book', title: '旧笔记本', sha: sha('1'), description: '修改' }], []), /原始内容/)
})

test('an update preserves existing index text and returns the new metadata for restore', async () => {
  const sha = value => value.repeat(40)
  const original = '# 笔记\n\n索引中原有的链接 [x](chapter.md)\n'
  const trees = {
    [sha('b')]: [{ path: 'docs', type: 'tree', mode: '040000', sha: sha('c') }],
    [sha('c')]: [{ path: 'notebooks', type: 'tree', mode: '040000', sha: sha('d') }],
    [sha('d')]: [{ path: 'book', type: 'tree', mode: '040000', sha: sha('e') }],
    [sha('e')]: [{ path: 'index.md', type: 'blob', mode: '100644', sha: sha('f') }]
  }
  let submitted
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.split('/git/')[1]
    const method = options.method || 'GET'
    if (path === 'ref/heads/main') return Response.json({ object: { sha: sha('a') } })
    if (path === `commits/${sha('a')}`) return Response.json({ tree: { sha: sha('b') } })
    if (path?.startsWith('trees/') && method === 'GET') return Response.json({ tree: trees[path.slice(6)] })
    if (path === 'trees' && method === 'POST') { submitted = JSON.parse(options.body).tree; return Response.json({ sha: sha('2') }) }
    if (path === 'commits' && method === 'POST') return Response.json({ sha: sha('3') })
    if (path === 'refs/heads/main' && method === 'PATCH') return Response.json({})
    throw new Error(`unexpected ${method} ${path}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  const result = await store.syncBatch([{ id: 'book', title: '笔记', sha: sha('f'), indexContent: original, description: '这本书的介绍' }], [])
  assert.equal(submitted.length, 1)
  assert.ok(submitted[0].content.startsWith(original))
  assert.equal(readNotebookDescription(submitted[0].content), '这本书的介绍')
  assert.equal(result.books[0].indexContent, submitted[0].content)
  assert.equal(result.books[0].description, '这本书的介绍')
})
