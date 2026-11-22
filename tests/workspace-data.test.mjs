import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const result = await build({ entryPoints: ['docs/.vitepress/theme/workspaceData.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { hasUserData } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)

test('a description-only workspace is recognized as user data for source and target checks', () => {
  const descriptionOnly = JSON.stringify({ books: [], chapters: [], synced: {}, bookDescriptionDrafts: { book: { base: { id: 'book' }, description: '尚未同步' } } })
  assert.equal(hasUserData('paper-notes-local-collection', descriptionOnly), true)
  assert.equal(hasUserData('repo:paper-notes-local-collection', descriptionOnly), true)
  assert.equal(hasUserData('paper-notes-local-collection', JSON.stringify({ books: [], chapters: [], synced: {}, bookDescriptionDrafts: {} })), false)
})

test('other existing workspace and conservative corrupt-data checks are preserved', () => {
  assert.equal(hasUserData('paper-notes-draft:book:chapter', '{}'), true)
  assert.equal(hasUserData('repo:paper-notes:cabinets:v1', '{"moves":{"book":"shelf"}}'), true)
  assert.equal(hasUserData('repo:paper-notes-local-collection', '{bad json'), true)
})
