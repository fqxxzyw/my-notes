import { syntaxTree } from '@codemirror/language'
import { findClusterBreak } from '@codemirror/state'

const inlineTypes = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'])

/** Skip invisible delimiters when deleting the adjacent visible character. */
export function visibleInlineEditPosition(state, position, direction) {
  let current = position
  let moved = false
  let adjacent = false
  for (let depth = 0; depth < 32; depth++) {
    let next = null
    syntaxTree(state).iterate({ from: Math.max(0, current - 1), to: Math.min(state.doc.length, current + 1), enter(node) {
      let openFrom, openTo, closeFrom, closeTo
      if (node.name === 'Link') {
        const marks = node.node.getChildren('LinkMark')
        if (!marks[0] || !marks[1] || marks[0].to >= marks[1].from) return
        openFrom = marks[0].from; openTo = marks[0].to
        closeFrom = marks[1].from; closeTo = node.to
      } else {
        if (!inlineTypes.has(node.name)) return
        const first = node.node.firstChild, last = node.node.lastChild
        if (!first || !last || first === last || first.to >= last.from) return
        openFrom = first.from; openTo = first.to; closeFrom = last.from; closeTo = last.to
      }
      if (direction === -1 && closeTo === current) next = closeFrom
      else if (direction === -1 && openTo === current) next = openFrom
      if (direction === 1 && openFrom === current) next = openTo
      else if (direction === 1 && closeFrom === current) next = closeTo
      if (direction === -1 && closeFrom === current || direction === 1 && openTo === current) adjacent = true
    } })
    if (next === null || next === current) break
    current = next
    moved = true
  }
  return moved || adjacent ? current : null
}

/** Remove empty formatting wrappers with their final visible grapheme.
 * Links are never removed because their URL is user content.
 */
export function emptyInlineDeletion(state, position, direction) {
  const cursor = visibleInlineEditPosition(state, position, direction) ?? position
  const wrappers = []
  syntaxTree(state).iterate({ from: Math.max(0, cursor - 1), to: Math.min(state.doc.length, cursor + 1), enter(node) {
    if (!inlineTypes.has(node.name)) return
    const first = node.node.firstChild, last = node.node.lastChild
    if (!first || !last || first === last || first.to >= last.from) return
    wrappers.push({ from: node.from, to: node.to, first: first.to, last: last.from })
  } })
  const candidates = wrappers.filter(w => {
    if (direction === -1 ? w.last !== cursor : w.first !== cursor) return false
    const text = state.sliceDoc(w.first, w.last)
    return text.length > 0 && findClusterBreak(text, 0, true) === text.length
  }).sort((a, b) => (a.to - a.from) - (b.to - b.from))
  let current = candidates[0]
  if (!current) return null
  // Unwrap only ancestors that contain precisely this wrapper, so unrelated
  // text, links and URLs are never deleted along with the last character.
  for (;;) {
    const parent = wrappers.find(w => w.first === current.from && w.last === current.to)
    if (!parent) break
    current = parent
  }
  let edit = { from: current.from, to: current.to, text: '' }
  // If removing an edge child leaves whitespace next to an outer delimiter,
  // keep that whitespace outside the marker so the remaining text still
  // renders as Markdown (e.g. **长 *a*** → **长** ).
  for (let depth = 0; depth < 32; depth++) {
    const parent = wrappers.filter(w => w.first <= edit.from && edit.to <= w.last && (w.first === edit.from || w.last === edit.to))
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]
    if (!parent) break
    const body = state.sliceDoc(parent.first, edit.from) + edit.text + state.sliceDoc(edit.to, parent.last)
    const leading = /^\s*/u.exec(body)[0]
    const trailing = /\s*$/u.exec(body)[0]
    if (!leading && !trailing) break
    const text = body.slice(leading.length, body.length - trailing.length)
    const replacement = text ? leading + state.sliceDoc(parent.from, parent.first) + text + state.sliceDoc(parent.last, parent.to) + trailing : body
    edit = { from: parent.from, to: parent.to, text: replacement }
  }
  return edit.text ? edit : { from: edit.from, to: edit.to }
}
