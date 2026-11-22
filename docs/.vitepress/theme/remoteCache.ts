import { validateCatalog, type CatalogVersion } from './cabinetStore'
import type { Chapter, Notebook } from './notebookStore'
import { namespaceKey } from './repository'

/** A complete GitHub revision, separate from unsynchronized local drafts. */
export type RemoteSnapshot = {
  head: string
  books: Notebook[]
  chapters: Record<string, Chapter[]>
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
  const books = input.books.map((raw: unknown): Notebook => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('远端笔记本数据无效。')
    const book = raw as Record<string, unknown>
    if (typeof book.id !== 'string' || !ID.test(book.id) || ids.has(book.id) ||
        typeof book.title !== 'string' || typeof book.sha !== 'string' || !SHA.test(book.sha)) throw new Error('远端笔记本数据无效。')
    ids.add(book.id)
    return { id: book.id, title: book.title, sha: book.sha }
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
      return { bookId: book.id, id: chapter.id, title: chapter.title, content: chapter.content, sha: chapter.sha }
    })
  }
  const rawCatalog = input.catalog as Record<string, unknown>
  if (typeof rawCatalog.sha !== 'string' || (rawCatalog.sha !== '' && !SHA.test(rawCatalog.sha))) throw new Error('远端书柜版本无效。')
  if (input.stale !== undefined && typeof input.stale !== 'boolean') throw new Error('远端快照状态无效。')
  return { head: input.head, books, chapters, catalog: { catalog: validateCatalog(rawCatalog.catalog), sha: rawCatalog.sha }, ...(input.stale === undefined ? {} : { stale: input.stale }) }
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
