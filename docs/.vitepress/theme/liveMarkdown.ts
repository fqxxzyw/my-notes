import MarkdownIt from 'markdown-it'
import { enableSafeHtmlImages } from './safeHtmlImage'
import { enableTaskMarkers } from './markdownTasks'
import { enableTyporaMarkdown } from './markdownTypora'

/** A rendered block is only a view of these original source offsets. */
export type MarkdownBlock = { from: number; to: number; source: string; html: string; type: string; direct: boolean }

/** A boundary cursor is outside a marker; only reveal an actively edited mark. */
export function revealInlineMarker(selections: readonly { from: number; to: number }[], from: number, to: number): boolean {
  return selections.some(range => range.from === range.to
    ? range.from > from && range.from < to
    : range.from < to && range.to > from)
}


const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
enableSafeHtmlImages(markdown)
enableTaskMarkers(markdown)
enableTyporaMarkdown(markdown)

/** Render complete top-level blocks without changing, normalizing or serializing source. */
export function markdownBlocks(source: string): MarkdownBlock[] {
  if (!source) return []
  // markdown-it treats CR, LF and CRLF as newlines. Build offsets in the
  // original UTF-16 source, rather than splitting only on LF, so a block can
  // never accidentally point into the body of the previous or next block.
  const offsets: number[] = [0]
  const ends: number[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\r' && source[i] !== '\n') continue
    ends.push(i)
    if (source[i] === '\r' && source[i + 1] === '\n') i++
    offsets.push(i + 1)
  }
  ends.push(source.length)
  const environment: Record<string, unknown> = {}
  const tokens = markdown.parse(source, environment)
  const result: MarkdownBlock[] = []
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex]
    if (token.level !== 0 || !token.map || token.nesting === -1) continue
    const [first, last] = token.map
    if (first < 0 || last <= first || first >= offsets.length) continue
    const from = offsets[first]
    const lastLine = Math.min(last - 1, ends.length - 1)
    const to = ends[lastLine]
    if (to <= from || (result.length && from < result[result.length - 1].to)) continue
    const raw = source.slice(from, to)
    // Common text and list blocks stay native editable lines; image syntax
    // inside them gets a small inline widget rather than replacing the block.
    const direct = ['heading_open', 'paragraph_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open'].includes(token.type)
    const blockEnv: Record<string, unknown> = {
      references: environment.references,
      __paperFnDefs: environment.__paperFnDefs,
      __paperDocHeadings: environment.__paperDocHeadings,
      __paperSingleBlock: true
    }
    result.push({ from, to, source: raw, html: markdown.render(raw, blockEnv), type: token.type, direct })
  }
  return result
}

/** Preserve document-scoped reference definitions while rendering inline widgets. */
export function markdownEnvironment(source: string): Record<string, unknown> {
  const environment: Record<string, unknown> = {}
  markdown.parse(source, environment)
  return environment
}
/** Render inline Markdown using markdown-it's default URL validation. */
export function renderInlineMarkdown(source: string, environment: Record<string, unknown> = {}): string { return markdown.renderInline(source, environment) }

/** Edit a common inline image without touching surrounding document text. */
export function replaceInlineImage(source: string, alt: string, destination: string): string | null {
  const match = /^!\[(?:\\.|[^\]\\\r\n])*\]\((?:<[^>\r\n]*>|(?:\\.|[^\s()\\])+)(\s+(?:"[^"\r\n]*"|'[^'\r\n]*'))?\)$/.exec(source)
  if (!match || /[\r\n]/.test(alt) || /[\r\n<>]/.test(destination)) return null
  const url = destination.trim()
  if (!url) return null
  // Keep the optional Markdown title while escaping user-editable fields.
  return `![${alt.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}](<${url}>${match[1] || ''})`
}

/** Locate a plain GFM table cell without rewriting any other bytes. */
export function tableCellRange(source: string, row: number, column: number): { from: number; to: number; text: string } | null {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) return null
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1)
  }
  const lineIndex = row === 0 ? 0 : row + 1 // The second source line is the alignment row.
  if (lineIndex >= starts.length) return null
  const lineStart = starts[lineIndex]
  let lineEnd = lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : source.length
  if (source[lineEnd - 1] === '\r') lineEnd--
  const line = source.slice(lineStart, lineEnd)
  const separators: number[] = []
  let escape = false, codeFence = 0
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (escape) { escape = false; continue }
    if (char === '\\') { escape = true; continue }
    if (char === '`') {
      let count = 1
      while (line[i + count] === '`') count++
      if (!codeFence) codeFence = count
      else if (codeFence === count) codeFence = 0
      i += count - 1
    } else if (char === '|' && !codeFence) separators.push(i)
  }
  const leading = /^\s*\|/.test(line), trailing = /\|\s*$/.test(line)
  const bounds = [leading ? separators.shift()! + 1 : 0, ...separators.map(index => index + 1)]
  const ends = [...separators, line.length]
  if (trailing) { bounds.pop(); ends.pop() }
  if (column >= bounds.length) return null
  let from = bounds[column], to = ends[column]
  while (from < to && /\s/.test(line[from])) from++
  while (to > from && /\s/.test(line[to - 1])) to--
  const raw = line.slice(from, to)
  const children = markdown.parseInline(raw, {})[0]?.children || []
  // Never silently flatten bold, code, links or escaped syntax into plain text.
  if (children.some(token => token.type !== 'text') || /\\/.test(raw)) return null
  return { from: lineStart + from, to: lineStart + to, text: raw }
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
