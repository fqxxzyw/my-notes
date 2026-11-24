/**
 * Typora-compatible smart Markdown editing helpers:
 * - Smart Enter continuation & empty-item exit for lists, tasks, and blockquotes
 * - Smart Tab / Shift+Tab list nesting
 * - Smart URL paste onto selected text -> [selected](url)
 * - Heading level H1–H6 / Paragraph (Ctrl+0)
 * - Toggleable Typora inline markers: ==highlight==, <u>underline</u>, ~sub~, ^sup^, $math$
 */

export interface TextEdit {
  from: number
  to: number
  insert: string
  selectionStart: number
  selectionEnd: number
}

function isInsideCodeFence(doc: string, pos: number): boolean {
  const before = doc.slice(0, pos)
  const lines = before.split(/\r?\n/)
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  for (let i = 0; i < lines.length - 1; i++) {
    const stripped = lines[i].replace(/^(?: {0,3}>[ \t]?)+/, '')
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(stripped)
    if (inFence) {
      if (match && match[1][0] === fenceChar && match[1].length >= fenceLen && !stripped.slice(match[0].length).trim()) {
        inFence = false
      }
    } else if (match) {
      inFence = true
      fenceChar = match[1][0]
      fenceLen = match[1].length
    }
  }
  return inFence
}

/**
 * Handle Enter on list items, task items, ordered lists, and blockquotes just like Typora.
 * Returns null if normal newline behavior should run.
 */
export function handleTyporaEnter(doc: string, cursor: number): TextEdit | null {
  if (isInsideCodeFence(doc, cursor)) return null
  const lineStart = doc.lastIndexOf('\n', cursor - 1) + 1
  const nextNl = doc.indexOf('\n', cursor)
  const rawLineEnd = nextNl === -1 ? doc.length : nextNl
  const hasCr = rawLineEnd > lineStart && doc[rawLineEnd - 1] === '\r'
  const lineEnd = hasCr ? rawLineEnd - 1 : rawLineEnd
  const newline = doc.includes('\r\n') && !/(^|[^\r])\n/.test(doc) ? '\r\n' : '\n'
  const line = doc.slice(lineStart, lineEnd)

  // Only trigger smart continuation if cursor is after the prefix marker.
  const beforeCursor = doc.slice(lineStart, Math.min(cursor, lineEnd))

  // 1. Task list: `  - [ ] text` or `  - [x] text`
  const taskMatch = /^(\s*)([-*+])(\s+)\[([ xX])\]([ \t]+)(.*)$/.exec(line)
  if (taskMatch) {
    const prefixLen = taskMatch[1].length + taskMatch[2].length + taskMatch[3].length + 3 + taskMatch[5].length
    if (beforeCursor.length < prefixLen) return null
    if (!taskMatch[6].trim() && cursor >= lineStart + prefixLen) {
      // Empty task item -> exit list cleanly
      return { from: lineStart, to: lineEnd, insert: '', selectionStart: lineStart, selectionEnd: lineStart }
    }
    const nextPrefix = `${newline}${taskMatch[1]}${taskMatch[2]} [ ] `
    return { from: cursor, to: cursor, insert: nextPrefix, selectionStart: cursor + nextPrefix.length, selectionEnd: cursor + nextPrefix.length }
  }

  // 2. Unordered list: `  - text`, `  * text`, `  + text`
  const bulletMatch = /^(\s*)([-*+])([ \t]+)(.*)$/.exec(line)
  if (bulletMatch) {
    // Do not mistake thematic break `---` or `* * *` for a list.
    if (/^\s*(?:-\s*-\s*-|\*\s*\*\s*\*)\s*$/.test(line)) return null
    const prefixLen = bulletMatch[1].length + bulletMatch[2].length + bulletMatch[3].length
    if (beforeCursor.length < prefixLen) return null
    if (!bulletMatch[4].trim() && cursor >= lineStart + prefixLen) {
      return { from: lineStart, to: lineEnd, insert: '', selectionStart: lineStart, selectionEnd: lineStart }
    }
    const nextPrefix = `${newline}${bulletMatch[1]}${bulletMatch[2]}${bulletMatch[3]}`
    return { from: cursor, to: cursor, insert: nextPrefix, selectionStart: cursor + nextPrefix.length, selectionEnd: cursor + nextPrefix.length }
  }

  // 3. Ordered list: `  1. text` or `  1) text`
  const orderedMatch = /^(\s*)(\d+)([.)])([ \t]+)(.*)$/.exec(line)
  if (orderedMatch) {
    const prefixLen = orderedMatch[1].length + orderedMatch[2].length + 1 + orderedMatch[4].length
    if (beforeCursor.length < prefixLen) return null
    if (!orderedMatch[5].trim() && cursor >= lineStart + prefixLen) {
      return { from: lineStart, to: lineEnd, insert: '', selectionStart: lineStart, selectionEnd: lineStart }
    }
    const nextNumber = Number(orderedMatch[2]) + 1
    const nextPrefix = `${newline}${orderedMatch[1]}${nextNumber}${orderedMatch[3]}${orderedMatch[4]}`
    return { from: cursor, to: cursor, insert: nextPrefix, selectionStart: cursor + nextPrefix.length, selectionEnd: cursor + nextPrefix.length }
  }

  // 4. Blockquote: `> text` or `> > text` (do not continue callout header `> [!NOTE]` with empty marker issue)
  const quoteMatch = /^((?: {0,3}>[ \t]?)+)(.*)$/.exec(line)
  if (quoteMatch) {
    const prefix = quoteMatch[1]
    if (beforeCursor.length < prefix.length) return null
    if (!quoteMatch[2].trim() && cursor >= lineStart + prefix.length) {
      return { from: lineStart, to: lineEnd, insert: '', selectionStart: lineStart, selectionEnd: lineStart }
    }
    const normalizedPrefix = prefix.endsWith(' ') || prefix.endsWith('\t') ? prefix : `${prefix} `
    const nextPrefix = `${newline}${normalizedPrefix}`
    return { from: cursor, to: cursor, insert: nextPrefix, selectionStart: cursor + nextPrefix.length, selectionEnd: cursor + nextPrefix.length }
  }

  return null
}

/**
 * Smart Tab / Shift+Tab for Markdown list items (indent/outdent by 2 spaces).
 * Returns null if selection is not on a Markdown list item.
 */
export function handleTyporaListIndent(doc: string, from: number, to: number, outdent: boolean): TextEdit | null {
  if (isInsideCodeFence(doc, from)) return null
  const blockStart = doc.lastIndexOf('\n', from - 1) + 1
  const lastPos = to > from && doc[to - 1] === '\n' ? to - 1 : to
  const nextNl = doc.indexOf('\n', lastPos)
  const blockEnd = nextNl === -1 ? doc.length : nextNl
  const slice = doc.slice(blockStart, blockEnd)
  const lines = slice.split('\n')
  const isListLine = (line: string) => /^\s*(?:[-*+]|\d+[.)])[ \t]+/.test(line.replace(/\r$/, ''))
  if (!lines.some(isListLine)) return null

  let firstDelta = 0
  let totalDelta = 0
  const updated = lines.map((line, idx) => {
    if (!outdent) {
      if (idx === 0) firstDelta = 2
      totalDelta += 2
      return `  ${line}`
    }
    const remove = line.startsWith('\t') ? 1 : line.startsWith('  ') ? 2 : line.startsWith(' ') ? 1 : 0
    if (idx === 0) firstDelta = -remove
    totalDelta -= remove
    return line.slice(remove)
  }).join('\n')

  if (updated === slice) return null
  const selectionStart = Math.max(blockStart, from + firstDelta)
  const selectionEnd = Math.max(selectionStart, to + totalDelta)
  return { from: blockStart, to: blockEnd, insert: updated, selectionStart, selectionEnd }
}

/**
 * If text is selected and user pastes an http(s) URL, wrap the selection as `[selected](url)`.
 */
export function smartPasteUrl(doc: string, from: number, to: number, clipboardText: string): TextEdit | null {
  if (from >= to || isInsideCodeFence(doc, from)) return null
  const url = (clipboardText || '').trim()
  if (!/^https?:\/\/[^\s<>]+$/i.test(url)) return null
  const selected = doc.slice(from, to)
  if (!selected.trim() || /[\r\n]/.test(selected) || /^https?:\/\//i.test(selected.trim())) return null
  const escapedLabel = selected.replace(/([\[\]])/g, '\\$1')
  const insert = `[${escapedLabel}](${url})`
  return { from, to, insert, selectionStart: from + insert.length, selectionEnd: from + insert.length }
}

/** Set heading level 1..6 or clear heading back to paragraph (0). */
export function applyHeadingLevel(doc: string, start: number, end: number, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): TextEdit {
  const replaceStart = start === 0 ? 0 : doc.lastIndexOf('\n', start - 1) + 1
  const lastSelected = end > start && doc[end - 1] === '\n' ? end - 1 : end
  const nextLine = doc.indexOf('\n', lastSelected)
  const replaceEnd = nextLine === -1 ? doc.length : nextLine
  const lines = doc.slice(replaceStart, replaceEnd).split('\n')
  const prefix = level === 0 ? '' : `${'#'.repeat(level)} `
  const replacement = lines.map(line => {
    const clean = line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)/, '')
    return prefix + clean
  }).join('\n')
  const selectionStart = replaceStart + (start === end ? replacement.length : 0)
  return { from: replaceStart, to: replaceEnd, insert: replacement, selectionStart, selectionEnd: replaceStart + replacement.length }
}

export type TyporaInlineKind = 'highlight' | 'underline' | 'sub' | 'sup' | 'inline-math'

const INLINE_PAIRS: Record<TyporaInlineKind, [string, string, string]> = {
  highlight: ['==', '==', '高亮文本'],
  underline: ['<u>', '</u>', '下划线'],
  sub: ['~', '~', '下标'],
  sup: ['^', '^', '上标'],
  'inline-math': ['$', '$', 'E = mc^2']
}

/** Toggle Typora-specific inline syntax cleanly without stacking markers infinitely. */
export function toggleTyporaInline(doc: string, start: number, end: number, kind: TyporaInlineKind): TextEdit {
  const [open, close, placeholder] = INLINE_PAIRS[kind]
  const selected = doc.slice(start, end)
  // Unwrap if outer document already wraps the selection with open..close.
  if (
    start >= open.length &&
    end + close.length <= doc.length &&
    doc.slice(start - open.length, start) === open &&
    doc.slice(end, end + close.length) === close
  ) {
    return {
      from: start - open.length,
      to: end + close.length,
      insert: selected,
      selectionStart: start - open.length,
      selectionEnd: end - open.length
    }
  }
  // Unwrap if selection itself starts with open and ends with close.
  if (selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) {
    const inner = selected.slice(open.length, selected.length - close.length)
    return {
      from: start,
      to: end,
      insert: inner,
      selectionStart: start,
      selectionEnd: start + inner.length
    }
  }
  const inner = selected || placeholder
  const insert = `${open}${inner}${close}`
  return {
    from: start,
    to: end,
    insert,
    selectionStart: start + open.length,
    selectionEnd: start + open.length + inner.length
  }
}
