import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/readDroppedMarkdown.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { readDroppedMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
const file = (name, content) => new File([content], name)
const fileEntry = (value) => ({ name: value.name, isFile: true, isDirectory: false, file: resolve => resolve(value) })
const directory = (name, batches) => ({ name, isFile: false, isDirectory: true, createReader() { let i = 0; return { readEntries: resolve => resolve(batches[i++] || []) } } })
const transfer = (...entries) => ({ items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry })) })

test('walks all directory batches, keeps empty roots, exact markdown and reports resources', async () => {
  const source = '\ufeff# 开始\r\n![图](images/a.png)\r\n[章节](../other.md)\r\n`![x](no.png)`\r\n[网页](https://example.com)\r\n'
  const nested = directory('子目录', [[fileEntry(file('二.MD', '正文'))]])
  const root = directory('学习', [[fileEntry(file('一.md', source)), fileEntry(file('忽略.png', 'image'))], [nested]])
  const result = await readDroppedMarkdown(transfer(root, directory('空目录', []), fileEntry(file('独立.md', '# hi'))))
  assert.deepEqual(result.folders, ['学习', '空目录'])
  assert.deepEqual(result.files.map(x => x.path), ['学习/一.md', '学习/子目录/二.MD', '独立.md'])
  assert.equal(result.files[0].content, source)
  assert.deepEqual(result.skipped, [{ path: '学习/忽略.png', reason: 'not-markdown' }])
  assert.deepEqual(result.localResources, [{ markdownPath: '学习/一.md', target: 'images/a.png' }, { markdownPath: '学习/一.md', target: '../other.md' }])
})

test('supports FileList fallback and records relative top folder', async () => {
  const chapter = file('chapter.md', '# 章节')
  Object.defineProperty(chapter, 'webkitRelativePath', { value: '书/子/chapter.md' })
  const result = await readDroppedMarkdown({ items: [], files: [chapter, file('file.txt', 'ignored')] })
  assert.deepEqual(result.folders, ['书'])
  assert.equal(result.files[0].path, '书/子/chapter.md')
  assert.deepEqual(result.skipped, [{ path: 'file.txt', reason: 'not-markdown' }])
})

test('rejects invalid UTF-8 and enforces read limits without mutating files', async () => {
  const result = await readDroppedMarkdown({ files: [file('bad.md', new Uint8Array([0xff])), file('large.md', '12345'), file('ok.md', 'x'), file('extra.md', 'y')] }, { maxFileBytes: 4, maxFiles: 1 })
  assert.deepEqual(result.files.map(x => x.path), ['ok.md'])
  assert.deepEqual(result.skipped.map(x => x.reason), ['invalid-utf8', 'too-large', 'too-many'])
})

test('limits traversal and reports directory read errors', async () => {
  const broken = { name: 'broken', isDirectory: true, createReader: () => ({ readEntries: (_ok, error) => error(new Error('failed')) }) }
  const fail = await readDroppedMarkdown(transfer(broken))
  assert.deepEqual(fail.skipped, [{ path: 'broken', reason: 'read-error' }])
  const many = await readDroppedMarkdown(transfer(directory('root', [[fileEntry(file('a.md', 'a')), fileEntry(file('b.md', 'b'))]])), { maxEntries: 2 })
  assert.equal(many.files.length, 1)
  assert.deepEqual(many.skipped, [{ path: '（其余项目）', reason: 'too-many' }])
})

test('captures all drop handles before the browser invalidates the drag store', async () => {
  let available = true
  const first = fileEntry(file('first.md', 'one'))
  const second = fileEntry(file('second.md', 'two'))
  first.file = resolve => { available = false; queueMicrotask(() => resolve(file('first.md', 'one'))) }
  const result = await readDroppedMarkdown({ items: [first, second].map(entry => ({ kind: 'file', webkitGetAsEntry: () => available ? entry : null, getAsFile: () => null })) })
  assert.deepEqual(result.files.map(x => x.name), ['first.md', 'second.md'])
})
