import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundled = await build({ entryPoints: ['docs/.vitepress/theme/attachmentRestore.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { finishAttachmentRestore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
const images = [{ path: 'first', bytes: new Uint8Array([1]) }, { path: 'second', bytes: new Uint8Array([2]) }]

test('refuses publishing a restored snapshot if the local workspace changes while saving an image', async () => {
  let current = true
  const written = []
  await assert.rejects(finishAttachmentRestore(images, 'head', {
    async put(image) { written.push(image.path); current = false },
    async readHead() { return 'head' },
    isCurrent() { return current }
  }), /本机目录发生变化/)
  assert.deepEqual(written, ['first'])
})

test('rechecks remote head after slow image writes before publishing a snapshot', async () => {
  let head = 'before'
  await assert.rejects(finishAttachmentRestore(images, head, {
    async put() { head = 'after' },
    async readHead() { return head },
    isCurrent() { return true }
  }), /GitHub 内容发生变化/)
  await assert.doesNotReject(finishAttachmentRestore(images, 'after', {
    async put() {}, async readHead() { return 'after' }, isCurrent() { return true }
  }))
})
