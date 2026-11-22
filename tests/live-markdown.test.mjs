import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { EditorState } from '@codemirror/state'

const bundled = await build({ entryPoints: ['docs/.vitepress/theme/liveMarkdown.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { markdownBlocks, sourceOffsetForText, rawOffsetForTextarea, textareaOffsetForRaw, applyTextareaChange } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)

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
