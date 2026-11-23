import { namespaceKey } from './repository'
import type { Chapter, Notebook } from './notebookStore'
import welcomeV104 from './welcome-v104.json'
import welcomeAttachmentsV104 from './welcome-attachments-v104.json'

export type WorkspaceEntry = [string, string]
export type WelcomeCandidate = { book: Notebook; chapters: Chapter[] }
export type WelcomeDuplicate = { localBookId: string; remoteBookId: string }

/** Only call with a fully read, consistent remote revision. Null means unavailable. */
export function findPristineWelcomeDuplicate(
  entries: WorkspaceEntry[], templates: Record<string, string>, remote: WelcomeCandidate[] | null,
  repository = ''
): WelcomeDuplicate | null {
  try {
    if (!remote || !Array.isArray(remote)) return null
    const collectionKey = namespaceKey('paper-notes-local-collection', repository)
    const collectionEntry = entries.filter(([key]) => key === collectionKey)
    if (collectionEntry.length !== 1) return null
    const collection = JSON.parse(collectionEntry[0][1])
    if (!collection || typeof collection !== 'object' || Array.isArray(collection) || collection.welcomeInitialized !== true ||
        typeof collection.welcomeBookId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(collection.welcomeBookId) ||
        !Array.isArray(collection.books) || !Array.isArray(collection.chapters)) return null
    const id = collection.welcomeBookId as string
    const matches = collection.books.filter((book: Notebook) => book?.id === id)
    if (matches.length !== 1) return null
    const local = matches[0]
    if (local.title !== '使用说明与教程' || local.sha !== '' ||
        Object.keys(local).some(key => !['id', 'title', 'sha'].includes(key))) return null
    const draftPrefix = `${namespaceKey('paper-notes-draft', repository)}:${id}:`
    if (entries.some(([key]) => key.startsWith(draftPrefix))) return null
    // Unknown future journal fields are also checked for references before excluding anything.
    if (Object.entries(collection).some(([key, value]) => !['books', 'chapters', 'welcomeInitialized', 'welcomeBookId'].includes(key) && JSON.stringify(value)?.includes(id))) return null
    const cabinetKey = namespaceKey('paper-notes:cabinets:v1', repository)
    if (entries.some(([key, value]) => key === cabinetKey && value.includes(id))) return null

    // Keep released templates byte-for-byte: an old manual may only match the
    // same complete old version on both sides, never a different revision.
    for (const version of [templates, welcomeV104, welcomeAttachmentsV104]) {
      const expected = Object.entries(version).filter(([path]) => path.endsWith('.md') && !path.endsWith('/index.md'))
        .sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => {
          const chapterId = path.split('/').pop()!.replace(/\.md$/, '')
          if (!/^[a-zA-Z0-9_-]+$/.test(chapterId) || typeof content !== 'string') throw new Error('invalid template')
          return { id: chapterId, title: /^#\s+(.+)$/m.exec(content)?.[1]?.trim() || '使用教程', content }
        })
      if (!expected.length || new Set(expected.map(chapter => chapter.id)).size !== expected.length) continue
      const sameChapters = (chapters: Chapter[], bookId: string, localOnly: boolean) => {
        if (!Array.isArray(chapters) || chapters.length !== expected.length) return false
        return expected.every(expectedChapter => {
          const found = chapters.filter(chapter => chapter?.id === expectedChapter.id)
          if (found.length !== 1) return false
          const chapter = found[0]
          return chapter.bookId === bookId && chapter.title === expectedChapter.title && chapter.content === expectedChapter.content &&
            typeof chapter.sha === 'string' && (localOnly ? chapter.sha === '' : /^[a-f0-9]{40}$/.test(chapter.sha)) &&
            (!localOnly || Object.keys(chapter).every(key => ['id', 'bookId', 'title', 'content', 'sha'].includes(key)))
        })
      }
      if (!sameChapters(collection.chapters.filter((chapter: Chapter) => chapter?.bookId === id), id, true)) continue
      for (const candidate of remote) {
        const book = candidate?.book
        if (!book || book.id === id || !/^[a-zA-Z0-9_-]+$/.test(book.id) || book.title !== local.title ||
            typeof book.sha !== 'string' || !/^[a-f0-9]{40}$/.test(book.sha) || book.description || book.chapterOrder !== undefined ||
            typeof book.indexContent !== 'string' || !/^# 使用说明与教程\r?\n?$/.test(book.indexContent)) continue
        if (sameChapters(candidate.chapters, book.id, false)) return { localBookId: id, remoteBookId: book.id }
      }
    }
  } catch { /* Never modify data if a record cannot be verified. */ }
  return null
}

/** Prepare a copy for first-time import; never mutates the source workspace. */
export function prepareWelcomeImport(entries: WorkspaceEntry[], templates: Record<string, string>, remote: WelcomeCandidate[] | null):
  { entries: WorkspaceEntry[]; duplicate: WelcomeDuplicate | null } {
  const duplicate = findPristineWelcomeDuplicate(entries, templates, remote)
  if (!duplicate) return { entries, duplicate: null }
  const collectionKey = namespaceKey('paper-notes-local-collection', '')
  return {
    duplicate,
    entries: entries.map(([key, value]) => {
      if (key !== collectionKey) return [key, value]
      const collection = JSON.parse(value)
      collection.books = collection.books.filter((book: Notebook) => book.id !== duplicate.localBookId)
      collection.chapters = collection.chapters.filter((chapter: Chapter) => chapter.bookId !== duplicate.localBookId)
      collection.welcomeBookId = duplicate.remoteBookId
      return [key, JSON.stringify(collection)]
    })
  }
}
