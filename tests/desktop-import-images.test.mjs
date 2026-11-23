import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { File } from 'node:buffer'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto
globalThis.File ??= File
globalThis.location = { protocol: 'https:', hostname: 'paper.local', pathname: '/my-notes/index.html' }
const listeners = new Set(), requests = []
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
const markdownPath = 'C:\\Users\\Tester\\Desktop\\示例.md'
const source = '![绝对](C:\\Users\\Tester\\Pictures\\图片.png)\n![相对](./示例.assets/图片.png)\n![编码](./示例.assets/编码%2Epng)\n[普通链接](C:\\Users\\Tester\\Pictures\\secret.png)\n\n```md\n![代码](C:\\Users\\Tester\\Pictures\\code.png)\n```'
const bridge = {
  addEventListener(_type, callback) { listeners.add(callback) },
  removeEventListener(_type, callback) { listeners.delete(callback) },
  postMessage(message) {
    requests.push(message)
    const reply = { channel: 'paper-notes', id: message.id, ok: true }
    if (message.action === 'import.pickMarkdownFiles') reply.paths = [markdownPath]
    else if (message.action === 'import.pickMarkdownFolder') reply.files = [
      { path: markdownPath, relative: '学习/示例.md', size: Buffer.byteLength(source), markdown: true },
      { path: 'C:\\Users\\Tester\\Desktop\\示例.assets\\图片.png', relative: '学习/示例.assets/图片.png', size: png.length, markdown: false },
      { path: 'C:\\Users\\Tester\\Desktop\\示例.assets\\编码.png', relative: '学习/示例.assets/编码.png', size: png.length, markdown: false }
    ]
    else if (message.action === 'import.readMarkdown') reply.data = Buffer.from(source).toString('base64')
    else if (message.action === 'import.readSelectedImage') reply.data = Buffer.from(png).toString('base64')
    else if (message.action === 'import.readImage') reply.data = message.path.includes('missing') ? null : Buffer.from(png).toString('base64')
    queueMicrotask(() => { for (const listener of listeners) listener({ data: reply }) })
  }
}
globalThis.window = { chrome: { webview: bridge } }
const compiled = await build({ entryPoints: ['docs/.vitepress/theme/desktopImportImages.ts', 'docs/.vitepress/theme/readDroppedMarkdown.ts'], outdir: 'out-test-desktop-import', bundle: true, platform: 'node', format: 'esm', write: false })
async function loadOutput(suffix) {
  const file = compiled.outputFiles.find(output => output.path.replaceAll('\\', '/').endsWith(suffix))
  return import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`)
}
const desktop = await loadOutput('/desktopImportImages.js')
const reader = await loadOutput('/readDroppedMarkdown.js')

test('native picker preserves source directory only in transient metadata and loads exact referenced pictures', async () => {
  const files = await desktop.pickDesktopMarkdownFiles()
  assert.equal(files.length, 1)
  assert.equal(files[0].paperSourcePath, markdownPath)
  const parsed = await reader.readDroppedMarkdown({ files, items: [] })
  assert.equal(parsed.files[0].sourcePath, markdownPath)
  assert.equal(parsed.files[0].content, source)
  const completed = await desktop.resolveDesktopImportedImages(parsed)
  assert.equal(completed.images.length, 3)
  assert.ok(completed.images.some(image => image.path.endsWith('编码.png')))
  assert.equal(completed.images.every(image => Buffer.from(image.bytes).equals(Buffer.from(png))), true)
  const reads = requests.filter(request => request.action === 'import.readImage')
  assert.equal(reads.length, 3)
  assert.equal(reads.filter(request => request.markdownPath === markdownPath).length, 3)
  assert.equal(reads.some(request => request.path.includes('secret') || request.path.includes('code')), false)
  assert.equal(completed.files[0].content, source)
})

test('native folder import retains relative paths and reads referenced images lazily', async () => {
  const before = requests.length
  const files = await desktop.pickDesktopMarkdownFolder()
  assert.equal(files.length, 3)
  assert.equal(requests.slice(before).filter(request => request.action === 'import.readSelectedImage').length, 0)
  const parsed = await reader.readDroppedMarkdown({ files, items: [] })
  assert.equal(parsed.files[0].sourcePath, markdownPath)
  assert.equal(parsed.files[0].path, '学习/示例.md')
  assert.equal(parsed.images.length, 2)
  const completed = await desktop.resolveDesktopImportedImages(parsed)
  assert.equal(completed.images.length, 3)
  assert.equal(requests.slice(before).filter(request => request.action === 'import.readSelectedImage').length, 2)
  assert.equal(requests.slice(before).filter(request => request.action === 'import.readImage').length, 1)
  assert.equal(completed.files[0].content, source)
})

test('missing original images remain unresolved; browsers never call the desktop bridge', async () => {
  const content = '![图](file:///C:/Users/Tester/missing.png)'
  const parsed = await reader.readDroppedMarkdown({ files: [], items: [] }, { referenceFiles: [{ path: '笔记.md', name: '笔记.md', content }] })
  const prior = requests.length
  const resolved = await desktop.resolveDesktopImportedImages(parsed)
  assert.equal(resolved.images.length, 0)
  assert.equal(resolved.localResources.length, 1)
  assert.equal(requests.length, prior, 'no native access without a selected Markdown source')
  const before = requests.length
  globalThis.location = { protocol: 'https:', hostname: 'example.com', pathname: '/' }
  assert.equal(await desktop.resolveDesktopImportedImages(parsed), parsed)
  assert.equal(await desktop.pickDesktopMarkdownFiles(), null)
  assert.equal(requests.length, before)
})
