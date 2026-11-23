import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { markdownEditorLanguage } from './editorHighlight.js'

const formats = {
  bold: { node: 'StrongEmphasis', marker: '**' },
  italic: { node: 'Emphasis', marker: '*' },
  strike: { node: 'Strikethrough', marker: '~~' },
  'inline-code': { node: 'InlineCode', marker: '`' }
}

// CommonMark requires non-whitespace next to formatting delimiters. Keeping
// selected edge whitespace outside the delimiters makes the result render.
function wrap(source, marker, isCode = false) {
  const leading = /^\s*/u.exec(source)[0]
  const trailing = /\s*$/u.exec(source)[0]
  const body = source.slice(leading.length, source.length - trailing.length)
  if (!body) return { text: source, from: 0, to: source.length }
  // CommonMark code spans need a separating space when the contents begin or
  // end with a backtick, otherwise the delimiter merges with the contents.
  const padding = isCode && (/^`|`$/u.test(body)) ? ' ' : ''
  return { text: `${leading}${marker}${padding}${body}${padding}${marker}${trailing}`, from: leading.length + marker.length + padding.length, to: leading.length + marker.length + padding.length + body.length }
}

/** Compute an undoable single edit, based on Markdown syntax, not raw stars. */
export function toggleInlineFormat(source, start, end, kind) {
  const format = formats[kind]
  if (!format || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) return null
  const selection = source.slice(start, end)
  if (start === end) {
    const placeholder = kind === 'inline-code' ? '代码' : '文字'
    const text = `${format.marker}${placeholder}${format.marker}`
    return { from: start, to: end, text, selectionStart: start + format.marker.length, selectionEnd: start + format.marker.length + placeholder.length }
  }
  const state = EditorState.create({ doc: source, extensions: [EditorState.lineSeparator.of('\n'), markdownEditorLanguage] })
  const candidates = []
  let crossesBoundary = false
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== format.node) return
    const first = node.node.firstChild, last = node.node.lastChild
    if (!first || !last || first === last || first.to > last.from) return
    const inside = start >= first.to && end <= last.from
    const all = start <= node.from && end >= node.to && /^\s*$/u.test(source.slice(start, node.from)) && /^\s*$/u.test(source.slice(node.to, end))
    const entirelyIncluded = start <= node.from && end >= node.to
    if (inside || all) candidates.push({ from: node.from, to: node.to, first, last, inside, all })
    else if (!entirelyIncluded && start < node.to && end > node.from) crossesBoundary = true
  } })
  candidates.sort((a, b) => (a.to - a.from) - (b.to - b.from))
  const node = candidates[0]
  if (node) {
    const content = source.slice(node.first.to, node.last.from)
    if (kind === 'inline-code' && content.startsWith(' ') && content.endsWith(' ') && /\S/u.test(content) &&
        (!node.inside || (start === node.first.to + 1 && end === node.last.from - 1))) {
      const unpadded = content.slice(1, -1)
      return { from: node.from, to: node.to, text: unpadded, selectionStart: node.from, selectionEnd: node.from + unpadded.length }
    }
    const selectedStart = node.inside ? start - node.first.to : 0
    const selectedEnd = node.inside ? end - node.first.to : content.length
    if (selectedStart === 0 && selectedEnd === content.length) {
      const before = node.all ? source.slice(start, node.from) : ''
      const after = node.all ? source.slice(node.to, end) : ''
      const from = node.all ? start : node.from
      return { from, to: node.all ? end : node.to, text: before + content + after, selectionStart: from + before.length, selectionEnd: from + before.length + content.length }
    }
    // Selecting the whole visible inner text of a nested strong/emphasis span
    // should remove the outer style without stripping the inner markers.
    const prefix = content.slice(0, selectedStart), suffix = content.slice(selectedEnd)
    if (['**', '__', '*', '_', '~~'].some(mark => prefix === mark && suffix === mark)) {
      return { from: node.from, to: node.to, text: content, selectionStart: node.from + selectedStart, selectionEnd: node.from + selectedEnd }
    }
    // Splitting across nested syntax may invalidate it. Leave complex markup
    // untouched instead of damaging formatting outside the selection.
    if (/[*_`~\r\n]/u.test(content)) return null
    const marker = source.slice(node.first.from, node.first.to)
    const left = wrap(content.slice(0, selectedStart), marker).text
    const middle = content.slice(selectedStart, selectedEnd)
    const right = wrap(content.slice(selectedEnd), marker).text
    return { from: node.from, to: node.to, text: left + middle + right, selectionStart: node.from + left.length, selectionEnd: node.from + left.length + middle.length }
  }
  if (crossesBoundary) return null
  // Remove complete same-style spans within the selection first; wrapping
  // them again would produce ambiguous sequences such as ****text**.
  const marks = []
  if (kind !== 'inline-code') syntaxTree(state).iterate({ enter(node) {
    if (node.name !== format.node || node.from < start || node.to > end) return
    const first = node.node.firstChild, last = node.node.lastChild
    if (!first || !last || first === last) return
    marks.push([first.from - start, first.to - start], [last.from - start, last.to - start])
  } })
  let selected = selection
  for (const [from, to] of marks.sort((a, b) => b[0] - a[0])) selected = selected.slice(0, from) + selected.slice(to)
  const marker = kind === 'inline-code' ? '`'.repeat(Math.max(1, ...Array.from(selected.matchAll(/`+/g), match => match[0].length + 1))) : format.marker
  const result = wrap(selected, marker, kind === 'inline-code')
  if (result.text !== selected) {
    const nextSource = source.slice(0, start) + result.text + source.slice(end)
    const nextState = EditorState.create({ doc: nextSource, extensions: [EditorState.lineSeparator.of('\n'), markdownEditorLanguage] })
    const selectedFrom = start + result.from, selectedTo = start + result.to
    let rendered = false
    syntaxTree(nextState).iterate({ enter(node) {
      if (node.name !== format.node) return
      const first = node.node.firstChild, last = node.node.lastChild
      if (first && last && selectedFrom >= first.to && selectedTo <= last.from) rendered = true
    } })
    // A blank paragraph, fenced code, or another block boundary can make an
    // apparent pair of markers invalid. Do not insert markup that cannot render.
    if (!rendered) return null
  }
  return { from: start, to: end, text: result.text, selectionStart: start + result.from, selectionEnd: start + result.to }
}
