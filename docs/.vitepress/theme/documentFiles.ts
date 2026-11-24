/**
 * Multi-format file metadata, managed binary storage (Desktop native / IndexedDB),
 * external app launch bridge, and offline OOXML (.docx / .pptx / .xlsx) & CSV previewers.
 */
import { unzipSync } from 'fflate'
import { normalizeRepository } from './repository'

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
export const MAX_GITHUB_DOCUMENT_BYTES = 25 * 1024 * 1024

export const EDITABLE_EXTENSIONS = new Set(['md', 'txt'])
export const BINARY_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'rtf'
])
export const ALL_SUPPORTED_IMPORT_EXTENSIONS = new Set([
  ...EDITABLE_EXTENSIONS,
  ...BINARY_DOCUMENT_EXTENSIONS
])

const MANAGED_DOC_PATH = /^docs\/(?:notebooks\/[A-Za-z0-9_-]+|pages)\/files\/[a-f0-9]{32}\.(?:pdf|doc|docx|ppt|pptx|xls|xlsx|csv|rtf)$/

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
  rtf: 'application/rtf'
}

export function extractFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

export function normalizeFileExt(ext?: string): string {
  const clean = (ext || 'md').trim().toLowerCase().replace(/^\./, '')
  return ALL_SUPPORTED_IMPORT_EXTENSIONS.has(clean) ? clean : 'md'
}

export function isMarkdownExt(ext?: string): boolean {
  return normalizeFileExt(ext) === 'md'
}

export function isPlainTextExt(ext?: string): boolean {
  return normalizeFileExt(ext) === 'txt'
}

/** Only .md and .txt files can be edited inside 纸间; all other imported documents are strictly read-only. */
export function isEditableExt(ext?: string): boolean {
  return EDITABLE_EXTENSIONS.has(normalizeFileExt(ext))
}

export function isBinaryDocumentExt(ext?: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(normalizeFileExt(ext))
}

export function isSupportedImportFileName(name: string): boolean {
  return ALL_SUPPORTED_IMPORT_EXTENSIONS.has(extractFileExtension(name))
}

export function formatBadgeLabel(ext?: string): string {
  return normalizeFileExt(ext).toUpperCase()
}

export function formatKindCaption(ext?: string): string {
  const normalized = normalizeFileExt(ext)
  if (normalized === 'md') return 'MARKDOWN'
  if (normalized === 'txt') return 'PLAIN TEXT'
  if (normalized === 'pdf') return 'PDF 文档'
  if (normalized === 'docx' || normalized === 'doc') return 'WORD 文档'
  if (normalized === 'pptx' || normalized === 'ppt') return 'PPT 演示'
  if (normalized === 'xlsx' || normalized === 'xls' || normalized === 'csv') return '表格文档'
  return '只读文档'
}

export function documentMimeType(ext?: string): string {
  return MIME_BY_EXT[normalizeFileExt(ext)] || 'application/octet-stream'
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function validateDocumentPath(path: string): string {
  if (typeof path !== 'string' || !MANAGED_DOC_PATH.test(path)) {
    throw new Error('文档存储路径无效。')
  }
  return path
}

export function newDocumentPath(bookId: string | null, ext: string): string {
  const normalized = normalizeFileExt(ext)
  if (!BINARY_DOCUMENT_EXTENSIONS.has(normalized)) {
    throw new Error(`不支持的只读文档类型：.${normalized}`)
  }
  if (bookId !== null && !/^[A-Za-z0-9_-]+$/.test(bookId)) {
    throw new Error('笔记本标识无效。')
  }
  return validateDocumentPath(
    `docs/${bookId === null ? 'pages' : `notebooks/${bookId}`}/files/${crypto.randomUUID().replaceAll('-', '')}.${normalized}`
  )
}

export function stripSupportedExtension(filename: string): string {
  const ext = extractFileExtension(filename)
  if (ext && ALL_SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
    return filename.slice(0, -(ext.length + 1))
  }
  return filename
}

export function displayFileName(title: string, ext?: string): string {
  const normalized = normalizeFileExt(ext)
  const cleanTitle = title.trim() || '未命名'
  if (cleanTitle.toLowerCase().endsWith(`.${normalized}`)) return cleanTitle
  return `${cleanTitle}.${normalized}`
}

// --- Storage layer (Desktop native files under 纸间数据\文件\ with IndexedDB fallback) ---

export type StoredDocumentFile = { path: string; bytes: Uint8Array }

const DOC_DB = 'paper-notes-documents-v1'
const DOC_STORE = 'files'

function docKey(repository: string | null | undefined, path: string): string {
  return `${repository ? normalizeRepository(repository) : ''}\0${validateDocumentPath(path)}`
}

function openDocDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('本机文档存储不可用。')); return }
    const request = indexedDB.open(DOC_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DOC_STORE)) request.result.createObjectStore(DOC_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法打开本机文档存储。'))
    request.onblocked = () => reject(new Error('本机文档存储正被其他页面占用。'))
  })
}

async function putIndexedDocument(repository: string | null | undefined, file: StoredDocumentFile): Promise<void> {
  validateDocumentPath(file.path)
  if (!(file.bytes instanceof Uint8Array) || !file.bytes.length || file.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error('文档为空或超过 50 MiB。')
  }
  const key = docKey(repository, file.path)
  const db = await openDocDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, 'readwrite')
      tx.objectStore(DOC_STORE).put({ path: file.path, bytes: file.bytes.slice().buffer }, key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('无法保存文档到本地存储，请检查磁盘空间。'))
    })
  } finally { db.close() }
}

async function getIndexedDocument(repository: string | null | undefined, path: string): Promise<StoredDocumentFile | null> {
  const key = docKey(repository, path)
  const db = await openDocDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(DOC_STORE, 'readonly').objectStore(DOC_STORE).get(key)
      req.onerror = () => reject(new Error('无法读取本地文档。'))
      req.onsuccess = () => {
        if (req.result === undefined) { resolve(null); return }
        const val = req.result
        if (val?.path !== path || !(val?.bytes instanceof ArrayBuffer)) { reject(new Error('本地文档数据损坏。')); return }
        resolve({ path, bytes: new Uint8Array(val.bytes) })
      }
    })
  } finally { db.close() }
}

type NativeBridge = {
  postMessage: (message: object) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

function isDesktopHost(): boolean {
  return typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    location.hostname === 'paper.local' &&
    (location.pathname === '/my-notes' || location.pathname.startsWith('/my-notes/'))
}

function desktopDocRequest(
  action: 'document.get' | 'document.put' | 'document.openExternal',
  args: Record<string, unknown>
): Promise<any> {
  const bridge = (window as unknown as { chrome?: { webview?: NativeBridge } }).chrome?.webview
  if (!bridge) return Promise.reject(new Error('无法连接桌面文档存储，请重新启动纸间。'))
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge.removeEventListener('message', receive); reject(new Error('访问本机文档超时，请重试。')) }, 90000)
    const receive = (event: MessageEvent) => {
      const reply = event.data
      if (!reply || reply.channel !== 'paper-notes' || reply.id !== id) return
      clearTimeout(timer)
      bridge.removeEventListener('message', receive)
      if (!reply.ok) reject(new Error(typeof reply.error === 'string' ? reply.error : '无法访问本机文档。'))
      else resolve(reply)
    }
    bridge.addEventListener('message', receive)
    try { bridge.postMessage({ channel: 'paper-notes', action, id, ...args }) }
    catch { clearTimeout(timer); bridge.removeEventListener('message', receive); reject(new Error('无法连接桌面文档存储。')) }
  })
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)))
  return btoa(chunks.join(''))
}

function decodeBase64(encoded: string): Uint8Array {
  if (encoded.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 16) throw new Error('文档超过 50 MiB。')
  const raw = atob(encoded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function putDocumentFile(repository: string | null | undefined, file: StoredDocumentFile): Promise<void> {
  validateDocumentPath(file.path)
  if (!(file.bytes instanceof Uint8Array) || !file.bytes.length || file.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error('文档为空或超过 50 MiB，请缩小后重试。')
  }
  if (!isDesktopHost()) {
    await putIndexedDocument(repository, file)
    return
  }
  await desktopDocRequest('document.put', {
    repository: repository ? normalizeRepository(repository) : '',
    path: file.path,
    data: encodeBase64(file.bytes)
  })
}

export async function getDocumentFile(repository: string | null | undefined, path: string): Promise<StoredDocumentFile | null> {
  validateDocumentPath(path)
  if (!isDesktopHost()) return getIndexedDocument(repository, path)
  const reply = await desktopDocRequest('document.get', {
    repository: repository ? normalizeRepository(repository) : '',
    path
  })
  if (reply.data === null || reply.data === undefined) return null
  if (typeof reply.data !== 'string') throw new Error('本机文档数据无效。')
  return { path, bytes: decodeBase64(reply.data) }
}

/** Launch the read-only copy of a stored document using the OS default application (Desktop only). */
export async function openDocumentExternally(
  repository: string | null | undefined,
  path: string,
  displayName: string
): Promise<void> {
  validateDocumentPath(path)
  if (!isDesktopHost()) throw new Error('请在桌面端使用“系统默认程序打开”，网页端请先下载后打开。')
  await desktopDocRequest('document.openExternal', {
    repository: repository ? normalizeRepository(repository) : '',
    path,
    displayName
  })
}

// --- Offline client-side preview extractors (.docx / .pptx / .xlsx / .csv) ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function decodeTextSmart(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try { return new TextDecoder('gb18030').decode(bytes) }
    catch { return new TextDecoder('utf-8').decode(bytes) }
  }
}

function mediaMimeFromPath(name: string): string {
  const ext = extractFileExtension(name)
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  return ''
}

function parseXml(xmlText: string): Document {
  return new DOMParser().parseFromString(xmlText, 'application/xml')
}

function localChildren(node: Element, localName: string): Element[] {
  return Array.from(node.children).filter(child => child.localName === localName)
}

function findRelTargets(relsXml: string | undefined, baseDir: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!relsXml) return map
  const doc = parseXml(relsXml)
  const rels = doc.getElementsByTagName('*')
  for (let i = 0; i < rels.length; i++) {
    const el = rels[i]
    if (el.localName !== 'Relationship') continue
    const id = el.getAttribute('Id')
    const target = el.getAttribute('Target')
    if (!id || !target || /^https?:/i.test(target)) continue
    const parts = `${baseDir}/${target}`.replace(/\\/g, '/').split('/')
    const stack: string[] = []
    for (const part of parts) {
      if (!part || part === '.') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    map.set(id, stack.join('/'))
  }
  return map
}

function getZipEntry(entries: Record<string, Uint8Array>, target: string): Uint8Array | undefined {
  if (entries[target]) return entries[target]
  const lower = target.toLowerCase()
  const key = Object.keys(entries).find(k => k.toLowerCase() === lower)
  return key ? entries[key] : undefined
}

/** Extract sanitized read-only HTML preview from a .docx ZIP archive offline. */
export function extractDocxPreview(bytes: Uint8Array): { html: string; objectUrls: string[] } {
  const entries = unzipSync(bytes)
  const docBytes = getZipEntry(entries, 'word/document.xml')
  if (!docBytes) throw new Error('无法识别 DOCX 正文内容。')
  const relsBytes = getZipEntry(entries, 'word/_rels/document.xml.rels')
  const relMap = findRelTargets(relsBytes ? new TextDecoder().decode(relsBytes) : undefined, 'word')

  const objectUrls: string[] = []
  const relUrlCache = new Map<string, string>()
  const resolveImage = (rId: string): string | null => {
    if (relUrlCache.has(rId)) return relUrlCache.get(rId)!
    const target = relMap.get(rId)
    if (!target) return null
    const imgBytes = getZipEntry(entries, target)
    const mime = mediaMimeFromPath(target)
    if (!imgBytes || !mime) return null
    const url = URL.createObjectURL(new Blob([imgBytes], { type: mime }))
    objectUrls.push(url)
    relUrlCache.set(rId, url)
    return url
  }

  const xml = parseXml(new TextDecoder().decode(docBytes))
  const body = Array.from(xml.getElementsByTagName('*')).find(el => el.localName === 'body')
  if (!body) throw new Error('DOCX 文档正文为空。')

  const renderParagraph = (p: Element): string => {
    const pPr = localChildren(p, 'pPr')[0]
    const pStyleVal = pPr ? localChildren(pPr, 'pStyle')[0]?.getAttribute('w:val') || localChildren(pPr, 'pStyle')[0]?.getAttribute('val') || '' : ''
    const isList = !!(pPr && localChildren(pPr, 'numPr').length)
    let headingLevel = 0
    const headingMatch = /^(?:Heading|标题\s*)([1-6])$/i.exec(pStyleVal)
    if (headingMatch) headingLevel = Number(headingMatch[1])
    else if (/^Title$/i.test(pStyleVal)) headingLevel = 1

    const chunks: string[] = []
    const walkRuns = (parent: Element) => {
      for (const child of Array.from(parent.children)) {
        if (child.localName === 'hyperlink') { walkRuns(child); continue }
        if (child.localName !== 'r') continue
        const rPr = localChildren(child, 'rPr')[0]
        const bold = !!(rPr && localChildren(rPr, 'b').some(el => el.getAttribute('w:val') !== '0' && el.getAttribute('val') !== 'false'))
        const italic = !!(rPr && localChildren(rPr, 'i').some(el => el.getAttribute('w:val') !== '0' && el.getAttribute('val') !== 'false'))
        const strike = !!(rPr && localChildren(rPr, 'strike').length)
        const underline = !!(rPr && localChildren(rPr, 'u').some(el => el.getAttribute('w:val') !== 'none'))

        let runHtml = ''
        for (const sub of Array.from(child.children)) {
          if (sub.localName === 't') runHtml += escapeHtml(sub.textContent || '')
          else if (sub.localName === 'tab') runHtml += '&emsp;'
          else if (sub.localName === 'br') runHtml += '<br>'
          else if (sub.localName === 'drawing' || sub.localName === 'pict') {
            const blips = Array.from(sub.getElementsByTagName('*')).filter(el => el.localName === 'blip' || el.localName === 'imagedata')
            for (const blip of blips) {
              const rId = blip.getAttribute('r:embed') || blip.getAttribute('r:id') || blip.getAttribute('embed')
              if (rId) {
                const url = resolveImage(rId)
                if (url) runHtml += `<img class="docx-img" src="${url}" alt="文档图片">`
              }
            }
          }
        }
        if (!runHtml) continue
        if (bold) runHtml = `<strong>${runHtml}</strong>`
        if (italic) runHtml = `<em>${runHtml}</em>`
        if (strike) runHtml = `<s>${runHtml}</s>`
        if (underline) runHtml = `<u>${runHtml}</u>`
        chunks.push(runHtml)
      }
    }
    walkRuns(p)
    const inner = chunks.join('')
    if (!inner.trim()) return ''
    if (headingLevel >= 1 && headingLevel <= 6) return `<h${headingLevel}>${inner}</h${headingLevel}>`
    if (isList) return `<p class="docx-list-item">• ${inner}</p>`
    return `<p>${inner}</p>`
  }

  const renderTable = (tbl: Element): string => {
    const rows = localChildren(tbl, 'tr')
    if (!rows.length) return ''
    const rowHtml = rows.map((tr, rIdx) => {
      const cells = localChildren(tr, 'tc').map(tc => {
        const inner = localChildren(tc, 'p').map(renderParagraph).filter(Boolean).join('') || '&nbsp;'
        const tag = rIdx === 0 ? 'th' : 'td'
        return `<${tag}>${inner}</${tag}>`
      })
      return `<tr>${cells.join('')}</tr>`
    })
    return `<div class="paper-table-wrap"><div class="paper-table-scroll"><table><tbody>${rowHtml.join('')}</tbody></table></div></div>`
  }

  const parts: string[] = []
  for (const child of Array.from(body.children)) {
    if (child.localName === 'p') {
      const rendered = renderParagraph(child)
      if (rendered) parts.push(rendered)
    } else if (child.localName === 'tbl') {
      const rendered = renderTable(child)
      if (rendered) parts.push(rendered)
    }
  }
  return {
    html: parts.length ? parts.join('\n') : '<p class="doc-empty-hint">文档未包含可预览的文字内容，请点击上方「用系统默认程序打开」查看。</p>',
    objectUrls
  }
}

export interface PptxSlidePreview {
  index: number
  title: string
  paragraphs: string[]
  tables: string[][][]
  images: string[]
}

/** Extract ordered slide cards from a .pptx ZIP archive offline. */
export function extractPptxPreview(bytes: Uint8Array): { slides: PptxSlidePreview[]; objectUrls: string[] } {
  const entries = unzipSync(bytes)
  const slideKeys = Object.keys(entries)
    .filter(k => /^ppt\/slides\/slide(\d+)\.xml$/i.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/i)?.[1] || 0))
  if (!slideKeys.length) throw new Error('无法识别 PPTX 幻灯片内容。')

  const objectUrls: string[] = []
  const imgCache = new Map<string, string>()

  const slides: PptxSlidePreview[] = slideKeys.map((key, idx) => {
    const slideName = key.split('/').pop()!
    const relsKey = `ppt/slides/_rels/${slideName}.rels`
    const relsBytes = getZipEntry(entries, relsKey)
    const relMap = findRelTargets(relsBytes ? new TextDecoder().decode(relsBytes) : undefined, 'ppt/slides')

    const xml = parseXml(new TextDecoder().decode(entries[key]))
    const paragraphs: string[] = []
    let title = ''
    const tables: string[][][] = []
    const images: string[] = []

    const allElements = Array.from(xml.getElementsByTagName('*'))
    for (const el of allElements) {
      if (el.localName === 'sp') {
        const ph = Array.from(el.getElementsByTagName('*')).find(n => n.localName === 'ph')
        const phType = ph?.getAttribute('type') || ''
        const isTitle = phType === 'title' || phType === 'ctrTitle'
        const txBody = Array.from(el.children).find(c => c.localName === 'txBody')
        if (!txBody) continue
        for (const p of localChildren(txBody, 'p')) {
          const text = Array.from(p.getElementsByTagName('*'))
            .filter(n => n.localName === 't')
            .map(n => n.textContent || '')
            .join('')
            .trim()
          if (!text) continue
          if (isTitle && !title) title = text
          else paragraphs.push(text)
        }
      } else if (el.localName === 'tbl') {
        const rows = localChildren(el, 'tr').map(tr =>
          localChildren(tr, 'tc').map(tc =>
            Array.from(tc.getElementsByTagName('*'))
              .filter(n => n.localName === 't')
              .map(n => n.textContent || '')
              .join('')
              .trim()
          )
        )
        if (rows.length) tables.push(rows)
      } else if (el.localName === 'blip') {
        const rId = el.getAttribute('r:embed') || el.getAttribute('embed')
        if (!rId) continue
        const target = relMap.get(rId)
        if (!target) continue
        const mime = mediaMimeFromPath(target)
        const imgBytes = getZipEntry(entries, target)
        if (!mime || !imgBytes) continue
        let url = imgCache.get(target)
        if (!url) {
          url = URL.createObjectURL(new Blob([imgBytes], { type: mime }))
          imgCache.set(target, url)
          objectUrls.push(url)
        }
        if (!images.includes(url)) images.push(url)
      }
    }
    return { index: idx + 1, title: title || `第 ${idx + 1} 页`, paragraphs, tables, images }
  })

  return { slides, objectUrls }
}

/** Extract read-only sheets from an .xlsx archive offline. */
export function extractXlsxPreview(bytes: Uint8Array): { sheets: Array<{ name: string; rows: string[][] }> } {
  const entries = unzipSync(bytes)
  const sharedStrings: string[] = []
  const ssBytes = getZipEntry(entries, 'xl/sharedStrings.xml')
  if (ssBytes) {
    const ssXml = parseXml(new TextDecoder().decode(ssBytes))
    for (const si of Array.from(ssXml.getElementsByTagName('*')).filter(el => el.localName === 'si')) {
      const text = Array.from(si.getElementsByTagName('*'))
        .filter(el => el.localName === 't')
        .map(el => el.textContent || '')
        .join('')
      sharedStrings.push(text)
    }
  }
  const sheetKeys = Object.keys(entries)
    .filter(k => /^xl\/worksheets\/sheet(\d+)\.xml$/i.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/i)?.[1] || 0))
  const sheetNames: string[] = []
  const wbBytes = getZipEntry(entries, 'xl/workbook.xml')
  if (wbBytes) {
    const wbXml = parseXml(new TextDecoder().decode(wbBytes))
    for (const sh of Array.from(wbXml.getElementsByTagName('*')).filter(el => el.localName === 'sheet')) {
      sheetNames.push(sh.getAttribute('name') || '')
    }
  }
  const colIndexFromRef = (ref: string): number => {
    const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase()
    let n = 0
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64)
    return Math.max(0, n - 1)
  }
  const sheets = sheetKeys.map((key, idx) => {
    const xml = parseXml(new TextDecoder().decode(entries[key]))
    const rows: string[][] = []
    let maxCols = 0
    for (const rowEl of Array.from(xml.getElementsByTagName('*')).filter(el => el.localName === 'row').slice(0, 300)) {
      const rowValues: string[] = []
      for (const cell of localChildren(rowEl, 'c')) {
        const ref = cell.getAttribute('r') || ''
        const colIdx = ref ? colIndexFromRef(ref) : rowValues.length
        const type = cell.getAttribute('t') || ''
        let value = ''
        if (type === 's') {
          const idxStr = localChildren(cell, 'v')[0]?.textContent || ''
          value = sharedStrings[Number(idxStr)] ?? ''
        } else if (type === 'inlineStr') {
          value = Array.from(cell.getElementsByTagName('*')).filter(n => n.localName === 't').map(n => n.textContent || '').join('')
        } else {
          value = localChildren(cell, 'v')[0]?.textContent || ''
        }
        rowValues[colIdx] = value
        if (colIdx + 1 > maxCols) maxCols = colIdx + 1
      }
      rows.push(rowValues)
    }
    const normalized = rows.map(r => Array.from({ length: maxCols }, (_, i) => r[i] ?? ''))
    return { name: sheetNames[idx] || `工作表 ${idx + 1}`, rows: normalized }
  })
  return { sheets }
}

/** Parse CSV bytes into rows with UTF-8 / GB18030 support. */
export function parseCsvPreview(bytes: Uint8Array): string[][] {
  const text = decodeTextSmart(bytes).replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cell += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell); cell = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else {
      cell += ch
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  return rows.slice(0, 500)
}
