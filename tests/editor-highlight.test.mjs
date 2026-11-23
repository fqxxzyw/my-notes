import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { syntaxTree, syntaxHighlighting } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { markdownEditorLanguage, sourceMarkdownHighlight, visualCodeHighlight } from '../docs/.vitepress/theme/editorHighlight.js'

function highlighted(source, style = sourceMarkdownHighlight) {
  const state = EditorState.create({ doc: source, extensions: [markdownEditorLanguage, syntaxHighlighting(style)] })
  const spans = []
  highlightTree(syntaxTree(state), style, (from, to, classes) => spans.push({ text: source.slice(from, to), classes }))
  return spans
}

test('source mode highlights Markdown syntax and heading text', () => {
  const source = '# 一级\n\n## 二级\n\n**粗体** *斜体* `行内` [链接](https://example.com)\n\n- 列表\n\n> 引用\n\n```python\nprint("你好")\n```'
  const spans = highlighted(source)
  for (const text of ['#', ' 一级', '##', ' 二级', '**', '粗体', '*', '斜体', '`', '行内', '[', '链接', 'https://example.com', '-', '>', '```', 'python']) {
    assert.ok(spans.some(span => span.text === text && span.classes), `missing highlight: ${text}`)
  }
  assert.notEqual(spans.find(span => span.text === ' 一级').classes, spans.find(span => span.text === '**').classes)
})

test('source and visual modes highlight embedded code with language-specific tokens', () => {
  const source = '```PYTHON extra\n# 注释\nvalue = 42\nprint("你好")\n```\n\n```js\nconst n = 1\n```\n\n```sql\nSELECT name FROM notes\n```'
  for (const style of [sourceMarkdownHighlight, visualCodeHighlight]) {
    const spans = highlighted(source, style)
    for (const text of ['# 注释', '42', 'print', '"你好"', 'const', 'SELECT']) {
      assert.ok(spans.some(span => span.text === text && span.classes), `missing code highlight: ${text}`)
    }
    assert.notEqual(spans.find(span => span.text === '42').classes, spans.find(span => span.text === '"你好"').classes)
  }
})

test('unknown languages, empty blocks and long lines keep their original text', () => {
  const source = '## 保留\r\n\r\n```unknown\r\n' + '很长的文本 '.repeat(300) + '\r\n```\r\n\r\n```python\r\n```\r\n'
  const state = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of('\n'), markdownEditorLanguage, syntaxHighlighting(sourceMarkdownHighlight)] })
  assert.equal(state.doc.toString(), source)
  assert.doesNotThrow(() => highlightTree(syntaxTree(state), sourceMarkdownHighlight, () => {}))
})

test('highlighting preserves normal edits, selections and undo history', () => {
  let state = EditorState.create({ doc: '# 标题\n\n中文', extensions: [history(), markdownEditorLanguage, syntaxHighlighting(sourceMarkdownHighlight)] })
  state = state.update({ changes: { from: state.doc.length, insert: '输入' }, selection: { anchor: state.doc.length + 2 } }).state
  assert.equal(state.doc.toString(), '# 标题\n\n中文输入')
  const target = { state, dispatch: tr => { target.state = tr.state } }
  assert.equal(undo(target), true)
  assert.equal(target.state.doc.toString(), '# 标题\n\n中文')
})
