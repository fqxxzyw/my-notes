/**
 * Structured GFM Markdown table parser, mutator, and serializer.
 * Supports arbitrary inline Markdown inside cells (bold, code, links, escaped pipes),
 * row/column insertion & deletion, and per-column alignment.
 */

export type TableAlignment = 'none' | 'left' | 'center' | 'right'

export interface MarkdownTable {
  headers: string[]
  alignments: TableAlignment[]
  rows: string[][]
  newline: '\n' | '\r\n'
}

/** Split one GFM table line into raw cell strings, respecting `\|` escapes. */
function splitTableRow(line: string): string[] {
  const separators: number[] = []
  let escaped = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '|') separators.push(i)
  }
  const leading = /^\s*\|/.test(line)
  const trailing = /(?:^|[^\\])(?:\\\\)*\|\s*$/.test(line)
  const bounds: number[] = []
  const ends: number[] = []
  const seps = [...separators]
  let start = 0
  if (leading && seps.length) start = seps.shift()! + 1
  bounds.push(start)
  for (const idx of seps) {
    ends.push(idx)
    bounds.push(idx + 1)
  }
  ends.push(line.length)
  if (trailing && bounds.length > 1) {
    bounds.pop()
    ends.pop()
  }
  return bounds.map((from, i) => unescapeTableCell(line.slice(from, ends[i]).trim()))
}

/** Unescape `\|` -> `|` for comfortable cell editing while keeping other Markdown intact. */
export function unescapeTableCell(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && raw[i + 1] === '|') {
      out += '|'
      i++
    } else {
      out += raw[i]
    }
  }
  return out
}

/** Escape unescaped pipes `|` so cell text never breaks GFM table column boundaries. */
export function escapeTableCell(text: string): string {
  const singleLine = text.replace(/\r?\n/g, ' ').trim()
  let out = ''
  let backslashes = 0
  for (let i = 0; i < singleLine.length; i++) {
    const ch = singleLine[i]
    if (ch === '\\') {
      backslashes++
      out += ch
    } else if (ch === '|') {
      if (backslashes % 2 === 0) out += '\\|'
      else out += '|'
      backslashes = 0
    } else {
      backslashes = 0
      out += ch
    }
  }
  return out
}

function parseAlignmentCell(cell: string): TableAlignment | null {
  const trimmed = cell.trim()
  if (!/^:?-{1,}:?$/.test(trimmed)) return null
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return 'none'
}

function formatAlignmentCell(align: TableAlignment): string {
  if (align === 'left') return ':---'
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

/** Parse a GFM Markdown table block into a structured editable model. */
export function parseMarkdownTable(source: string): MarkdownTable | null {
  if (!source || !source.includes('|')) return null
  const newline: '\n' | '\r\n' = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/).filter((line, index, arr) => index < arr.length - 1 || line.trim() !== '')
  if (lines.length < 2) return null

  const headerCells = splitTableRow(lines[0])
  const alignRaw = splitTableRow(lines[1])
  if (!headerCells.length || alignRaw.length !== headerCells.length) return null

  const alignments: TableAlignment[] = []
  for (const cell of alignRaw) {
    const parsed = parseAlignmentCell(cell)
    if (parsed === null) return null
    alignments.push(parsed)
  }

  const colCount = headerCells.length
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].includes('|')) return null
    const cells = splitTableRow(lines[i])
    const normalized = Array.from({ length: colCount }, (_, col) => cells[col] ?? '')
    rows.push(normalized)
  }

  return { headers: headerCells, alignments, rows, newline }
}

/** Serialize a structured table back into clean GFM Markdown. */
export function serializeMarkdownTable(table: MarkdownTable): string {
  const colCount = table.headers.length
  if (!colCount) return ''
  const formatRow = (cells: string[]) =>
    `| ${Array.from({ length: colCount }, (_, i) => escapeTableCell(cells[i] ?? '')).join(' | ')} |`
  const headerLine = formatRow(table.headers)
  const alignLine = `| ${Array.from({ length: colCount }, (_, i) => formatAlignmentCell(table.alignments[i] ?? 'none')).join(' | ')} |`
  const bodyLines = table.rows.map(formatRow)
  return [headerLine, alignLine, ...bodyLines].join(table.newline)
}

/** Update any cell (`row === 0` is header, `row >= 1` is body row `row - 1`). */
export function updateTableCell(table: MarkdownTable, row: number, col: number, value: string): MarkdownTable {
  if (col < 0 || col >= table.headers.length) return table
  const clean = value.replace(/\r?\n/g, ' ')
  if (row === 0) {
    const headers = [...table.headers]
    headers[col] = clean
    return { ...table, headers }
  }
  const bodyIndex = row - 1
  if (bodyIndex < 0 || bodyIndex >= table.rows.length) return table
  const rows = table.rows.map((r, i) => (i === bodyIndex ? r.map((cell, c) => (c === col ? clean : cell)) : r))
  return { ...table, rows }
}

/** Insert a blank body row at `bodyIndex` (0..rows.length). */
export function insertTableRow(table: MarkdownTable, bodyIndex: number): MarkdownTable {
  const clamped = Math.max(0, Math.min(table.rows.length, bodyIndex))
  const emptyRow = Array.from({ length: table.headers.length }, () => '')
  const rows = [...table.rows.slice(0, clamped), emptyRow, ...table.rows.slice(clamped)]
  return { ...table, rows }
}

/** Delete a body row (0..rows.length - 1). Keeps at least 0 body rows safely. */
export function deleteTableRow(table: MarkdownTable, bodyIndex: number): MarkdownTable {
  if (bodyIndex < 0 || bodyIndex >= table.rows.length) return table
  return { ...table, rows: table.rows.filter((_, i) => i !== bodyIndex) }
}

/** Insert a new column at `colIndex` (0..headers.length). */
export function insertTableColumn(table: MarkdownTable, colIndex: number, headerLabel = '新列'): MarkdownTable {
  const clamped = Math.max(0, Math.min(table.headers.length, colIndex))
  const headers = [...table.headers.slice(0, clamped), headerLabel, ...table.headers.slice(clamped)]
  const alignments = [...table.alignments.slice(0, clamped), 'none' as TableAlignment, ...table.alignments.slice(clamped)]
  const rows = table.rows.map(row => [...row.slice(0, clamped), '', ...row.slice(clamped)])
  return { ...table, headers, alignments, rows }
}

/** Delete a column if at least two columns exist. */
export function deleteTableColumn(table: MarkdownTable, colIndex: number): MarkdownTable {
  if (table.headers.length <= 1 || colIndex < 0 || colIndex >= table.headers.length) return table
  return {
    ...table,
    headers: table.headers.filter((_, i) => i !== colIndex),
    alignments: table.alignments.filter((_, i) => i !== colIndex),
    rows: table.rows.map(row => row.filter((_, i) => i !== colIndex))
  }
}

/** Set alignment for a column. */
export function setTableColumnAlign(table: MarkdownTable, colIndex: number, align: TableAlignment): MarkdownTable {
  if (colIndex < 0 || colIndex >= table.alignments.length) return table
  const alignments = table.alignments.map((a, i) => (i === colIndex ? align : a))
  return { ...table, alignments }
}
