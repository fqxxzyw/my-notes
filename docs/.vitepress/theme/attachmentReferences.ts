import MarkdownIt from 'markdown-it'
import { validateAttachmentPath } from './attachmentStore'

const markdown = new MarkdownIt({ html: false })
export type AttachmentReference = { src: string; path: string }

/** Compare original key/value snapshots independent of localStorage order. */
export function workspaceEntriesMatch(expected: Array<[string, string]>, current: Array<[string, string]>): boolean {
  const byKey = new Map(current)
  return byKey.size === current.length && current.length === expected.length && expected.every(([key, value]) => byKey.get(key) === value)
}

/** Resolve only app-managed images against the Markdown file's own directory.
 * Parse Markdown tokens (including references), never code fences or plain links.
 */
export function attachmentReferences(source: string, bookId: string | null): AttachmentReference[] {
  const found = new Map<string, string>()
  const tokens = markdown.parse(source, {})
  for (const token of tokens) for (const child of token.children || []) {
    if (child.type !== 'image') continue
    const src = child.attrGet('src')
    if (!src || !/^(?:\.\/)?assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/.test(src)) continue
    try {
      const base = bookId === null ? 'docs/pages' : `docs/notebooks/${bookId}`
      found.set(src, validateAttachmentPath(`${base}/${src.replace(/^\.\//, '')}`))
    } catch { /* Existing non-managed paths remain ordinary Markdown links. */ }
  }
  return [...found].map(([src, path]) => ({ src, path }))
}

/** Find references in saved chapters and drafts before copying a workspace. */
export function workspaceAttachmentPaths(entries: Array<[string, string]>): string[] {
  const parsed: unknown[] = []
  for (const [, raw] of entries) {
    try { parsed.push(JSON.parse(raw)) } catch { throw new Error('本地笔记数据无法读取，未复制任何笔记。') }
  }
  const pageBooks = new Set<string>()
  for (const value of parsed) {
    const collection = value as { books?: Array<{ id?: unknown; kind?: unknown }> } | null
    if (Array.isArray(collection?.books)) for (const book of collection.books) {
      if (book?.kind === 'page' && typeof book.id === 'string') pageBooks.add(book.id)
    }
  }
  const paths = new Set<string>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const item = value as Record<string, any>
    const bookId = typeof item.bookId === 'string' ? item.bookId : typeof item.base?.bookId === 'string' ? item.base.bookId : null
    if (bookId !== null && typeof item.content === 'string') {
      for (const ref of attachmentReferences(item.content, pageBooks.has(bookId) ? null : bookId)) paths.add(ref.path)
    }
    for (const child of Object.values(item)) visit(child)
  }
  parsed.forEach(visit)
  return [...paths]
}
