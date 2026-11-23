import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundled = await build({ entryPoints: ['docs/.vitepress/theme/attachmentReferences.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { attachmentReferences, workspaceAttachmentPaths, workspaceEntriesMatch } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
const id = '0123456789abcdef0123456789abcdef'
const image = `assets/${id}.png`

test('finds real Markdown image references relative to their own notebook', () => {
  const text = `![粘贴](${image})\n![引用][pic]\n\n[pic]: ./${image}\n\n\`\`\`md\n![不上传](${image})\n\`\`\`\n[普通链接](${image})\n![外部](https://example.com/a.png)`
  assert.deepEqual(attachmentReferences(text, 'book1'), [
    { src: image, path: `docs/notebooks/book1/${image}` },
    { src: `./${image}`, path: `docs/notebooks/book1/${image}` }
  ])
  assert.deepEqual(attachmentReferences(`![图](${image})`, null), [{ src: image, path: `docs/pages/${image}` }])
})

test('workspace copy finds notebook and standalone page draft references without copying arbitrary text', () => {
  const entries = [
    ['collection', JSON.stringify({ books: [{ id: 'page_pageid', kind: 'page' }, { id: 'book' }], chapters: [{ bookId: 'book', content: `![图](${image})` }] })],
    ['draft', JSON.stringify({ base: { bookId: 'page_pageid' }, content: `![图](${image})` })]
  ]
  assert.deepEqual(workspaceAttachmentPaths(entries).sort(), [`docs/notebooks/book/${image}`, `docs/pages/${image}`])
  assert.throws(() => workspaceAttachmentPaths([['collection', '{invalid']]), /无法读取/)
})

test('workspace copy detects concurrent edits and new drafts after reading attachments', () => {
  const source = [['collection', '{"books":[]}'], ['draft', '{"content":"原文"}']]
  assert.equal(workspaceEntriesMatch(source, [...source].reverse()), true)
  assert.equal(workspaceEntriesMatch(source, [source[0], ['draft', '{"content":"修改"}']]), false)
  assert.equal(workspaceEntriesMatch(source, [...source, ['newDraft', '{}']]), false)
  assert.equal(workspaceEntriesMatch(source, [source[0]]), false)
})
