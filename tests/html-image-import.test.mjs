import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function load(path) {
  const bundle = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
}
const { htmlImageReferences } = await load('docs/.vitepress/theme/htmlImageRefs.ts')
const { readDroppedMarkdown } = await load('docs/.vitepress/theme/readDroppedMarkdown.ts')
const { rewriteImportedImages } = await load('docs/.vitepress/theme/rewriteImportedImages.ts')
const destination = `assets/${'a'.repeat(32)}.png`
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

function selectedFile(name, contents, path) {
  const file = new File([contents], name)
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

test('recognizes real Typora images, decoding entities but excluding code, comments and raw-text elements', () => {
  const source = [
    '<img src="img/图&amp;片.png" alt="图" style="zoom:50%;" />',
    "正文 <IMG SRC='img/second.png' title='a > b'> 后续",
    '<div>\n<img src=img/third.png >\n<script>const x = "<img src=img/fake.png>"</script>\n</div>',
    '<!-- <img src="img/comment.png"> --> <img src="img/after-comment.png">',
    '`<img src="img/inline.png">`',
    '```html\n<img src="img/code.png">\n```',
  ].join('\n\n')
  const images = htmlImageReferences(source)
  assert.deepEqual(images.map(image => image.src), ['img/%E5%9B%BE&%E7%89%87.png', 'img/second.png', 'img/third.png', 'img/after-comment.png'])
  assert.equal(source.slice(images[0].from, images[0].to), 'img/图&amp;片.png')
  assert.equal(source.slice(images[1].from, images[1].to), 'img/second.png')
  assert.equal(source.slice(images[2].from, images[2].to), 'img/third.png')
})

test('folder import reads only referenced valid relative HTML pictures and retains ordinary link warnings', async () => {
  const content = '<img src="img/图&amp;片.png" alt="图" style="zoom:50%;" />\n\n[下载](img/%E5%9B%BE&%E7%89%87.png)\n\n<img src="../outside.png">\n<img src="missing.png">\n<img src="https://example.com/a.png">\n'
  const md = selectedFile('note.md', content, '书/note.md')
  const image = selectedFile('图&片.png', png, '书/img/图&片.png')
  const result = await readDroppedMarkdown({ files: [md, image] })
  assert.equal(result.images.length, 1)
  assert.equal(result.images[0].path, '书/img/图&片.png')
  assert.deepEqual(result.images[0].references, [{ markdownPath: '书/note.md', target: 'img/%E5%9B%BE&%E7%89%87.png' }])
  assert.ok(result.localResources.some(ref => ref.target === 'img/%E5%9B%BE&%E7%89%87.png'), 'ordinary link remains unresolved')
  assert.ok(result.localResources.some(ref => ref.target === '../outside.png'))
  assert.ok(result.localResources.some(ref => ref.target === 'missing.png'))
})

test('rewrites only src attribute of genuine HTML images while preserving sizing, quotes and unrelated content', () => {
  const source = '<img src="img/图&amp;片.png" alt="图" style="zoom:50%;" />\r\n' +
    "文字 <IMG ALT='A' SRC='img/图&amp;片.png' style='zoom:75%'> 后续\r\n" +
    '[下载](img/%E5%9B%BE&%E7%89%87.png)\r\n' +
    '<!-- <img src="img/图&amp;片.png"> -->\r\n' +
    '```html\r\n<img src="img/图&amp;片.png">\r\n```\r\n'
  const target = 'img/%E5%9B%BE&%E7%89%87.png'
  const result = rewriteImportedImages(source, new Map([[target, destination]]))
  const expected = source.replace('src="img/图&amp;片.png"', `src="${destination}"`).replace("SRC='img/图&amp;片.png'", `SRC='${destination}'`)
  assert.equal(result.content, expected)
  assert.deepEqual(result.replaced, [target])
})

test('duplicate src, outside-root, malformed and non-image tags cannot be imported or rewritten', async () => {
  const source = '<img src="a.png" src="b.png">\n<img src="%2e%2e/secret.png">\n<img src="&#x2e;&#x2e;/secret.png">\n<img src="&#106;&#97;vascript:alert(1)">\n<video src="a.png">\n'
  const result = await readDroppedMarkdown({ files: [selectedFile('n.md', source, 'root/n.md'), selectedFile('a.png', png, 'root/a.png'), selectedFile('b.png', png, 'root/b.png')] })
  assert.deepEqual(result.images, [])
  assert.equal(rewriteImportedImages(source, new Map([['a.png', destination], ['b.png', destination]])).content, source)
})
