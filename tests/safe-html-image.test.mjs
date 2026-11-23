import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['docs/.vitepress/theme/safeHtmlImage.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { renderSafeHtmlImage, enableSafeHtmlImages } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
const parser = new MarkdownIt({ html: false })
enableSafeHtmlImages(parser)

test('renders Typora image with safe zoom without interpreting other HTML', () => {
  const image = '<img src="assets/abc.png" alt="示例" style="zoom:50%;" />'
  assert.equal(renderSafeHtmlImage(image), '<img src="assets/abc.png" alt="示例" style="zoom:50%">')
  assert.match(parser.render(image), /<img src="assets\/abc\.png" alt="示例" style="zoom:50%">/)
  assert.match(parser.render('<b>not allowed</b>'), /&lt;b&gt;not allowed&lt;\/b&gt;/)
  assert.match(parser.render('`<img src="a.png">`'), /&lt;img src=&quot;a\.png&quot;&gt;/)
  assert.match(parser.render('```html\n<img src="a.png">\n```'), /&lt;img src=&quot;a\.png&quot;&gt;/)
  assert.doesNotMatch(parser.render('<!-- <img src="a.png"> -->'), /<img\s/)
  assert.doesNotMatch(parser.render('<script><img src="a.png"></script>'), /<img\s/)
})

test('prevents URL, attribute and style injection', () => {
  for (const src of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'file:///C:/secret.png', 'blob:https://evil.example/id']) {
    assert.equal(renderSafeHtmlImage(`<img src="${src}" />`), null)
    assert.doesNotMatch(parser.render(`<img src="${src}" />`), /<img\s/)
  }
  const html = renderSafeHtmlImage('<img src="https://example.com/a.png" alt="x&amp;quot; y" onerror="alert(1)" style="zoom:50%;background:url(https://evil)" />')
  assert.match(html, /^<img src="https:\/\/example\.com\/a\.png" alt=/)
  assert.doesNotMatch(html, /onerror|background|evil/)
  assert.equal(renderSafeHtmlImage('<img src="a.png" src="b.png">'), null)
  assert.equal(renderSafeHtmlImage('<img src="a.png"><script>alert(1)</script>'), null)
})

test('supports encoded relative paths, dimensions, and ordinary Markdown images', () => {
  const html = renderSafeHtmlImage("<IMG alt='图' src='img/图 一.png' width='200' height='100' style='zoom:0.5' />")
  assert.match(html, /src="img\/%E5%9B%BE%20%E4%B8%80\.png"/)
  assert.match(html, /width="200" height="100" style="zoom:50%"/)
  assert.match(parser.render('![图](assets/example.png)'), /<img src="assets\/example\.png" alt="图">/)
})
