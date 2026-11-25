/** A notebook's ordering lives in its index; chapter Markdown files are never renamed. */
const KEY = '<!-- paper-notes-chapter-order:'
const ID = /^[a-zA-Z0-9_-]+$/
const ENCODED_CHAPTER_ID = /^c_[a-f0-9]{32}_([A-Za-z0-9_-]+)$/
const OVERVIEW_NAME = /^(?:readme|index)$/i
const NUMERIC_PREFIX = /^\d+/
const IMPORTED_EXT = /\.(?:md|txt|pdf|docx?|pptx?|xlsx?|csv|rtf)$/i

const zhCollator = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
  ? new Intl.Collator('zh-CN', { sensitivity: 'base' })
  : null

/** Decode the original relative path embedded in an imported chapter ID (`c_<uuid>_<base64url>`). */
export function decodeEncodedChapterPath(id: string): string | null {
  const match = ENCODED_CHAPTER_ID.exec(id)
  if (!match) return null
  try {
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    let bytes: Uint8Array
    if (typeof atob === 'function') {
      const binary = atob(padded)
      bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    } else {
      return null
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\\/g, '/').trim()
    return decoded && !/[\r\n]/.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

/** Return the nested folder label (e.g. `3-异步编程`) for chapters imported from subfolders, or empty string for flat chapters. */
export function chapterFolderPath(id: string): string {
  const decoded = decodeEncodedChapterPath(id)
  if (!decoded || !decoded.includes('/')) return ''
  return decoded.slice(0, decoded.lastIndexOf('/'))
}

function compareTextRun(a: string, b: string): number {
  if (a === b) return 0
  if (zhCollator) {
    const cmp = zhCollator.compare(a, b)
    if (cmp !== 0) return cmp
  } else {
    const lowerA = a.toLowerCase(), lowerB = b.toLowerCase()
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1
  }
  return a < b ? -1 : 1
}

function compareDigitRun(a: string, b: string): number {
  const normA = a.replace(/^0+/, '') || '0'
  const normB = b.replace(/^0+/, '') || '0'
  if (normA.length !== normB.length) return normA.length - normB.length
  if (normA !== normB) return normA < normB ? -1 : 1
  if (a.length !== b.length) return a.length - b.length
  return 0
}

/** Natural alphanumeric + zh-CN comparator (1 < 2 < 10, deterministic strict weak ordering). */
export function compareNatural(a: string, b: string): number {
  if (a === b) return 0
  const partsA = a.match(/\d+|\D+/g) || []
  const partsB = b.match(/\d+|\D+/g) || []
  const limit = Math.min(partsA.length, partsB.length)
  for (let i = 0; i < limit; i++) {
    const segA = partsA[i], segB = partsB[i]
    if (segA === segB) continue
    const numA = segA.charCodeAt(0) >= 48 && segA.charCodeAt(0) <= 57
    const numB = segB.charCodeAt(0) >= 48 && segB.charCodeAt(0) <= 57
    if (numA && numB) {
      const cmp = compareDigitRun(segA, segB)
      if (cmp !== 0) return cmp
    } else if (numA !== numB) {
      return numA ? -1 : 1
    } else {
      const cmp = compareTextRun(segA, segB)
      if (cmp !== 0) return cmp
    }
  }
  if (partsA.length !== partsB.length) return partsA.length - partsB.length
  return a < b ? -1 : 1
}

function segmentBucket(stem: string, isDir: boolean): number {
  if (!isDir && OVERVIEW_NAME.test(stem)) return 0
  if (NUMERIC_PREFIX.test(stem)) return 1
  return isDir ? 3 : 2
}

/**
 * Strictly transitive hierarchical path comparator for flattened nested folders.
 * At each directory level:
 *   0. Overview files (`README`, `index`) first
 *   1. Explicitly numbered files/folders (`00-...`, `1-...`, `2-...`, `10-...`) in natural numeric order (file before dir on tie)
 *   2. Unnumbered direct files in natural order
 *   3. Unnumbered subdirectories in natural order
 */
export function compareImportedPaths(pathA: string, pathB: string): number {
  const normA = (pathA || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const normB = (pathB || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (normA === normB) return 0
  const segsA = normA ? normA.split('/') : []
  const segsB = normB ? normB.split('/') : []
  const limit = Math.min(segsA.length, segsB.length)
  for (let i = 0; i < limit; i++) {
    const rawA = segsA[i], rawB = segsB[i]
    const isDirA = i < segsA.length - 1
    const isDirB = i < segsB.length - 1
    const stemA = isDirA ? rawA : rawA.replace(IMPORTED_EXT, '')
    const stemB = isDirB ? rawB : rawB.replace(IMPORTED_EXT, '')
    if (stemA === stemB && isDirA === isDirB && rawA === rawB) continue

    const bucketA = segmentBucket(stemA, isDirA)
    const bucketB = segmentBucket(stemB, isDirB)
    if (bucketA !== bucketB) return bucketA - bucketB

    const cmpStem = compareNatural(stemA, stemB)
    if (cmpStem !== 0) return cmpStem

    if (isDirA !== isDirB) return isDirA ? 1 : -1

    const cmpRaw = compareNatural(rawA, rawB)
    if (cmpRaw !== 0) return cmpRaw
  }
  if (segsA.length !== segsB.length) return segsA.length - segsB.length
  return normA < normB ? -1 : 1
}

function checkedOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 999) throw new Error('章节顺序数据无效，请检查笔记本索引。')
  const seen = new Set<string>()
  return value.map(id => {
    if (typeof id !== 'string' || id.length > 251 || !ID.test(id) || id.toLowerCase() === 'index' || seen.has(id)) {
      throw new Error('章节顺序数据无效，请检查笔记本索引。')
    }
    seen.add(id)
    return id
  })
}

export function validateChapterOrder(value: unknown): string[] { return checkedOrder(value) }

/** The description must remain the last line for older versions of 纸间. */
function splitDescription(content: string): [string, string] {
  const match = /(?:^|\n)<!-- paper-notes-description:.*? -->(?:\r?\n)?$/.exec(content)
  if (!match) return [content, '']
  const start = match.index + (match[0].startsWith('\n') ? 1 : 0)
  return [content.slice(0, start), content.slice(start)]
}

function splitOrder(content: string): { before: string; after: string; order?: string[] } {
  const [prefix, description] = splitDescription(content)
  // If prefix ends in a newline, inspect the preceding line rather than the
  // empty string after it; do not touch similar comments in user-written text.
  const end = prefix.endsWith('\n') ? prefix.length - 1 : prefix.length
  const start = prefix.lastIndexOf('\n', end - 1) + 1
  const tail = prefix.slice(start, end).replace(/\r$/, '')
  if (!tail.startsWith(KEY)) return { before: prefix, after: description }
  const marker = /^<!-- paper-notes-chapter-order:(.*?) -->$/.exec(tail)
  if (!marker) throw new Error('章节顺序标记损坏，请先检查笔记本索引。')
  let order: string[]
  try { order = checkedOrder(JSON.parse(marker[1])) }
  catch { throw new Error('章节顺序标记损坏，请先检查笔记本索引。') }
  // Two adjacent controlled markers are ambiguous; never silently discard one.
  const before = prefix.slice(0, start)
  const prior = before.replace(/\r?\n$/, '').split('\n').pop() || ''
  if (prior.startsWith(KEY)) throw new Error('章节顺序标记重复，请先检查笔记本索引。')
  return { before, after: description, order }
}

/** Undefined means no order metadata exists; a malformed controlled marker errors. */
export function readNotebookChapterOrder(content: string): string[] | undefined {
  return splitOrder(content).order
}

/** Undefined keeps existing index bytes exactly as they are. */
export function writeNotebookChapterOrder(content: string, value?: string[]): string {
  if (value === undefined) return content
  const order = checkedOrder(value)
  const { before, after, order: previous } = splitOrder(content)
  if (previous && previous.length === order.length && previous.every((id, index) => id === order[index])) return content
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const separator = before && !before.endsWith('\n') ? newline : ''
  const marker = `${KEY}${JSON.stringify(order).replace(/-/g, '\\u002d')} -->`
  return before + separator + marker + newline + after
}

/**
 * Existing listed IDs lead in exact saved order; missing IDs are ignored.
 * Unlisted (or unordered) chapters imported with encoded relative paths sort
 * deterministically by hierarchical natural path order instead of random UUID hex,
 * while non-encoded chapter IDs keep their exact input stability.
 */
export function sortChapters<T extends { id: string }>(chapters: readonly T[], order?: readonly string[]): T[] {
  const rank = order?.length ? new Map(order.map((id, index) => [id, index])) : null
  const items = chapters.map((chapter, index) => {
    const explicitRank = rank?.get(chapter.id)
    const encodedPath = explicitRank === undefined ? decodeEncodedChapterPath(chapter.id) : null
    return { chapter, index, explicitRank, encodedPath }
  })
  if (!rank && !items.some(item => item.encodedPath !== null)) {
    return [...chapters]
  }
  return items
    .sort((a, b) => {
      const rankA = a.explicitRank ?? Number.MAX_SAFE_INTEGER
      const rankB = b.explicitRank ?? Number.MAX_SAFE_INTEGER
      if (rankA !== rankB) return rankA - rankB
      if (a.encodedPath !== null && b.encodedPath !== null) {
        const cmp = compareImportedPaths(a.encodedPath, b.encodedPath)
        if (cmp !== 0) return cmp
      } else if (a.encodedPath !== null || b.encodedPath !== null) {
        return a.encodedPath !== null ? -1 : 1
      }
      return a.index - b.index
    })
    .map(item => item.chapter)
}
