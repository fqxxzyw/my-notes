/** Helpers for cleaning and updating notebook/chapter/page titles without losing metadata or changing IDs. */

const SIMPLE_INLINE_HTML_TAG = /<\/?(?:u|kbd|sup|sub|mark|strong|b|em|i|code|s|del|span)(?:\s[^<>]*)?>/gi

function stripInlineMarkdownText(segment: string): string {
  let out = segment
  // Unwrap Markdown images and links to their visible label text.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  // Unwrap simple inline formatting HTML tags (e.g. <u>, <kbd>, <mark>) while keeping text.
  out = out.replace(SIMPLE_INLINE_HTML_TAG, '')
  // Unwrap Typora / GFM inline formatting delimiters without touching intraword underscores like snake_case.
  out = out.replace(/==([^=\r\n]+)==/g, '$1')
  out = out.replace(/~~([^~\r\n]+)~~/g, '$1')
  out = out.replace(/\*\*([^*\r\n]+)\*\*/g, '$1')
  out = out.replace(/(^|[\s([{"'（【「『《：:、，。！？；—-])__([^_\r\n]+)__(?=$|[\s)\]}"'）】」』》：:、，。！？；—-])/g, '$1$2')
  out = out.replace(/\*([^*\s][^*\r\n]*?)\*/g, '$1')
  out = out.replace(/(^|[\s([{"'（【「『《：:、，。！？；—-])_([^_\s][^_\r\n]*?)_(?=$|[\s)\]}"'）】」』》：:、，。！？；—-])/g, '$1$2')
  // Unescape Markdown backslash escapes.
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!~=|])/g, '$1')
  return out
}

/**
 * Render an inline Markdown heading string (e.g. `` `05-asyncio_gather.py` 代码精讲 ``)
 * into clean plain text for UI lists, breadcrumbs, and headers while preserving
 * code-span contents (such as underscores in filenames) verbatim.
 */
export function cleanMarkdownTitle(raw: string): string {
  const trimmed = (raw || '').replace(/[\r\n]+/g, ' ').trim()
  if (!trimmed) return ''
  // Strip optional CommonMark ATX closing hashes preceded by whitespace.
  const withoutClosing = trimmed.replace(/[ \t]+#+[ \t]*$/, '').trim()
  if (!withoutClosing) return trimmed

  let result = ''
  let i = 0
  const n = withoutClosing.length
  let plainStart = 0

  const flushPlain = (end: number) => {
    if (end > plainStart) result += stripInlineMarkdownText(withoutClosing.slice(plainStart, end))
  }

  while (i < n) {
    if (withoutClosing[i] === '\\' && i + 1 < n) {
      i += 2
      continue
    }
    if (withoutClosing[i] === '`') {
      let tickEnd = i
      while (tickEnd < n && withoutClosing[tickEnd] === '`') tickEnd++
      const tickCount = tickEnd - i
      // Find matching closing run of exact length tickCount.
      let search = tickEnd
      let closeStart = -1
      while (search < n) {
        const idx = withoutClosing.indexOf('`', search)
        if (idx < 0) break
        let runEnd = idx
        while (runEnd < n && withoutClosing[runEnd] === '`') runEnd++
        if (runEnd - idx === tickCount) {
          closeStart = idx
          break
        }
        search = runEnd
      }
      if (closeStart >= 0) {
        flushPlain(i)
        let code = withoutClosing.slice(tickEnd, closeStart)
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) {
          code = code.slice(1, -1)
        }
        result += code
        i = closeStart + tickCount
        plainStart = i
        continue
      }
      i = tickEnd
      continue
    }
    i++
  }
  flushPlain(n)

  const cleaned = result.replace(/\s+/g, ' ').trim()
  return cleaned || withoutClosing
}

/** Extract and clean the first Markdown H1 heading, falling back to `fallback`. */
export function extractMarkdownTitle(content: string, fallback: string): string {
  const match = /^#\s+(.+?)\s*$/m.exec((content || '').replace(/^\uFEFF/, ''))
  if (match?.[1]) {
    const cleaned = cleanMarkdownTitle(match[1])
    if (cleaned) return cleaned
  }
  return cleanMarkdownTitle(fallback) || fallback
}

export function validateRenameTitle(raw: string): string {
  const value = raw.trim()
  if (!value || /[\r\n]/.test(value) || value.length > 120) {
    throw new Error('名称不能为空、包含换行或超过 120 个字符。')
  }
  return value
}

/**
 * Update the `# Title` line of a notebook's `index.md` while keeping any
 * description/chapter-order markers and extra user content untouched.
 */
export function writeNotebookIndexTitle(indexContent: string, newTitle: string): string {
  const title = validateRenameTitle(newTitle)
  const newline = indexContent.includes('\r\n') ? '\r\n' : '\n'
  const bom = indexContent.startsWith('\uFEFF') ? '\uFEFF' : ''
  const body = bom ? indexContent.slice(1) : indexContent
  const headingMatch = /^#\s+[^\r\n]*/m.exec(body)
  if (headingMatch && headingMatch.index !== undefined) {
    return (
      bom +
      body.slice(0, headingMatch.index) +
      `# ${title}` +
      body.slice(headingMatch.index + headingMatch[0].length)
    )
  }
  return `${bom}# ${title}${newline}${body}`
}

/**
 * Update a Markdown chapter or standalone page's first H1 heading when renamed.
 * Preserves BOM, newline style, and all remaining document bytes.
 */
export function writeMarkdownDocumentTitle(content: string, newTitle: string): string {
  const title = validateRenameTitle(newTitle)
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  const body = bom ? content.slice(1) : content
  const leadingHeading = /^([ \t]*(?:\r?\n)*)#\s+[^\r\n]*/.exec(body)
  if (leadingHeading) {
    return `${bom}${leadingHeading[1]}# ${title}${body.slice(leadingHeading[0].length)}`
  }
  if (!body) return `${bom}# ${title}${newline}${newline}`
  return `${bom}# ${title}${newline}${newline}${body}`
}
