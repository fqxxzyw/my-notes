// Keep user-owned index.md content intact. The app owns only this single line.
// Only the final line belongs to the app; identical-looking lines elsewhere may
// be user-written examples and must never be rewritten.
const marker = /(?:^|\n)(<!-- paper-notes-description:(.*?) -->)(\r?\n)?$/

export function readNotebookDescription(content: string): string {
  const match = marker.exec(content)
  if (!match) return ''
  try {
    const value: unknown = JSON.parse(match[2])
    return typeof value === 'string' && value.length <= 500 ? value : ''
  } catch { return '' }
}

export function writeNotebookDescription(content: string, description: string): string {
  if (description.length > 500) throw new Error('简介不能超过 500 个字符。')
  const match = marker.exec(content)
  if (!match && !description) return content
  // Escaping hyphens prevents a user-entered "-->" from ending the comment.
  const encoded = JSON.stringify(description).replace(/-/g, '\\u002d')
  const line = `<!-- paper-notes-description:${encoded} -->`
  if (match) {
    try { if (typeof JSON.parse(match[2]) !== 'string') throw new Error() }
    catch { throw new Error('笔记本简介标记格式无效，请先检查原文件。') }
    const start = match.index! + (match[0].startsWith('\n') ? 1 : 0)
    return content.slice(0, start) + line + (match[3] || '')
  }
  return content + (content.endsWith('\n') ? '' : '\n') + line + '\n'
}
