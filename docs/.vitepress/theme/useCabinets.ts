import { computed, ref } from 'vue'
import type { CabinetCatalog, CatalogVersion } from './cabinetStore'

const storageKey = 'paper-notes:cabinets:v1'
const fallback: CabinetCatalog = { cabinets: [{ id: 'general', title: '常用书柜' }], assignments: {} }

// `via` records destinations submitted before an uncertain response. They are
// valid intermediate remote states on retry, but not arbitrary remote edits.
type Move = { from: string; to: string; via?: string[] }
type Journal = {
  created: Record<string, string>
  moves: Record<string, Move>
  saved?: CatalogVersion
  snapshotSha?: string
}

export function useCabinets() {
  const base = ref<CatalogVersion>({ catalog: fallback, sha: '' })
  const journal = ref<Journal>({ created: {}, moves: {} })
  let snapshotSha = ''
  let inFlight: { moves: Record<string, Move> } | null = null
  const persist = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(journal.value)) }
    catch { throw new Error('无法保存到浏览器存储；本次更改仍在当前页面内，请勿关闭页面并重试。') }
  }
  const cabinets = computed(() => [
    ...base.value.catalog.cabinets,
    ...Object.entries(journal.value.created)
      .filter(([id]) => !base.value.catalog.cabinets.some(c => c.id === id))
      .map(([id, title]) => ({ id, title }))
  ])
  const pending = computed(() => Object.keys(journal.value.created).length + Object.keys(journal.value.moves).length)
  function assigned(id: string) {
    return journal.value.moves[id]?.to || base.value.catalog.assignments[id] || 'general'
  }
  function restore(version: CatalogVersion) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再读取目录。')
    snapshotSha = version.sha
    base.value = version
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const state = JSON.parse(raw)
        if (state?.created && state?.moves) journal.value = state
      }
    } catch {
      throw new Error('无法读取浏览器中的书柜更改；当前页面里的更改仍然保留。')
    }
    base.value = journal.value.saved && journal.value.snapshotSha === snapshotSha ? journal.value.saved : version
  }
  function latest(version: CatalogVersion) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再读取目录。')
    base.value = version
  }
  function create(title: string) {
    if (!title.trim() || title.trim().length > 120 || /[\r\n]/.test(title)) throw new Error('请输入 1 至 120 字的单行书柜名称。')
    const id = crypto.randomUUID()
    journal.value.created[id] = title.trim()
    persist()
    return id
  }
  function move(book: string, to: string) {
    if (!cabinets.value.some(c => c.id === to)) throw new Error('目标书柜不存在。')
    const old = journal.value.moves[book]
    const from = old?.from || base.value.catalog.assignments[book] || 'general'
    const via = old?.via ? [...old.via] : []
    // An in-flight submission may still land, even when the user moves back.
    if (to === from && !via.length) delete journal.value.moves[book]
    else journal.value.moves[book] = { from, to, ...(via.length ? { via } : {}) }
    persist()
  }
  // Only include cabinet changes needed by the selected books or explicitly requested cabinets.
  function prepare(bookIds: string[], cabinetIds: string[]): CatalogVersion | undefined {
    if (inFlight) throw new Error('书柜同步正在进行，请等待完成后重试。')
    const source = base.value.catalog
    const next: CabinetCatalog = { cabinets: source.cabinets.map(c => ({ ...c })), assignments: { ...source.assignments } }
    const needed = new Set([...cabinetIds, ...bookIds.map(assigned)])
    let changed = false
    for (const id of needed) {
      const title = journal.value.created[id]
      if (!title) continue
      changed = true
      const existing = next.cabinets.find(c => c.id === id)
      if (!existing) next.cabinets.push({ id, title })
      else if (existing.title !== title) throw new Error('远程书柜名称发生变化，请读取最新目录。')
    }
    for (const id of bookIds) {
      const move = journal.value.moves[id]
      if (!move) continue
      const current = source.assignments[id] || 'general'
      if (current !== move.from && current !== move.to && !move.via?.includes(current)) throw new Error('这本笔记的归属已在另一台设备上更改。请读取最新目录，再重新选择目标书柜。')
      if (!next.cabinets.some(c => c.id === move.to)) throw new Error('目标书柜已变更，请重新选择。')
      next.assignments[id] = move.to
      changed = true
    }
    if (!changed) return undefined
    const submitted: Record<string, Move> = {}
    for (const id of bookIds) {
      const move = journal.value.moves[id]
      if (!move) continue
      submitted[id] = { ...move, via: move.via ? [...move.via] : undefined }
      const via = new Set(move.via || [])
      via.add(move.to)
      journal.value.moves[id] = { ...move, via: [...via] }
    }
    // Save the attempted intermediate before any request so reloads can retry.
    persist()
    inFlight = { moves: submitted }
    return { catalog: next, sha: base.value.sha }
  }
  function acknowledge(version: CatalogVersion) {
    if (!inFlight) throw new Error('没有正在进行的书柜同步。')
    const submitted = inFlight.moves
    const beforeCreated = { ...journal.value.created }
    const beforeMoves = Object.fromEntries(Object.entries(journal.value.moves).map(([id, move]) => [
      id, { ...move, ...(move.via ? { via: [...move.via] } : {}) }
    ])) as Record<string, Move>
    base.value = version
    for (const c of version.catalog.cabinets) {
      if (journal.value.created[c.id] === c.title) delete journal.value.created[c.id]
    }
    for (const [id, move] of Object.entries(journal.value.moves)) {
      const current = version.catalog.assignments[id] || 'general'
      if (current === move.to) delete journal.value.moves[id]
      else if (submitted[id] && current === submitted[id].to) {
        // Keep edits made during this request, now based on the acknowledged state.
        journal.value.moves[id] = { from: current, to: move.to }
      }
    }
    journal.value.saved = version
    journal.value.snapshotSha = snapshotSha
    inFlight = null
    try { persist() } catch (error) {
      // Keep a visible retryable journal if the browser could not record the
      // acknowledgement. The confirmed remote version remains the new base.
      journal.value.created = beforeCreated
      journal.value.moves = beforeMoves
      for (const [id, move] of Object.entries(journal.value.moves)) {
        const current = version.catalog.assignments[id] || 'general'
        if (submitted[id] && current === submitted[id].to) {
          journal.value.moves[id] = { from: current, to: move.to }
        }
      }
      throw error
    }
  }
  function fail() { inFlight = null }
  return { cabinets, pending, journal, assigned, create, move, restore, latest, prepare, acknowledge, fail }
}
