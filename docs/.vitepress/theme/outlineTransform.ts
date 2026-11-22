import MarkdownIt from 'markdown-it'
import { hasUnclosedFrontmatter, maskFrontmatter } from './outlineSource'
import { markdownOutline, type OutlineHeading } from './markdownOutline'

const parser = new MarkdownIt({ html: false })
type Heading = { offset: number; lineEnd: number; tokenEnd: number; level: number; markup: string }
export type OutlineChange = { text: string; focus: number }

function lineOffsets(source: string): number[] {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r') { if (source[i + 1] === '\n') i++; offsets.push(i + 1) }
    else if (source[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

/** Only root-level headings delimit movable sections; quoted/code headings stay untouched. */
function headings(source: string): Heading[] {
  const offsets = lineOffsets(source)
  return parser.parse(maskFrontmatter(source), {}).flatMap(token => {
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map) return []
    const level = Number(token.tag.slice(1))
    if (!Number.isInteger(level) || level < 1 || level > 6) return []
    return [{ offset: offsets[token.map[0]] ?? source.length, lineEnd: offsets[token.map[0] + 1] ?? source.length,
      tokenEnd: offsets[token.map[1]] ?? source.length, level, markup: token.markup }]
  })
}

/** Headings embedded in blockquotes or lists can be navigated, but not moved. */
export function movableOutlineOffsets(source: string): number[] {
  return headings(source).map(item => item.offset)
}

function endOfSection(items: Heading[], index: number, length: number): number {
  const level = items[index].level
  for (let i = index + 1; i < items.length; i++) if (items[i].level <= level) return items[i].offset
  return length
}

function validateOutline(text: string, expected: Pick<OutlineHeading, 'level' | 'title'>[]) {
  const actual = markdownOutline(text)
  if (actual.length !== expected.length || actual.some((item, index) => item.level !== expected[index].level || item.title !== expected[index].title)) {
    throw new Error('移动后 Markdown 标题结构会发生意外变化（例如未闭合代码块），请先检查格式。')
  }
}

function adjust(source: string, items: Heading[], index: number, delta: number): string {
  const start = items[index].offset, end = endOfSection(items, index, source.length)
  const relevant = items.slice(index).filter(item => item.offset < end)
  if (relevant.some(item => item.level + delta < 1 || item.level + delta > 6)) {
    throw new Error('调整后标题层级必须在一级到六级之间，请先调整子标题。')
  }
  if (!delta) return source.slice(start, end)
  let block = source.slice(start, end)
  // Work backwards so source positions remain valid. Never rewrite code fences.
  for (const item of [...relevant].reverse()) {
    const relativeStart = item.offset - start, relativeLineEnd = item.lineEnd - start, relativeTokenEnd = item.tokenEnd - start
    const line = block.slice(relativeStart, relativeLineEnd)
    if (item.markup[0] === '#') {
      const match = /^( {0,3})(#{1,6})(?=[ \t\r\n]|$)/.exec(line)
      if (!match || match[2].length !== item.level) throw new Error('无法安全调整该标题，请先检查 Markdown 格式。')
      const markerAt = relativeStart + match[1].length
      block = block.slice(0, markerAt) + '#'.repeat(item.level + delta) + block.slice(markerAt + match[2].length)
    } else {
      // A multi-line Setext heading cannot become ATX without changing its text.
      const token = block.slice(relativeStart, relativeTokenEnd)
      const tokenLines = token.split(/\r\n|\r|\n/)
      if (tokenLines.length < 2 || tokenLines.slice(2).some(Boolean)) throw new Error('多行 Setext 标题无法安全调整，请先改为 # 标题。')
      const textLine = line.replace(/(\r\n|\r|\n)$/, '')
      const lineBreak = /(?:\r\n|\r|\n)$/.exec(token)?.[0] || ''
      const prefix = /^( {0,3})/.exec(textLine)?.[0] || ''
      const replacement = prefix + '#'.repeat(item.level + delta) + ' ' + textLine.slice(prefix.length) + lineBreak
      block = block.slice(0, relativeStart) + replacement + block.slice(relativeTokenEnd)
    }
  }
  return block
}

/** Move the source section to the end of the target's children and make it a child. */
export function moveOutlineSection(source: string, sourceOffset: number, targetOffset: number): OutlineChange {
  if (hasUnclosedFrontmatter(source)) throw new Error('文档开头的 front matter 尚未闭合，请先补全后再调整标题。')
  const items = headings(source)
  const from = items.findIndex(item => item.offset === sourceOffset), to = items.findIndex(item => item.offset === targetOffset)
  if (from < 0 || to < 0) throw new Error('该标题无法拖动，请选择正文中的普通标题。')
  const start = items[from].offset, end = endOfSection(items, from, source.length)
  if (targetOffset >= start && targetOffset < end) throw new Error('不能把标题拖到自身或自己的子标题中。')
  const targetEnd = endOfSection(items, to, source.length)
  const delta = items[to].level + 1 - items[from].level
  const block = adjust(source, items, from, delta)
  const without = source.slice(0, start) + source.slice(end)
  const destination = targetEnd > start ? targetEnd - (end - start) : targetEnd
  const left = without.slice(0, destination), right = without.slice(destination)
  const newline = /\r\n|\r|\n/.exec(source)?.[0] || '\n'
  const before = left && !/[\r\n]$/.test(left) ? newline : ''
  const after = right && !/[\r\n]$/.test(block) ? newline : ''
  const text = left + before + block + after + right
  const oldOutline = markdownOutline(source), topLevel = new Set(items.map(item => item.offset))
  const outside = oldOutline.filter(item => item.offset < start || item.offset >= end)
  const moved = oldOutline.filter(item => item.offset >= start && item.offset < end)
    .map(item => ({ ...item, level: item.level + (topLevel.has(item.offset) ? delta : 0) }))
  validateOutline(text, [...outside.filter(item => item.offset < targetEnd), ...moved, ...outside.filter(item => item.offset >= targetEnd)])
  return { text, focus: left.length + before.length }
}

/** Shift a heading and all of its child headings without moving the section. */
export function shiftOutlineSection(source: string, sourceOffset: number, delta: -1 | 1): OutlineChange {
  if (hasUnclosedFrontmatter(source)) throw new Error('文档开头的 front matter 尚未闭合，请先补全后再调整标题。')
  const items = headings(source)
  const index = items.findIndex(item => item.offset === sourceOffset)
  if (index < 0) throw new Error('该标题无法调整，请选择正文中的普通标题。')
  const end = endOfSection(items, index, source.length)
  const text = source.slice(0, sourceOffset) + adjust(source, items, index, delta) + source.slice(end)
  const topLevel = new Set(items.map(item => item.offset))
  validateOutline(text, markdownOutline(source).map(item => ({ ...item, level: item.offset >= sourceOffset && item.offset < end && topLevel.has(item.offset) ? item.level + delta : item.level })))
  return { text, focus: sourceOffset }
}
