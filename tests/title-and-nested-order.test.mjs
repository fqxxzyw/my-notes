import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}

const { cleanMarkdownTitle, extractMarkdownTitle } = await load('docs/.vitepress/theme/notebookTitle.ts')
const {
  decodeEncodedChapterPath,
  chapterFolderPath,
  compareNatural,
  compareImportedPaths,
  sortChapters
} = await load('docs/.vitepress/theme/notebookChapterOrder.ts')
const { chapterIdFromTitle } = await load('docs/.vitepress/theme/notebookStore.ts')
const { readRemoteCache, writeRemoteCache } = await load('docs/.vitepress/theme/remoteCache.ts')
const { readDroppedMarkdown } = await load('docs/.vitepress/theme/readDroppedMarkdown.ts')

test('cleanMarkdownTitle strips backticks and inline Markdown while preserving snake_case and symbols', () => {
  assert.equal(
    cleanMarkdownTitle('`05-asyncio_gather.py` 代码精讲：多协程并发汇聚（`asyncio.gather`）与耗时压缩原理'),
    '05-asyncio_gather.py 代码精讲：多协程并发汇聚（asyncio.gather）与耗时压缩原理'
  )
  assert.equal(
    cleanMarkdownTitle('模块总览：`1-uv环境管理工具` —— 现代 Python 极速包与虚拟环境管理完全指南'),
    '模块总览：1-uv环境管理工具 —— 现代 Python 极速包与虚拟环境管理完全指南'
  )
  assert.equal(
    cleanMarkdownTitle('`utils/__init__.py` 与 `@tool` 和 **加粗** _斜体_ ==高亮== ~~旧版~~ [文档](https://a.test) <u>重点</u> ###'),
    'utils/__init__.py 与 @tool 和 加粗 斜体 高亮 旧版 文档 重点'
  )
  // Intraword underscores outside backticks must never be stripped.
  assert.equal(cleanMarkdownTitle('chat_service_core.py 与 a2a_server 说明'), 'chat_service_core.py 与 a2a_server 说明')
  // Multi-backtick code span containing literal single backticks.
  assert.equal(cleanMarkdownTitle('使用 `` `code` `` 语法'), '使用 `code` 语法')
  // extractMarkdownTitle handles BOM and fallback cleanly.
  assert.equal(
    extractMarkdownTitle('\uFEFF# `07-mcp-streamable-server.py` 深度精讲\n\n正文', 'fallback'),
    '07-mcp-streamable-server.py 深度精讲'
  )
  assert.equal(extractMarkdownTitle('正文没有一级标题', '`fallback_name`'), 'fallback_name')
})

test('compareImportedPaths satisfies strict weak ordering (antisymmetry and transitivity) across mixed trees', () => {
  const samples = [
    'README.md',
    'index.md',
    '00-导读.md',
    '01-基础.md',
    '01-基础/README.md',
    '01-基础/01-安装.md',
    '01-基础/2-配置.md',
    '01-基础/10-排错.md',
    '1-uv环境管理工具/README.md',
    '1-uv环境管理工具/requirements.txt.md',
    '2-Function Call/01-基本调用.py.md',
    '2-Function Call/02-装饰器方式.py.md',
    '10-进阶实战/01-入口.md',
    'requirements.txt.md',
    '附录.md',
    '压力测试/stress_test.py.md'
  ]
  for (const a of samples) {
    assert.equal(compareImportedPaths(a, a), 0, `reflexivity failed for ${a}`)
    for (const b of samples) {
      const ab = Math.sign(compareImportedPaths(a, b))
      const ba = Math.sign(compareImportedPaths(b, a))
      assert.equal(ab + ba, 0, `antisymmetry failed for ${a} vs ${b}`)
      for (const c of samples) {
        const bc = Math.sign(compareImportedPaths(b, c))
        const ac = Math.sign(compareImportedPaths(a, c))
        if (ab < 0 && bc < 0) assert.equal(ac, -1, `transitivity failed: ${a} < ${b} < ${c}`)
        if (ab === 0 && bc === 0) assert.equal(ac, 0, `equivalence transitivity failed: ${a} == ${b} == ${c}`)
      }
    }
  }
  const reversed = [...samples].reverse().sort(compareImportedPaths)
  assert.equal(reversed[0], 'index.md')
  assert.equal(reversed[1], 'README.md')
  assert.ok(reversed.indexOf('01-基础.md') < reversed.indexOf('01-基础/README.md'))
  assert.ok(reversed.indexOf('01-基础/README.md') < reversed.indexOf('01-基础/01-安装.md'))
  assert.ok(reversed.indexOf('01-基础/2-配置.md') < reversed.indexOf('01-基础/10-排错.md'))
  assert.ok(reversed.indexOf('2-Function Call/02-装饰器方式.py.md') < reversed.indexOf('10-进阶实战/01-入口.md'))
  assert.ok(reversed.indexOf('附录.md') < reversed.indexOf('压力测试/stress_test.py.md'))
  assert.ok(compareNatural('2-Function Call', '10-实战') < 0)
})

test('sortChapters recovers nested folder hierarchy from encoded IDs while honoring explicit order and plain IDs', () => {
  const paths = [
    '6-A2A协议/12_multi_intent.py',
    '4-MCP协议/07-mcp-streamable-server.py',
    '1-uv环境管理工具/requirements.txt',
    '3-异步编程/02-asyncio_run.py',
    '1-uv环境管理工具/README',
    '2-Function Call/01-基本调用.py',
    '6-A2A协议/02_a2a_executor.py',
    '3-异步编程/01-async_basic.py'
  ]
  const chapters = paths.map(rel => ({ id: chapterIdFromTitle(rel), rel }))
  assert.equal(chapterFolderPath(chapters[0].id), '6-A2A协议')
  assert.equal(decodeEncodedChapterPath(chapters[0].id), '6-A2A协议/12_multi_intent.py')

  const autoSorted = sortChapters(chapters, undefined)
  assert.deepEqual(
    autoSorted.map(c => c.rel),
    [
      '1-uv环境管理工具/README',
      '1-uv环境管理工具/requirements.txt',
      '2-Function Call/01-基本调用.py',
      '3-异步编程/01-async_basic.py',
      '3-异步编程/02-asyncio_run.py',
      '4-MCP协议/07-mcp-streamable-server.py',
      '6-A2A协议/02_a2a_executor.py',
      '6-A2A协议/12_multi_intent.py'
    ]
  )

  // Explicit manual order overrides default path order; unlisted encoded chapters follow in path order.
  const pinned = chapters.find(c => c.rel === '6-A2A协议/12_multi_intent.py')
  const custom = sortChapters(chapters, [pinned.id])
  assert.equal(custom[0].rel, '6-A2A协议/12_multi_intent.py')
  assert.equal(custom[1].rel, '1-uv环境管理工具/README')

  // Plain non-encoded IDs keep exact original input stability.
  const plain = [{ id: 'zeta' }, { id: 'alpha' }, { id: 'beta' }]
  assert.deepEqual(sortChapters(plain, undefined).map(c => c.id), ['zeta', 'alpha', 'beta'])
})

test('real 前置知识 notebook (if present) sorts all 46 nested chapters cleanly without stray backticks', () => {
  const dir = path.resolve('docs/notebooks/b154cf9c47ed4b19a7b27a4b3a2b975a')
  if (!fs.existsSync(dir)) return
  const chapters = fs.readdirSync(dir)
    .filter(name => name.endsWith('.md') && name !== 'index.md')
    .map(name => {
      const id = name.slice(0, -3)
      const content = fs.readFileSync(path.join(dir, name), 'utf8')
      return { id, title: extractMarkdownTitle(content, decodeEncodedChapterPath(id) || id), decoded: decodeEncodedChapterPath(id) }
    })
  const sorted = sortChapters(chapters, undefined)
  assert.equal(sorted.length, 46)
  // No backticks remain in any cleaned title.
  for (const ch of sorted) {
    assert.ok(!ch.title.includes('`'), `Title still contains backtick: ${ch.title}`)
  }
  // Folders appear monotonically 1 -> 2 -> 3 -> 4 -> 5 -> 6.
  const folderNums = sorted.map(ch => Number(/^(\d+)-/.exec(ch.decoded || '')?.[1]))
  for (let i = 1; i < folderNums.length; i++) {
    assert.ok(folderNums[i] >= folderNums[i - 1], `Folder order regressed at ${i}: ${sorted[i - 1].decoded} -> ${sorted[i].decoded}`)
  }
  // Module overview README leads section 1; 6-A2A ends at 12_multi_intent.py.
  assert.equal(sorted[0].decoded, '1-uv环境管理工具/README')
  assert.equal(sorted[sorted.length - 1].decoded, '6-A2A协议/12_multi_intent.py')
})

test('readRemoteCache cleans raw Markdown backticks from legacy cached snapshots', () => {
  const sha = 'a'.repeat(40)
  const values = new Map()
  const storage = {
    getItem: k => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: k => values.delete(k)
  }
  const snapshot = {
    head: sha,
    books: [{ id: 'book1', title: '`前置知识`', sha }],
    chapters: {
      book1: [
        { bookId: 'book1', id: 'c1', title: '`05-asyncio_gather.py` 代码精讲（`asyncio.gather`）', content: '# `05-asyncio_gather.py`', sha }
      ]
    },
    pages: [{ id: 'p1', title: '`README` 总览', content: '# `README` 总览', sha }],
    catalog: { catalog: { cabinets: [{ id: 'general', title: '默认书柜' }], assignments: {} }, sha: '' }
  }
  writeRemoteCache(snapshot, 'example/repo', storage)
  const loaded = readRemoteCache('example/repo', storage)
  assert.equal(loaded.books[0].title, '前置知识')
  assert.equal(loaded.chapters.book1[0].title, '05-asyncio_gather.py 代码精讲（asyncio.gather）')
  assert.equal(loaded.pages[0].title, 'README 总览')
})

test('nested folder import entries sort into deterministic hierarchical natural order', async () => {
  const mkFile = (relPath, body) => {
    const f = new File([body], relPath.split('/').pop(), { type: 'text/markdown' })
    Object.defineProperty(f, 'webkitRelativePath', { value: relPath })
    return f
  }
  const files = [
    mkFile('前置知识/6-A2A协议/10_router.md', '# `10_router`'),
    mkFile('前置知识/6-A2A协议/2_exec.md', '# `2_exec`'),
    mkFile('前置知识/1-uv/uv安装.md', '# uv安装'),
    mkFile('前置知识/1-uv/README.md', '# 模块总览'),
    mkFile('前置知识/2-FC/01-基础.md', '# 基础')
  ]
  const result = await readDroppedMarkdown({ files, items: [] }, { allowOtherFiles: true })
  const ordered = [...result.files].sort((a, b) =>
    compareImportedPaths(a.path.slice('前置知识/'.length), b.path.slice('前置知识/'.length))
  )
  assert.deepEqual(
    ordered.map(f => f.path),
    [
      '前置知识/1-uv/README.md',
      '前置知识/1-uv/uv安装.md',
      '前置知识/2-FC/01-基础.md',
      '前置知识/6-A2A协议/2_exec.md',
      '前置知识/6-A2A协议/10_router.md'
    ]
  )
})
