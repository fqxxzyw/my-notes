<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createNotebookStore, type Notebook, type Chapter } from './notebookStore'
import ChapterMarkdown from './ChapterMarkdown.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import BookShelf from './BookShelf.vue'
import CabinetGallery from './CabinetGallery.vue'
import { useCabinets } from './useCabinets'
declare const __PAPER_BUILD_SHA__: string

const store = createNotebookStore()
const catalog = useCabinets()
const activeCabinet = ref('')
const creatingCabinet = ref(false)
const cabinetName = ref('')
const books = ref<Notebook[]>([])
const chapters = ref<Chapter[]>([])
const selectedBook = ref<Notebook | null>(null)
const selectedChapter = ref<Chapter | null>(null)
const content = ref('')
const tokenInput = ref('')
const connected = ref(false)
const tokenLoading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const view = ref<'read' | 'edit'>('read')
const query = ref('')
const bookTitle = ref('')
const chapterTitle = ref('')
const creatingBook = ref(false)
const creatingChapter = ref(false)
watch([creatingCabinet, creatingBook], ([cabinetOpen, bookOpen]) => {
  if (cabinetOpen || bookOpen) {
    void nextTick(() => document.getElementById(cabinetOpen ? 'cabinet-name' : 'book-name')?.focus())
  }
})
const remoteVersion = ref<Chapter | null>(null)
const snapshot = ref(true)
const searchIndex = ref<Chapter[]>([])
const searching = ref(false)
let searchRun = 0
let bookRun = 0
let localMutationVersion = 0
let suspendDraft = false
const localBooks = ref<Notebook[]>([])
const bookVersions = ref<Record<string, string>>({})
const localChapters = ref<Chapter[]>([])
const loadedBookIds = ref<string[]>([])
type SyncedCopy = { chapter: Chapter; baseSha: string | null; snapshotVersion: string }
const syncedCopies = ref<Record<string, SyncedCopy>>({})
const snapshotFiles = import.meta.glob('../../notebooks/**/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
let snapshotVersion = ''
async function identifySnapshot() {
  const text = JSON.stringify(Object.entries(snapshotFiles).sort(([a], [b]) => a.localeCompare(b)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  snapshotVersion = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
const chapterCache = new Map<string, Promise<Chapter[]>>()
type Draft = { content: string; base: Chapter }
const drafts = ref<Record<string, Draft>>({})
const selectedKeys = ref<string[]>([])
const isHosted = ref(false)
const isDesktop = ref(false)
const autoSave = ref(false)
const autoStatus = ref('自动保存已关闭')
let autoTimer: ReturnType<typeof setTimeout> | undefined
let writing = false
let disposed = false
const autoKeys = new Set<string>()
const autoBooks = new Set<string>()
const autoCabinets = new Set<string>()
const autoMoves = new Set<string>()
const inFlightKeys = new Set<string>()
const localKey = 'paper-notes-local-collection'
const credentialKey = 'paper-notes-github-token'
const autoPreferenceKey = 'paper-notes-auto-save-enabled'
function savedAutoPreference(): boolean {
  try { return localStorage.getItem(autoPreferenceKey) !== 'false' } catch { return false }
}
type DesktopBridge = {
  postMessage: (value: object) => void
  addEventListener: (name: 'message', handler: (event: MessageEvent) => void) => void
  removeEventListener: (name: 'message', handler: (event: MessageEvent) => void) => void
}
function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { chrome?: { webview?: DesktopBridge } }).chrome?.webview
}
function desktopRequest(action: 'token.get' | 'token.set' | 'token.clear', token?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const bridge = desktopBridge()
    if (!bridge) { reject(new Error('桌面安全存储不可用。')); return }
    const id = crypto.randomUUID()
    const timer = setTimeout(() => { bridge.removeEventListener('message', receive); reject(new Error('桌面安全存储没有响应。')) }, 8000)
    function receive(event: MessageEvent) {
      const result = event.data
      if (!result || result.channel !== 'paper-notes' || result.id !== id) return
      clearTimeout(timer)
      bridge!.removeEventListener('message', receive)
      if (result.ok !== true) reject(new Error('无法访问桌面安全存储。'))
      else resolve(typeof result.token === 'string' ? result.token : null)
    }
    bridge.addEventListener('message', receive)
    try { bridge.postMessage({ channel: 'paper-notes', id, action, ...(action === 'token.set' ? { token } : {}) }) }
    catch { clearTimeout(timer); bridge.removeEventListener('message', receive); reject(new Error('无法访问桌面安全存储。')) }
  })
}
async function readCredential(): Promise<string | null> {
  return isDesktop.value ? await desktopRequest('token.get') : localStorage.getItem(credentialKey)
}
async function saveCredential(token: string): Promise<void> {
  if (isDesktop.value) await desktopRequest('token.set', token)
  else localStorage.setItem(credentialKey, token)
}
async function clearCredential(): Promise<void> {
  if (isDesktop.value) await desktopRequest('token.clear')
  else localStorage.removeItem(credentialKey)
}
function windowCommand(action: 'window.minimize' | 'window.maximize' | 'window.close' | 'window.drag') {
  if (isDesktop.value) desktopBridge()?.postMessage({ channel: 'paper-notes', action })
}
function dragWindow(event: MouseEvent) {
  if (!isDesktop.value || event.button !== 0 || (event.target as Element).closest('button, a, input, textarea, select, label')) return
  windowCommand('window.drag')
}
function maximizeWindow(event: MouseEvent) {
  if (!isDesktop.value || (event.target as Element).closest('button, a, input, textarea, select, label')) return
  windowCommand('window.maximize')
}
function persistLocal() {
  try { localStorage.setItem(localKey, JSON.stringify({ books: localBooks.value, chapters: localChapters.value, synced: syncedCopies.value, bookVersions: bookVersions.value })) }
  catch { throw new Error('浏览器无法保存本地内容，请复制正文或释放存储空间后重试。') }
}
const chapterKey = (chapter: Pick<Chapter, 'bookId' | 'id'>) => `${chapter.bookId}/${chapter.id}`
const batchItems = computed(() => {
  const byKey = new Map<string, Chapter>()
  for (const chapter of localChapters.value) if (!chapter.sha) byKey.set(chapterKey(chapter), chapter)
  for (const [key, draft] of Object.entries(drafts.value)) byKey.set(key, { ...draft.base, content: draft.content })
  return Array.from(byKey, ([key, chapter]) => ({ key, bookId: chapter.bookId, bookTitle: books.value.find(book => book.id === chapter.bookId)?.title || chapter.bookId, title: chapter.title, chapter }))
})
const batchGroups = computed(() => {
  const groups = new Map<string, { id: string; title: string; isNew: boolean; items: typeof batchItems.value }>()
  for (const book of localBooks.value) {
    if (!book.sha) groups.set(book.id, { id: book.id, title: book.title, isNew: true, items: [] })
  }
  for (const item of batchItems.value) {
    let group = groups.get(item.bookId)
    if (!group) {
      group = { id: item.bookId, title: item.bookTitle, isNew: false, items: [] }
      groups.set(item.bookId, group)
    }
    group.items.push(item)
  }
  return Array.from(groups.values())
})
const pendingBatchCount = computed(() => batchGroups.value.reduce((count, group) => count + group.items.length + Number(group.isNew), 0))
function batchGroupKeys(group: typeof batchGroups.value[number]): string[] {
  return [...(group.isNew ? [`book:${group.id}`] : []), ...group.items.map(item => item.key)]
}
function isBatchGroupSelected(group: typeof batchGroups.value[number]): boolean {
  const keys = batchGroupKeys(group)
  return keys.length > 0 && keys.every(key => selectedKeys.value.includes(key))
}
function toggleBatchGroup(group: typeof batchGroups.value[number], event: Event) {
  const keys = batchGroupKeys(group)
  const selected = new Set(selectedKeys.value)
  for (const key of keys) {
    if ((event.target as HTMLInputElement).checked) selected.add(key)
    else selected.delete(key)
  }
  selectedKeys.value = [...selected]
}
async function getChapters(book: Notebook): Promise<Chapter[]> {
  const useSnapshot = snapshot.value
  const key = `${useSnapshot ? 'snapshot' : 'remote'}:${book.id}`
  let pending = chapterCache.get(key)
  if (!pending) {
    pending = !loadedBookIds.value.includes(book.id) ? Promise.resolve([]) : useSnapshot ? store.listSnapshotChapters(book.id) : store.listChapters(book.id)
    chapterCache.set(key, pending)
    pending.catch(() => { if (chapterCache.get(key) === pending) chapterCache.delete(key) })
  }
  const source = await pending
  const merged = source.map(chapter => {
    const copy = syncedCopies.value[chapterKey(chapter)]
    return useSnapshot && copy?.snapshotVersion === snapshotVersion && copy.baseSha === chapter.sha ? copy.chapter : chapter
  })
  const extras = [ ...localChapters.value.filter(chapter => !chapter.sha), ...Object.values(drafts.value).map(draft => draft.base), ...(useSnapshot ? Object.values(syncedCopies.value).filter(copy => copy.snapshotVersion === snapshotVersion && copy.baseSha === null).map(copy => copy.chapter) : []) ]
  for (const chapter of extras) {
    if (chapter.bookId === book.id && !merged.some(item => item.id === chapter.id)) merged.push(chapter)
  }
  return merged
}
function newId() { return crypto.randomUUID().replaceAll('-', '') }
const draftKey = (chapter: Chapter) => `paper-notes-draft:${chapter.bookId}:${chapter.id}`
const dirty = computed(() => !!selectedChapter.value && content.value !== selectedChapter.value.content)
const chosenCabinet = computed(() => catalog.cabinets.value.find(cabinet => cabinet.id === activeCabinet.value) || null)
const cabinetItems = computed(() => catalog.cabinets.value.map(cabinet => ({ ...cabinet, books: books.value.filter(book => catalog.assigned(book.id) === cabinet.id) })))
const visibleCabinets = computed(() => cabinetItems.value.filter(cabinet => {
  const q = query.value.trim().toLowerCase()
  return !q || cabinet.title.toLowerCase().includes(q) || cabinet.books.some(book => book.title.toLowerCase().includes(q))
}))
const filteredBooks = computed(() => books.value.filter(book => catalog.assigned(book.id) === activeCabinet.value && book.title.toLowerCase().includes(query.value.trim().toLowerCase())))
const filteredChapters = computed(() => {
  const q = query.value.trim().toLowerCase()
  return chapters.value.filter(chapter => !q || chapter.title.toLowerCase().includes(q) || chapter.content.toLowerCase().includes(q))
})
const searchResults = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return searchIndex.value.filter(chapter => chapter.title.toLowerCase().includes(q) || chapter.content.toLowerCase().includes(q))
})

function message(e: unknown) {
  return e instanceof Error ? e.message : '操作没有完成，请稍后重试。'
}
function clearMessages() { error.value = ''; notice.value = ''; remoteVersion.value = null }
function revealConnection() {
  const panel = document.querySelector<HTMLDetailsElement>('details#connection')
  if (panel) panel.open = true
}
function goToConnection() {
  revealConnection()
  document.getElementById('connection')?.scrollIntoView({ behavior: 'smooth' })
}
function saveDraft(): boolean {
  const chapter = selectedChapter.value
  if (!chapter || typeof localStorage === 'undefined') return true
  try {
    const key = chapterKey(chapter)
    if (content.value === chapter.content && !inFlightKeys.has(key)) {
      localStorage.removeItem(draftKey(chapter))
      const next = { ...drafts.value }; delete next[key]; drafts.value = next
    } else {
      const draft = { content: content.value, base: chapter }
      localStorage.setItem(draftKey(chapter), JSON.stringify(draft))
      drafts.value = { ...drafts.value, [key]: draft }
    }
    return true
  } catch { error.value = '浏览器无法保存本地草稿，请复制正文或释放存储空间后重试。'; return false }
}
watch(content, () => {
  if (suspendDraft) return
  if (!saveDraft()) { autoSave.value = false; autoStatus.value = '本地草稿保存失败，自动保存已暂停'; return }
  if (selectedChapter.value && autoSave.value) { autoKeys.add(chapterKey(selectedChapter.value)); scheduleAuto() }
}, { flush: 'sync' })

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try { await action(); return true } catch (e) { error.value = message(e); return false } finally { busy.value = false }
}
async function loadBooks(useSnapshot = snapshot.value) {
  const remoteBooks = useSnapshot ? await store.listSnapshotNotebooks() : await store.listNotebooks()
  chapterCache.clear()
  loadedBookIds.value = remoteBooks.map(book => book.id)
  books.value = mergeBooks(remoteBooks, useSnapshot)
  snapshot.value = useSnapshot
}
function mergeBooks(remoteBooks: Notebook[], useSnapshot: boolean): Notebook[] {
  const merged = [...remoteBooks, ...localBooks.value.filter(local => !remoteBooks.some(book => book.id === local.id) && (!local.sha || localChapters.value.some(chapter => chapter.bookId === local.id && !chapter.sha) || Object.values(drafts.value).some(draft => draft.base.bookId === local.id) || (useSnapshot && bookVersions.value[local.id] === snapshotVersion)))]
  for (const draft of Object.values(drafts.value)) {
    if (!merged.some(book => book.id === draft.base.bookId)) merged.push({ id: draft.base.bookId, title: `本地草稿 · ${draft.base.bookId.slice(0, 8)}`, sha: '' })
  }
  return merged
}
function openCabinet(id = '') {
  if (!saveDraft()) return
  if (id && !catalog.cabinets.value.some(cabinet => cabinet.id === id)) { error.value = '书柜不存在，请刷新目录。'; return }
  ++bookRun
  activeCabinet.value = id
  selectedBook.value = null
  selectedChapter.value = null
  chapters.value = []
  creatingBook.value = false; creatingChapter.value = false; creatingCabinet.value = false
  busy.value = false
  clearMessages()
}
function backToChapters() {
  if (!saveDraft()) return
  selectedChapter.value = null
  view.value = 'read'
  clearMessages()
  void nextTick(() => document.getElementById('bookshelf')?.scrollIntoView({ block: 'start' }))
}
function addCabinet() {
  clearMessages()
  try {
    const id = catalog.create(cabinetName.value)
    cabinetName.value = ''; creatingCabinet.value = false
    notice.value = '书柜已保存在本机。'
    if (autoSave.value) { autoCabinets.add(id); scheduleAuto() }
  } catch (e) { error.value = `无法创建书柜：${message(e)}` }
}
function moveSelected(event: Event) {
  const book = selectedBook.value
  const select = event.target as HTMLSelectElement | null
  if (!book || !select) return
  const previous = catalog.assigned(book.id)
  try {
    catalog.move(book.id, select.value)
    activeCabinet.value = select.value
    notice.value = '笔记本归属已保存在本机。'
    if (autoSave.value) { autoMoves.add(book.id); scheduleAuto() }
  } catch (e) { activeCabinet.value = catalog.assigned(book.id); select.value = activeCabinet.value || previous; error.value = `书柜归属尚未保存：${message(e)}` }
}
async function openBook(book: Notebook) {
  if (!saveDraft()) return
  const request = ++bookRun
  clearMessages()
  activeCabinet.value = catalog.assigned(book.id)
  creatingBook.value = false; creatingChapter.value = false
  selectedBook.value = book
  selectedChapter.value = null
  chapters.value = []
  busy.value = true
  try {
    const result = await getChapters(book)
    if (request === bookRun && selectedBook.value?.id === book.id) chapters.value = result
  } catch (e) { if (request === bookRun) error.value = message(e) }
  finally { if (request === bookRun) busy.value = false }
}
function openChapter(chapter: Chapter) {
  if (!saveDraft()) return
  clearMessages()
  suspendDraft = true
  selectedChapter.value = chapter
  content.value = chapter.content
  try {
    const raw = localStorage.getItem(draftKey(chapter))
    if (raw) {
      const saved = JSON.parse(raw)
      if (typeof saved.content === 'string' && saved.base?.id === chapter.id && saved.base?.bookId === chapter.bookId && typeof saved.base?.sha === 'string') {
        selectedChapter.value = saved.base
        content.value = saved.content
        notice.value = '已恢复这篇章节的本地草稿。'
      }
    }
  } catch { error.value = '无法读取本地草稿。' }
  finally { suspendDraft = false }
  view.value = 'read'
  void nextTick(() => document.getElementById('writing-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
async function refresh() {
  if (!saveDraft()) return false
  if (writing) { error.value = '正在同步，请稍候再读取目录。'; return false }
  const request = ++bookRun
  const version = localMutationVersion
  clearMessages()
  return await run(async () => {
    const bookId = selectedBook.value?.id
    const chapterId = selectedChapter.value?.id
    const [remoteBooks, latestCatalog] = await Promise.all([store.listNotebooks(), store.readCatalog(false)])
    if (writing || version !== localMutationVersion) throw new Error('同步期间目录发生变化，请稍后重新读取。')
    catalog.latest(latestCatalog)
    chapterCache.clear()
    loadedBookIds.value = remoteBooks.map(book => book.id)
    books.value = mergeBooks(remoteBooks, false)
    snapshot.value = false
    if (selectedBook.value) activeCabinet.value = catalog.assigned(selectedBook.value.id)
    else if (activeCabinet.value && !catalog.cabinets.value.some(item => item.id === activeCabinet.value)) activeCabinet.value = ''
    if (request !== bookRun) return
    if (bookId) {
      selectedBook.value = books.value.find(book => book.id === bookId) || null
      if (selectedBook.value) {
        chapters.value = await getChapters(selectedBook.value)
        const chapter = chapters.value.find(item => item.id === chapterId)
        if (chapter) openChapter(chapter)
        else selectedChapter.value = null
      } else { chapters.value = []; selectedChapter.value = null }
    }
    notice.value = '已读取 GitHub 上的最新目录。'
  })
}
async function connect() {
  const token = tokenInput.value.trim()
  if (!token) { error.value = '请输入 GitHub 令牌。'; return }
  store.setToken(token)
  tokenInput.value = ''
  const success = await run(async () => {
    await store.listNotebooks()
    try { await saveCredential(token) } catch { throw new Error('令牌无法保存到本机，请检查存储权限后重试。') }
  })
  if (success) {
    connected.value = true
    if (isHosted.value) autoSave.value = savedAutoPreference()
    notice.value = '令牌已保存，写入权限将在同步时验证；已有本地草稿需手动选择同步。'
  } else store.clearToken()
}
async function disconnect() {
  const success = await run(async () => {
    try { await clearCredential() } catch { throw new Error('无法清除已保存的令牌，请重试。') }
  })
  if (!success) return
  connected.value = false; autoSave.value = false; store.clearToken(); tokenInput.value = ''
  notice.value = '已断开连接并清除保存的令牌；本地草稿仍保留。'
}
async function addBook() {
  if (!saveDraft()) return
  clearMessages()
  await run(async () => {
    const title = bookTitle.value.trim()
    if (!title || /[\r\n]/.test(title)) throw new Error('请输入有效的笔记本名称。')
    if (!activeCabinet.value) throw new Error('请先打开一个书柜。')
    const book = { id: newId(), title, sha: '' }
    localBooks.value.push(book)
    try { persistLocal() } catch (e) { localBooks.value.pop(); throw e }
    books.value = [...books.value, book]
    bookTitle.value = ''; creatingBook.value = false
    selectedBook.value = book; chapters.value = []; selectedChapter.value = null
    try { catalog.move(book.id, activeCabinet.value) } catch (e) {
      throw new Error(`笔记本已保存在本机，但书柜归属尚未保存：${message(e)}`)
    }
    notice.value = '本地笔记本已创建。添加章节后可一并同步。'
    if (autoSave.value) { autoBooks.add(book.id); scheduleAuto() }
  })
}
async function addChapter() {
  const book = selectedBook.value
  if (!book) return
  if (!saveDraft()) return
  clearMessages()
  await run(async () => {
    const title = chapterTitle.value.trim()
    if (!title || /[\r\n]/.test(title)) throw new Error('请输入有效的章节名称。')
    const chapter = { bookId: book.id, id: newId(), title, content: `# ${title}\n\n`, sha: '' }
    localChapters.value.push(chapter)
    try { persistLocal() } catch (e) { localChapters.value.pop(); throw e }
    chapters.value = [...chapters.value, chapter]
    chapterTitle.value = ''; creatingChapter.value = false
    openChapter(chapter); view.value = 'edit'
    notice.value = '本地章节已创建；准备好后点击同步。'
    if (autoSave.value) { autoKeys.add(chapterKey(chapter)); scheduleAuto() }
  })
}
async function syncBook() {
  const book = selectedBook.value
  if (!book) return
  if (!connected.value) { error.value = '请先在页面下方连接 GitHub，再同步笔记本。'; goToConnection(); return }
  if (!saveDraft()) return
  clearMessages()
  const success = await run(() => performBatch([], [book.id]))
  if (success) notice.value = '笔记本及其归属已同步到 GitHub。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
async function syncCatalog() {
  if (!connected.value) { error.value = '请先连接 GitHub，再同步书柜整理。'; goToConnection(); return }
  if (!saveDraft()) return
  const bookIds = Object.keys(catalog.journal.value.moves)
  const cabinetIds = Object.keys(catalog.journal.value.created)
  if (!bookIds.length && !cabinetIds.length) { notice.value = '没有待同步的书柜整理。'; return }
  clearMessages()
  const success = await run(() => performBatch([], bookIds, cabinetIds))
  if (success) notice.value = '书柜整理已同步到 GitHub。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
async function sync() {
  const chapter = selectedChapter.value
  if (!chapter) return
  if (!connected.value) { error.value = '请先连接 GitHub，再同步本地草稿。'; goToConnection(); return }
  if (!saveDraft()) return
  clearMessages()
  const success = await run(() => performBatch([chapterKey(chapter)], []))
  if (success) notice.value = '已同步到 GitHub；网站将在构建完成后更新。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
async function inspectRemote() {
  const chapter = selectedChapter.value
  if (!chapter) return
  await run(async () => { remoteVersion.value = await store.readChapter(chapter.bookId, chapter.id) })
}
function useRemoteBase() {
  if (!remoteVersion.value) return
  const previous = selectedChapter.value
  selectedChapter.value = remoteVersion.value
  if (!saveDraft()) { selectedChapter.value = previous; return }
  remoteVersion.value = null
  error.value = ''
  notice.value = '已采用远程版本作为同步基准，当前草稿未改变。确认合并后再点击同步。'
}
async function performBatch(keys: string[], bookIds: string[], cabinetIds: string[] = []) {
  if (writing) throw new Error('正在同步，请稍候。')
  const entries = batchItems.value.filter(item => keys.includes(item.key))
  const newBooks = localBooks.value.filter(book => !book.sha && (bookIds.includes(book.id) || entries.some(item => item.bookId === book.id)))
  writing = true
  for (const entry of entries) inFlightKeys.add(entry.key)
  let catalogPrepared = false
  try {
    const scopedBookIds = [...new Set([...bookIds, ...entries.map(item => item.bookId)])]
    const catalogChange = catalog.prepare(scopedBookIds, cabinetIds)
    catalogPrepared = !!catalogChange
    if (!entries.length && !newBooks.length && !catalogChange) return
    const bases = await Promise.all(entries.map(async item => {
      const prior = syncedCopies.value[item.key]
      if (prior && prior.snapshotVersion === snapshotVersion && prior.chapter.sha === item.chapter.sha) return prior.baseSha
      return (await store.listSnapshotChapters(item.bookId)).find(chapter => chapter.id === item.chapter.id)?.sha || null
    }))
    const result = await store.syncBatch(newBooks, entries.map(item => item.chapter), catalogChange)
    if (catalogChange && !result.catalog) throw new Error('GitHub 未返回书柜目录版本，请保留本地整理后重试。')
    if (result.catalog) { catalog.acknowledge(result.catalog); catalogPrepared = false }
    localMutationVersion++
    for (const item of entries) chapterCache.delete(`remote:${item.bookId}`)
    for (const book of result.books) {
      if (!loadedBookIds.value.includes(book.id) && !snapshot.value) loadedBookIds.value.push(book.id)
      bookVersions.value = { ...bookVersions.value, [book.id]: snapshotVersion }
      localBooks.value = localBooks.value.map(item => item.id === book.id ? book : item)
      books.value = books.value.map(item => item.id === book.id ? book : item)
      if (selectedBook.value?.id === book.id) selectedBook.value = book
    }
    for (let i = 0; i < result.chapters.length; i++) {
      const chapter = result.chapters[i]
      const index = entries.findIndex(item => item.key === chapterKey(chapter))
      if (index < 0) continue
      syncedCopies.value = { ...syncedCopies.value, [chapterKey(chapter)]: { chapter, baseSha: bases[index], snapshotVersion } }
      localChapters.value = localChapters.value.map(item => chapterKey(item) === chapterKey(chapter) ? chapter : item)
      chapters.value = chapters.value.map(item => chapterKey(item) === chapterKey(chapter) ? chapter : item)
    }
    try { persistLocal() } catch { throw new Error('内容已提交到 GitHub，但浏览器无法保存本地缓存。请保留草稿并刷新远程目录。') }
    for (const resultChapter of result.chapters) {
      const key = chapterKey(resultChapter)
      const entry = entries.find(item => item.key === key)
      if (!entry) continue
      const current = drafts.value[key]
      try {
        if (current && current.content !== entry.chapter.content) {
          const draft = { base: resultChapter, content: current.content }
          localStorage.setItem(draftKey(resultChapter), JSON.stringify(draft))
          drafts.value = { ...drafts.value, [key]: draft }
        } else {
          localStorage.removeItem(draftKey(resultChapter))
          const next = { ...drafts.value }; delete next[key]; drafts.value = next
        }
      } catch { throw new Error('内容已提交到 GitHub，但浏览器无法保存后续本地修改。请立即复制草稿。') }
      if (selectedChapter.value && chapterKey(selectedChapter.value) === key) selectedChapter.value = resultChapter
    }
  } finally {
    if (catalogPrepared) catalog.fail()
    for (const entry of entries) inFlightKeys.delete(entry.key)
    writing = false
  }
}
async function syncSelected() {
  if (!connected.value) { error.value = '请先连接 GitHub，再同步勾选的章节。'; goToConnection(); return }
  if (!saveDraft()) return
  const validChapterKeys = new Set(batchItems.value.map(item => item.key))
  const validBookIds = new Set(localBooks.value.filter(book => !book.sha).map(book => book.id))
  const keys = selectedKeys.value.filter(key => validChapterKeys.has(key))
  const bookIds = selectedKeys.value.filter(key => key.startsWith('book:') && validBookIds.has(key.slice(5))).map(key => key.slice(5))
  if (!keys.length && !bookIds.length) { error.value = '请先勾选要同步的笔记本或章节。'; return }
  clearMessages()
  const success = await run(() => performBatch(keys, bookIds))
  if (success) { const sent = new Set([...keys, ...bookIds.map(id => `book:${id}`)]); selectedKeys.value = selectedKeys.value.filter(key => !sent.has(key)); notice.value = '所选笔记已同步到 GitHub。' }
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
function scheduleAuto() {
  if (disposed || !autoSave.value || !connected.value || !isHosted.value) return
  clearTimeout(autoTimer)
  autoStatus.value = '等待自动保存'
  autoTimer = setTimeout(() => { void flushAuto() }, 1600)
}
async function flushAuto() {
  if (disposed || !autoSave.value || !connected.value || !isHosted.value) return
  if (writing) { scheduleAuto(); return }
  const keys = [...autoKeys]; const bookIds = [...new Set([...autoBooks, ...autoMoves])]; const cabinetIds = [...autoCabinets]
  autoKeys.clear(); autoBooks.clear(); autoMoves.clear(); autoCabinets.clear()
  if (!keys.length && !bookIds.length && !cabinetIds.length) return
  autoStatus.value = '正在自动保存'
  try {
    await performBatch(keys, bookIds, cabinetIds)
    autoStatus.value = '已自动同步'
    if (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size) scheduleAuto()
  } catch (e) {
    autoSave.value = false
    autoStatus.value = `自动保存已暂停：${message(e)}`
    error.value = `${autoStatus.value}。本地草稿仍保留，请检查后手动同步。`
    autoKeys.clear(); autoBooks.clear(); autoMoves.clear(); autoCabinets.clear()
  }
}
watch(autoSave, enabled => {
  if (enabled && (!isHosted.value || !connected.value)) { autoSave.value = false; autoStatus.value = '连接线上书架后可开启'; return }
  if (isHosted.value && connected.value && !disposed) {
    try { localStorage.setItem(autoPreferenceKey, String(enabled)) } catch { /* keep the active setting for this session */ }
  }
  if (enabled) autoStatus.value = '自动保存已开启'
  else { clearTimeout(autoTimer); autoKeys.clear(); autoBooks.clear(); autoMoves.clear(); autoCabinets.clear(); autoStatus.value = '自动保存已关闭' }
}, { flush: 'sync' })
let backgroundRunning = false
let backgroundReady = false
let backgroundRetry = false
let backgroundTimer: ReturnType<typeof setTimeout> | undefined
let backgroundLastCheck = 0
let backgroundHead = ''
function scheduleDesktopRemoteCheck() {
  if (!isDesktop.value || !backgroundReady || disposed) return
  if (backgroundRunning) { backgroundRetry = true; return }
  clearTimeout(backgroundTimer)
  // Limit unauthenticated GitHub API traffic while still checking after a quick
  // switch back from the web app, rather than losing that focus event.
  const delay = Math.max(0, 10000 - (Date.now() - backgroundLastCheck))
  backgroundTimer = setTimeout(() => { void updateFromRemoteInBackground() }, delay)
}
async function updateFromRemoteInBackground() {
  if ((!isHosted.value && !isDesktop.value) || (!isDesktop.value && !snapshot.value) || disposed) return
  if (backgroundRunning) { if (isDesktop.value) backgroundRetry = true; return }
  if (isDesktop.value && (busy.value || writing)) { backgroundLastCheck = Date.now(); scheduleDesktopRemoteCheck(); return }
  backgroundRunning = true
  backgroundLastCheck = Date.now()
  const version = localMutationVersion
  try {
    const head = await store.readHead()
    if (isDesktop.value && head && head === backgroundHead) return
    const buildSha = typeof __PAPER_BUILD_SHA__ === 'string' ? __PAPER_BUILD_SHA__ : ''
    if (snapshot.value && buildSha && head === buildSha) { backgroundHead = head; return }
    const [latest, latestCatalog] = await Promise.all([store.listNotebooks(), store.readCatalog(false)])
    const selectedId = selectedBook.value?.id
    const request = bookRun
    const selectedExists = !!selectedId && latest.some(book => book.id === selectedId)
    const latestChapters = selectedExists ? await store.listChapters(selectedId!) : []
    if ((!isDesktop.value && !snapshot.value) || disposed || writing || version !== localMutationVersion) return
    catalog.latest(latestCatalog)
    chapterCache.clear()
    if (selectedExists) chapterCache.set(`remote:${selectedId}`, Promise.resolve(latestChapters))
    loadedBookIds.value = latest.map(book => book.id)
    books.value = mergeBooks(latest, false)
    if (selectedBook.value) activeCabinet.value = catalog.assigned(selectedBook.value.id)
    else if (activeCabinet.value && !catalog.cabinets.value.some(item => item.id === activeCabinet.value)) activeCabinet.value = ''
    snapshot.value = false
    if (selectedId && selectedBook.value?.id === selectedId && request === bookRun) {
      selectedBook.value = books.value.find(book => book.id === selectedId) || selectedBook.value
      chapters.value = await getChapters(selectedBook.value)
      // Never replace an open editor or the baseline of a pending draft; the
      // existing GitHub SHA check must detect a concurrent edit on submission.
      const current = selectedChapter.value
      const latestChapter = current && chapters.value.find(item => item.id === current.id)
      if (current && latestChapter && view.value !== 'edit' && !drafts.value[chapterKey(current)] && content.value === current.content) {
        suspendDraft = true
        try { selectedChapter.value = latestChapter; content.value = latestChapter.content }
        finally { suspendDraft = false }
      }
    }
    if (isDesktop.value && request !== bookRun) { backgroundHead = ''; backgroundRetry = true }
    else backgroundHead = head
  } catch { /* Snapshot stays available when GitHub is unreachable. */ }
  finally {
    backgroundRunning = false
    if (backgroundRetry && !disposed) { backgroundRetry = false; scheduleDesktopRemoteCheck() }
  }
}
onMounted(() => {
  isHosted.value = location.hostname === 'fqxxzyw.github.io' && (location.pathname === '/my-notes' || location.pathname.startsWith('/my-notes/'))
  isDesktop.value = location.hostname === 'paper.local' && (location.pathname === '/my-notes' || location.pathname.startsWith('/my-notes/'))
  void (async () => {
    try {
      const token = await readCredential()
      if (disposed) return
      if (token) {
        store.setToken(token)
        connected.value = true
        if (isHosted.value) autoSave.value = savedAutoPreference()
      }
    } catch { if (!disposed) error.value = '无法读取已保存的 GitHub 令牌，请检查本机存储。' }
    finally { tokenLoading.value = false }
  })()
  let restoreError = ''
  try {
    const saved = JSON.parse(localStorage.getItem(localKey) || '{}')
    if (Array.isArray(saved.books)) localBooks.value = saved.books
    if (Array.isArray(saved.chapters)) localChapters.value = saved.chapters
    if (saved.synced && typeof saved.synced === 'object' && !Array.isArray(saved.synced)) syncedCopies.value = saved.synced
    if (saved.bookVersions && typeof saved.bookVersions === 'object' && !Array.isArray(saved.bookVersions)) bookVersions.value = saved.bookVersions
    const found: Record<string, Draft> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('paper-notes-draft:')) continue
      try {
        const draft = JSON.parse(localStorage.getItem(key) || 'null')
        if (typeof draft?.content === 'string' && typeof draft?.base?.bookId === 'string' && typeof draft?.base?.id === 'string' && typeof draft?.base?.sha === 'string') found[chapterKey(draft.base)] = draft
      } catch { /* skip a malformed draft without discarding others */ }
    }
    drafts.value = found
  } catch { restoreError = '无法读取本地笔记本，请检查浏览器存储。' }
  void (async () => {
    await identifySnapshot()
    const loaded = await run(async () => {
      const snapshotCatalog = await store.readCatalog(true)
      try { catalog.restore(snapshotCatalog) } catch { restoreError = '无法恢复本地书柜，请检查浏览器存储。'; catalog.latest(snapshotCatalog) }
      await loadBooks(true)
    })
    if (restoreError) error.value = restoreError
    backgroundReady = loaded
    if (loaded) void updateFromRemoteInBackground()
  })()
  window.addEventListener('focus', scheduleDesktopRemoteCheck)
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('focus', scheduleDesktopRemoteCheck)
  clearTimeout(backgroundTimer)
  clearTimeout(autoTimer)
  saveDraft()
  autoSave.value = false
  store.clearToken()
  tokenInput.value = ''
})
watch([query, books, localChapters, content, syncedCopies, drafts], async ([value]) => {
  const runId = ++searchRun
  if (!value.trim()) { searchIndex.value = []; searching.value = false; return }
  searching.value = true
  try {
    const all = await Promise.all(books.value.map(book => getChapters(book)))
    if (runId === searchRun) searchIndex.value = all.flat().map(chapter => {
      try { const draft = JSON.parse(localStorage.getItem(draftKey(chapter)) || 'null'); return typeof draft?.content === 'string' ? { ...chapter, content: draft.content } : chapter } catch { return chapter }
    })
  } catch (e) { if (runId === searchRun) error.value = `搜索暂不可用：${message(e)}` }
  finally { if (runId === searchRun) searching.value = false }
})
async function openSearchResult(chapter: Chapter) {
  const book = books.value.find(item => item.id === chapter.bookId)
  if (!book) return
  await openBook(book)
  if (selectedBook.value?.id !== chapter.bookId) return
  const original = chapters.value.find(item => item.id === chapter.id)
  if (original) {
    query.value = ''
    openChapter(original)
  }
}
</script>

<template>
  <div class="desk">
    <header class="archive-header" :class="{ 'desktop-header': isDesktop }" @mousedown="dragWindow" @dblclick="maximizeWindow">
      <div class="archive-header-inner">
        <div class="archive-path">
          <button class="archive-brand" type="button" @click="openCabinet()"><span aria-hidden="true"></span>纸间</button>
          <span class="archive-divider" aria-hidden="true"></span>
          <nav aria-label="当前位置">
            <button type="button" @click="openCabinet()">全部书柜</button>
            <template v-if="chosenCabinet">
              <span aria-hidden="true"> / </span>
              <button type="button" @click="openCabinet(chosenCabinet.id)">{{ chosenCabinet.title }}</button>
            </template>
            <template v-if="selectedBook">
              <span aria-hidden="true"> / </span>
              <button type="button" @click="openBook(selectedBook)">{{ selectedBook.title }}</button>
            </template>
            <template v-if="selectedChapter"><span aria-hidden="true"> / </span><span>{{ selectedChapter.title }}</span></template>
          </nav>
        </div>
        <div class="archive-actions">
          <div class="archive-search-wrap">
            <label class="archive-search"><span class="sr-only">搜索笔记</span><input v-model="query" type="search" placeholder="搜索书柜 / 笔记本 / 章节..."></label>
            <div v-if="selectedChapter && view === 'edit' && query.trim()" class="archive-search-results">
              <p v-if="searching">正在查找章节…</p>
              <template v-else>
                <button v-for="result in searchResults" :key="result.bookId + '/' + result.id" type="button"
                  :disabled="busy" @click="openSearchResult(result)">
                  {{ books.find(book => book.id === result.bookId)?.title }} ／ {{ result.title }}
                </button>
                <p v-if="!searchResults.length">没有匹配的章节。</p>
              </template>
            </div>
          </div>
          <button class="archive-refresh" :disabled="busy" @click="refresh">刷新</button>
          <a class="archive-sync" href="#connection" @click="revealConnection">同步</a>
          <button v-if="!chosenCabinet" type="button" class="archive-new" :disabled="busy" @click="creatingCabinet = true">＋ 新建书柜</button>
          <button v-else-if="!selectedBook" type="button" class="archive-new" :disabled="busy" @click="creatingBook = true">＋ 新建笔记本</button>
          <button v-else type="button" class="archive-new" :disabled="busy" @click="creatingChapter = true; if (selectedChapter) backToChapters()">＋ 新建章节</button>
          <div v-if="isDesktop" class="window-controls" aria-label="窗口控制">
            <button type="button" aria-label="最小化窗口" title="最小化" @click="windowCommand('window.minimize')">&#x2212;</button>
            <button type="button" aria-label="最大化或还原窗口" title="最大化或还原" @click="windowCommand('window.maximize')">&#x25A1;</button>
            <button type="button" class="window-close" aria-label="关闭窗口" title="关闭" @click="windowCommand('window.close')">&#x00D7;</button>
          </div>
        </div>
      </div>
    </header>
    <section v-show="!selectedBook && (!selectedChapter || view !== 'edit')" class="intro" aria-labelledby="desk-title">
      <div class="intro-copy">
        <p v-if="!chosenCabinet" class="archive-kicker">LEVEL 01 · ARCHITECTURAL BOOKCASES</p>
        <nav v-if="chosenCabinet && !selectedBook" class="crumbs"><button type="button" @click="openCabinet()">← 返回书柜</button></nav>
        <h1 id="desk-title">{{ selectedBook?.title || chosenCabinet?.title || '全部书柜' }}</h1>
        <p v-if="!chosenCabinet" class="archive-intro">点击书柜进入书架，整理和阅读笔记。</p>
        <p class="intro-text">
          {{ selectedBook ? chapters.length + ' 章' : chosenCabinet ? filteredBooks.length + ' 册笔记本' : cabinetItems.length + ' 个书柜 · ' + books.length + ' 册笔记本' }}
        </p>
        <a href="#connection" class="sync-link" @click="revealConnection">
          <span class="sync-dot" :class="{ online: connected }" aria-hidden="true"></span>
          {{ connected ? (isHosted ? autoStatus : '令牌已设置') : '本机草稿 · 连接 GitHub' }}
        </a>
      </div>
    </section>

    <section v-show="!selectedChapter || view !== 'edit'" id="bookshelf" class="library" aria-label="笔记本与章节">
      <div class="tools archive-mobile-tools">
        <label class="search">
          <span class="lens" aria-hidden="true"></span><span class="sr-only">搜索笔记</span>
          <input v-model="query" type="search" placeholder="搜索书柜、笔记本或章节">
        </label>
        <button class="text-button" :disabled="busy" @click="refresh">读取最新目录</button>
        <button v-if="!chosenCabinet" class="primary-button" :disabled="busy" :aria-expanded="creatingCabinet" @click="creatingCabinet = !creatingCabinet">＋ 新建书柜</button>
        <button v-else-if="!selectedBook" class="primary-button" :disabled="busy" :aria-expanded="creatingBook" @click="creatingBook = !creatingBook">＋ 新建笔记本</button>
        <button v-else class="primary-button" :disabled="busy" :aria-expanded="creatingChapter" @click="creatingChapter = !creatingChapter">＋ 添加章节</button>
      </div>
      <div v-if="creatingCabinet && !chosenCabinet" class="archive-modal" @click.self="creatingCabinet = false" @keydown.esc="creatingCabinet = false">
        <form class="archive-dialog" role="dialog" aria-modal="true" aria-labelledby="new-cabinet-title" @submit.prevent="addCabinet">
          <div class="archive-dialog-heading"><h2 id="new-cabinet-title">新建书柜</h2><button type="button" aria-label="关闭" @click="creatingCabinet = false">×</button></div>
          <label for="cabinet-name">书柜名称</label>
          <input id="cabinet-name" v-model="cabinetName" maxlength="120" placeholder="例如，工作资料" required>
          <div class="archive-dialog-actions"><button type="button" class="archive-new" @click="creatingCabinet = false">取消</button><button class="primary-button" :disabled="busy">确认创建</button></div>
        </form>
      </div>
      <div v-if="creatingBook" class="archive-modal" @click.self="creatingBook = false" @keydown.esc="creatingBook = false">
        <form class="archive-dialog" role="dialog" aria-modal="true" aria-labelledby="new-book-title" @submit.prevent="addBook">
          <div class="archive-dialog-heading"><h2 id="new-book-title">新建笔记本</h2><button type="button" aria-label="关闭" @click="creatingBook = false">×</button></div>
          <label for="book-name">笔记本名称</label>
          <input id="book-name" v-model="bookTitle" maxlength="120" placeholder="例如，Java 学习" required>
          <div class="archive-dialog-actions"><button type="button" class="archive-new" @click="creatingBook = false">取消</button><button class="primary-button" :disabled="busy">确认创建</button></div>
        </form>
      </div>
      <div v-if="query.trim()" class="search-results">
        <p v-if="searching" role="status">正在查找章节…</p>
        <template v-else>
          <p>{{ searchResults.length }} 篇匹配章节</p>
          <button v-for="result in searchResults" :key="result.bookId + '/' + result.id" class="chapter-row" :disabled="busy" @click="openSearchResult(result)">
            <span>{{ books.find(book => book.id === result.bookId)?.title }} ／ {{ result.title }}</span>
            <span class="arrow" aria-hidden="true">↗</span>
          </button>
        </template>
      </div>
      <div v-if="!selectedChapter && error" class="feedback error" role="alert">{{ error }}</div>
      <p v-if="!selectedChapter && notice" class="feedback" role="status">{{ notice }}</p>
      <p v-if="busy" class="feedback" role="status">正在读取或保存笔记…</p>
      <CabinetGallery v-if="!chosenCabinet" :items="visibleCabinets" @select="openCabinet" @create="creatingCabinet = true" />
      <p v-if="!chosenCabinet && !visibleCabinets.length" class="empty-shelf">没有匹配的书柜。</p>
      <BookShelf v-if="chosenCabinet && !selectedBook && filteredBooks.length" :books="filteredBooks"
        :disabled="busy" @select="openBook" />
      <p v-if="chosenCabinet && !selectedBook && !filteredBooks.length" class="empty-shelf">{{ query ? '没有匹配的书名。' : '书柜还是空的。新建一本笔记，或把其他柜里的笔记移到这里。' }}</p>
      <div v-if="selectedBook" class="chapter-panel">
        <aside class="reference-book-card">
          <div class="reference-hero-stage" aria-hidden="true">
            <div class="reference-hero-book">
              <div class="reference-book-spine">
                <span class="reference-book-number">01</span>
                <span class="reference-book-spine-title">{{ selectedBook.title }}</span>
                <span class="reference-book-rule"></span>
              </div>
              <div class="reference-book-cover">
                <div class="reference-cover-frame"></div>
                <span class="reference-cover-meta">NOTEBOOK</span>
                <strong class="reference-cover-title">{{ selectedBook.title }}</strong>
                <span class="reference-cover-rule"></span>
              </div>
              <div class="reference-book-top"></div>
            </div>
          </div>
          <div class="reference-book-details">
            <div class="panel-heading">
              <span>{{ selectedBook.sha ? '已收录笔记本' : '本机笔记本' }}</span>
              <button v-if="!selectedBook.sha" class="text-button" :disabled="busy" @click="syncBook">同步笔记本</button>
            </div>
            <h2>{{ selectedBook.title }}</h2>
            <label class="move-book">所在书柜
              <select :value="activeCabinet" :disabled="busy" @change="moveSelected">
                <option v-for="cabinet in cabinetItems" :key="cabinet.id" :value="cabinet.id">{{ cabinet.title }}</option>
              </select>
            </label>
            <div class="reference-book-bottom">
              <button class="reference-outline-button" type="button" @click="openCabinet(activeCabinet)">← 返回书架</button>
              <span>{{ chapters.length }} 篇章节</span>
            </div>
          </div>
        </aside>
        <div class="contents-list">
            <div class="chapter-title reference-chapter-heading">
              <div><small>CHAPTER DIRECTORY</small><h2>章节目录</h2></div>
              <button class="primary-button" :disabled="busy" :aria-expanded="creatingChapter" @click="creatingChapter = !creatingChapter">＋ 新建章节</button>
            </div>
            <form v-if="creatingChapter" class="inline-form" @submit.prevent="addChapter">
              <label for="chapter-name">章节名称</label>
              <input id="chapter-name" v-model="chapterTitle" maxlength="120" required>
              <button class="primary-button" :disabled="busy">创建</button>
              <button type="button" class="text-button" @click="creatingChapter = false">取消</button>
            </form>
            <button v-for="(chapter, index) in filteredChapters" :key="chapter.id" class="chapter-row"
              :disabled="busy" :class="{selected: selectedChapter?.id === chapter.id}" @click="openChapter(chapter)">
              <span class="chapter-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
              <span>{{ chapter.title }}</span><span class="arrow" aria-hidden="true">↗</span>
            </button>
            <p v-if="!filteredChapters.length" class="empty">{{ query ? '本册没有匹配的章节。' : '还没有章节。点「添加章节」写下第一页。' }}</p>
        </div>
      </div>
      <button v-if="catalog.pending.value" class="text-button sync-catalog" :disabled="busy" @click="syncCatalog">同步书柜整理</button>
      <details class="batch-box">
        <summary>批量同步<span>{{ pendingBatchCount }} 项待同步</span></summary>
        <p v-if="!batchGroups.length">目前没有待提交的笔记本或章节。</p>
        <template v-else>
          <p>勾选笔记本或章节，一次提交到 GitHub。选中整本会包括其中全部待同步章节。新笔记本会随所选章节一起创建。</p>
          <div class="batch-list">
            <fieldset v-for="group in batchGroups" :key="group.id" class="batch-group">
              <legend class="sr-only">{{ group.title }}</legend>
              <label class="batch-group-heading">
                <input type="checkbox" :checked="isBatchGroupSelected(group)" :disabled="busy" @change="toggleBatchGroup(group, $event)">
                <strong>{{ group.title }}</strong><small>全选本册</small>
              </label>
              <div class="batch-children">
                <label v-if="group.isNew">
                  <input v-model="selectedKeys" type="checkbox" :disabled="busy" :value="`book:${group.id}`">
                  <span>笔记本本身（新建）</span>
                </label>
                <label v-for="item in group.items" :key="item.key">
                  <input v-model="selectedKeys" type="checkbox" :disabled="busy" :value="item.key">
                  <span>{{ item.title }}</span>
                </label>
              </div>
            </fieldset>
          </div>
          <button class="primary-button" :disabled="busy || !selectedKeys.length" @click="syncSelected">
            同步所选（{{ selectedKeys.length }}）
          </button>
        </template>
      </details>
    </section>

    <section v-if="selectedChapter" class="writing" aria-labelledby="writing-title">
      <div class="writing-top">
        <div>
          <button v-if="view === 'edit'" class="back-to-chapters" type="button" @click="backToChapters">← 返回章节目录</button>
          <p>{{ selectedBook?.title }}</p><h2 id="writing-title">{{ selectedChapter.title }}</h2>
          <p>{{ !selectedChapter.sha ? '本地章节，尚未同步' : dirty ? '本机有未同步的修改' : 'GitHub 已收录此版本' }}</p>
        </div>
        <div class="view-actions">
          <button :class="{ chosen: view === 'read' }" :aria-pressed="view === 'read'" @click="view = 'read'">阅读</button>
          <button :class="{ chosen: view === 'edit' }" :aria-pressed="view === 'edit'" @click="view = 'edit'">编辑</button>
        </div>
      </div>
      <div v-if="view === 'read'" class="paper">
        <ChapterMarkdown :source="content.replace(/^# [^\r\n]+(?:\r?\n|$)/, '')" />
      </div>
      <div v-else class="reference-editor-workspace">
        <details class="reference-editor-sidebar" open aria-label="章节目录">
          <summary class="reference-sidebar-heading"><strong :title="selectedBook?.title">{{ selectedBook?.title }}</strong></summary>
          <button v-for="chapter in chapters" :key="chapter.id" type="button" class="reference-sidebar-row"
            :class="{ active: selectedChapter.id === chapter.id }" :disabled="busy"
            :aria-label="chapter.title" :aria-current="selectedChapter.id === chapter.id ? 'page' : undefined" :title="chapter.title"
            @click="openChapter(chapter); view = 'edit'">{{ chapter.title }}</button>
        </details>
        <div class="paper editor">
          <MarkdownEditor v-model="content" :readonly="busy" />
          <div class="editor-footer">
            <span>{{ content.length }} 字符<span v-if="isHosted && connected" aria-live="polite"> · {{ autoStatus }}</span></span>
            <button class="primary-button" :disabled="busy || (!dirty && !!selectedChapter.sha)" @click="sync">同步到 GitHub ↗</button>
          </div>
        </div>
      </div>
      <div v-if="error" class="feedback error" role="alert">
        {{ error }}
        <button v-if="error.includes('远程')" class="text-button" :disabled="busy" @click="inspectRemote">查看远程版本</button>
        <a v-if="!connected" href="#connection" @click="revealConnection">连接 GitHub</a>
      </div>
      <p v-if="notice" class="feedback" role="status">{{ notice }}</p>
      <div v-if="remoteVersion" class="remote-box">
        <h3>GitHub 上的版本</h3>
        <p>对照下面的内容编辑草稿，再选择「已完成合并」并同步。</p>
        <pre>{{ remoteVersion.content }}</pre>
        <button class="text-button" @click="useRemoteBase">已完成合并，使用这个版本作为基准</button>
      </div>
    </section>

    <details id="connection" class="connection-details">
      <summary>GitHub 同步设置</summary>
      <div class="connection">
      <div>
        <p>{{ isHosted ? '连接后，本次新建和编辑的笔记将自动保存到公开仓库' : '勾选章节再点同步，原文将通过一次提交保存到公开仓库' }}
          <a href="https://github.com/fqxxzyw/my-notes">fqxxzyw/my-notes</a>。</p>
      </div>
      <div class="connection-form">
        <form v-if="!connected" @submit.prevent="connect">
          <label for="github-token">此仓库的精细访问令牌</label>
          <div class="token-row">
            <input id="github-token" v-model="tokenInput" type="password" autocomplete="off" placeholder="GitHub 访问令牌" :disabled="tokenLoading" required>
            <button class="primary-button" :disabled="busy || tokenLoading">连接 GitHub</button>
          </div>
        </form>
        <template v-else>
          <p class="connected">令牌已设置，写入权限将在同步时验证。</p>
          <label v-if="isHosted" class="auto-setting">
            <input v-model="autoSave" type="checkbox"> 自动保存到 GitHub
          </label>
          <p v-if="isHosted" role="status">{{ autoStatus }}</p>
          <button class="text-button" :disabled="busy" @click="disconnect">断开连接</button>
        </template>
        <p v-if="isDesktop">令牌使用 Windows 当前账户加密保存在本机；断开连接会清除。</p>
        <p v-else>令牌保存在此浏览器的本地存储中，刷新后会恢复；同一浏览器的扩展或此站点脚本可能读取它，请仅在可信设备上使用。断开连接会清除。</p>
        <a href="./guide.html">查看令牌设置和同步说明 ↗</a>
      </div>
      </div>
    </details>
  </div>
</template>

<style scoped src="./notebook.css"></style>
<style scoped src="./batch.css"></style>
<style scoped src="./reference-chapters.css"></style>
