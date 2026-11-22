import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { EditorState } from '@codemirror/state'

const bundled = await build({ entryPoints: ['docs/.vitepress/theme/liveMarkdown.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { markdownBlocks, markdownEnvironment, sourceOffsetForText, rawOffsetForTextarea, textareaOffsetForRaw, applyTextareaChange, tableCellRange, replaceInlineImage, renderInlineMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)

test('the editor document retains mixed newlines and unknown Markdown exactly', () => {
  const source = '# 标题\r\n\r\n文字 **粗体**\n\n::: custom\r\n<raw> & text\r\n:::\n'
  const state = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of('\n')] })
  assert.equal(state.doc.toString(), source)
  const next = state.update({ selection: { anchor: source.indexOf('custom') } }).state
  assert.equal(next.doc.toString(), source)
  assert.equal(markdownBlocks(source).map(block => source.slice(block.from, block.to)).every((raw, i) => raw === markdownBlocks(source)[i].source), true)
})

test('renders common blocks while retaining their source offsets', () => {
  const source = '# 一级\n\n**粗体** 和 *斜体*、`代码`、[链接](https://example.com)\n\n- [x] 已完成\n- [ ] 待办\n\n> 引用\n\n```js\nconst n = 1\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 一 | 二 |\n'
  const blocks = markdownBlocks(source)
  assert.equal(blocks.length, 6)
  for (const block of blocks) assert.equal(source.slice(block.from, block.to), block.source)
  const html = blocks.map(block => block.html).join('')
  for (const fragment of ['<h1>', '<strong>', '<em>', '<code>', '<a ', '<blockquote>', '<pre>', '<table>', 'type="checkbox"', 'checked']) assert.ok(html.includes(fragment), fragment)
})

test('visual editing leaves prose, lists and image-containing paragraphs as native lines', () => {
  const blocks = markdownBlocks('# 标题\n\n文字 **加粗** 与 [链接](https://example.com)\n\n- 一项\n- [x] 完成\n\n![图片](photo.png)\n')
  assert.deepEqual(blocks.map(block => [block.type, block.direct]), [
    ['heading_open', true], ['paragraph_open', true], ['bullet_list_open', true], ['paragraph_open', true]
  ])
})

test('table cell edits locate only plain target text and preserve other cells', () => {
  const raw = '| 姓名 | 内容 |\r\n| --- | --- |\r\n| 甲 | 两个字 |\r\n| **乙** | `代码` |'
  const target = tableCellRange(raw, 1, 1)
  assert.equal(raw.slice(target.from, target.to), '两个字')
  assert.equal(raw.slice(0, target.from) + '新内容' + raw.slice(target.to), raw.replace('两个字', '新内容'))
  assert.equal(tableCellRange(raw, 2, 0), null)
  assert.equal(tableCellRange(raw, 2, 1), null)
  assert.equal(tableCellRange(raw, 100, 0), null)
})

test('image editing preserves titles and rejects unsafe unsupported structures', () => {
  const updated = replaceInlineImage('![原图](images/a.png "说明")', '描述]', 'images/b.png')
  assert.equal(updated, '![描述\\]](<images/b.png> "说明")')
  assert.equal(replaceInlineImage('![图][reference]', '图', 'a.png'), null)
  assert.equal(replaceInlineImage('![图](a.png)', '图', 'bad\nurl'), null)
  assert.ok(!renderInlineMarkdown('![bad](javascript:alert(1))').includes('src="javascript:'))
})

test('reference images use the current document definitions without changing source', () => {
  const one = '![ref][id]\n\n[id]: https://example.com/a.png'
  const two = one.replace('a.png', 'b.png')
  assert.match(renderInlineMarkdown('![ref][id]', markdownEnvironment(one)), /src="https:\/\/example\.com\/a\.png"/)
  assert.match(renderInlineMarkdown('![ref][id]', markdownEnvironment(two)), /src="https:\/\/example\.com\/b\.png"/)
  assert.equal(replaceInlineImage('![ref][id]', 'ref', 'x.png'), null)
})

test('block offsets remain exact with mixed CR-only, CRLF, LF and emoji', () => {
  const source = '# 😀 标题\r\n\r正文\r\n\n```js\rlet x = 1;\r```\n\n结尾'
  const blocks = markdownBlocks(source)
  assert.deepEqual(blocks.map(block => block.source), ['# 😀 标题', '正文', '```js\rlet x = 1;\r```', '结尾'])
  assert.ok(blocks.every(block => source.slice(block.from, block.to) === block.source))
})

test('never turns raw HTML or unsafe links into executable markup', () => {
  const html = markdownBlocks('<script>alert(1)</script>\n\n[bad](javascript:alert(1))').map(block => block.html).join('')
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('href="javascript:'))
})

test('click mapping is bounded and uses UTF-16 offsets', () => {
  const source = '# 😀 标题 **粗体**'
  const offset = sourceOffsetForText(source, '😀 标题')
  assert.equal(source.slice(offset).startsWith(' **粗体**'), true)
  assert.ok(sourceOffsetForText(source, '不存在') <= source.length)
})

test('native fallback editing preserves untouched mixed newline bytes', () => {
  const raw = '甲\r\n乙\n丙\r丁😀'
  assert.equal(rawOffsetForTextarea(raw, 2), 3)
  assert.equal(textareaOffsetForRaw(raw, 3), 2)
  assert.equal(applyTextareaChange(raw, '甲\n乙字\n丙\n丁😀'), '甲\r\n乙字\n丙\r丁😀')
  assert.equal(applyTextareaChange('甲\r\n乙', '甲\n新\n乙'), '甲\r\n新\r\n乙')
})
