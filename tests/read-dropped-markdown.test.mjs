import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/readDroppedMarkdown.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { readDroppedMarkdown, resolveDroppedImagePath, windowsImagePath, selectedImageMatch, absoluteImageReferences, localImageReferences } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
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

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const image = (name, data = png) => file(name, data)

test('imports referenced nested images by their full path, including encoded spaces and Chinese names', async () => {
  const first = file('chapter.md', '# 笔记\n![一](../图片/%E5%9B%BE%20%E4%B8%80.png)\n![二][ref]\n\n[ref]: ../图片/%E5%9B%BE%20%E4%B8%80.png\n')
  const other = file('two.md', '![二](../其他/图%20一.png)')
  const root = directory('文档', [[
    directory('章节', [[fileEntry(first), fileEntry(other)]]),
    directory('图片', [[fileEntry(image('图 一.png'))]]),
    directory('其他', [[fileEntry(image('图 一.png', Uint8Array.from([...png, 99])))]]),
  ]])
  const result = await readDroppedMarkdown(transfer(root))
  assert.deepEqual(result.images.map(item => item.path), ['文档/图片/图 一.png', '文档/其他/图 一.png'])
  assert.equal(result.images[0].references.length, 1, 'same target reused through a Markdown reference is stored once')
  assert.deepEqual(result.images[0].references, [{ markdownPath: '文档/章节/chapter.md', target: '../%E5%9B%BE%E7%89%87/%E5%9B%BE%20%E4%B8%80.png' }])
  assert.equal(result.images[1].references[0].markdownPath, '文档/章节/two.md')
  assert.deepEqual(result.localResources, [])
  assert.deepEqual(result.images[0].bytes, png)
})

test('FileList imports a Typora assets folder and ignores links, code and unreferenced images', async () => {
  const chapter = file('note.md', '![截图](note.assets/a.png)\n[原图](note.assets/a.png)\n`![不是图片](note.assets/b.png)`\n[文档](note.assets/b.png)')
  Object.defineProperty(chapter, 'webkitRelativePath', { value: '书/note.md' })
  const a = image('a.png'), b = image('b.png')
  Object.defineProperty(a, 'webkitRelativePath', { value: '书/note.assets/a.png' })
  Object.defineProperty(b, 'webkitRelativePath', { value: '书/note.assets/b.png' })
  const result = await readDroppedMarkdown({ files: [chapter, a, b] })
  assert.deepEqual(result.images.map(item => item.path), ['书/note.assets/a.png'])
  assert.deepEqual(result.skipped, [{ path: '书/note.assets/b.png', reason: 'not-markdown' }])
  assert.deepEqual(result.localResources, [{ markdownPath: '书/note.md', target: 'note.assets/a.png' }, { markdownPath: '书/note.md', target: 'note.assets/b.png' }])
})

test('unsafe, missing, ambiguous, invalid and oversized images never become attachments', async () => {
  assert.equal(resolveDroppedImagePath('书/子/a.md', '../../外.png'), null)
  assert.equal(resolveDroppedImagePath('书/a.md', '%2e%2e/外.png'), null)
  assert.equal(resolveDroppedImagePath('书/a.md', '%2Fetc/a.png'), null)
  assert.equal(resolveDroppedImagePath('书/a.md', 'C:%5Cprivate.png'), null)
  assert.equal(resolveDroppedImagePath('书/子/a.md', '../图%20片.png'), '书/图 片.png')
  const source = '![missing](missing.png) ![amb](a.png) ![bad](bad.png) ![large](big.png) ![escape](../outside.png)'
  const root = directory('书', [[fileEntry(file('note.md', source)), fileEntry(image('a.png')), fileEntry(image('a.png')), fileEntry(image('bad.png', 'not a png')), fileEntry(image('big.png', Uint8Array.from([...png, 4]))) ]])
  const result = await readDroppedMarkdown(transfer(root), { maxImageBytes: 11 })
  assert.deepEqual(result.images, [])
  assert.deepEqual(result.skipped.map(item => item.reason), ['ambiguous', 'invalid-image', 'too-large'])
  assert.equal(result.localResources.length, 5)
})

test('standalone files import selected sibling images, but reject paths outside selection', async () => {
  const md = file('note.md', '![可用](picture.png)\n![缺少](missing.png)\n![拒绝](../private.png)')
  const result = await readDroppedMarkdown({ files: [md, image('picture.png'), image('private.png')] })
  assert.deepEqual(result.images.map(item => item.path), ['picture.png'])
  assert.deepEqual(result.localResources, [{ markdownPath: 'note.md', target: 'missing.png' }, { markdownPath: 'note.md', target: '../private.png' }])
  assert.deepEqual(result.skipped, [{ path: 'private.png', reason: 'not-markdown' }])
})

test('unsafe FileList root never becomes an import folder', async () => {
  const bad = file('note.md', '# 标题')
  Object.defineProperty(bad, 'webkitRelativePath', { value: '../outside/note.md' })
  const result = await readDroppedMarkdown({ files: [bad] })
  assert.deepEqual(result.folders, [])
  assert.deepEqual(result.files, [])
  assert.equal(result.skipped[0].reason, 'invalid-path')
})

test('Windows absolute image references use only files explicitly selected with the Markdown', async () => {
  const source = '![截图](C:\\Users\\Lenovo\\AppData\\Roaming\\Typora\\typora-user-images\\图一.png)\n<img src="C:\\Users\\Lenovo\\图片\\二.png" style="zoom:50%" />\n`![示例](C:\\Users\\Lenovo\\其他.png)`\n![外链](https://example.org/图一.png)'
  const note = file('note.md', source)
  const one = image('图一.png'), two = image('二.png')
  Object.defineProperty(one, 'paperSourcePath', { value: 'C:\\Users\\Lenovo\\AppData\\Roaming\\Typora\\typora-user-images\\图一.png' })
  Object.defineProperty(two, 'paperSourcePath', { value: 'C:\\Users\\Lenovo\\图片\\二.png' })
  const result = await readDroppedMarkdown({ files: [note, one, two, image('其他.png')] })
  assert.deepEqual(result.images.map(item => item.path), ['图一.png', '二.png'])
  assert.ok(result.images[0].references[0].target.startsWith('C:%5CUsers%5CLenovo'))
  assert.deepEqual(result.localResources, [])
  assert.equal(result.files[0].content, source)
  assert.deepEqual(result.skipped, [{ path: '其他.png', reason: 'not-markdown' }])
})

test('an explicitly selected picture folder can repair the open Markdown independently', async () => {
  const source = '![绝对](file:///C:/Users/Lenovo/Pictures/%E5%9B%BE.png)\n![相对](note.assets/other.png)\n![缺失](C:/old/missing.png)'
  const selected = [image('图.png'), image('other.png')]
  Object.defineProperty(selected[0], 'webkitRelativePath', { value: '截图/图.png' })
  Object.defineProperty(selected[1], 'webkitRelativePath', { value: '截图/other.png' })
  const virtualNote = { path: '当前.md', name: '当前.md', content: source }
  const result = await readDroppedMarkdown({ files: selected }, { referenceFiles: [virtualNote], selectedImageFolder: true })
  assert.deepEqual(result.files, [virtualNote])
  assert.deepEqual(result.images.map(item => item.path), ['截图/图.png', '截图/other.png'])
  assert.equal(result.images[0].references[0].target, 'file:///C:/Users/Lenovo/Pictures/%E5%9B%BE.png')
  assert.deepEqual(result.localResources, [{ markdownPath: '当前.md', target: 'C:/old/missing.png' }])
})

test('duplicate picture filenames remain ambiguous; URL schemes and parent traversal never match', async () => {
  assert.deepEqual(windowsImagePath('C:%5CUsers%5CLenovo%5C%E5%9B%BE.png'), ['Users', 'Lenovo', '图.png'])
  assert.deepEqual(windowsImagePath('file:///C:/Users/Lenovo/%E5%9B%BE.png'), ['Users', 'Lenovo', '图.png'])
  for (const unsafe of ['https://example.com/图.png', 'C:%5CUsers%5C..%5Cprivate.png', 'file:///etc/passwd', 'C:relative.png']) assert.equal(windowsImagePath(unsafe), null)
  assert.deepEqual(selectedImageMatch('C:/Users/Lenovo/a.png', ['选择/一/a.png', '选择/二/a.png'], true), { path: null, ambiguous: true })
  assert.deepEqual(selectedImageMatch('../private.png', ['选择/private.png'], true), { path: null, ambiguous: false })
  const note = file('note.md', '![图](C:/Users/Lenovo/a.png)')
  const a = image('a.png'), b = image('a.png', Uint8Array.from([...png, 9]))
  Object.defineProperty(a, 'webkitRelativePath', { value: '选择/一/a.png' })
  Object.defineProperty(b, 'webkitRelativePath', { value: '选择/二/a.png' })
  const result = await readDroppedMarkdown({ files: [note, a, b] }, { selectedImageFolder: true })
  assert.deepEqual(result.images, [])
  assert.equal(result.skipped.filter(item => item.reason === 'ambiguous').length, 1)
  assert.equal(result.localResources.length, 1)
})

test('ordinary import never guesses an absolute image from an unrelated same-name file', async () => {
  const note = file('note.md', '![图](C:/Pictures/a.png)')
  const unrelated = image('a.png')
  Object.defineProperty(unrelated, 'webkitRelativePath', { value: '选择/其他/a.png' })
  Object.defineProperty(unrelated, 'paperSourcePath', { value: 'C:\\Desktop\\其他\\a.png' })
  const result = await readDroppedMarkdown({ files: [note, unrelated] })
  assert.deepEqual(result.images, [])
  assert.deepEqual(result.localResources, [{ markdownPath: 'note.md', target: 'C:/Pictures/a.png' }])
  const matching = image('a.png')
  Object.defineProperty(matching, 'paperSourcePath', { value: 'c:\\pictures\\a.png' })
  const withExactPath = await readDroppedMarkdown({ files: [note, matching] })
  assert.equal(withExactPath.images.length, 1)
  assert.equal(withExactPath.images[0].references[0].target, 'C:/Pictures/a.png')
})

test('absolute image URLs decode once but native filesystem names remain literal', async () => {
  const cases = [
    ['C:/Pictures/a%20b.png', 'C:\\Pictures\\a%20b.png', false],
    ['C:/Pictures/a%20b.png', 'C:\\Pictures\\a b.png', true],
    ['file:///C:/Pictures/a%2520b.png', 'C:\\Pictures\\a%20b.png', true],
    ['C:/Pictures/a%2Fb.png', 'C:\\Pictures\\a%2Fb.png', false],
    ['C:/Pictures/a%252Fb.png', 'C:\\Pictures\\a%2Fb.png', true],
    ['C:/Pictures/100%25.png', 'C:\\Pictures\\100%.png', true],
  ]
  for (const [target, source, expected] of cases) {
    const note = file('note.md', `![图](${target})`)
    const candidate = image(source.split('\\').at(-1))
    Object.defineProperty(candidate, 'paperSourcePath', { value: source })
    const result = await readDroppedMarkdown({ files: [note, candidate] })
    assert.equal(result.images.length, Number(expected), `${target} versus ${source}`)
    assert.equal(result.localResources.length, Number(!expected), `${target} versus ${source}`)
  }
})

test('desktop discovery returns only Windows paths in real inline/reference/HTML image syntax', () => {
  const source = '![图](C:\\Users\\Lenovo\\图.png)\r\n![引用][id]\r\n\r\n[id]: file:///C:/Users/Lenovo/另图.png "标题"\r\n\r\n<img src="C:\\Users\\Lenovo\\三.png">\r\n[普通链接](C:/Users/Lenovo/not-image.png)\r\n`![代码](C:/Users/Lenovo/not-code.png)`\r\n<!-- <img src="C:/Users/Lenovo/not-comment.png"> -->\r\n```md\r\n![fence](C:/Users/Lenovo/not-fence.png)\r\n```\r\n'
  assert.deepEqual(absoluteImageReferences(source), [
    'C:%5CUsers%5CLenovo%5C%E4%B8%89.png',
    'C:%5CUsers%5CLenovo%5C%E5%9B%BE.png',
    'file:///C:/Users/Lenovo/%E5%8F%A6%E5%9B%BE.png'
  ])
})

test('desktop native Markdown source path is temporary metadata and only local image references are discovered', async () => {
  const source = '![相对](../img/图.png)\n![盘符](C:/Users/Example/a.png)\n![文件](file:///C:/Users/Example/b.png)\n![网络](https://example.com/x.png)\n![data](data:image/png;base64,abc)\n[链接](img/not-an-image.png)\n`![代码](img/code.png)`\n<!-- <img src="img/comment.png"> -->\n<img src="img/real.png">'
  const note = file('note.md', source)
  Object.defineProperty(note, 'paperSourcePath', { value: 'C:\\Selected\\note.md' })
  const result = await readDroppedMarkdown({ files: [note] })
  assert.equal(result.files[0].sourcePath, 'C:\\Selected\\note.md')
  assert.equal(result.files[0].content, source)
  assert.deepEqual(new Set(localImageReferences(source)), new Set(['../img/%E5%9B%BE.png', 'C:/Users/Example/a.png', 'file:///C:/Users/Example/b.png', 'img/real.png']))
  const fake = file('fake.md', 'content')
  Object.defineProperty(fake, 'paperSourcePath', { value: 'C:\\Selected\\bad\0.md' })
  assert.equal((await readDroppedMarkdown({ files: [fake] })).files[0].sourcePath, undefined)
})
