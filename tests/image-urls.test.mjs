import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['docs/.vitepress/theme/imageUrls.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { applyImageUrls, originalImageSource } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)

function image(source) {
  const attrs = { src: source }
  return { dataset: {}, getAttribute: key => attrs[key] ?? null, setAttribute: (key, value) => { attrs[key] = value }, removeAttribute: key => { delete attrs[key] } }
}
function root(...images) { return { querySelectorAll: () => images } }

test('local image references hydrate without replacing their Markdown destinations', () => {
  const src = `assets/${'a'.repeat(32)}.png`
  const local = image(src)
  applyImageUrls(root(local), {})
  assert.equal(local.getAttribute('src'), null)
  assert.equal(originalImageSource(local), src)
  applyImageUrls(root(local), { [src]: 'blob:https://paper.local/example' })
  assert.equal(local.getAttribute('src'), 'blob:https://paper.local/example')
  assert.equal(originalImageSource(local), src)
  applyImageUrls(root(local), {})
  assert.equal(local.getAttribute('src'), null)
})

test('remote and legacy data images stay unchanged and unsafe substitutes are rejected', () => {
  const remote = image('https://example.com/image.png')
  const legacy = image('data:image/png;base64,AAAA')
  const local = image('assets/a.png')
  applyImageUrls(root(remote, legacy, local), { 'assets/a.png': 'javascript:alert(1)' })
  assert.equal(remote.getAttribute('src'), 'https://example.com/image.png')
  assert.equal(legacy.getAttribute('src'), 'data:image/png;base64,AAAA')
  assert.equal(local.getAttribute('src'), null)
})
