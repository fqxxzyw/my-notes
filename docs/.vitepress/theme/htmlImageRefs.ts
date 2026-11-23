import MarkdownIt from 'markdown-it'
import { markdownEditorLanguage } from './editorHighlight.js'

const parser = new MarkdownIt({ html: true })

/** A source range covers only the raw attribute value, without its quotes. */
export type HtmlImageReference = { src: string; from: number; to: number }

// HTML tags cannot be parsed by /<img[^>]*>/ because attributes may contain
// quoted > characters, and fake tags can occur in comments or script text.
function tagEnd(text: string, start: number): number {
  let quote = ''
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i + 1
  }
  return -1
}

function imageSource(tag: string, offset: number): HtmlImageReference | null {
  const name = /^<img(?=[\s/>])/i.exec(tag)
  if (!name) return null
  let i = name[0].length
  let source: { from: number; to: number } | null = null
  while (i < tag.length) {
    while (/\s/.test(tag[i] || '')) i++
    if (i >= tag.length || tag[i] === '>' || (tag[i] === '/' && tag[i + 1] === '>')) break
    const begin = i
    while (i < tag.length && !/[\s"'<>/=]/.test(tag[i])) i++
    if (i === begin) return null
    const key = tag.slice(begin, i).toLowerCase()
    while (/\s/.test(tag[i] || '')) i++
    if (tag[i] !== '=') { if (key === 'src') return null; continue }
    i++
    while (/\s/.test(tag[i] || '')) i++
    let valueStart = i, valueEnd = i
    if (tag[i] === '"' || tag[i] === "'") {
      const quote = tag[i++]
      valueStart = i
      while (i < tag.length && tag[i] !== quote) i++
      if (i >= tag.length) return null
      valueEnd = i++
    } else {
      valueStart = i
      while (i < tag.length && !/[\s"'=<>`]/.test(tag[i])) i++
      valueEnd = i
      if (valueStart === valueEnd) return null
    }
    if (key === 'src') {
      // Duplicate src values are ambiguous: do not guess what to import.
      if (source) return null
      source = { from: valueStart, to: valueEnd }
    }
  }
  if (!source) return null
  const raw = tag.slice(source.from, source.to)
  const src = parser.normalizeLink(parser.utils.unescapeAll(raw.trim()))
  return src ? { src, from: offset + source.from, to: offset + source.to } : null
}

function scanHtml(text: string, offset: number, found: HtmlImageReference[]) {
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('<', i)
    if (start < 0) break
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4)
      if (end < 0) break
      i = end + 3
      continue
    }
    const end = tagEnd(text, start)
    if (end < 0) break
    const tag = text.slice(start, end)
    const image = imageSource(tag, offset + start)
    if (image) found.push(image)
    // Text inside these tags is raw text, not nested HTML elements.
    const raw = /^<(script|style|textarea|title)(?=[\s/>])/i.exec(tag)
    if (raw && !/\/\s*>$/.test(tag)) {
      const close = new RegExp(`<\\/${raw[1]}\\s*>`, 'ig')
      close.lastIndex = end
      const match = close.exec(text)
      i = match ? match.index + match[0].length : text.length
    } else i = end
  }
}

/** Find actual HTML image tags only; Markdown code blocks, inline code and
 * comments are excluded by the Markdown syntax tree, without editing text. */
export function htmlImageReferences(source: string): HtmlImageReference[] {
  const found: HtmlImageReference[] = []
  markdownEditorLanguage.language.parser.parse(source).iterate({ enter(node) {
    if (node.name !== 'HTMLTag' && node.name !== 'HTMLBlock' && node.name !== 'CommentBlock') return
    scanHtml(source.slice(node.from, node.to), node.from, found)
    return false
  } })
  return found
}
