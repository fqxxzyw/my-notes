import { namespaceKey } from './repository'
import type { Chapter, Notebook } from './notebookStore'

type LocalCollection = {
  books?: Notebook[]
  chapters?: Chapter[]
  welcomeInitialized?: boolean
  welcomeBookId?: string
  [key: string]: unknown
}

/** Create the editable welcome notebook in the selected local workspace.
 * Only a fresh, unbound workspace is seeded automatically; connected
 * repositories require an explicit request so deleted notes do not return.
 */
export function addWelcomeNotebook(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  repository: string,
  templates: Record<string, string>,
  createId: () => string,
  explicit = false
): { book: Notebook; chapters: Chapter[] } | null {
  if (repository && !explicit) return null
  const key = namespaceKey('paper-notes-local-collection', repository)
  const raw = storage.getItem(key)
  let saved: LocalCollection = {}
  if (raw !== null) {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('本地笔记格式无效，请先检查已有数据。')
    saved = parsed as LocalCollection
  }
  if (!explicit && saved.welcomeInitialized === true) return null
  if (saved.books !== undefined && !Array.isArray(saved.books)) throw new Error('本地笔记本格式无效。')
  if (saved.chapters !== undefined && !Array.isArray(saved.chapters)) throw new Error('本地章节格式无效。')
  const books = saved.books || []
  const chapters = saved.chapters || []
  const id = createId()
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || books.some(book => book.id === id)) throw new Error('无法生成笔记本标识，请重试。')
  const book: Notebook = { id, title: '使用说明与教程', sha: '' }
  const guideChapters: Chapter[] = Object.entries(templates)
    .filter(([path]) => path.endsWith('.md') && !path.endsWith('/index.md'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => {
      const chapterId = path.split('/').pop()!.replace(/\.md$/, '')
      if (!/^[a-zA-Z0-9_-]+$/.test(chapterId) || typeof content !== 'string') throw new Error('使用说明模板无效。')
      return { bookId: id, id: chapterId, title: /^#\s+(.+)$/m.exec(content)?.[1]?.trim() || '使用教程', content, sha: '' }
    })
  if (!guideChapters.length || new Set(guideChapters.map(chapter => chapter.id)).size !== guideChapters.length) throw new Error('使用说明模板不完整。')
  const next: LocalCollection = { ...saved, books: [...books, book], chapters: [...chapters, ...guideChapters], welcomeInitialized: true, welcomeBookId: id }
  storage.setItem(key, JSON.stringify(next))
  return { book, chapters: guideChapters }
}
