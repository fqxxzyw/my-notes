import MarkdownIt from 'markdown-it'
import { maskFrontmatter } from './outlineSource'

export type OutlineHeading = { level: number; title: string; offset: number }

const parser = new MarkdownIt({ html: false })

/** Read rendered headings and retain their UTF-16 source positions. */
export function markdownOutline(source: string): OutlineHeading[] {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code === 13) {
      if (source.charCodeAt(i + 1) === 10) i++
      offsets.push(i + 1)
    } else if (code === 10) offsets.push(i + 1)
  }
  const tokens = parser.parse(maskFrontmatter(source), {})
  const result: OutlineHeading[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open' || !token.map) continue
    const level = Number(token.tag.slice(1))
    const inline = tokens[i + 1]
    if (!Number.isInteger(level) || level < 1 || level > 6 || inline?.type !== 'inline') continue
    const title = (inline.children || []).map(child => {
      if (child.type === 'text' || child.type === 'code_inline') return child.content
      if (child.type === 'image') return child.content
      if (child.type === 'softbreak' || child.type === 'hardbreak') return ' '
      return ''
    }).join('').trim() || '未命名标题'
    result.push({ level, title, offset: offsets[token.map[0]] ?? 0 })
  }
  return result
}
