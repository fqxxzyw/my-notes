import MarkdownIt from 'markdown-it'
import { markdownEditorLanguage } from './editorHighlight.js'
import { htmlImageReferences } from './htmlImageRefs'
import { windowsImagePath } from './readDroppedMarkdown'

const parser = new MarkdownIt({ html: true })
// This parser is only used to locate source text after a file has been
// selected/read by the importer. It never renders or loads the file URI.
const safeLink = parser.validateLink.bind(parser)
parser.validateLink = target => safeLink(target) || /^file:/i.test(target) && windowsImagePath(target) !== null

/** Rewrite only image destinations; leave code, links and other attributes untouched. */
export function rewriteImportedImages(source: string, destinations: ReadonlyMap<string, string>): { content: string; replaced: string[] } {
  if (!destinations.size) return { content: source, replaced: [] }
  const environment: Record<string, unknown> = {}
  parser.parse(source, environment)
  // EditorState's syntaxTree can be incomplete for long documents until the
  // editor finishes background parsing. Import must process the whole file.
  const tree = markdownEditorLanguage.language.parser.parse(source)
  const edits: Array<{ from: number; to: number; text: string; target: string }> = []
  for (const image of htmlImageReferences(source)) {
    const destination = destinations.get(image.src)
    if (destination && /^assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/.test(destination)) {
      edits.push({ from: image.from, to: image.to, text: destination, target: image.src })
    }
  }
  tree.iterate({ enter(node) {
    if (node.name !== 'Image') return
    const raw = source.slice(node.from, node.to)
    const inline = parser.parseInline(raw, environment)[0]?.children || []
    const image = inline.find(token => token.type === 'image')
    const target = image?.attrGet('src')
    const destination = target && destinations.get(target)
    if (!destination || !/^assets\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/.test(destination)) return
    let url = node.node.firstChild
    while (url && url.name !== 'URL') url = url.nextSibling
    if (url) {
      const original = source.slice(url.from, url.to)
      edits.push({ from: url.from, to: url.to, text: original.startsWith('<') && original.endsWith('>') ? `<${destination}>` : destination, target })
      return false
    }
    // Reference definitions may also be used by ordinary links. Convert only
    // the image occurrence into an inline image; preserve the definition.
    let marker = node.node.firstChild
    if (!marker || marker.name !== 'LinkMark') return
    const altStart = marker.to
    marker = marker.nextSibling
    while (marker && !(marker.name === 'LinkMark' && source.slice(marker.from, marker.to) === ']')) marker = marker.nextSibling
    if (!marker) return
    const alt = source.slice(altStart, marker.from)
    const title = image?.attrGet('title')
    edits.push({ from: node.from, to: node.to, text: `![${alt}](${destination}${title ? ` ${JSON.stringify(title)}` : ''})`, target })
    return false
  } })
  let content = source
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) content = content.slice(0, edit.from) + edit.text + content.slice(edit.to)
  return { content, replaced: [...new Set(edits.map(edit => edit.target))] }
}
