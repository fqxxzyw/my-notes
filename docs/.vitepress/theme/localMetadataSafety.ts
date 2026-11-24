import { validateChapterOrder } from './notebookChapterOrder'

/** Keep loading other local data, but prevent writes if any metadata cannot be read. */
export function restoreBookMetadataDrafts(input: unknown): { drafts: Record<string, any>; damaged: boolean } {
  if (input === undefined) return { drafts: {}, damaged: false }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { drafts: {}, damaged: true }
  const drafts: Record<string, any> = {}
  let damaged = false
  for (const [id, value] of Object.entries(input) as [string, any][]) {
    try {
      if (!value || typeof value.description !== 'string' || value.description.length > 500 || value.base?.id !== id || typeof value.base?.sha !== 'string' || typeof value.base?.indexContent !== 'string') throw new Error('invalid draft')
      if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 120 || /[\r\n]/.test(value.title))) throw new Error('invalid draft title')
      drafts[id] = { base: value.base, description: value.description, ...(value.title === undefined ? {} : { title: value.title.trim() }), ...(value.chapterOrder === undefined ? {} : { chapterOrder: validateChapterOrder(value.chapterOrder) }) }
    } catch { damaged = true }
  }
  return { drafts, damaged }
}

/** Inspect existing data before seeding anything; corrupt storage is never changed. */
export function prepareLocalCollection<T>(storage: Pick<Storage, 'getItem'>, key: string, seed: () => T): {
  saved: Record<string, any>; metadata: ReturnType<typeof restoreBookMetadataDrafts>; added: T | null; damaged: boolean
} {
  const inspect = () => {
    const raw = storage.getItem(key)
    let saved: Record<string, any>
    try {
      const parsed = raw === null ? {} : JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid collection')
      saved = parsed
    } catch { return { saved: {}, metadata: restoreBookMetadataDrafts(undefined), damaged: true } }
    const metadata = restoreBookMetadataDrafts(saved.bookDescriptionDrafts)
    const invalidList = ['books', 'chapters'].some(field => saved[field] !== undefined && !Array.isArray(saved[field]))
    const invalidMap = ['synced', 'bookVersions'].some(field => saved[field] !== undefined && (!saved[field] || typeof saved[field] !== 'object' || Array.isArray(saved[field])))
    return { saved, metadata, damaged: metadata.damaged || invalidList || invalidMap }
  }
  const initial = inspect()
  if (initial.damaged) return { ...initial, added: null }
  const added = seed()
  const final = inspect()
  return { ...final, added }
}

export function assertLocalMetadataWritable(damaged: boolean): void {
  if (damaged) throw new Error('本地笔记本信息损坏，已保留原始数据并暂停写入笔记目录和同步；请先备份本地数据，再检查或恢复。')
}

/** An old snapshot may omit chapterOrder; clear a discarded draft explicitly. */
export function restoreNotebookBase<T extends { chapterOrder?: string[] }>(current: T, base: T): T {
  return { ...current, ...base, chapterOrder: base.chapterOrder }
}
