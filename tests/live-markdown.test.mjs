import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { markdownEditorLanguage } from '../docs/.vitepress/theme/editorHighlight.js'
import { emptyInlineDeletion, visibleInlineEditPosition } from '../docs/.vitepress/theme/inlineDeletion.js'

const bundled = await build({ entryPoints: ['docs/.vitepress/theme/liveMarkdown.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { markdownBlocks, markdownEnvironment, sourceOffsetForText, rawOffsetForTextarea, textareaOffsetForRaw, applyTextareaChange, tableCellRange, replaceInlineImage, renderInlineMarkdown, revealInlineMarker } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)

test('inline closing marks hide immediately at the end without changing the source', () => {
  for (const [source, name] of [['`repr`', 'InlineCode'], ['**粗体**', 'StrongEmphasis'], ['*斜体*', 'Emphasis'], ['~~删除~~', 'Strikethrough']]) {
    const state = EditorState.create({ doc: source, extensions: [markdownEditorLanguage] })
    let marker
    syntaxTree(state).iterate({ enter(node) { if (node.name === name) marker = node.node.lastChild } })
    assert.ok(marker, `${name} must parse`)
    assert.equal(revealInlineMarker([{ from: marker.to, to: marker.to }], marker.from, marker.to), false, `${name} closed at caret`)
    assert.equal(revealInlineMarker([{ from: marker.from, to: marker.from }], marker.from, marker.to), false, `${name} caret before closing`)
    assert.equal(revealInlineMarker([{ from: marker.from, to: marker.to }], marker.from, marker.to), true, `${name} selected mark`)
    if (marker.to - marker.from > 1) assert.equal(revealInlineMarker([{ from: marker.from + 1, to: marker.from + 1 }], marker.from, marker.to), true, `${name} cursor inside mark`)
    assert.equal(state.doc.toString(), source)
  }
  assert.equal(revealInlineMarker([{ from: 0, to: 1 }, { from: 4, to: 6 }], 5, 7), true)
})

test('backspace and delete target visible text across hidden nested and link marks', () => {
  for (const [source, before, after] of [['`repr`', 1, 5], ['**粗体**', 2, 4], ['***文本***', 3, 5], ['~~删除~~', 2, 4], ['[链接](https://example.com)', 1, 3]]) {
    const state = EditorState.create({ doc: source, extensions: [markdownEditorLanguage] })
    assert.equal(visibleInlineEditPosition(state, source.length, -1), after, `${source} backspace`)
    assert.equal(visibleInlineEditPosition(state, 0, 1), before, `${source} delete`)
    assert.equal(visibleInlineEditPosition(state, before, -1), 0, `${source} skips opening on backspace`)
    assert.equal(visibleInlineEditPosition(state, after, 1), source.length, `${source} skips closing on delete`)
  }
  const state = EditorState.create({ doc: '`前😀后`!', extensions: [markdownEditorLanguage] })
  assert.equal(visibleInlineEditPosition(state, state.doc.length, -1), null, 'normal text after markup remains normal')
})

test('removing the last visible grapheme removes only empty formatting wrappers', () => {
  for (const source of ['`a`', '**a**', '*a*', '~~a~~', '***a***', '**`a`**', '**e\u0301**', '**😀**']) {
    const state = EditorState.create({ doc: source, extensions: [markdownEditorLanguage] })
    assert.deepEqual(emptyInlineDeletion(state, source.length, -1), { from: 0, to: source.length }, `${source} backspace`)
    assert.deepEqual(emptyInlineDeletion(state, 0, 1), { from: 0, to: source.length }, `${source} delete`)
  }
  const mixed = '开始 **长 *a*** 后'
  const state = EditorState.create({ doc: mixed, extensions: [markdownEditorLanguage] })
  const end = mixed.indexOf(' 后')
  const edit = emptyInlineDeletion(state, end, -1)
  assert.equal(mixed.slice(0, edit.from) + (edit.text || '') + mixed.slice(edit.to), '开始 **长**  后')
  const link = '[a](https://example.com)'
  assert.equal(emptyInlineDeletion(EditorState.create({ doc: link, extensions: [markdownEditorLanguage] }), link.length, -1), null)
  const multi = '**ab**'
  assert.equal(emptyInlineDeletion(EditorState.create({ doc: multi, extensions: [markdownEditorLanguage] }), multi.length, -1), null)
})

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

test('embedded clipboard images render as Markdown and unsafe data URLs stay blocked', () => {
  const safe = '![图片](data:image/png;base64,iVBORw0KGgo=)'
  assert.match(renderInlineMarkdown(safe), /<img[^>]*src="data:image\/png;base64,iVBORw0KGgo="/)
  assert.match(markdownBlocks(safe)[0].html, /<img[^>]*src="data:image\/png;base64,iVBORw0KGgo="/)
  assert.doesNotMatch(renderInlineMarkdown('![bad](data:image/svg+xml;base64,PHN2Zz4=)'), /src="data:image\/svg/)
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
