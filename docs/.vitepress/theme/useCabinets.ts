import { computed, ref } from 'vue'
import type { CabinetCatalog, CatalogVersion } from './cabinetStore'
import { namespaceKey } from './repository'

const storageBase = 'paper-notes:cabinets:v1'
const fallback: CabinetCatalog = { schemaVersion: 2, cabinets: [{ id: 'general', title: '默认书柜' }], assignments: {} }

// `via` records destinations submitted before an uncertain response. They are
// valid intermediate remote states on retry, but not arbitrary remote edits.
type Move = { from: string; to: string; via?: string[] }
type Removed = { title: string; sha: string; redirected?: Record<string, { before: Move; after?: Move }> }
type Journal = {
  created: Record<string, string>
  moves: Record<string, Move>
  removed?: Record<string, Removed | string>
  defaultMigration?: { legacyShas: string[] }
  saved?: CatalogVersion
  snapshotSha?: string
}

export function useCabinets(repository?: string | null) {
  const storageKey = namespaceKey(storageBase, repository)
  const base = ref<CatalogVersion>({ catalog: fallback, sha: '' })
  const journal = ref<Journal>({ created: {}, moves: {} })
  let snapshotSha = ''
  let inFlight: { moves: Record<string, Move>; removed: Record<string, Removed> } | null = null
  const persist = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(journal.value)) }
    catch { throw new Error('无法保存书柜更改，请检查本机存储后重试。') }
  }
  const cabinets = computed(() => [
    ...base.value.catalog.cabinets,
    ...Object.entries(journal.value.created)
      .filter(([id]) => !base.value.catalog.cabinets.some(c => c.id === id))
      .map(([id, title]) => ({ id, title }))
  ].filter(cabinet => !journal.value.removed?.[cabinet.id]))
  const pending = computed(() => Object.keys(journal.value.created).length + Object.keys(journal.value.moves).length + Object.keys(journal.value.removed || {}).length)
  function assigned(id: string) {
    const target = journal.value.moves[id]?.to || base.value.catalog.assignments[id] || 'general'
    return journal.value.removed?.[target] ? 'general' : target
  }
  function projected(version: CatalogVersion): CatalogVersion {
    // Old per-device snapshots may remain after the repository has migrated.
    // Only project the exact legacy revisions recorded on this device; a later
    // legacy client write with a different SHA must not erase newly made cases.
    if (version.catalog.schemaVersion !== 2 && journal.value.defaultMigration?.legacyShas.includes(version.sha)) {
      return { sha: version.sha, catalog: fallback }
    }
    return version
  }
  function restore(version: CatalogVersion) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再读取目录。')
    let nextJournal: Journal = { created: {}, moves: {} }
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const state = JSON.parse(raw)
        if (state?.created && state?.moves) nextJournal = state
      }
      if (!nextJournal.defaultMigration) {
        const legacyShas = new Set<string>()
        if (version.catalog.schemaVersion !== 2) legacyShas.add(version.sha)
        if (nextJournal.saved && nextJournal.saved.catalog?.schemaVersion !== 2) legacyShas.add(nextJournal.saved.sha)
        if (typeof nextJournal.snapshotSha === 'string') legacyShas.add(nextJournal.snapshotSha)
        // The requested one-time reset affects old grouping only, never notes.
        // Save journal + migration marker together before replacing memory.
        nextJournal = { created: {}, moves: {}, removed: {}, defaultMigration: { legacyShas: [...legacyShas] } }
        localStorage.setItem(storageKey, JSON.stringify(nextJournal))
      }
    } catch {
      throw new Error('无法读取或迁移本机书柜；原有本机更改仍然保留。')
    }
    snapshotSha = version.sha
    journal.value = nextJournal
    const saved = journal.value.saved && journal.value.snapshotSha === snapshotSha ? journal.value.saved : version
    base.value = projected(saved)
  }
  function latest(version: CatalogVersion) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再读取目录。')
    base.value = projected(version)
  }
  function create(title: string) {
    if (!title.trim() || title.trim().length > 120 || /[\r\n]/.test(title)) throw new Error('请输入 1 至 120 字的单行书柜名称。')
    const id = crypto.randomUUID()
    const previous = journal.value.created
    journal.value.created = { ...previous, [id]: title.trim() }
    try { persist() } catch (error) { journal.value.created = previous; throw error }
    return id
  }
  function move(book: string, to: string) {
    if (!cabinets.value.some(c => c.id === to)) throw new Error('目标书柜不存在。')
    const previous = journal.value.moves
    const next = { ...previous }
    const old = next[book]
    const from = old?.from || base.value.catalog.assignments[book] || 'general'
    const via = old?.via ? [...old.via] : []
    // An in-flight submission may still land, even when the user moves back.
    if (to === from && !via.length) delete next[book]
    else next[book] = { from, to, ...(via.length ? { via } : {}) }
    journal.value.moves = next
    try { persist() } catch (error) { journal.value.moves = previous; throw error }
  }
  function moveMany(bookIds: string[], to: string) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再移动。')
    if (!cabinets.value.some(c => c.id === to)) throw new Error('目标书柜不存在。')
    if (!Array.isArray(bookIds) || bookIds.some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('笔记本标识无效。')
    const previous = journal.value.moves
    const next = { ...previous }
    for (const book of new Set(bookIds)) {
      const old = next[book]
      const from = old?.from || base.value.catalog.assignments[book] || 'general'
      const via = old?.via ? [...old.via] : []
      if (to === from && !via.length) delete next[book]
      else next[book] = { from, to, ...(via.length ? { via } : {}) }
    }
    journal.value.moves = next
    try { persist() } catch (error) { journal.value.moves = previous; throw error }
  }
  function remove(id: string) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再删除。')
    if (id === 'general') throw new Error('默认书柜不能删除。')
    const cabinet = cabinets.value.find(item => item.id === id)
    if (!cabinet) throw new Error('书柜不存在或已经删除。')
    const before = journal.value
    const created = { ...before.created }, moves = { ...before.moves }, removed = { ...(before.removed || {}) }
    const isRemote = base.value.catalog.cabinets.some(item => item.id === id)
    delete created[id]
    const redirected: Record<string, { before: Move; after?: Move }> = {}
    for (const [book, move] of Object.entries(moves)) {
      if (move.to !== id) continue
      const via = move.via ? [...move.via] : []
      if (move.from === 'general' && !via.length) delete moves[book]
      else moves[book] = { from: move.from, to: 'general', ...(via.length ? { via } : {}) }
      redirected[book] = { before: move, ...(moves[book] ? { after: moves[book] } : {}) }
    }
    if (isRemote) removed[id] = { title: cabinet.title, sha: base.value.sha, redirected }
    journal.value = { ...before, created, moves, removed }
    try { persist() } catch (error) { journal.value = before; throw error }
  }
  function undoRemove(id: string) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再撤销。')
    const record = journal.value.removed?.[id]
    if (!record) throw new Error('没有待撤销的书柜删除。')
    if (!base.value.catalog.cabinets.some(item => item.id === id)) throw new Error('远程书柜已不存在，请同步删除状态。')
    const before = journal.value
    const removed = { ...(before.removed || {}) }, moves = { ...before.moves }
    if (typeof record !== 'string') {
      for (const [book, pair] of Object.entries(record.redirected || {})) {
        // Do not discard a move the user made after deleting the cabinet.
        if (JSON.stringify(moves[book] ?? null) === JSON.stringify(pair.after ?? null)) moves[book] = pair.before
      }
    }
    delete removed[id]
    journal.value = { ...before, moves, removed }
    try { persist() } catch (error) { journal.value = before; throw error }
  }
  // Only include cabinet changes needed by the selected books or explicitly requested cabinets.
  function prepare(bookIds: string[], cabinetIds: string[]): CatalogVersion | undefined {
    if (inFlight) throw new Error('书柜同步正在进行，请等待完成后重试。')
    const source = base.value.catalog
    const next: CabinetCatalog = { schemaVersion: 2, cabinets: source.cabinets.map(c => ({ ...c })), assignments: { ...source.assignments } }
    const needed = new Set([...cabinetIds, ...bookIds.map(assigned)])
    let changed = false
    const submittedRemoved: Record<string, Removed> = {}
    for (const id of cabinetIds) {
      const stored = journal.value.removed?.[id]
      if (!stored) continue
      const removal = typeof stored === 'string' ? { title: stored, sha: base.value.sha } : stored
      if (id === 'general') throw new Error('默认书柜不能删除。')
      const current = source.cabinets.find(c => c.id === id)
      if (current && (current.title !== removal.title || base.value.sha !== removal.sha)) throw new Error('远程书柜内容已变化，请恢复后重新检查。')
      next.cabinets = next.cabinets.filter(c => c.id !== id)
      for (const [book, target] of Object.entries(next.assignments)) {
        if (target === id) delete next.assignments[book]
      }
      submittedRemoved[id] = removal
      changed = true
    }
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
    inFlight = { moves: submitted, removed: submittedRemoved }
    return { catalog: next, sha: base.value.sha }
  }
  function acknowledge(version: CatalogVersion) {
    if (!inFlight) throw new Error('没有正在进行的书柜同步。')
    const submitted = inFlight.moves
    const submittedRemoved = inFlight.removed
    const beforeCreated = { ...journal.value.created }
    const beforeRemoved = { ...(journal.value.removed || {}) }
    const beforeMoves = Object.fromEntries(Object.entries(journal.value.moves).map(([id, move]) => [
      id, { ...move, ...(move.via ? { via: [...move.via] } : {}) }
    ])) as Record<string, Move>
    base.value = version
    for (const c of version.catalog.cabinets) {
      if (journal.value.created[c.id] === c.title) delete journal.value.created[c.id]
    }
    for (const [id, removal] of Object.entries(submittedRemoved)) {
      const pendingRemoval = journal.value.removed?.[id]
      if ((typeof pendingRemoval === 'string' ? pendingRemoval === removal.title : pendingRemoval?.title === removal.title && pendingRemoval.sha === removal.sha) && !version.catalog.cabinets.some(c => c.id === id)) delete journal.value.removed![id]
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
      journal.value.removed = beforeRemoved
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
  function discardMoves(bookIds: string[]) {
    if (inFlight) throw new Error('书柜同步正在进行，请稍后再删除。')
    const previous = journal.value.moves
    const next = { ...previous }
    for (const id of bookIds) delete next[id]
    journal.value.moves = next
    try { persist() } catch (error) { journal.value.moves = previous; throw error }
  }
  return { cabinets, pending, journal, assigned, create, move, moveMany, remove, undoRemove, restore, latest, prepare, acknowledge, fail, discardMoves }
}
