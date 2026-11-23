/** A notebook's ordering lives in its index; chapter Markdown files are never renamed. */
const KEY = '<!-- paper-notes-chapter-order:'
const ID = /^[a-zA-Z0-9_-]+$/

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

/** Existing listed IDs lead; missing IDs are ignored and new chapters stay stable. */
export function sortChapters<T extends { id: string }>(chapters: readonly T[], order?: readonly string[]): T[] {
  if (!order?.length) return [...chapters]
  const rank = new Map(order.map((id, index) => [id, index]))
  return chapters.map((chapter, index) => ({ chapter, index, rank: rank.get(chapter.id) }))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(item => item.chapter)
}
