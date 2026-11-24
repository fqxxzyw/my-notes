import { localImageReferences } from './readDroppedMarkdown'
import type { DroppedImage, DroppedMarkdownResult, DroppedSkip } from './readDroppedMarkdown'
import { ALL_SUPPORTED_IMPORT_EXTENSIONS, BINARY_DOCUMENT_EXTENSIONS, documentMimeType, extractFileExtension, MAX_DOCUMENT_BYTES } from './documentFiles'

type NativeBridge = {
  postMessage: (message: object) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}
const maxImageBytes = 20 * 1024 * 1024
const maxTotalBytes = 100 * 1024 * 1024
const maxImages = 300
const maxTotalDocumentBytes = 200 * 1024 * 1024

function bridgeForDesktop(): NativeBridge | null {
  if (typeof location === 'undefined' || typeof window === 'undefined' || location.protocol !== 'https:' || location.hostname !== 'paper.local' || !(location.pathname === '/my-notes' || location.pathname.startsWith('/my-notes/'))) return null
  return (window as unknown as { chrome?: { webview?: NativeBridge } }).chrome?.webview || null
}

function nativeRequest(bridge: NativeBridge, action: string, args: Record<string, unknown> = {}, timeoutMs = 60000): Promise<any> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge.removeEventListener('message', receive); reject(new Error('读取文件超时。')) }, timeoutMs)
    const receive = (event: MessageEvent) => {
      const reply = event.data
      if (!reply || reply.channel !== 'paper-notes' || reply.id !== id) return
      clearTimeout(timer); bridge.removeEventListener('message', receive)
      if (!reply.ok) { reject(new Error(typeof reply.error === 'string' ? reply.error : '无法读取选择的文件。')); return }
      resolve(reply)
    }
    bridge.addEventListener('message', receive)
    try { bridge.postMessage({ channel: 'paper-notes', action, id, ...args }) }
    catch { clearTimeout(timer); bridge.removeEventListener('message', receive); reject(new Error('无法连接桌面图片读取器。')) }
  })
}

function decodeNativeBytes(value: unknown, limit: number, allowEmpty = false): Uint8Array | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4) throw new Error('读取的文件数据无效。')
  try {
    const decoded = atob(value)
    if ((!decoded.length && !allowEmpty) || decoded.length > limit) throw new Error('invalid')
    const bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
    return bytes
  } catch { throw new Error('读取的文件数据无效。') }
}

/** A native picker provides the actual MD directory for relative images.
 * Outside the Windows app null lets the normal browser picker take over.
 */
export async function pickDesktopMarkdownFiles(): Promise<File[] | null> {
  const bridge = bridgeForDesktop()
  if (!bridge) return null
  const response = await nativeRequest(bridge, 'import.pickMarkdownFiles', {}, 10 * 60 * 1000)
  if (!Array.isArray(response.paths) || response.paths.length > maxImages || response.paths.some((path: unknown) => typeof path !== 'string' || !/^[a-z]:[\\/].+\.md$/i.test(path))) throw new Error('选择的 Markdown 文件无效。')
  const files: File[] = []
  const names = new Set<string>()
  let total = 0
  for (const path of response.paths as string[]) {
    const name = path.split(/[\\/]/).pop()!
    if (names.has(name.toLocaleLowerCase())) throw new Error('选中的文件存在相同名称，请分批导入。')
    names.add(name.toLocaleLowerCase())
    const limit = Math.min(5 * 1024 * 1024, 30 * 1024 * 1024 - total)
    if (limit <= 0) throw new Error('Markdown 文件总大小超过 30 MiB。')
    const responseFile = await nativeRequest(bridge, 'import.readMarkdown', { path, maxBytes: String(limit) })
    const bytes = decodeNativeBytes(responseFile.data, limit, true)
    if (!bytes) throw new Error(`无法读取 Markdown 文件：${name}`)
    total += bytes.length
    const file = new File([bytes], name, { type: 'text/markdown' })
    Object.defineProperty(file, 'paperSourcePath', { value: path, enumerable: false })
    files.push(file)
  }
  return files
}

/** A folder grant preserves relative paths and reads each file lazily. */
export async function pickDesktopMarkdownFolder(): Promise<File[] | null> {
  const bridge = bridgeForDesktop()
  if (!bridge) return null
  const response = await nativeRequest(bridge, 'import.pickMarkdownFolder', {}, 10 * 60 * 1000)
  if (!Array.isArray(response.files) || response.files.length > 2000) throw new Error('选择的文件夹内容无效。')
  return response.files.map((entry: any) => {
    if (!entry || typeof entry.path !== 'string' || !/^[a-z]:[\\/]/i.test(entry.path) || typeof entry.relative !== 'string' || !entry.relative.includes('/') || entry.relative.startsWith('/') || /[\\\0]/.test(entry.relative) || entry.relative.split('/').some((part: string) => !part || part === '.' || part === '..') || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.markdown !== 'boolean') throw new Error('选择的文件夹内容无效。')
    const name = entry.relative.split('/').pop()!
    if (entry.markdown ? !/\.md$/i.test(name) : !/\.(?:png|jpe?g|gif|webp)$/i.test(name)) throw new Error('选择的文件类型无效。')
    const file = {
      name,
      size: entry.size,
      webkitRelativePath: entry.relative,
      paperSourcePath: entry.path,
      async arrayBuffer(): Promise<ArrayBuffer> {
        const limit = entry.markdown ? 5 * 1024 * 1024 : maxImageBytes
        const responseFile = await nativeRequest(bridge, entry.markdown ? 'import.readMarkdown' : 'import.readSelectedImage', { path: entry.path, maxBytes: String(limit) })
        const bytes = decodeNativeBytes(responseFile.data, limit, entry.markdown)
        if (!bytes) throw new Error('读取文件失败。')
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      }
    }
    return file as unknown as File
  })
}

/** Multi-format desktop file picker supporting .md, .txt, and read-only documents (.pdf, .doc, .docx, .ppt, .pptx, etc.). */
export async function pickDesktopImportFiles(): Promise<File[] | null> {
  const bridge = bridgeForDesktop()
  if (!bridge) return null
  const response = await nativeRequest(bridge, 'import.pickFiles', {}, 10 * 60 * 1000)
  if (!Array.isArray(response.paths) || response.paths.length > maxImages) throw new Error('选择的文件列表无效。')
  const files: File[] = []
  const names = new Set<string>()
  let totalText = 0
  let totalDoc = 0
  for (const path of response.paths as unknown[]) {
    if (typeof path !== 'string' || !/^[a-z]:[\\/]/i.test(path)) throw new Error('选择的文件路径无效。')
    const name = path.split(/[\\/]/).pop()!
    const ext = extractFileExtension(name)
    if (!ALL_SUPPORTED_IMPORT_EXTENSIONS.has(ext)) throw new Error(`暂不支持导入此文件类型：${name}`)
    if (names.has(name.toLocaleLowerCase())) throw new Error('选中的文件存在相同名称，请分批导入。')
    names.add(name.toLocaleLowerCase())
    if (ext === 'md' || ext === 'txt') {
      const limit = Math.min(5 * 1024 * 1024, 30 * 1024 * 1024 - totalText)
      if (limit <= 0) throw new Error('文本文件总大小超过 30 MiB。')
      const action = ext === 'md' ? 'import.readMarkdown' : 'import.readTextFile'
      const responseFile = await nativeRequest(bridge, action, { path, maxBytes: String(limit) })
      const bytes = decodeNativeBytes(responseFile.data, limit, true)
      if (!bytes) throw new Error(`无法读取文件：${name}`)
      totalText += bytes.length
      const file = new File([bytes], name, { type: documentMimeType(ext) })
      if (ext === 'md') Object.defineProperty(file, 'paperSourcePath', { value: path, enumerable: false })
      files.push(file)
    } else if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
      const limit = Math.min(MAX_DOCUMENT_BYTES, maxTotalDocumentBytes - totalDoc)
      if (limit <= 0) throw new Error('导入的外部文档总大小超过 200 MiB。')
      const responseFile = await nativeRequest(bridge, 'import.readDocumentFile', { path, maxBytes: String(limit) }, 120000)
      const bytes = decodeNativeBytes(responseFile.data, limit, false)
      if (!bytes) throw new Error(`无法读取文档文件：${name}`)
      totalDoc += bytes.length
      files.push(new File([bytes], name, { type: documentMimeType(ext) }))
    }
  }
  return files
}

/** Multi-format desktop folder picker preserving relative paths for .md, .txt, images, and read-only documents. */
export async function pickDesktopImportFolder(): Promise<File[] | null> {
  const bridge = bridgeForDesktop()
  if (!bridge) return null
  const response = await nativeRequest(bridge, 'import.pickFolder', {}, 10 * 60 * 1000)
  if (!Array.isArray(response.files) || response.files.length > 2000) throw new Error('选择的文件夹内容无效。')
  return response.files.map((entry: any) => {
    if (!entry || typeof entry.path !== 'string' || !/^[a-z]:[\\/]/i.test(entry.path) || typeof entry.relative !== 'string' || !entry.relative.includes('/') || entry.relative.startsWith('/') || /[\\\0]/.test(entry.relative) || entry.relative.split('/').some((part: string) => !part || part === '.' || part === '..') || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('选择的文件夹内容无效。')
    const name = entry.relative.split('/').pop()!
    const kind = typeof entry.kind === 'string' ? entry.kind : (entry.markdown ? 'markdown' : 'image')
    const ext = extractFileExtension(name)
    if (kind === 'markdown' && ext !== 'md') throw new Error('选择的文件类型无效。')
    if (kind === 'text' && ext !== 'txt') throw new Error('选择的文件类型无效。')
    if (kind === 'document' && !BINARY_DOCUMENT_EXTENSIONS.has(ext)) throw new Error('选择的文件类型无效。')
    if (kind === 'image' && !/^(?:png|jpe?g|gif|webp)$/.test(ext)) throw new Error('选择的文件类型无效。')
    const file = {
      name,
      size: entry.size,
      webkitRelativePath: entry.relative,
      ...(kind === 'markdown' ? { paperSourcePath: entry.path } : {}),
      async arrayBuffer(): Promise<ArrayBuffer> {
        const isDoc = kind === 'document'
        const isText = kind === 'markdown' || kind === 'text'
        const limit = isDoc ? MAX_DOCUMENT_BYTES : isText ? 5 * 1024 * 1024 : maxImageBytes
        const action = kind === 'markdown' ? 'import.readMarkdown' : kind === 'text' ? 'import.readTextFile' : isDoc ? 'import.readDocumentFile' : 'import.readSelectedImage'
        const responseFile = await nativeRequest(bridge, action, { path: entry.path, maxBytes: String(limit) }, isDoc ? 120000 : 60000)
        const bytes = decodeNativeBytes(responseFile.data, limit, isText)
        if (!bytes) throw new Error('读取文件失败。')
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      }
    }
    return file as unknown as File
  })
}

/** Resolve only exact image references from the selected Markdown files.
 * The browser version never opens local paths; unresolved references remain
 * available for the explicit folder selection and visible warning.
 */
export async function resolveDesktopImportedImages(result: DroppedMarkdownResult): Promise<DroppedMarkdownResult> {
  const bridge = bridgeForDesktop()
  if (!bridge) return result
  const pending = new Map<string, { target: string; sourcePath?: string; references: Array<{ markdownPath: string; target: string }> }>()
  const already = new Set(result.images.flatMap(image => image.references.map(ref => `${ref.markdownPath}\0${ref.target}`)))
  const unresolved = new Set(result.localResources.map(ref => `${ref.markdownPath}\0${ref.target}`))
  for (const file of result.files) {
    // A native source path exists only after the user picked this MD with
    // the desktop dialog. Ordinary file-input/drop results have no such grant.
    if (!file.sourcePath) continue
    for (const target of localImageReferences(file.content)) {
      const key = `${file.path}\0${target}`
      if (already.has(key) || !unresolved.has(key)) continue
      const sourcePath = file.sourcePath
      const candidate = `${sourcePath}\0${target}`
      const entry = pending.get(candidate) || { target, sourcePath, references: [] }
      entry.references.push({ markdownPath: file.path, target })
      pending.set(candidate, entry)
    }
  }
  if (!pending.size) return result
  const images: DroppedImage[] = [...result.images]
  const skipped: DroppedSkip[] = [...result.skipped]
  const fulfilled = new Set<string>()
  let total = images.reduce((sum, image) => sum + image.bytes.length, 0)
  for (const { target, sourcePath, references } of pending.values()) {
    if (images.length >= maxImages) { skipped.push({ path: target, reason: 'too-many' }); continue }
    const remaining = maxTotalBytes - total
    if (remaining <= 0) { skipped.push({ path: target, reason: 'too-large' }); continue }
    try {
      const maximumBytes = Math.min(maxImageBytes, remaining)
      const reply = await nativeRequest(bridge, 'import.readImage', { path: target, maxBytes: String(maximumBytes), ...(sourcePath ? { markdownPath: sourcePath } : {}) })
      const bytes = decodeNativeBytes(reply.data, maximumBytes)
      if (!bytes) { skipped.push({ path: target, reason: 'read-error' }); continue }
      if (total + bytes.length > maxTotalBytes) { skipped.push({ path: target, reason: 'too-large' }); continue }
      total += bytes.length
      // The extension remains available to the existing MIME detection. No
      // actual filesystem access is ever performed on this synthetic path.
      let filename = target.replace(/[?#].*$/, '')
      try { filename = decodeURIComponent(filename) } catch { /* host already validated the source; retain original */ }
      const path = `${sourcePath}/${filename}`
      images.push({ path, bytes, references })
      for (const ref of references) fulfilled.add(`${ref.markdownPath}\0${ref.target}`)
    } catch { skipped.push({ path: target, reason: 'read-error' }) }
  }
  return { ...result, images, skipped, localResources: result.localResources.filter(ref => !fulfilled.has(`${ref.markdownPath}\0${ref.target}`)) }
}
