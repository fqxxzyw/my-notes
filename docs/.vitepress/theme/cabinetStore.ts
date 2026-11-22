/** Public, versioned bookshelf catalog. Missing assignments belong to general. */
export type Cabinet = { id: string; title: string }
export type CabinetCatalog = { cabinets: Cabinet[]; assignments: Record<string, string> }
export type CatalogVersion = { catalog: CabinetCatalog; sha: string }

export const DEFAULT_CABINET_ID = 'general'
const ID = /^[a-zA-Z0-9_-]+$/

export function defaultCatalog(): CabinetCatalog {
  return { cabinets: [{ id: DEFAULT_CABINET_ID, title: '常用书柜' }], assignments: {} }
}

/** Validate untrusted JSON and return a detached, JSON-safe copy. */
export function validateCatalog(value: unknown): CabinetCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('书柜目录格式无效。')
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.cabinets) || !input.assignments || typeof input.assignments !== 'object' || Array.isArray(input.assignments)) {
    throw new Error('书柜目录格式无效。')
  }
  const seen = new Set<string>()
  const cabinets: Cabinet[] = input.cabinets.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('书柜信息格式无效。')
    const { id, title } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) throw new Error('书柜标识无效或重复。')
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[\r\n]/.test(title)) throw new Error('书柜名称无效。')
    seen.add(id)
    return { id, title: title.trim() }
  })
  if (!seen.has(DEFAULT_CABINET_ID)) throw new Error('书柜目录缺少常用书柜。')
  const assignments: Record<string, string> = Object.create(null)
  for (const [bookId, cabinetId] of Object.entries(input.assignments)) {
    if (!ID.test(bookId) || typeof cabinetId !== 'string' || !seen.has(cabinetId)) throw new Error('笔记本的书柜归属无效。')
    assignments[bookId] = cabinetId
  }
  return { cabinets, assignments }
}

export function parseCatalog(raw: string): CabinetCatalog {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('书柜目录不是有效的 JSON。') }
  return validateCatalog(parsed)
}

export function serializeCatalog(catalog: CabinetCatalog): string {
  return `${JSON.stringify(validateCatalog(catalog), null, 2)}\n`
}
