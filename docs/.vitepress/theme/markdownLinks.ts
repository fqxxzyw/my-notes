/**
 * Markdown heading anchor slugs and relative cross-document link resolution.
 * Supports jumping to headings within a document (#anchor) and jumping to
 * sibling/relative .md/.txt/document files inside the same notebook or cabinet.
 */
import { extractFileExtension, stripSupportedExtension } from './documentFiles'
import { decodeEncodedChapterPath } from './notebookChapterOrder'

export function safeDecodeUri(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/** GitHub/Typora-friendly slug for Markdown headings. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section'
}

/** Permissive normalized key so #2.1-标题, #21-标题, and URL-encoded anchors all match. */
export function normalizeHeadingKey(text: string): string {
  return safeDecodeUri(text)
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-、，。：:（）()【】[\]`*_~]+/g, '')
}

export type ParsedMarkdownHref =
  | { kind: 'external'; href: string }
  | { kind: 'hash'; hash: string }
  | { kind: 'local'; path: string; hash: string; ext: string }

/** Classify a clicked Markdown anchor href into external, same-doc hash, or local file link. */
export function parseMarkdownLinkHref(rawHref: string): ParsedMarkdownHref {
  const href = (rawHref || '').trim()
  if (!href || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(href)) {
    return { kind: 'external', href }
  }
  if (href.startsWith('#')) {
    return { kind: 'hash', hash: safeDecodeUri(href.slice(1)) }
  }
  const hashIndex = href.indexOf('#')
  const rawPath = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).split('?', 1)[0]
  const hash = hashIndex >= 0 ? safeDecodeUri(href.slice(hashIndex + 1)) : ''
  const decodedPath = safeDecodeUri(rawPath).replace(/\\/g, '/').trim()
  if (!decodedPath) return { kind: 'hash', hash }
  return {
    kind: 'local',
    path: decodedPath,
    hash,
    ext: extractFileExtension(decodedPath)
  }
}

/**
 * Resolve a relative Markdown link (e.g. `./mcp_tools.md`, `../other.md`, `sub/a.md`)
 * against the current document's title/relative path, returning ordered lookup candidates.
 */
export function resolveRelativeLinkCandidates(currentTitle: string, targetPath: string): {
  exactPaths: string[]
  basenames: string[]
} {
  const cleanTarget = targetPath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  const baseDir = currentTitle.includes('/')
    ? currentTitle.replace(/\\/g, '/').split('/').slice(0, -1)
    : []

  const stack = [...baseDir]
  for (const segment of cleanTarget.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') stack.pop()
    else stack.push(segment)
  }

  const joined = stack.join('/')
  const strippedJoined = stripSupportedExtension(joined)
  const strippedRaw = stripSupportedExtension(cleanTarget.replace(/^(?:\.\/)+/, ''))

  const exactSet = new Set<string>()
  for (const candidate of [joined, strippedJoined, cleanTarget.replace(/^(?:\.\/)+/, ''), strippedRaw]) {
    const c = candidate.trim().toLowerCase()
    if (c) exactSet.add(c)
  }

  const baseNameWithExt = (stack[stack.length - 1] || cleanTarget.split('/').pop() || '').trim()
  const baseNameNoExt = stripSupportedExtension(baseNameWithExt).trim()
  const baseSet = new Set<string>()
  for (const candidate of [baseNameWithExt, baseNameNoExt]) {
    const c = candidate.toLowerCase()
    if (c) baseSet.add(c)
  }

  return {
    exactPaths: [...exactSet],
    basenames: [...baseSet]
  }
}

export interface LinkableItem {
  bookId: string
  id: string
  title: string
  ext?: string
  fileName?: string
  cabinetId?: string
  isPage?: boolean
}

function itemMatchKeys(item: LinkableItem): { exact: string[]; basenames: string[] } {
  const normalizedTitle = item.title.replace(/\\/g, '/').trim()
  const strippedTitle = stripSupportedExtension(normalizedTitle)
  const ext = (item.ext || 'md').toLowerCase()
  const withExt = strippedTitle ? `${strippedTitle}.${ext}` : ''
  const fileName = (item.fileName || '').replace(/\\/g, '/').trim()
  const encodedPath = (decodeEncodedChapterPath(item.id) || '').replace(/\\/g, '/').trim()
  const strippedEncoded = stripSupportedExtension(encodedPath)
  const encodedWithExt = strippedEncoded ? `${strippedEncoded}.${ext}` : ''

  const exact = [normalizedTitle, strippedTitle, withExt, fileName, encodedPath, strippedEncoded, encodedWithExt, item.id]
    .map(v => v.toLowerCase())
    .filter(Boolean)

  const titleLeaf = strippedTitle.split('/').pop() || ''
  const leafWithExt = titleLeaf ? `${titleLeaf}.${ext}` : ''
  const fileLeaf = fileName.split('/').pop() || ''
  const encodedLeaf = strippedEncoded.split('/').pop() || ''
  const encodedLeafWithExt = encodedLeaf ? `${encodedLeaf}.${ext}` : ''
  const basenames = [titleLeaf, leafWithExt, fileLeaf, encodedLeaf, encodedLeafWithExt]
    .map(v => v.toLowerCase())
    .filter(Boolean)

  return { exact, basenames }
}

function matchPool(pool: readonly LinkableItem[], exactPaths: string[], basenames: string[], wantedExt: string): LinkableItem | null {
  // 1. Exact relative path match (prefer matching extension if specified)
  const exactMatches = pool.filter(item => {
    const keys = itemMatchKeys(item)
    return exactPaths.some(p => keys.exact.includes(p))
  })
  if (exactMatches.length) {
    if (wantedExt) {
      const extMatch = exactMatches.find(item => (item.ext || 'md').toLowerCase() === wantedExt)
      if (extMatch) return extMatch
    }
    return exactMatches[0]
  }
  // 2. Basename match
  const baseMatches = pool.filter(item => {
    const keys = itemMatchKeys(item)
    return basenames.some(b => keys.basenames.includes(b))
  })
  if (baseMatches.length) {
    if (wantedExt) {
      const extMatch = baseMatches.find(item => (item.ext || 'md').toLowerCase() === wantedExt)
      if (extMatch) return extMatch
    }
    return baseMatches[0]
  }
  return null
}

/**
 * Find the target chapter or standalone page for a relative Markdown link.
 * Priority: current notebook chapters -> same-cabinet pages -> other pages -> other chapters.
 */
export function resolveMarkdownTarget(
  rawHref: string,
  current: LinkableItem,
  sameBookChapters: readonly LinkableItem[],
  cabinetItems: readonly LinkableItem[],
  allItems: readonly LinkableItem[] = []
): { target: LinkableItem; hash: string } | null {
  const parsed = parseMarkdownLinkHref(rawHref)
  if (parsed.kind !== 'local') return null
  const baseHint = decodeEncodedChapterPath(current.id) || current.title
  const { exactPaths, basenames } = resolveRelativeLinkCandidates(baseHint, parsed.path)
  if (!exactPaths.length && !basenames.length) return null

  const pools: readonly (readonly LinkableItem[])[] = [sameBookChapters, cabinetItems, allItems]
  for (const pool of pools) {
    const found = matchPool(pool, exactPaths, basenames, parsed.ext)
    if (found) return { target: found, hash: parsed.hash }
  }
  return null
}
