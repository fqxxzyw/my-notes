import MarkdownIt from 'markdown-it'

const utilities = new MarkdownIt({ html: false })
const IMAGE_TAG = /^<img(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>/i

/** Safely render one Typora image without permitting other HTML or CSS. */
export function renderSafeHtmlImage(raw: string): string | null {
  const tag = IMAGE_TAG.exec(raw)?.[0]
  if (!tag || tag !== raw) return null
  const body = tag.slice(4, -1).replace(/\/\s*$/, '')
  const attributes = new Map<string, string>()
  let index = 0
  while (index < body.length) {
    const spaces = /^\s+/.exec(body.slice(index))
    if (!spaces) return null
    index += spaces[0].length
    if (index === body.length) break
    const name = /^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(body.slice(index))
    if (!name) return null
    index += name[0].length
    while (/\s/.test(body[index] || '')) index++
    let value = ''
    if (body[index] === '=') {
      index++
      while (/\s/.test(body[index] || '')) index++
      const quote = body[index]
      if (quote === '"' || quote === "'") {
        const end = body.indexOf(quote, index + 1)
        if (end < 0) return null
        value = body.slice(index + 1, end); index = end + 1
      } else {
        const match = /^[^\s"'`=<>]+/.exec(body.slice(index))
        if (!match) return null
        value = match[0]; index += value.length
      }
    }
    const key = name[0].toLowerCase()
    if (attributes.has(key)) return null
    attributes.set(key, utilities.utils.unescapeAll(value))
  }
  const original = attributes.get('src')?.trim() || ''
  if (!original || /[\u0000-\u001f\u007f]/.test(original)) return null
  const src = utilities.normalizeLink(original)
  // Blob URLs are granted only by the app's attachment hydration. Never trust
  // one supplied as note content, or other custom URL schemes.
  if (!utilities.validateLink(src) || (/^[a-z][a-z\d+.-]*:/i.test(src) && !/^https?:\/\//i.test(src) && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src))) return null
  const escape = utilities.utils.escapeHtml
  const output = [`src="${escape(src)}"`, `alt="${escape(attributes.get('alt') || '')}"`]
  if (attributes.has('title')) output.push(`title="${escape(attributes.get('title')!)}"`)
  for (const dimension of ['width', 'height']) {
    const value = attributes.get(dimension) || ''
    if (/^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) <= 10000) output.push(`${dimension}="${value}"`)
  }
  const zoom = /^\s*zoom\s*:\s*(\d+(?:\.\d+)?)\s*(%)?\s*;?\s*$/i.exec(attributes.get('style') || '')
  if (zoom) {
    const value = Number(zoom[1]), percent = zoom[2] ? value : value * 100
    if (percent >= 1 && percent <= 400) output.push(`style="zoom:${percent}%"`)
  }
  return `<img ${output.join(' ')}>`
}

/** Recognize only a single sanitized image. All other raw HTML stays escaped. */
export function enableSafeHtmlImages(markdown: MarkdownIt): void {
  markdown.inline.ruler.before('html_inline', 'paper-safe-image', (state, silent) => {
    if (!/^<img(?=[\s/>])/i.test(state.src.slice(state.pos, state.pos + 5))) return false
    // Raw HTML is otherwise escaped. In particular, a lookalike inside an
    // HTML comment or raw-text element must not become a live image request.
    const prefix = state.src.slice(0, state.pos).toLowerCase()
    if (prefix.lastIndexOf('<!--') > prefix.lastIndexOf('-->')) return false
    for (const name of ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']) {
      const opening = new RegExp(`<${name}(?:\\s|>)`, 'g')
      const closing = new RegExp(`</${name}\\s*>`, 'g')
      let opened = -1, closed = -1, match: RegExpExecArray | null
      while ((match = opening.exec(prefix))) opened = match.index
      while ((match = closing.exec(prefix))) closed = match.index
      if (opened > closed) return false
    }
    const tag = IMAGE_TAG.exec(state.src.slice(state.pos))?.[0]
    const html = tag && renderSafeHtmlImage(tag)
    if (!html) return false
    if (!silent) { const token = state.push('html_inline', '', 0); token.content = html }
    state.pos += tag.length
    return true
  })
}
