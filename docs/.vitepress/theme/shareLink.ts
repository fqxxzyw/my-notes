/**
 * Cross-platform full-hierarchy share link codec for Paper Notes (Desktop, Web & Android).
 * Supports two interoperable formats:
 * 1. Offline self-contained zlib+base64url links: `paper-share://v1/<data>` (or `<url>#paper-share=v1:<data>`)
 * 2. GitHub public/connected repo short links: `paper-share://gh/v1?repo=owner/name&scope=...&id=...`
 *    plus direct GitHub `blob`/`tree` URLs inside `docs/`.
 */
import { zlibSync, unzlibSync } from 'fflate'
import { normalizeRepository } from './repository'

export type ShareScope = 'cabinet' | 'book' | 'chapter' | 'page'

export interface SharedAttachment {
  /** Relative path as referenced inside Markdown, e.g. `assets/<32hex>.png` */
  relPath: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  base64: string
}

export interface SharedChapter {
  title: string
  content: string
  ext?: 'md' | 'txt'
}

export interface SharedBook {
  title: string
  description?: string
  chapters: SharedChapter[]
  attachments?: SharedAttachment[]
}

export interface SharedPage {
  title: string
  content: string
  ext?: 'md' | 'txt'
  attachments?: SharedAttachment[]
}

export interface PaperSharePayloadV1 {
  v: 1
  scope: ShareScope
  createdAt?: string
  cabinet?: {
    title: string
    books: SharedBook[]
    pages: SharedPage[]
  }
  book?: SharedBook
  chapter?: SharedChapter & {
    bookTitle?: string
    attachments?: SharedAttachment[]
  }
  page?: SharedPage
}

export interface GitHubShareRef {
  kind: 'github'
  repo: string
  scope: ShareScope
  id: string
  chapterId?: string
  title?: string
}

export type ParsedShareInput =
  | { kind: 'offline'; payload: PaperSharePayloadV1 }
  | GitHubShareRef

export interface ShareSummary {
  scope: ShareScope
  scopeLabel: string
  title: string
  bookCount: number
  chapterCount: number
  pageCount: number
  imageCount: number
}

export const SHARE_URI_PREFIX = 'paper-share://v1/'
export const SHARE_GH_PREFIX = 'paper-share://gh/v1?'
/** Hard memory caps for self-contained offline share links to prevent UI freezes or clipboard bloat. */
export const MAX_OFFLINE_RAW_BYTES = 512 * 1024
export const MAX_OFFLINE_SINGLE_IMAGE_BYTES = 180 * 1024
export const MAX_OFFLINE_TOTAL_IMAGE_BYTES = 320 * 1024
export const MAX_SHARE_LINK_CHARS = 120_000
export const MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024

const REL_ASSET_PATTERN = /^assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/
const VALID_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const VALID_SCOPES = new Set<ShareScope>(['cabinet', 'book', 'chapter', 'page'])

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '')
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'))
  const binary = atob(clean)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (normalized.length % 4)) % 4
  return base64ToBytes(normalized + '='.repeat(pad))
}

function sanitizeAttachmentList(list: unknown): SharedAttachment[] | undefined {
  if (!Array.isArray(list) || !list.length) return undefined
  const cleaned: SharedAttachment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const relPath = typeof rec.relPath === 'string' ? rec.relPath.trim() : ''
    const mime = typeof rec.mime === 'string' ? rec.mime.trim().toLowerCase() : ''
    const base64 = typeof rec.base64 === 'string' ? rec.base64.trim() : ''
    if (!REL_ASSET_PATTERN.test(relPath) || !VALID_MIMES.has(mime) || !base64) continue
    cleaned.push({ relPath, mime: mime as SharedAttachment['mime'], base64 })
  }
  return cleaned.length ? cleaned : undefined
}

function sanitizeChapter(raw: unknown): SharedChapter | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 120) : ''
  const content = typeof rec.content === 'string' ? rec.content : ''
  if (!title) return null
  const ext = rec.ext === 'txt' ? 'txt' : 'md'
  return { title, content, ...(ext === 'txt' ? { ext } : {}) }
}

function sanitizeBook(raw: unknown): SharedBook | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 120) : ''
  if (!title) return null
  const description = typeof rec.description === 'string' ? rec.description.trim().slice(0, 500) : undefined
  const chapters = Array.isArray(rec.chapters)
    ? rec.chapters.map(sanitizeChapter).filter((c): c is SharedChapter => c !== null)
    : []
  const attachments = sanitizeAttachmentList(rec.attachments)
  return {
    title,
    ...(description ? { description } : {}),
    chapters,
    ...(attachments ? { attachments } : {})
  }
}

function sanitizePage(raw: unknown): SharedPage | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 120) : ''
  const content = typeof rec.content === 'string' ? rec.content : ''
  if (!title) return null
  const ext = rec.ext === 'txt' ? 'txt' : 'md'
  const attachments = sanitizeAttachmentList(rec.attachments)
  return {
    title,
    content,
    ...(ext === 'txt' ? { ext } : {}),
    ...(attachments ? { attachments } : {})
  }
}

export function validateSharePayload(raw: unknown): PaperSharePayloadV1 {
  if (!raw || typeof raw !== 'object') throw new Error('分享链接格式无效。')
  const rec = raw as Record<string, unknown>
  if (rec.v !== 1) throw new Error('不支持的分享链接版本，请更新纸间后重试。')
  if (typeof rec.scope !== 'string' || !VALID_SCOPES.has(rec.scope as ShareScope)) {
    throw new Error('分享链接缺少有效的层级标识。')
  }
  const scope = rec.scope as ShareScope
  const createdAt = typeof rec.createdAt === 'string' ? rec.createdAt : undefined

  if (scope === 'cabinet') {
    const cab = rec.cabinet as Record<string, unknown> | undefined
    const title = typeof cab?.title === 'string' ? cab.title.trim().slice(0, 80) : ''
    if (!title) throw new Error('书柜分享内容缺少书柜名称。')
    const books = Array.isArray(cab?.books) ? cab!.books.map(sanitizeBook).filter((b): b is SharedBook => b !== null) : []
    const pages = Array.isArray(cab?.pages) ? cab!.pages.map(sanitizePage).filter((p): p is SharedPage => p !== null) : []
    return { v: 1, scope, ...(createdAt ? { createdAt } : {}), cabinet: { title, books, pages } }
  }

  if (scope === 'book') {
    const book = sanitizeBook(rec.book)
    if (!book) throw new Error('笔记本分享内容不完整。')
    return { v: 1, scope, ...(createdAt ? { createdAt } : {}), book }
  }

  if (scope === 'chapter') {
    const ch = sanitizeChapter(rec.chapter)
    if (!ch) throw new Error('章节分享内容不完整。')
    const chRec = rec.chapter as Record<string, unknown>
    const bookTitle = typeof chRec.bookTitle === 'string' ? chRec.bookTitle.trim().slice(0, 120) : undefined
    const attachments = sanitizeAttachmentList(chRec.attachments)
    return {
      v: 1,
      scope,
      ...(createdAt ? { createdAt } : {}),
      chapter: {
        ...ch,
        ...(bookTitle ? { bookTitle } : {}),
        ...(attachments ? { attachments } : {})
      }
    }
  }

  const page = sanitizePage(rec.page)
  if (!page) throw new Error('书页分享内容不完整。')
  return { v: 1, scope, ...(createdAt ? { createdAt } : {}), page }
}

/** Encode a validated share payload into a portable compressed `paper-share://v1/...` link with memory cap enforcement. */
export function encodeShareLink(payload: PaperSharePayloadV1, options?: { webOriginUrl?: string }): {
  uri: string
  webUrl?: string
  rawBytes: number
  charLength: number
  tooLarge: boolean
  overMemoryLimit: boolean
} {
  const validated = validateSharePayload(payload)
  const jsonBytes = textEncoder.encode(JSON.stringify(validated))
  if (jsonBytes.length > MAX_OFFLINE_RAW_BYTES) {
    return {
      uri: '',
      rawBytes: jsonBytes.length,
      charLength: 0,
      tooLarge: true,
      overMemoryLimit: true
    }
  }
  const compressed = zlibSync(jsonBytes, { level: 9 })
  const token = bytesToBase64Url(compressed)
  const uri = `${SHARE_URI_PREFIX}${token}`
  let webUrl: string | undefined
  if (options?.webOriginUrl) {
    try {
      const parsed = new URL(options.webOriginUrl)
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname !== 'paper.local') {
        webUrl = `${parsed.origin}${parsed.pathname}#paper-share=v1:${token}`
      }
    } catch { /* ignore invalid origin */ }
  }
  return {
    uri,
    ...(webUrl ? { webUrl } : {}),
    rawBytes: jsonBytes.length,
    charLength: uri.length,
    tooLarge: uri.length > MAX_SHARE_LINK_CHARS,
    overMemoryLimit: false
  }
}

/** Encode a compact GitHub repository share link (zero payload size limit for synced notes). */
export function encodeGitHubShareLink(ref: Omit<GitHubShareRef, 'kind'>): string {
  const repo = normalizeRepository(ref.repo)
  const params = new URLSearchParams()
  params.set('repo', repo)
  params.set('scope', ref.scope)
  params.set('id', ref.id)
  if (ref.chapterId) params.set('chapter', ref.chapterId)
  if (ref.title) params.set('title', ref.title.slice(0, 80))
  return `${SHARE_GH_PREFIX}${params.toString()}`
}

/** Decode any pasted share text (`paper-share://v1/...`, web `#paper-share=v1:...`, `paper-share://gh/v1?...`, or GitHub URL). */
export function decodeShareInput(rawInput: string): ParsedShareInput {
  const trimmed = (rawInput || '').trim()
  if (!trimmed) throw new Error('请先粘贴分享链接。')

  // 1. Offline compressed URI or web URL hash (even embedded inside a chat message)
  const offlineMatch = /paper-share:\/\/v1\/([A-Za-z0-9_-]+)/.exec(trimmed)
    || /#paper-share=v1:([A-Za-z0-9_-]+)/.exec(trimmed)
  if (offlineMatch) {
    const token = offlineMatch[1]
    let inflated: Uint8Array
    try {
      const compressed = base64UrlToBytes(token)
      inflated = unzlibSync(compressed)
    } catch {
      throw new Error('分享链接不完整或已损坏，请确认已完整复制链接。')
    }
    if (inflated.length > MAX_DECOMPRESSED_BYTES) {
      throw new Error('分享链接数据超出安全大小上限（4 MiB）。')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(textDecoder.decode(inflated))
    } catch {
      throw new Error('分享链接内容损坏，无法解析 JSON。')
    }
    return { kind: 'offline', payload: validateSharePayload(parsed) }
  }

  // 2. GitHub short share URI: `paper-share://gh/v1?repo=...&scope=...&id=...`
  const ghShareMatch = /paper-share:\/\/gh\/v1\?([^\s]+)/.exec(trimmed)
    || /#paper-share=gh:([^\s]+)/.exec(trimmed)
  if (ghShareMatch) {
    const params = new URLSearchParams(ghShareMatch[1])
    const rawRepo = params.get('repo') || ''
    const scope = params.get('scope') as ShareScope | null
    const id = (params.get('id') || '').trim()
    const chapterId = (params.get('chapter') || '').trim() || undefined
    const title = (params.get('title') || '').trim() || undefined
    if (!rawRepo || !scope || !VALID_SCOPES.has(scope) || !id) {
      throw new Error('GitHub 分享链接缺少必要参数。')
    }
    return {
      kind: 'github',
      repo: normalizeRepository(rawRepo),
      scope,
      id,
      ...(chapterId ? { chapterId } : {}),
      ...(title ? { title } : {})
    }
  }

  // 3. Direct GitHub web URL pointing to `docs/notebooks/<bookId>[/<chapter>.md]` or `docs/pages/<page>.md`
  const ghWebMatch = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:blob|tree)\/[^/]+\/docs\/([^\s?#]+)/i.exec(trimmed)
  if (ghWebMatch) {
    const repo = normalizeRepository(ghWebMatch[1])
    const subPath = decodeURIComponent(ghWebMatch[2]).replace(/\/+$/, '')
    const parts = subPath.split('/')
    if (parts[0] === 'pages' && parts[1]) {
      const file = parts[1].replace(/\.(?:md|txt)$/i, '')
      return { kind: 'github', repo, scope: 'page', id: file }
    }
    if (parts[0] === 'notebooks' && parts[1]) {
      const bookId = parts[1]
      if (parts[2] && parts[2].toLowerCase() !== 'index.md') {
        const chapterId = parts[2].replace(/\.(?:md|txt)$/i, '')
        return { kind: 'github', repo, scope: 'chapter', id: bookId, chapterId }
      }
      return { kind: 'github', repo, scope: 'book', id: bookId }
    }
  }

  throw new Error('未识别的分享链接格式。请粘贴以 paper-share:// 开头的纸间分享链接或 GitHub 笔记链接。')
}

export function summarizeSharePayload(payload: PaperSharePayloadV1): ShareSummary {
  if (payload.scope === 'cabinet' && payload.cabinet) {
    const books = payload.cabinet.books
    const pages = payload.cabinet.pages
    const chapterCount = books.reduce((sum, b) => sum + b.chapters.length, 0)
    const imageCount = books.reduce((sum, b) => sum + (b.attachments?.length || 0), 0)
      + pages.reduce((sum, p) => sum + (p.attachments?.length || 0), 0)
    return {
      scope: 'cabinet',
      scopeLabel: '书柜分享',
      title: payload.cabinet.title,
      bookCount: books.length,
      chapterCount,
      pageCount: pages.length,
      imageCount
    }
  }
  if (payload.scope === 'book' && payload.book) {
    return {
      scope: 'book',
      scopeLabel: '笔记本分享',
      title: payload.book.title,
      bookCount: 1,
      chapterCount: payload.book.chapters.length,
      pageCount: 0,
      imageCount: payload.book.attachments?.length || 0
    }
  }
  if (payload.scope === 'chapter' && payload.chapter) {
    return {
      scope: 'chapter',
      scopeLabel: '章节分享',
      title: payload.chapter.title,
      bookCount: 0,
      chapterCount: 1,
      pageCount: 0,
      imageCount: payload.chapter.attachments?.length || 0
    }
  }
  const page = payload.page!
  return {
    scope: 'page',
    scopeLabel: '独立书页分享',
    title: page.title,
    bookCount: 0,
    chapterCount: 0,
    pageCount: 1,
    imageCount: page.attachments?.length || 0
  }
}

/** Strip attachments from a payload if user opts for a smaller text-only share link. */
export function stripShareAttachments(payload: PaperSharePayloadV1): PaperSharePayloadV1 {
  if (payload.scope === 'cabinet' && payload.cabinet) {
    return {
      ...payload,
      cabinet: {
        title: payload.cabinet.title,
        books: payload.cabinet.books.map(({ attachments: _a, ...rest }) => rest),
        pages: payload.cabinet.pages.map(({ attachments: _a, ...rest }) => rest)
      }
    }
  }
  if (payload.scope === 'book' && payload.book) {
    const { attachments: _a, ...rest } = payload.book
    return { ...payload, book: rest }
  }
  if (payload.scope === 'chapter' && payload.chapter) {
    const { attachments: _a, ...rest } = payload.chapter
    return { ...payload, chapter: rest }
  }
  if (payload.scope === 'page' && payload.page) {
    const { attachments: _a, ...rest } = payload.page
    return { ...payload, page: rest }
  }
  return payload
}
