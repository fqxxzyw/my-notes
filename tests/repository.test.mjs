import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

// Use independent bundles to avoid generated relative imports in data: URLs.
const storeBundle = await build({ entryPoints: ['docs/.vitepress/theme/notebookStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'empty-snapshot', setup(build) { build.onLoad({ filter: /notebookStore\.ts$/ }, async ({ path }) => {
    const contents = (await readFile(path, 'utf8')).replace(/const snapshotFiles = import\.meta\.glob<string>\([\s\S]*?\n\}\)/, 'const snapshotFiles: Record<string, string> = {}')
    return { contents, loader: 'ts', resolveDir: path.replace(/[\\/][^\\/]+$/, '') }
  }) } }] })
const repositoryBundle = await build({ entryPoints: ['docs/.vitepress/theme/repository.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const load = result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
const { createNotebookStore } = await load(storeBundle)
const { normalizeRepository, namespaceKey, getConfiguredRepository, setConfiguredRepository } = await load(repositoryBundle)
globalThis.crypto ??= webcrypto

test('repository identities are normalized and validated', () => {
  assert.equal(normalizeRepository('Owner/Notes'), 'owner/notes')
  assert.equal(normalizeRepository('https://github.com/Owner/Notes.git/'), 'owner/notes')
  for (const input of ['https://evil.example/owner/repo', 'http://github.com/owner/repo', 'https://user:pass@github.com/owner/repo',
    'https://github.com/owner/repo?token=secret', 'https://github.com/owner/repo#x', 'owner/repo/extra', '../repo', 'owner/..', 'owner/%2f']) {
    assert.throws(() => normalizeRepository(input))
  }
  assert.equal(namespaceKey('draft', 'OWNER/Notes'), namespaceKey('draft', 'owner/notes'))
  assert.notEqual(namespaceKey('draft', 'owner/notes'), namespaceKey('draft', 'other/notes'))
  assert.notEqual(namespaceKey('draft', null), namespaceKey('draft', 'owner/notes'))
})

test('repository settings persist canonical values and refuse invalid input', () => {
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  setConfiguredRepository('Alice/Notes')
  assert.equal(getConfiguredRepository(), 'alice/notes')
  assert.throws(() => setConfiguredRepository('https://evil.invalid/a/b'))
  assert.equal(getConfiguredRepository(), 'alice/notes')
  setConfiguredRepository('')
  assert.equal(getConfiguredRepository(), '')
  values.set('paper-notes:repository:v2', 'invalid repository')
  assert.equal(getConfiguredRepository(), '')
})

test('unconfigured stores refuse all remote reads without making requests', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('unexpected') }
  const store = createNotebookStore()
  await assert.rejects(store.verifyRepository(), /先设置/)
  await assert.rejects(store.listNotebooks(), /先设置/)
  await assert.rejects(store.readHead(), /先设置/)
  assert.equal(calls, 0)
})

test('repo validation checks the actual requested repository, not a missing notes directory', async () => {
  const calls = []; globalThis.fetch = async (url, options) => { calls.push([url, options]); return new Response('{}', { status: 404 }) }
  const store = createNotebookStore('Alice/Notes'); store.setToken('fake')
  await assert.rejects(store.verifyRepository(), /仓库不存在或无权访问/)
  assert.equal(calls[0][0], 'https://api.github.com/repos/alice/notes')
})

test('a readme-initialized empty notes repository accepts its first notebook', async () => {
  const h = char => char.repeat(40)
  const paths = []
  globalThis.fetch = async (url, options = {}) => {
    const p = new URL(url).pathname.split('/git/')[1]
    const method = options.method || 'GET'; paths.push([p, method, options.body && JSON.parse(options.body)])
    const json = v => new Response(JSON.stringify(v), { status: 200 })
    if (p === 'ref/heads/main') return json({ object: { sha: h('a') } })
    if (p === `commits/${h('a')}`) return json({ tree: { sha: h('b') } })
    if (p === `trees/${h('b')}` && method === 'GET') return json({ tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: h('f') }] })
    if (p === 'trees' && method === 'POST') return json({ sha: h('c') })
    if (p === 'commits' && method === 'POST') return json({ sha: h('d') })
    if (p === 'refs/heads/main' && method === 'PATCH') return json({})
    throw new Error(`unexpected ${method} ${p}`)
  }
  const store = createNotebookStore('alice/notes'); store.setToken('fake')
  const result = await store.syncBatch([{ id: 'test', title: 'Test', sha: '' }], [])
  assert.equal(result.head, h('d'))
  assert.equal(paths.find(([p, m]) => p === 'trees' && m === 'POST')[2].tree[0].path, 'docs/notebooks/test/index.md')
})
