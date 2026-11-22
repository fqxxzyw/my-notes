/** Hide YAML front matter from heading parsing without changing any offsets. */
function frontmatter(source: string): { opening: number; end: number } | null {
  const opening = /^\uFEFF?---[ \t]*(?:\r\n|\r|\n)/.exec(source)
  if (!opening) return null
  const remainder = source.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\r|\n|$)/m.exec(remainder)
  return { opening: opening[0].length, end: closing && closing.index !== undefined ? opening[0].length + closing.index + closing[0].length : 0 }
}

export function hasUnclosedFrontmatter(source: string): boolean {
  const block = frontmatter(source)
  return !!block && !block.end
}

export function maskFrontmatter(source: string): string {
  const end = frontmatter(source)?.end || 0
  if (!end) return source
  return source.slice(0, end).replace(/[^\r\n]/g, ' ') + source.slice(end)
}
