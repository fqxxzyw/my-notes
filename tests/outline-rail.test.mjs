import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['docs/.vitepress/theme/outlineRail.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { nearestHeadingIndex } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)

test('empty outlines have no target', () => assert.equal(nearestHeadingIndex([], 42), -1))

test('the position maps to the nearest actual source offset, including repeated titles', () => {
  const headings = [{ title: '相同', offset: 4, level: 1 }, { title: '相同', offset: 25, level: 2 }, { title: '末尾', offset: 500, level: 1 }]
  assert.equal(nearestHeadingIndex(headings, 0), 0)
  assert.equal(nearestHeadingIndex(headings, 24), 1)
  assert.equal(nearestHeadingIndex(headings, 25), 1)
  assert.equal(nearestHeadingIndex(headings, 1000), 2)
})

test('dense and long outlines retain every keyboard-reachable heading', () => {
  const headings = Array.from({ length: 5000 }, (_, i) => ({ title: `标题 ${i}`, offset: i * 2, level: 1 }))
  assert.equal(nearestHeadingIndex(headings, 8278), 4139)
})
