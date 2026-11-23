import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { build } from 'esbuild'

async function load(path) {
  const compiled = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
}
const { enableTaskMarkers } = await load('docs/.vitepress/theme/markdownTasks.ts')
const { enableSafeHtmlImages } = await load('docs/.vitepress/theme/safeHtmlImage.ts')
const { markdownBlocks } = await load('docs/.vitepress/theme/liveMarkdown.ts')

test('reading and visual blocks show checked and unchecked task markers', () => {
  const source = '# 标题\n\n- [x] 完成\n- [ ] 待办\n  - [X] 嵌套\n- [ ]\n\n|列|值|\n|-|-|\n|甲|乙|\n\n![普通图片](assets/a.png)\n\n<img src="assets/b.png" style="zoom:50%;" />'
  const reading = new MarkdownIt({ html: false })
  enableSafeHtmlImages(reading)
  enableTaskMarkers(reading)
  const html = reading.render(source)
  const visual = markdownBlocks(source).map(block => block.html).join('\n')
  for (const rendered of [html, visual]) {
    assert.equal((rendered.match(/type="checkbox"/g) || []).length, 4)
    assert.equal((rendered.match(/aria-label="任务已完成" checked/g) || []).length, 2)
    assert.equal((rendered.match(/aria-label="任务未完成"/g) || []).length, 2)
    assert.match(rendered, /<h1>/)
    assert.match(rendered, /<table>/)
    assert.match(rendered, /<img src="assets\/a\.png"/)
    assert.match(rendered, /<img src="assets\/b\.png" alt="" style="zoom:50%">/)
  }
})

test('only actual list items become checkboxes, never raw HTML or code', () => {
  const markdown = new MarkdownIt({ html: false })
  enableTaskMarkers(markdown)
  const html = markdown.render('[x] ordinary text\n\n```md\n- [x] code\n```\n\n<input type="checkbox" onclick="alert(1)">')
  assert.match(html, /\[x\] ordinary text/)
  assert.match(html, /\[x\] code/)
  assert.doesNotMatch(html, /<input\b/)
  assert.match(html, /&lt;input/)
})
