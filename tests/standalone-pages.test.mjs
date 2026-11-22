import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto, createHash } from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto
const bundled = await build({ entryPoints: ['docs/.vitepress/theme/notebookStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { createNotebookStore, pageIdFromTitle, chapterIdFromTitle } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
const sha = char => char.repeat(40)

test('standalone UTF-8 Markdown name and original text survive a fresh read', async () => {
  const id = pageIdFromTitle('中文标题 📖')
  assert.notEqual(id, pageIdFromTitle('中文标题 📖'))
  assert.match(id, /^[A-Za-z0-9_-]+$/)
  const content = '没有一级标题\r\n原内容与换行保留\n'
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'file', sha: sha('b'), encoding: 'base64', content: Buffer.from(content).toString('base64') }))
  const page = await createNotebookStore('example/repo').readPage(id)
  assert.equal(page.title, '中文标题 📖')
  assert.equal(page.content, content)
  assert.throws(() => pageIdFromTitle('文'.repeat(100)), /过长/)
})

test('listing pages ignores non-Markdown and reads each standalone file', async () => {
  const id = pageIdFromTitle('文件名')
  const content = '# 正文标题\n内容'
  globalThis.fetch = async url => {
    const path = decodeURIComponent(new URL(url).pathname)
    if (path.endsWith('/docs/pages')) return new Response(JSON.stringify([
      { type: 'file', name: `${id}.md` }, { type: 'file', name: 'image.png' }, { type: 'dir', name: 'nested' }
    ]))
    if (path.endsWith(`/docs/pages/${id}.md`)) return new Response(JSON.stringify({ type: 'file', sha: sha('b'), encoding: 'base64', content: Buffer.from(content).toString('base64') }))
    throw new Error(`Unexpected read ${path}`)
  }
  const pages = await createNotebookStore('example/repo').listPages()
  assert.equal(pages.length, 1)
  assert.equal(pages[0].title, '正文标题')
  assert.equal(pages[0].content, content)
})

test('an imported chapter without a heading restores its original filename', async () => {
  const id = chapterIdFromTitle('目录内章节 📝')
  const original = '原始内容\r\n下一行\n'
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'file', sha: sha('b'), encoding: 'base64', content: Buffer.from(original).toString('base64') }))
  const store = createNotebookStore('example/repo')
  const chapter = await store.readChapter('book', id)
  assert.equal(chapter.title, '目录内章节 📝')
  assert.equal(chapter.content, original)
  const legacy = await store.readChapter('book', 'legacy_id')
  assert.equal(legacy.title, 'legacy_id')
})

test('chapter counts need only one directory request and ignore unrelated files', async () => {
  let calls = 0
  globalThis.fetch = async url => {
    calls++
    assert.match(new URL(url).pathname, /\/docs\/notebooks\/book$/)
    return new Response(JSON.stringify([
      { type: 'file', name: 'index.md' }, { type: 'file', name: 'chapter_1.md' },
      { type: 'file', name: 'chapter_2.md' }, { type: 'file', name: 'image.png' },
      { type: 'dir', name: 'nested' }, { type: 'file', name: 'invalid name.md' }
    ]))
  }
  assert.deepEqual(await createNotebookStore('example/repo').listChapterIds('book'), ['chapter_1', 'chapter_2'])
  assert.equal(calls, 1)
})

test('large files omitted by Contents are recovered through the Git Blob API', async () => {
  const id = pageIdFromTitle('大文件')
  const content = '原始正文\n'
  const requests = []
  globalThis.fetch = async url => {
    const path = new URL(url).pathname
    requests.push(path)
    if (path.includes('/contents/')) return new Response(JSON.stringify({ type: 'file', sha: sha('b'), encoding: 'none', content: '' }))
    if (path.endsWith(`/git/blobs/${sha('b')}`)) return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(content).toString('base64') }))
    throw new Error(`Unexpected path ${path}`)
  }
  assert.equal((await createNotebookStore('example/repo').readPage(id)).content, content)
  assert.equal(requests.length, 2)
})

function mockGit(currentSha = '') {
  const calls = []
  const parent = sha('a'), root = sha('b'), docs = sha('c'), pages = sha('d'), catalog = sha('e')
  const page = { id: pageIdFromTitle('本页'), title: '本页', content: '原文\r\n', sha: currentSha }
  const trees = {
    [root]: [{ path: 'docs', type: 'tree', mode: '040000', sha: docs }],
    [docs]: [{ path: 'pages', type: 'tree', mode: '040000', sha: pages }, { path: 'cabinets.json', type: 'blob', mode: '100644', sha: catalog }],
    [pages]: currentSha ? [{ path: `${page.id}.md`, type: 'blob', mode: '100644', sha: currentSha }] : []
  }
  const doc = { cabinets: [{ id: 'general', title: '默认书柜' }], assignments: { [`page_${page.id}`]: 'general', other: 'general' } }
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.split('/git/')[1]
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ path, method, body })
    const response = data => new Response(JSON.stringify(data), { status: 200 })
    if (method === 'GET' && path === 'ref/heads/main') return response({ object: { sha: parent } })
    if (method === 'GET' && path === `commits/${parent}`) return response({ tree: { sha: root } })
    if (method === 'GET' && path.startsWith('trees/')) return response({ tree: trees[path.slice(6)] })
    if (method === 'GET' && path === `blobs/${catalog}`) return response({ encoding: 'base64', content: Buffer.from(JSON.stringify(doc)).toString('base64') })
    if (method === 'POST' && path === 'trees') return response({ sha: sha('f') })
    if (method === 'POST' && path === 'commits') return response({ sha: sha('1') })
    if (method === 'PATCH' && path === 'refs/heads/main') return response({})
    throw new Error(`Unexpected ${method} ${path}`)
  }
  const store = createNotebookStore('example/repo')
  store.setToken('fake-token')
  return { calls, store, page }
}

test('sync creates a single standalone file without inserting a title', async () => {
  const { calls, store, page } = mockGit()
  const result = await store.syncBatch([], [], undefined, [page])
  const tree = calls.find(call => call.method === 'POST' && call.path === 'trees').body.tree
  assert.deepEqual(tree.map(entry => entry.path), [`docs/pages/${page.id}.md`])
  assert.equal(tree[0].content, page.content)
  assert.equal(result.pages[0].content, page.content)
})

test('sync refuses to overwrite a remotely changed page', async () => {
  const { calls, store, page } = mockGit(sha('2'))
  await assert.rejects(store.syncBatch([], [], undefined, [{ ...page, sha: sha('3') }]), error => error.code === 'conflict')
  assert.equal(calls.some(call => call.method !== 'GET'), false)
})

test('deleting a page checks its revision and removes only its own cabinet assignment', async () => {
  const { calls, store, page } = mockGit(sha('2'))
  await store.deleteBatch([], [], [page])
  const updates = calls.find(call => call.method === 'POST' && call.path === 'trees').body.tree
  assert.equal(updates.find(item => item.path === `docs/pages/${page.id}.md`).sha, null)
  assert.deepEqual(JSON.parse(updates.find(item => item.path === 'docs/cabinets.json').content).assignments, { other: 'general' })
})

test('a page survives sync, a fresh restore, edit conflict and deletion', async () => {
  const hash = text => createHash('sha1').update(text).digest('hex')
  const blob = text => hash(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(text)}\0`), Buffer.from(text)]))
  let files = new Map([['docs/cabinets.json', JSON.stringify({ cabinets: [{ id: 'general', title: '默认书柜' }], assignments: {} })]])
  let head = sha('a'), staged, newCommit, root, trees
  const buildTrees = () => {
    trees = new Map()
    const make = prefix => {
      const dirs = new Set(), entries = []
      for (const [path, content] of files) {
        if (!path.startsWith(prefix)) continue
        const remainder = path.slice(prefix.length)
        const slash = remainder.indexOf('/')
        if (slash < 0) entries.push({ path: remainder, type: 'blob', mode: '100644', sha: blob(content) })
        else dirs.add(remainder.slice(0, slash))
      }
      for (const dir of dirs) entries.push({ path: dir, type: 'tree', mode: '040000', sha: make(`${prefix}${dir}/`) })
      const key = hash(JSON.stringify([prefix, entries])); trees.set(key, entries); return key
    }
    root = make('')
  }
  buildTrees()
  globalThis.fetch = async (url, options = {}) => {
    const path = decodeURIComponent(new URL(url).pathname)
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    const response = data => new Response(JSON.stringify(data), { status: 200 })
    const git = path.split('/git/')[1]
    if (git) {
      if (git === 'ref/heads/main') return response({ object: { sha: head } })
      if (git.startsWith('commits/') && method === 'GET') return response({ tree: { sha: root } })
      if (git.startsWith('trees/') && method === 'GET') return response({ tree: trees.get(git.slice(6)) })
      if (git.startsWith('blobs/') && method === 'GET') {
        const content = [...files.values()].find(text => blob(text) === git.slice(6))
        return response({ encoding: 'base64', content: Buffer.from(content).toString('base64') })
      }
      if (git === 'trees' && method === 'POST') { staged = body.tree; return response({ sha: sha('8') }) }
      if (git === 'commits' && method === 'POST') { newCommit = hash(`${head}/${JSON.stringify(staged)}`); return response({ sha: newCommit }) }
      if (git === 'refs/heads/main' && method === 'PATCH') {
        assert.equal(body.force, false)
        for (const change of staged) if (change.sha === null) files.delete(change.path); else files.set(change.path, change.content)
        head = newCommit; buildTrees(); return response({})
      }
    }
    const relative = path.split('/contents/')[1]
    if (relative === 'docs/pages') {
      const entries = [...files.keys()].filter(key => key.startsWith('docs/pages/')).map(key => ({ type: 'file', name: key.slice(11), path: key, sha: blob(files.get(key)) }))
      return entries.length ? response(entries) : new Response('{}', { status: 404 })
    }
    if (relative && files.has(relative)) return response({ type: 'file', sha: blob(files.get(relative)), encoding: 'base64', content: Buffer.from(files.get(relative)).toString('base64') })
    throw new Error(`Unexpected ${method} ${path}`)
  }
  const store = createNotebookStore('example/repo'); store.setToken('fake')
  const id = pageIdFromTitle('中文书页')
  const original = { id, title: '中文书页', content: '原文\r\n', sha: '' }
  await store.syncBatch([], [], undefined, [original])
  const fresh = await createNotebookStore('example/repo').listPages()
  assert.equal(fresh[0].title, original.title)
  assert.equal(fresh[0].content, original.content)
  assert.deepEqual([...files.keys()].filter(path => path.endsWith('.md')), [`docs/pages/${id}.md`])
  await store.syncBatch([], [], undefined, [{ ...fresh[0], content: '其他设备\n' }])
  await assert.rejects(store.syncBatch([], [], undefined, [{ ...fresh[0], content: '旧草稿\n' }]), error => error.code === 'conflict')
  const current = await store.readPage(id)
  assert.equal(current.content, '其他设备\n')
  await assert.rejects(store.deleteBatch([], [], [fresh[0]]), error => error.code === 'conflict')
  await store.deleteBatch([], [], [current])
  assert.deepEqual(await store.listPages(), [])
})
