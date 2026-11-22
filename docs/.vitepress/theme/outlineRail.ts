import type { OutlineHeading } from './markdownOutline'

/** Pick a heading by its source offset, retaining duplicate titles as distinct entries. */
export function nearestHeadingIndex(headings: OutlineHeading[], offset: number): number {
  if (!headings.length) return -1
  let lo = 0, hi = headings.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (headings[mid].offset < offset) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  if (lo >= headings.length) return headings.length - 1
  return offset - headings[lo - 1].offset <= headings[lo].offset - offset ? lo - 1 : lo
}
