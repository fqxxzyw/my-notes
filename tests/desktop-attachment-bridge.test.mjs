import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ??= webcrypto
globalThis.location = { protocol: 'https:', hostname: 'paper.local', pathname: '/my-notes/index.html' }
const legacy = new Map(), files = new Map(), listeners = new Set()
globalThis.indexedDB = {
  open() {
    const request = {}
    request.result = {
      objectStoreNames: { contains: () => true }, close() {},
      transaction() {
        const tx = { objectStore: () => ({
          get(key) { const req = {}; queueMicrotask(() => { req.result = legacy.get(key); req.onsuccess?.() }); return req },
          put(value, key) { legacy.set(key, value); queueMicrotask(() => tx.oncomplete?.()) }
        }) }
        return tx
      }
    }
    queueMicrotask(() => request.onsuccess?.())
    return request
  }
}
const bridge = {
  addEventListener(_type, callback) { listeners.add(callback) },
  removeEventListener(_type, callback) { listeners.delete(callback) },
  postMessage(message) {
    const key = `${message.repository}\0${message.path}`
    let reply = { channel: 'paper-notes', id: message.id, ok: true }
    if (message.action === 'attachment.get') reply.data = files.get(key) ?? null
    else if (files.has(key) && files.get(key) !== message.data) reply = { ...reply, ok: false, error: '图片路径已存在不同内容' }
    else files.set(key, message.data)
    queueMicrotask(() => { for (const listener of listeners) listener({ data: reply }) })
  }
}
globalThis.window = { chrome: { webview: bridge } }
const compiled = await build({ entryPoints: ['docs/.vitepress/theme/attachmentStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { putAttachment, getAttachment } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`)
const path = `docs/notebooks/book/assets/${'c'.repeat(32)}.png`
const png = Uint8Array.from([137,80,78,71,13,10,26,10,1])
const altered = Uint8Array.from([137,80,78,71,13,10,26,10,2])

test('desktop stores real files via bridge and preserves a legacy IndexedDB image', async () => {
  legacy.set(`alice/notes\0${path}`, { path, bytes: png.slice().buffer })
  assert.deepEqual((await getAttachment('Alice/Notes', path)).bytes, png)
  assert.equal(files.get(`alice/notes\0${path}`), Buffer.from(png).toString('base64'))
  assert.ok(legacy.has(`alice/notes\0${path}`), 'migration must not delete the old image')
  await assert.rejects(putAttachment('alice/notes', { path, bytes: altered }), /不同内容/)
  assert.deepEqual((await getAttachment('alice/notes', path)).bytes, png)
  assert.equal(await getAttachment('other/notes', path), null)
})

test('desktop writes do not require the Markdown to store image bytes', async () => {
  const anotherPath = path.replace('cccccccccccccccccccccccccccccccc', 'dddddddddddddddddddddddddddddddd')
  await putAttachment('', { path: anotherPath, bytes: png })
  assert.equal(files.get(`\0${anotherPath}`), Buffer.from(png).toString('base64'))
  assert.deepEqual((await getAttachment('', anotherPath)).bytes, png)
})
