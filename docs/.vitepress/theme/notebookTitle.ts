/** Helpers for updating notebook/chapter/page titles without losing metadata or changing IDs. */

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
