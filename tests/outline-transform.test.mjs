import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/outlineTransform.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { moveOutlineSection, shiftOutlineSection } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)

test('move a section under another heading, retaining its children and all body text', () => {
  const input = '# A\r\n段落😀\r\n## A 子\r\n```md\r\n# 不改代码\r\n```\r\n# B\r\nB 内容\r\n# C\r\n结束\r\n'
  const actual = moveOutlineSection(input, 0, input.indexOf('# B')).text
  assert.equal(actual, '# B\r\nB 内容\r\n## A\r\n段落😀\r\n### A 子\r\n```md\r\n# 不改代码\r\n```\r\n# C\r\n结束\r\n')
})

test('moves sections up and handles final lines without trailing newline', () => {
  const input = '# First\nbody\n# Second\nsecond body\n# Third\nlast'
  const result = moveOutlineSection(input, input.indexOf('# Third'), input.indexOf('# First')).text
  assert.equal(result, '# First\nbody\n## Third\nlast\n# Second\nsecond body\n')
})

test('rejects moving into itself, excessive depth and headings in quoted blocks', () => {
  const input = '# A\n## A1\n###### deepest\n# B\n'
  assert.throws(() => moveOutlineSection(input, 0, input.indexOf('## A1')), /自身/)
  assert.throws(() => moveOutlineSection(input, 0, input.indexOf('# B')), /六级/)
  assert.throws(() => shiftOutlineSection('> # 引用\n', 0, 1), /普通标题/)
})

test('single-line Setext headings preserve content and line endings when demoted', () => {
  const input = '一 *标题*\r\n=====\r\n正文\r\n\r\n二\r\n---\r\n内容\r\n'
  assert.equal(shiftOutlineSection(input, 0, 1).text, '## 一 *标题*\r\n正文\r\n\r\n### 二\r\n内容\r\n')
  assert.throws(() => shiftOutlineSection('多行\n标题\n===\n正文\n', 0, 1), /多行 Setext/)
})

test('duplicate titles use exact offsets; CR-only and missing final newline survive', () => {
  const input = '# 相同\r一\r# 相同\r二\r'
  assert.equal(moveOutlineSection(input, input.lastIndexOf('# 相同'), 0).text, '# 相同\r一\r## 相同\r二\r')
  assert.equal(shiftOutlineSection('## A\r正文', 0, -1).text, '# A\r正文')
})

test('YAML front matter remains byte-for-byte unchanged, including CRLF and emoji', () => {
  const meta = '---\r\ntitle: 😀 Keep\r\n---\r\n'
  const input = `${meta}\r\n# A\r\n正文\r\n# B\r\n内容\r\n`
  assert.equal(moveOutlineSection(input, input.indexOf('# B'), input.indexOf('# A')).text, `${meta}\r\n# A\r\n正文\r\n## B\r\n内容\r\n`)
  assert.throws(() => shiftOutlineSection(input, input.indexOf('title:'), 1), /普通标题/)
})

test('refuses moves that would let an unclosed code fence swallow other headings', () => {
  const input = '# A\ntext\n# C\ntext\n# B\n```js\nopen'
  assert.throws(() => moveOutlineSection(input, input.indexOf('# B'), 0), /意外变化/)
})

test('does not reorganize headings when opening front matter has no closing marker', () => {
  const input = '---\ntitle: metadata\n# A\nbody\n# B\nlast'
  assert.throws(() => moveOutlineSection(input, input.indexOf('# B'), input.indexOf('# A')), /front matter 尚未闭合/)
  assert.throws(() => shiftOutlineSection(input, input.indexOf('# A'), 1), /front matter 尚未闭合/)
})
