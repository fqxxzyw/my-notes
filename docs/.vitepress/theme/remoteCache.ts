import { validateCatalog, type CatalogVersion } from './cabinetStore'
import type { Chapter, Notebook, Page } from './notebookStore'
import { namespaceKey } from './repository'
import { readNotebookChapterOrder, validateChapterOrder } from './notebookChapterOrder'

/** A complete GitHub revision, separate from unsynchronized local drafts. */
export type RemoteSnapshot = {
  head: string
  books: Notebook[]
  chapters: Record<string, Chapter[]>
  /** Older snapshots predate standalone pages; callers should restore before assuming none exist. */
  pages?: Page[]
  catalog: CatalogVersion
  /** True means the locally cached revision has known gaps and needs a full restore. */
  stale?: boolean
}

const CACHE_KEY = 'paper-notes-remote-snapshot-v1'
const ID = /^[a-zA-Z0-9_-]+$/
const SHA = /^[a-f0-9]{40}$/
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function getStorage(storage?: StoragePort): StoragePort {
  if (storage) return storage
  if (typeof localStorage === 'undefined') throw new Error('本机缓存不可用。')
  return localStorage
}

/** Validate and copy only known fields, so tokens and draft metadata cannot leak into a snapshot. */
function cleanSnapshot(value: unknown): RemoteSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('远端快照格式无效。')
  const input = value as Record<string, unknown>
  if (typeof input.head !== 'string' || !SHA.test(input.head) || !Array.isArray(input.books) ||
      !input.chapters || typeof input.chapters !== 'object' || Array.isArray(input.chapters) ||
      !input.catalog || typeof input.catalog !== 'object' || Array.isArray(input.catalog)) throw new Error('远端快照格式无效。')

  const ids = new Set<string>()
  let badOrderMetadata = false
  const books = input.books.map((raw: unknown): Notebook => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('远端笔记本数据无效。')
    const book = raw as Record<string, unknown>
    if (typeof book.id !== 'string' || !ID.test(book.id) || ids.has(book.id) ||
        typeof book.title !== 'string' || typeof book.sha !== 'string' || !SHA.test(book.sha)) throw new Error('远端笔记本数据无效。')
    ids.add(book.id)
    if (book.description !== undefined && typeof book.description !== 'string' || book.indexContent !== undefined && typeof book.indexContent !== 'string') throw new Error('远端笔记本简介无效。')
    let chapterOrder: string[] | undefined
    if (book.chapterOrder !== undefined) chapterOrder = validateChapterOrder(book.chapterOrder)
    else if (typeof book.indexContent === 'string') {
      // Older clients preserved the index text but did not know the ordering
      // field. Recover it for offline use without rewriting the old cache.
      try { chapterOrder = readNotebookChapterOrder(book.indexContent) }
      catch { badOrderMetadata = true }
    }
    return { id: book.id, title: book.title, sha: book.sha, ...(book.description === undefined ? {} : { description: book.description as string }), ...(book.indexContent === undefined ? {} : { indexContent: book.indexContent as string }), ...(chapterOrder === undefined ? {} : { chapterOrder }) }
  })
  const allChapters = input.chapters as Record<string, unknown>
  if (Object.keys(allChapters).length !== books.length || Object.keys(allChapters).some(id => !ids.has(id))) {
    throw new Error('远端快照缺少完整的笔记本章节。')
  }
  const chapters: Record<string, Chapter[]> = Object.create(null)
  for (const book of books) {
    const entries = allChapters[book.id]
    if (!Array.isArray(entries)) throw new Error('远端快照缺少笔记本章节。')
    const seen = new Set<string>()
    chapters[book.id] = entries.map((raw: unknown): Chapter => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('远端章节数据无效。')
      const chapter = raw as Record<string, unknown>
      if (chapter.bookId !== book.id || typeof chapter.id !== 'string' || !ID.test(chapter.id) ||
          chapter.id.toLowerCase() === 'index' || seen.has(chapter.id) || typeof chapter.title !== 'string' ||
          typeof chapter.content !== 'string' || typeof chapter.sha !== 'string' || !SHA.test(chapter.sha)) throw new Error('远端章节数据无效。')
      seen.add(chapter.id)
      const ext = typeof chapter.ext === 'string' && /^[a-z0-9]{1,10}$/i.test(chapter.ext) ? chapter.ext.toLowerCase() : undefined
      const filePath = typeof chapter.filePath === 'string' ? chapter.filePath : undefined
      const fileName = typeof chapter.fileName === 'string' ? chapter.fileName : undefined
      const fileSize = typeof chapter.fileSize === 'number' && Number.isFinite(chapter.fileSize) && chapter.fileSize >= 0 ? chapter.fileSize : undefined
      return { bookId: book.id, id: chapter.id, title: chapter.title, content: chapter.content, sha: chapter.sha, ...(ext ? { ext } : {}), ...(filePath ? { filePath } : {}), ...(fileName ? { fileName } : {}), ...(fileSize !== undefined ? { fileSize } : {}) }
    })
  }
  const rawCatalog = input.catalog as Record<string, unknown>
  let pages: Page[] | undefined
  if (input.pages !== undefined) {
    if (!Array.isArray(input.pages)) throw new Error('远端书页数据无效。')
    const seen = new Set<string>()
    pages = input.pages.map((raw: unknown): Page => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('远端书页数据无效。')
      const page = raw as Record<string, unknown>
      if (typeof page.id !== 'string' || !ID.test(page.id) || page.id.length > 251 || seen.has(page.id) ||
          typeof page.title !== 'string' || typeof page.content !== 'string' || typeof page.sha !== 'string' || !SHA.test(page.sha)) throw new Error('远端书页数据无效。')
      seen.add(page.id)
      const ext = typeof page.ext === 'string' && /^[a-z0-9]{1,10}$/i.test(page.ext) ? page.ext.toLowerCase() : undefined
      const filePath = typeof page.filePath === 'string' ? page.filePath : undefined
      const fileName = typeof page.fileName === 'string' ? page.fileName : undefined
      const fileSize = typeof page.fileSize === 'number' && Number.isFinite(page.fileSize) && page.fileSize >= 0 ? page.fileSize : undefined
      return { id: page.id, title: page.title, content: page.content, sha: page.sha, ...(ext ? { ext } : {}), ...(filePath ? { filePath } : {}), ...(fileName ? { fileName } : {}), ...(fileSize !== undefined ? { fileSize } : {}) }
    })
  }
  if (typeof rawCatalog.sha !== 'string' || (rawCatalog.sha !== '' && !SHA.test(rawCatalog.sha))) throw new Error('远端书柜版本无效。')
  if (input.stale !== undefined && typeof input.stale !== 'boolean') throw new Error('远端快照状态无效。')
  return { head: input.head, books, chapters, ...(pages === undefined ? {} : { pages }), catalog: { catalog: validateCatalog(rawCatalog.catalog), sha: rawCatalog.sha }, ...(badOrderMetadata ? { stale: true } : input.stale === undefined ? {} : { stale: input.stale }) }
}

/** Returns null for an absent, incomplete or unreadable cache; never alters drafts or a damaged cache. */
export function readRemoteCache(repository?: string | null, storage?: StoragePort): RemoteSnapshot | null {
  try {
    const raw = getStorage(storage).getItem(namespaceKey(CACHE_KEY, repository))
    if (!raw) return null
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const envelope = data as Record<string, unknown>
    if (envelope.version !== 1) return null
    return cleanSnapshot(envelope.snapshot)
  } catch { return null }
}

/** Serialize first; localStorage setItem replaces the old snapshot atomically or throws. */
export function writeRemoteCache(snapshot: RemoteSnapshot, repository?: string | null, storage?: StoragePort): void {
  const clean = cleanSnapshot(snapshot)
  const serialized = JSON.stringify({ version: 1, snapshot: clean })
  getStorage(storage).setItem(namespaceKey(CACHE_KEY, repository), serialized)
}

/** Invalidate a prior revision after a remote deletion so it cannot revive deleted notes. */
export function clearRemoteCache(repository?: string | null, storage?: StoragePort): void {
  getStorage(storage).removeItem(namespaceKey(CACHE_KEY, repository))
}
