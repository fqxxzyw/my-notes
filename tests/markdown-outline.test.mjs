import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/markdownOutline.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { markdownOutline } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)

test('recognizes rendered heading text and exact source offsets, including CRLF', () => {
  const source = '# 第一章\r\n文字\r\n## **安装** 和 `代码`\r\n下一节\r\n---\r\n'
  const headings = markdownOutline(source)
  assert.deepEqual(headings.map(({ level, title }) => [level, title]), [[1, '第一章'], [2, '安装 和 代码'], [2, '下一节']])
  assert.deepEqual(headings.map(item => source.slice(item.offset).split(/\r?\n/)[0]), ['# 第一章', '## **安装** 和 `代码`', '下一节'])
})

test('does not treat fenced or indented code as headings', () => {
  const source = '# 真标题\n```md\n# 示例不是标题\n```\n    # 缩进代码\n~~~\n## 也不是\n~~~\n### 最后\n'
  assert.deepEqual(markdownOutline(source).map(item => item.title), ['真标题', '最后'])
})

test('preserves UTF-16 offsets following non-BMP characters', () => {
  const source = '😀 内容\n## [链接](https://example.com)\n'
  const [heading] = markdownOutline(source)
  assert.equal(heading.title, '链接')
  assert.equal(heading.offset, source.indexOf('## '))
})

test('handles CR-only and mixed CRLF line endings without shifting offsets', () => {
  const source = '# 一\r正文\r## 二\r### 三\r\n内容\n#### 四\r'
  const headings = markdownOutline(source)
  assert.deepEqual(headings.map(item => source.slice(item.offset).split(/\r\n|\r|\n/)[0]), ['# 一', '## 二', '### 三', '#### 四'])
})

test('keeps distinct offsets for repeated identical headings', () => {
  const source = '# 相同标题\n正文\n# 相同标题\n'
  const headings = markdownOutline(source)
  assert.equal(headings.length, 2)
  assert.equal(headings[0].offset, 0)
  assert.equal(headings[1].offset, source.lastIndexOf('# 相同标题'))
})

test('does not treat front matter as headings and retains exact content offsets', () => {
  const source = '\uFEFF---\r\ntitle: 😀 note\r\n---\r\n# 实际标题\r\n'
  const headings = markdownOutline(source)
  assert.deepEqual(headings.map(item => item.title), ['实际标题'])
  assert.equal(headings[0].offset, source.indexOf('# 实际标题'))
})
