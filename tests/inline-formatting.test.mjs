import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { markdownEditorLanguage } from '../docs/.vitepress/theme/editorHighlight.js'
import { toggleInlineFormat } from '../docs/.vitepress/theme/inlineFormatting.js'

function apply(source, start, end, kind) {
  const change = toggleInlineFormat(source, start, end, kind)
  assert.ok(change, 'format operation must be available')
  return { source: source.slice(0, change.from) + change.text + source.slice(change.to), start: change.selectionStart, end: change.selectionEnd }
}
function tree(source) {
  return syntaxTree(EditorState.create({ doc: source, extensions: [markdownEditorLanguage] })).toString()
}

test('bold toggles without accumulating markers and preserves whitespace', () => {
  const input = '在这里  实时天气: location 必选  后面'
  const first = apply(input, 3, input.length - 2, 'bold')
  assert.match(first.source, /\*\*实时天气: location 必选\*\*/)
  assert.match(tree(first.source), /StrongEmphasis/)
  assert.equal(first.source.slice(first.start, first.end), '实时天气: location 必选')
  const second = apply(first.source, first.start, first.end, 'bold')
  assert.equal(second.source, input)
  const third = apply(second.source, second.start, second.end, 'bold')
  assert.equal(third.source, first.source)
})

test('accepts fully selected delimiters and underscores, preserving nested styles', () => {
  assert.equal(apply('__测试__', 0, 6, 'bold').source, '测试')
  assert.equal(apply(' **测试** ', 0, 8, 'bold').source, ' 测试 ')
  assert.equal(apply('***文本***', 3, 5, 'bold').source, '*文本*')
  assert.equal(apply('***文本***', 3, 5, 'italic').source, '**文本**')
  assert.equal(apply('~~测试~~', 2, 4, 'strike').source, '测试')
  assert.equal(apply('`测试`', 1, 3, 'inline-code').source, '测试')
})

test('partially unbolding plain text retains formatting on either side', () => {
  const source = '**one two three**'
  const result = apply(source, 6, 9, 'bold')
  assert.equal(result.source, '**one** two **three**')
  assert.equal(result.source.slice(result.start, result.end), 'two')
  const nested = '**one *two* three**'
  assert.equal(toggleInlineFormat(nested, 2, 5, 'bold'), null)
})

test('selecting mixed strong and plain text creates one valid strong span', () => {
  const source = '**甲** 和 乙'
  const result = apply(source, 0, source.length, 'bold')
  assert.equal(result.source, '**甲 和 乙**')
  assert.match(tree(result.source), /StrongEmphasis/)
})

test('inline code chooses a safe delimiter for selected backticks', () => {
  const source = '`example`'
  const result = apply(source, 0, source.length, 'inline-code')
  // The exact existing span toggles off.
  assert.equal(result.source, 'example')
  const raw = 'before `a` after'
  const change = apply(raw, 7, raw.length, 'inline-code')
  assert.match(tree(change.source), /InlineCode/)
  assert.equal(change.source.slice(change.start, change.end), '`a` after')
  assert.equal(apply(change.source, change.start, change.end, 'inline-code').source, raw)
})

test('multiline content and empty/whitespace selections never lose bytes', () => {
  const source = '甲\n乙'
  const result = apply(source, 0, source.length, 'bold')
  assert.equal(apply(result.source, result.start, result.end, 'bold').source, source)
  assert.equal(apply('   ', 0, 3, 'bold').source, '   ')
  assert.equal(apply('甲', 1, 1, 'bold').source, '甲**文字**')
})

test('never strips partially selected markup or treats stars in code as strong delimiters', () => {
  const source = '开始 **bold** 结束'
  assert.equal(toggleInlineFormat(source, 0, 7, 'bold'), null)
  const fenced = '```python\n**foo**\n```'
  const start = fenced.indexOf('**foo**')
  assert.equal(toggleInlineFormat(fenced, start, start + 7, 'bold'), null)
  assert.equal(toggleInlineFormat('第一段\n\n第二段', 0, 8, 'bold'), null)
})
