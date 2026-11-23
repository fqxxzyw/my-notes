import { normalizeRepository } from './repository'

/** Managed images have immutable, random file names so references may be shared safely. */
export type NoteAttachment = { path: string; bytes: Uint8Array; sha?: string }
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MANAGED_PATH = /^docs\/(?:notebooks\/[A-Za-z0-9_-]+|pages)\/assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/
const MIME_EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

export function validateAttachmentPath(path: string): string {
  if (typeof path !== 'string' || !MANAGED_PATH.test(path)) throw new Error('图片附件路径无效。')
  return path
}

export function newAttachmentPath(bookId: string | null, mime: string): string {
  const ext = MIME_EXTENSION[mime]
  if (!ext) throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片。')
  if (bookId !== null && !/^[A-Za-z0-9_-]+$/.test(bookId)) throw new Error('笔记本标识无效。')
  return validateAttachmentPath(`docs/${bookId === null ? 'pages' : `notebooks/${bookId}`}/assets/${crypto.randomUUID().replaceAll('-', '')}.${ext}`)
}

export function validateAttachment(attachment: NoteAttachment): NoteAttachment {
  validateAttachmentPath(attachment.path)
  if (!(attachment.bytes instanceof Uint8Array) || !attachment.bytes.length || attachment.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('图片为空或超过 20 MiB，请缩小后重试。')
  const b = attachment.bytes
  const ext = attachment.path.slice(attachment.path.lastIndexOf('.') + 1)
  const png = b.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => b[i] === v)
  const jpg = b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
  const gif = b.length >= 6 && String.fromCharCode(...b.slice(0, 6)).match(/^GIF8[79]a$/)
  const webp = b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
  if (!(ext === 'png' && png || ext === 'jpg' && jpg || ext === 'gif' && gif || ext === 'webp' && webp)) throw new Error('图片内容与文件格式不匹配。')
  if (attachment.sha !== undefined && !/^[a-f0-9]{40}$/.test(attachment.sha)) throw new Error('图片版本号无效。')
  return attachment
}

export function attachmentMime(path: string): string {
  validateAttachmentPath(path)
  const ext = path.slice(path.lastIndexOf('.') + 1)
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
}

const DATABASE = 'paper-notes-attachments-v1'
const OBJECT_STORE = 'images'
function key(repository: string | null | undefined, path: string): string {
  return `${repository ? normalizeRepository(repository) : ''}\0${validateAttachmentPath(path)}`
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('本机图片存储不可用。')); return }
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法打开本机图片存储。'))
    request.onblocked = () => reject(new Error('本机图片存储正被其他页面占用。'))
  })
}

/** Resolve only when the transaction has committed; quota failures do not insert links. */
async function putIndexedAttachment(repository: string | null | undefined, attachment: NoteAttachment): Promise<void> {
  validateAttachment(attachment)
  const entryKey = key(repository, attachment.path)
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OBJECT_STORE, 'readwrite')
      const store = tx.objectStore(OBJECT_STORE)
      let collision = false
      const existing = store.get(entryKey)
      existing.onsuccess = () => {
        if (existing.result !== undefined) {
          const old = existing.result
          if (old.path !== attachment.path || !(old.bytes instanceof ArrayBuffer)) { collision = true; tx.abort(); return }
          const prior = new Uint8Array(old.bytes)
          if (prior.length !== attachment.bytes.length || prior.some((value, index) => value !== attachment.bytes[index])) { collision = true; tx.abort(); return }
        }
        store.put({ path: attachment.path, bytes: attachment.bytes.slice().buffer, ...(attachment.sha ? { sha: attachment.sha } : {}) }, entryKey)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error(collision ? '图片路径已存在不同内容，已保留原文件。' : '无法保存图片附件，请检查磁盘空间或浏览器存储权限。'))
    })
  } finally { db.close() }
}

async function getIndexedAttachment(repository: string | null | undefined, path: string): Promise<NoteAttachment | null> {
  const entryKey = key(repository, path)
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(entryKey)
      request.onerror = () => reject(new Error('无法读取本机图片附件。'))
      request.onsuccess = () => {
        if (request.result === undefined) { resolve(null); return }
        try {
          const value = request.result
          if (value.path !== path || !(value.bytes instanceof ArrayBuffer)) throw new Error('invalid')
          resolve(validateAttachment({ path, bytes: new Uint8Array(value.bytes), ...(value.sha ? { sha: value.sha } : {}) }))
        } catch { reject(new Error('本机图片附件损坏，请从 GitHub 恢复。')) }
      }
    })
  } finally { db.close() }
}

type NativeBridge = {
  postMessage: (message: object) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

function desktopOrigin(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:' && location.hostname === 'paper.local' && (location.pathname === '/my-notes' || location.pathname.startsWith('/my-notes/'))
}

function desktopRequest(action: 'attachment.get' | 'attachment.put', repository: string | null | undefined, path: string, data?: string): Promise<string | null> {
  const bridge = (window as unknown as { chrome?: { webview?: NativeBridge } }).chrome?.webview
  if (!bridge) return Promise.reject(new Error('无法连接桌面图片存储，请重新启动纸间。'))
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge.removeEventListener('message', receive); reject(new Error('访问本机图片超时，请重试。')) }, 60000)
    const receive = (event: MessageEvent) => {
      const reply = event.data
      if (!reply || reply.channel !== 'paper-notes' || reply.id !== id) return
      clearTimeout(timer); bridge.removeEventListener('message', receive)
      if (!reply.ok) reject(new Error(typeof reply.error === 'string' ? reply.error : '无法访问本机图片。'))
      else if (reply.data === null || reply.data === undefined || typeof reply.data === 'string') resolve(reply.data ?? null)
      else reject(new Error('本机图片数据无效。'))
    }
    bridge.addEventListener('message', receive)
    try { bridge.postMessage({ channel: 'paper-notes', action, id, repository: repository ? normalizeRepository(repository) : '', path, ...(data === undefined ? {} : { data }) }) }
    catch { clearTimeout(timer); bridge.removeEventListener('message', receive); reject(new Error('无法连接桌面图片存储。')) }
  })
}

function encodeBytes(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)))
  return btoa(chunks.join(''))
}

function decodeBytes(encoded: string): Uint8Array {
  if (encoded.length > 28 * 1024 * 1024) throw new Error('本机图片超过 20 MiB。')
  let decoded: string
  try { decoded = atob(encoded) } catch { throw new Error('本机图片数据损坏。') }
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Desktop uses real immutable image files; websites retain IndexedDB storage. */
export async function putAttachment(repository: string | null | undefined, attachment: NoteAttachment): Promise<void> {
  validateAttachment(attachment)
  if (!desktopOrigin()) { await putIndexedAttachment(repository, attachment); return }
  // Never overwrite an older IndexedDB copy with different bytes during migration.
  const old = await getIndexedAttachment(repository, attachment.path)
  if (old && !sameBytes(old.bytes, attachment.bytes)) throw new Error('图片路径已存在不同内容，已保留原文件。')
  await desktopRequest('attachment.put', repository, attachment.path, encodeBytes(attachment.bytes))
}

export async function getAttachment(repository: string | null | undefined, path: string): Promise<NoteAttachment | null> {
  validateAttachmentPath(path)
  if (!desktopOrigin()) return getIndexedAttachment(repository, path)
  const encoded = await desktopRequest('attachment.get', repository, path)
  const current = encoded === null ? null : validateAttachment({ path, bytes: decodeBytes(encoded) })
  let old: NoteAttachment | null
  try { old = await getIndexedAttachment(repository, path) }
  catch (error) { if (current) return current; throw error }
  if (old && current && !sameBytes(old.bytes, current.bytes)) throw new Error('本机两份图片内容不同，已保留原文件，请备份后检查。')
  if (!current && old) {
    // The old IndexedDB record is retained until migration is confirmed.
    // If the disk is unavailable the existing copy remains readable.
    try { await desktopRequest('attachment.put', repository, path, encodeBytes(old.bytes)) } catch { /* retain readable old copy */ }
    return old
  }
  return current
}
