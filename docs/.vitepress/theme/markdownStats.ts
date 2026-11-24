/** Typora-style document statistics and Read-mode task toggling helpers. */

export interface DocumentStats {
  chars: number
  charsNoSpace: number
  cjkChars: number
  words: number
  lines: number
  readingMinutes: number
}

/** Compute Typora-like Chinese character + English word count and reading time. */
export function computeDocumentStats(source: string): DocumentStats {
  if (!source) {
    return { chars: 0, charsNoSpace: 0, cjkChars: 0, words: 0, lines: 1, readingMinutes: 0 }
  }
  const chars = source.length
  const charsNoSpace = source.replace(/\s/g, '').length
  const lines = source.split(/\r?\n/).length
  // Strip fenced code markers and URLs so word count feels accurate to prose.
  const stripped = source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  const cjkMatches = stripped.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)
  const cjkChars = cjkMatches ? cjkMatches.length : 0
  const latinMatches = stripped.match(/[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g)
  const latinWords = latinMatches ? latinMatches.length : 0
  const words = cjkChars + latinWords
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 300))
  return { chars, charsNoSpace, cjkChars, words, lines, readingMinutes }
}

/**
 * Safely toggle the `targetIndex`-th Markdown task list item (`[ ]` <-> `[x]`)
 * while ignoring code fences. Returns the updated Markdown string, or null if not found.
 */
export function toggleMarkdownTaskAtIndex(source: string, targetIndex: number): string | null {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null
  const lines = source.split(/(\r?\n)/)
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0
  let seen = 0

  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]
    const trimmed = line.replace(/^(?: {0,3}>[ \t]?)+/, '')
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(trimmed)
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen && !trimmed.slice(fenceMatch[0].length).trim()) {
        inFence = false
      }
      continue
    }
    if (fenceMatch) {
      inFence = true
      fenceChar = fenceMatch[1][0]
      fenceLen = fenceMatch[1].length
      continue
    }
    const taskMatch = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\](?:[ \t]|$))/.exec(line)
    if (taskMatch) {
      if (seen === targetIndex) {
        const nextMark = taskMatch[2].toLowerCase() === 'x' ? ' ' : 'x'
        lines[i] = taskMatch[1] + nextMark + taskMatch[3] + line.slice(taskMatch[0].length)
        return lines.join('')
      }
      seen++
    }
  }
  return null
}
