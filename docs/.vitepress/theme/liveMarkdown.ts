import MarkdownIt from 'markdown-it'

/** A rendered block is only a view of these original source offsets. */
export type MarkdownBlock = { from: number; to: number; source: string; html: string }

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })

// Markdown-it supports GFM tables and strikethrough. Render task markers as
// disabled checkboxes; clicking the block opens its unchanged Markdown source.
markdown.core.ruler.after('inline', 'paper-task-markers', state => {
  const stack: string[] = []
  for (const token of state.tokens) {
    if (token.nesting === -1) stack.pop()
    if (token.type === 'inline' && stack.includes('list_item_open') && token.children?.length) {
      const first = token.children[0]
      const match = first.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null
      if (match) {
        first.content = first.content.slice(match[0].length)
        const box = new state.Token('html_inline', '', 0)
        box.content = `<input type="checkbox" disabled${match[1].toLowerCase() === 'x' ? ' checked' : ''}> `
        token.children.unshift(box)
      }
    }
    if (token.nesting === 1) stack.push(token.type)
  }
})

/** Render complete top-level blocks without changing, normalizing or serializing source. */
export function markdownBlocks(source: string): MarkdownBlock[] {
  if (!source) return []
  const lines = source.split('\n')
  const offsets: number[] = [0]
  for (let i = 0; i < lines.length - 1; i++) offsets.push(offsets[i] + lines[i].length + 1)
  const tokens = markdown.parse(source, {})
  const result: MarkdownBlock[] = []
  for (const token of tokens) {
    if (token.level !== 0 || !token.map || token.nesting === -1) continue
    const [first, last] = token.map
    if (first < 0 || last <= first || first >= lines.length) continue
    const from = offsets[first]
    const lastLine = Math.min(last - 1, lines.length - 1)
    const to = offsets[lastLine] + lines[lastLine].length
    if (to <= from || (result.length && from < result[result.length - 1].to)) continue
    const raw = source.slice(from, to)
    result.push({ from, to, source: raw, html: markdown.render(raw) })
  }
  return result
}

/** Approximate a click's rendered-text offset in the untouched Markdown block. */
export function sourceOffsetForText(source: string, renderedPrefix: string): number {
  let position = 0
  for (const character of renderedPrefix) {
    if (/\s/.test(character)) continue
    const index = source.indexOf(character, position)
    if (index < 0) continue
    position = index + character.length
  }
  return Math.min(position, source.length)
}

/** Map textarea's normalized newline offsets back to the unmodified source. */
export function rawOffsetForTextarea(source: string, offset: number): number {
  let raw = 0, shown = 0
  while (raw < source.length && shown < offset) {
    if (source[raw] === '\r' && source[raw + 1] === '\n') raw += 2
    else raw++
    shown++
  }
  return raw
}
export function textareaOffsetForRaw(source: string, offset: number): number {
  return source.slice(0, offset).replace(/\r\n|\r/g, '\n').length
}
/** Preserve untouched original newline bytes when the native fallback edits. */
export function applyTextareaChange(source: string, value: string): string {
  const before = source.replace(/\r\n|\r/g, '\n')
  let start = 0
  while (start < before.length && start < value.length && before[start] === value[start]) start++
  let oldEnd = before.length, newEnd = value.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === value[newEnd - 1]) { oldEnd--; newEnd-- }
  const insertion = value.slice(start, newEnd)
  // For consistent CRLF files keep newly typed line breaks consistent too.
  const preferCrLf = source.includes('\r\n') && !/(^|[^\r])\n|\r(?!\n)/.test(source)
  return source.slice(0, rawOffsetForTextarea(source, start)) + (preferCrLf ? insertion.replace(/\n/g, '\r\n') : insertion) + source.slice(rawOffsetForTextarea(source, oldEnd))
}
