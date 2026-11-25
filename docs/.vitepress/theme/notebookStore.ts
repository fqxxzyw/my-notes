/** GitHub-backed notebook storage. Credentials live only in this store instance. */
import { defaultCatalog, parseCatalog, serializeCatalog, type CabinetCatalog, type CatalogVersion } from './cabinetStore'
import { normalizeRepository } from './repository'
import { readNotebookDescription, writeNotebookDescription } from './notebookDescription'
import { readNotebookChapterOrder, writeNotebookChapterOrder } from './notebookChapterOrder'
import { extractMarkdownTitle } from './notebookTitle'
import { MAX_ATTACHMENT_BYTES, validateAttachment, validateAttachmentPath, type NoteAttachment } from './attachmentStore'
import { ALL_SUPPORTED_IMPORT_EXTENSIONS, BINARY_DOCUMENT_EXTENSIONS, MAX_GITHUB_DOCUMENT_BYTES, normalizeFileExt, type StoredDocumentFile } from './documentFiles'
export { normalizeRepository } from './repository'
export type { CabinetCatalog, CatalogVersion } from './cabinetStore'
export type Notebook = { id: string; title: string; sha: string; description?: string; indexContent?: string; chapterOrder?: string[] }
export type Chapter = { bookId: string; id: string; title: string; content: string; sha: string; ext?: string; filePath?: string; fileName?: string; fileSize?: number; binaryBytes?: Uint8Array }
/** A standalone document file in docs/pages, independent of notebooks. */
export type Page = { id: string; title: string; content: string; sha: string; ext?: string; filePath?: string; fileName?: string; fileSize?: number; binaryBytes?: Uint8Array }
export type NotebookStoreErrorCode = 'auth' | 'not-found' | 'conflict' | 'network' | 'invalid' | 'github'

export class NotebookStoreError extends Error {
  constructor(public code: NotebookStoreErrorCode, message: string) {
    super(message)
    this.name = 'NotebookStoreError'
  }
}

type GitHubFile = { type: 'file'; name: string; path: string; sha: string; encoding?: string; content?: string }
type GitHubEntry = { type: string; name: string; path: string; sha: string }
type GitTreeEntry = { path: string; type: string; mode: string; sha: string }
type GitTree = { tree: GitTreeEntry[]; truncated?: boolean }
type BatchResult = { books: Notebook[]; chapters: Chapter[]; pages: Page[]; catalog?: CatalogVersion; parent: string; head: string }
export type BookDeletion = { book: Notebook; chapters: Chapter[] }

const ROOT = 'notebooks'
const ID = /^[a-zA-Z0-9_-]+$/

function checkedCatalog(raw: string): CabinetCatalog {
  try { return parseCatalog(raw) }
  catch (error) { throw new NotebookStoreError('invalid', error instanceof Error ? error.message : '书柜目录格式无效。') }
}

function catalogText(catalog: CabinetCatalog): string {
  try { return serializeCatalog(catalog) }
  catch (error) { throw new NotebookStoreError('invalid', error instanceof Error ? error.message : '书柜目录格式无效。') }
}

async function blobSha(content: string): Promise<string> {
  return blobBytesSha(new TextEncoder().encode(content))
}

async function blobBytesSha(body: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new NotebookStoreError('github', '浏览器无法计算文件版本号，请使用安全连接访问。')
  }
  const encoder = new TextEncoder()
  const header = encoder.encode(`blob ${body.length}\0`)
  const data = new Uint8Array(header.length + body.length)
  data.set(header)
  data.set(body, header.length)
  const hash = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  return btoa(binary)
}

function decodeBytes(file: GitHubFile): Uint8Array {
  if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new NotebookStoreError('github', '无法读取图片附件。')
  const encoded = file.content.replace(/\s/g, '')
  if (encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) throw new NotebookStoreError('invalid', '图片超过 20 MiB，无法保存到本机。')
  try { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) }
  catch { throw new NotebookStoreError('invalid', '图片附件格式无效。') }
}

function checkId(value: string): string {
  if (!ID.test(value)) throw new NotebookStoreError('invalid', '笔记本或章节标识无效。')
  return value
}

function checkChapterId(value: string): string {
  checkId(value)
  if (value.toLowerCase() === 'index') throw new NotebookStoreError('invalid', '章节标识不能是 index。')
  return value
}

/** Preserve an imported filename without inserting metadata into its Markdown. */
function encodedIdFromTitle(prefix: 'p' | 'c', title: string): string {
  const name = checkTitle(title)
  const bytes = new TextEncoder().encode(name)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const id = `${prefix}_${crypto.randomUUID().replaceAll('-', '')}_${encoded}`
  if (id.length > 251) throw new NotebookStoreError('invalid', '文件名过长，请缩短后重试。')
  return id
}
export function pageIdFromTitle(title: string): string { return encodedIdFromTitle('p', title) }
export function chapterIdFromTitle(title: string): string { return encodedIdFromTitle('c', title) }

function checkPageId(id: string): string {
  checkId(id)
  if (id.length > 251) throw new NotebookStoreError('invalid', '书页文件名过长。')
  return id
}

function titleFromEncodedId(id: string, prefix: 'p' | 'c'): string {
  const match = new RegExp(`^${prefix}_[a-f0-9]{32}_([A-Za-z0-9_-]+)$`).exec(id)
  if (!match) return id
  try {
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const name = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
    return checkTitle(name)
  } catch { return id }
}

function checkTitle(title: string): string {
  const value = title.trim()
  if (!value || /[\r\n]/.test(value) || value.length > 120) {
    throw new NotebookStoreError('invalid', '标题不能为空、包含换行或超过 120 个字符。')
  }
  return value
}

function titleFrom(content: string, fallback: string): string {
  return extractMarkdownTitle(content, fallback)
}

function itemExt(item?: { ext?: string }): string {
  return normalizeFileExt(item?.ext)
}

function splitDocumentFileName(name: string): { id: string; ext: string } | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  const id = name.slice(0, dot)
  const ext = name.slice(dot + 1).toLowerCase()
  if (!ID.test(id) || !ALL_SUPPORTED_IMPORT_EXTENSIONS.has(ext)) return null
  return { id, ext }
}

function decodeBinaryBlob(file: GitHubFile): Uint8Array {
  if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new NotebookStoreError('github', '无法读取文档内容。')
  const encoded = file.content.replace(/\s/g, '')
  if (encoded.length > Math.ceil(MAX_GITHUB_DOCUMENT_BYTES / 3) * 4 + 16) throw new NotebookStoreError('invalid', '文档超过 25 MiB，无法通过 GitHub 接口读取。')
  try { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) }
  catch { throw new NotebookStoreError('invalid', '文档数据格式无效。') }
}

function decode(file: GitHubFile): string {
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new NotebookStoreError('github', '无法读取文件内容（文件可能超过 GitHub 接口的大小限制）。')
  }
  try {
    const binary = atob(file.content.replace(/\s/g, ''))
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new NotebookStoreError('invalid', '文件不是有效的 UTF-8 文本。')
  }
}

export function createNotebookStore(repository?: string | null) {
  const canonical = repository ? normalizeRepository(repository) : ''
  const repoPath = canonical.split('/').map(encodeURIComponent).join('/')
  const repoApi = canonical ? `https://api.github.com/repos/${repoPath}` : ''
  const api = repoApi ? `${repoApi}/contents/docs` : ''
  const gitApi = repoApi ? `${repoApi}/git` : ''
  let token = ''

  async function request(path: string, options: { allowMissing?: boolean } = {}): Promise<unknown> {
    if (!api) throw new NotebookStoreError('invalid', '请先设置 GitHub 仓库地址。')
    let response: Response
    try {
      response = await fetch(`${api}/${path.split('/').map(encodeURIComponent).join('/')}?ref=main`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        cache: 'no-store'
      })
    } catch {
      throw new NotebookStoreError('network', '无法连接 GitHub，请检查网络后重试。')
    }
    if (response.status === 404 && options.allowMissing) return null
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new NotebookStoreError('auth', 'GitHub 拒绝访问。请检查令牌权限或稍后重试。')
      }
      if (response.status === 404) throw new NotebookStoreError('not-found', '文件不存在或无权访问。')
      throw new NotebookStoreError('github', `GitHub 请求失败（HTTP ${response.status}）。`)
    }
    try { return await response.json() } catch {
      throw new NotebookStoreError('github', 'GitHub 返回了无法识别的数据。')
    }
  }

  async function gitRequest(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: object): Promise<unknown> {
    if (!gitApi) throw new NotebookStoreError('invalid', '请先设置 GitHub 仓库地址。')
    let response: Response
    try {
      response = await fetch(`${gitApi}/${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store'
      })
    } catch {
      throw new NotebookStoreError('network', method === 'GET'
        ? '无法连接 GitHub，请检查网络后重试。'
        : '无法连接 GitHub。提交结果可能未知，请保留草稿并用相同内容重试。')
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new NotebookStoreError('auth', 'GitHub 拒绝访问。请检查令牌权限或稍后重试。')
      if (method === 'PATCH' && (response.status === 409 || response.status === 422)) {
        throw new NotebookStoreError('conflict', '同步期间远程分支发生变化，请保留草稿并重新检查后重试。')
      }
      if (response.status === 404) throw new NotebookStoreError('not-found', '仓库或 main 分支不存在，或无权访问。')
      throw new NotebookStoreError('github', `GitHub 请求失败（HTTP ${response.status}）。请保留草稿后重试。`)
    }
    try { return await response.json() } catch {
      throw new NotebookStoreError('github', 'GitHub 返回了无法识别的数据；请保留草稿并用相同内容重试。')
    }
  }

  async function syncBatch(newBooks: Notebook[], chapters: Chapter[], catalogChange?: CatalogVersion, pages: Page[] = [], attachments: NoteAttachment[] = [], documents: StoredDocumentFile[] = []): Promise<BatchResult> {
    if (!token) throw new NotebookStoreError('auth', '请先输入具有仓库内容写入权限的 GitHub 令牌。')
    if (!newBooks.length && !chapters.length && !pages.length && !catalogChange) throw new NotebookStoreError('invalid', '请至少选择一本新笔记本、一篇章节、书页或书柜目录。')

    const docsByPath = new Map(documents.map(doc => [doc.path, doc.bytes]))
    const paths = new Set<string>()
    const changes: Array<{ path: string; content?: string; bytes?: Uint8Array; baseline: string; desired: string; mode?: string }> = []
    let catalog: CabinetCatalog | undefined
    if (catalogChange) {
      if (typeof catalogChange.sha !== 'string' || (catalogChange.sha !== '' && !/^[a-f0-9]{40}$/.test(catalogChange.sha))) throw new NotebookStoreError('invalid', '书柜目录版本号无效。')
      const content = catalogText(catalogChange.catalog)
      catalog = checkedCatalog(content)
      changes.push({ path: 'docs/cabinets.json', content, baseline: catalogChange.sha, desired: await blobSha(content) })
      paths.add('docs/cabinets.json')
    }
    for (const book of newBooks) {
      checkId(book.id)
      const title = checkTitle(book.title)
      const path = `docs/${ROOT}/${book.id}/index.md`
      if (paths.has(path)) throw new NotebookStoreError('invalid', '同步列表包含重复的笔记本。')
      paths.add(path)
      // For existing indexes never reconstruct the file: preserve all other user content.
      if (book.sha && typeof book.indexContent !== 'string') throw new NotebookStoreError('invalid', '缺少笔记本原始内容，请先恢复后再编辑简介。')
      const original = book.indexContent ?? `# ${title}\n`
      const content = writeNotebookChapterOrder(writeNotebookDescription(original, book.description ?? readNotebookDescription(original)), book.chapterOrder)
      // Validate even when this request only changes the description. Never
      // discover corrupt order metadata after a GitHub commit has been made.
      readNotebookChapterOrder(content)
      changes.push({ path, content, baseline: book.sha || '', desired: await blobSha(content) })
    }
    for (const chapter of chapters) {
      checkId(chapter.bookId); checkChapterId(chapter.id)
      if (typeof chapter.content !== 'string' || typeof chapter.sha !== 'string') {
        throw new NotebookStoreError('invalid', '章节内容或版本号无效。')
      }
      const ext = itemExt(chapter)
      const path = `docs/${ROOT}/${chapter.bookId}/${chapter.id}.${ext}`
      if (paths.has(path)) throw new NotebookStoreError('invalid', '同步列表包含重复的章节。')
      paths.add(path)
      if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
        const bytes = chapter.filePath ? docsByPath.get(chapter.filePath) : undefined
        if (!bytes || !bytes.length) throw new NotebookStoreError('invalid', `缺少文档文件数据，无法同步：${chapter.title}`)
        if (bytes.length > MAX_GITHUB_DOCUMENT_BYTES) throw new NotebookStoreError('invalid', `文档超过 GitHub 单文件同步限制（25 MiB）：${chapter.title}`)
        changes.push({ path, bytes, baseline: chapter.sha, desired: await blobBytesSha(bytes) })
      } else {
        changes.push({ path, content: chapter.content, baseline: chapter.sha, desired: await blobSha(chapter.content) })
      }
    }
    for (const page of pages) {
      checkPageId(page.id)
      if (typeof page.content !== 'string' || typeof page.sha !== 'string') throw new NotebookStoreError('invalid', '书页内容或版本号无效。')
      const ext = itemExt(page)
      const path = `docs/pages/${page.id}.${ext}`
      if (paths.has(path)) throw new NotebookStoreError('invalid', '同步列表包含重复的书页。')
      paths.add(path)
      if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
        const bytes = page.filePath ? docsByPath.get(page.filePath) : undefined
        if (!bytes || !bytes.length) throw new NotebookStoreError('invalid', `缺少文档文件数据，无法同步：${page.title}`)
        if (bytes.length > MAX_GITHUB_DOCUMENT_BYTES) throw new NotebookStoreError('invalid', `文档超过 GitHub 单文件同步限制（25 MiB）：${page.title}`)
        changes.push({ path, bytes, baseline: page.sha, desired: await blobBytesSha(bytes) })
      } else {
        changes.push({ path, content: page.content, baseline: page.sha, desired: await blobSha(page.content) })
      }
    }
    const attachmentDirectories = new Set([...chapters.map(chapter => `docs/${ROOT}/${chapter.bookId}/assets/`), ...(pages.length ? ['docs/pages/assets/'] : [])])
    for (const attachment of attachments) {
      try { validateAttachment(attachment) } catch (error) { throw new NotebookStoreError('invalid', error instanceof Error ? error.message : '图片附件无效。') }
      if (![...attachmentDirectories].some(dir => attachment.path.startsWith(dir))) throw new NotebookStoreError('invalid', '图片不属于本次同步的笔记。')
      if (paths.has(attachment.path)) throw new NotebookStoreError('invalid', '同步列表包含重复的图片附件。')
      paths.add(attachment.path)
      // Images use immutable random names. Reusing a name for different bytes
      // is always a conflict, even if a stale local cache carries a SHA.
      changes.push({ path: attachment.path, bytes: attachment.bytes, baseline: '', desired: await blobBytesSha(attachment.bytes) })
    }

    const ref = await gitRequest('ref/heads/main') as { object?: { sha?: string } }
    const parent = ref?.object?.sha
    if (!parent) throw new NotebookStoreError('github', '无法读取 main 分支版本，请保留草稿。')
    const commit = await gitRequest(`commits/${encodeURIComponent(parent)}`) as { tree?: { sha?: string } }
    const baseTree = commit?.tree?.sha
    if (!baseTree) throw new NotebookStoreError('github', '无法读取仓库文件树，请保留草稿。')

    const cache = new Map<string, Promise<GitTree>>()
    async function tree(sha: string): Promise<GitTree> {
      if (!cache.has(sha)) cache.set(sha, (async () => {
        const value = await gitRequest(`trees/${encodeURIComponent(sha)}`) as GitTree
        if (!Array.isArray(value?.tree) || value.truncated) {
          throw new NotebookStoreError('github', '无法完整读取仓库文件树，请保留草稿。')
        }
        return value
      })())
      return cache.get(sha)!
    }
    async function findPath(path: string): Promise<GitTreeEntry | null> {
      const parts = path.split('/')
      let treeSha = baseTree!
      for (let i = 0; i < parts.length; i++) {
        const entry = (await tree(treeSha)).tree.find(item => item.path === parts[i])
        if (!entry) return null
        if (i === parts.length - 1) return entry
        if (entry.type !== 'tree' || !entry.sha) throw new NotebookStoreError('conflict', '仓库目录结构已变化，请保留草稿并检查。')
        treeSha = entry.sha
      }
      return null
    }

    const newBookPaths = new Set(newBooks.map(book => `docs/${ROOT}/${book.id}/index.md`))
    for (const bookId of new Set(chapters.map(chapter => chapter.bookId))) {
      const indexPath = `docs/${ROOT}/${bookId}/index.md`
      if (!newBookPaths.has(indexPath)) {
        const index = await findPath(indexPath)
        if (!index || index.type !== 'blob' || !['100644', '100755'].includes(index.mode)) {
          throw new NotebookStoreError('conflict', `笔记本已不存在或目录已变化：${bookId}。请保留草稿并检查。`)
        }
      }
    }

    const pending: typeof changes = []
    for (const change of changes) {
      const existing = await findPath(change.path)
      if (existing && (existing.type !== 'blob' || !['100644', '100755'].includes(existing.mode))) {
        throw new NotebookStoreError('conflict', '远程路径不是普通文件，请保留草稿并检查。')
      }
      const current = existing?.sha || ''
      // A matching desired blob makes a retry after a lost response idempotent.
      if (current === change.desired) continue
      if (current !== change.baseline) {
        throw new NotebookStoreError('conflict', `远程文件已发生变化：${change.path}。请保留草稿并合并后重试。`)
      }
      change.mode = existing?.mode || '100644'
      pending.push(change)
    }

    let head = parent
    if (pending.length) {
      const treeEntries: Array<{ path: string; mode?: string; type: 'blob'; content?: string; sha?: string }> = []
      // Upload sequentially: base64 encoding many large images in parallel
      // can otherwise exceed the renderer's memory before any commit exists.
      for (const change of pending) {
        if (!change.bytes) { treeEntries.push({ path: change.path, mode: change.mode, type: 'blob', content: change.content }); continue }
        const blob = await gitRequest('blobs', 'POST', { content: encodeBytes(change.bytes), encoding: 'base64' }) as { sha?: string }
        if (blob.sha !== change.desired) throw new NotebookStoreError('github', 'GitHub 返回的图片版本与本地不一致，请保留草稿。')
        treeEntries.push({ path: change.path, mode: change.mode, type: 'blob', sha: blob.sha })
      }
      const createdTree = await gitRequest('trees', 'POST', {
        base_tree: baseTree,
        tree: treeEntries
      }) as { sha?: string }
      if (!createdTree?.sha) throw new NotebookStoreError('github', 'GitHub 未返回文件树版本，请保留草稿。')
      const summary = [
        newBooks.length ? `${newBooks.length} notebook${newBooks.length === 1 ? '' : 's'}` : '',
        chapters.length ? `${chapters.length} note${chapters.length === 1 ? '' : 's'}` : '',
        pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'}` : '',
        catalogChange ? 'cabinet catalog' : ''
      ].filter(Boolean).join(', ')
      const createdCommit = await gitRequest('commits', 'POST', {
        message: `Sync ${summary}`,
        tree: createdTree.sha,
        parents: [parent]
      }) as { sha?: string }
      if (!createdCommit?.sha) throw new NotebookStoreError('github', 'GitHub 未返回提交版本，请保留草稿。')
      await gitRequest('refs/heads/main', 'PATCH', { sha: createdCommit.sha, force: false })
      head = createdCommit.sha
    }
    const desiredByPath = new Map(changes.map(change => [change.path, change.desired]))
    return {
      parent, head,
      books: newBooks.map(book => {
        const original = book.indexContent ?? `# ${checkTitle(book.title)}\n`
        const indexContent = writeNotebookChapterOrder(writeNotebookDescription(original, book.description ?? readNotebookDescription(original)), book.chapterOrder)
        return { ...book, title: checkTitle(book.title), indexContent, chapterOrder: readNotebookChapterOrder(indexContent), sha: desiredByPath.get(`docs/${ROOT}/${book.id}/index.md`)! }
      }),
      chapters: chapters.map(chapter => {
        const ext = itemExt(chapter)
        const title = ext === 'md' ? titleFrom(chapter.content, titleFromEncodedId(chapter.id, 'c')) : (chapter.title || titleFromEncodedId(chapter.id, 'c'))
        return { ...chapter, title, sha: desiredByPath.get(`docs/${ROOT}/${chapter.bookId}/${chapter.id}.${ext}`)! }
      }),
      pages: pages.map(page => {
        const ext = itemExt(page)
        const title = ext === 'md' ? titleFrom(page.content, page.title || page.id) : (page.title || titleFromEncodedId(page.id, 'p'))
        return { ...page, title, sha: desiredByPath.get(`docs/pages/${page.id}.${ext}`)! }
      }),
      ...(catalog ? { catalog: { catalog, sha: desiredByPath.get('docs/cabinets.json')! } } : {})
    }
  }

  /** Delete only the exact files reviewed by the caller, in a single Git commit. */
  async function deleteBatch(books: BookDeletion[], chapters: Chapter[], pages: Page[] = []): Promise<{ parent: string; head: string; catalog?: CatalogVersion }> {
    if (!token) throw new NotebookStoreError('auth', '请先连接有仓库内容写入权限的 GitHub 令牌。')
    if (!books.length && !chapters.length && !pages.length) throw new NotebookStoreError('invalid', '请先选择要删除的笔记本、章节或书页。')

    const expected = new Map<string, string>()
    const selectedBooks = new Map<string, Map<string, string>>()
    const requireSha = (sha: string) => {
      if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new NotebookStoreError('invalid', '缺少有效的远端版本号，请刷新后重试。')
      return sha
    }
    const addExpected = (path: string, sha: string) => {
      if (expected.has(path)) throw new NotebookStoreError('invalid', '删除列表包含重复条目。')
      expected.set(path, requireSha(sha))
    }
    for (const item of books) {
      const bookId = checkId(item.book.id)
      if (selectedBooks.has(bookId) || !Array.isArray(item.chapters)) throw new NotebookStoreError('invalid', '删除列表包含重复或无效的笔记本。')
      const directory = `docs/${ROOT}/${bookId}`
      const files = new Map<string, string>()
      files.set('index.md', requireSha(item.book.sha))
      for (const chapter of item.chapters) {
        if (chapter.bookId !== bookId) throw new NotebookStoreError('invalid', '章节不属于所选笔记本。')
        const name = `${checkChapterId(chapter.id)}.${itemExt(chapter)}`
        if (files.has(name)) throw new NotebookStoreError('invalid', '删除列表包含重复章节。')
        files.set(name, requireSha(chapter.sha))
      }
      selectedBooks.set(bookId, files)
      for (const [name, sha] of files) addExpected(`${directory}/${name}`, sha)
    }
    for (const chapter of chapters) {
      const bookId = checkId(chapter.bookId)
      const chapterId = checkChapterId(chapter.id)
      if (selectedBooks.has(bookId)) throw new NotebookStoreError('invalid', '整本笔记和其中章节不能重复选择。')
      addExpected(`docs/${ROOT}/${bookId}/${chapterId}.${itemExt(chapter)}`, chapter.sha)
    }
    for (const page of pages) addExpected(`docs/pages/${checkPageId(page.id)}.${itemExt(page)}`, page.sha)

    const ref = await gitRequest('ref/heads/main') as { object?: { sha?: string } }
    const parent = requireSha(ref?.object?.sha || '')
    const commit = await gitRequest(`commits/${encodeURIComponent(parent)}`) as { tree?: { sha?: string } }
    const baseTree = requireSha(commit?.tree?.sha || '')
    const cache = new Map<string, Promise<GitTree>>()
    async function tree(sha: string): Promise<GitTree> {
      if (!cache.has(sha)) cache.set(sha, (async () => {
        const value = await gitRequest(`trees/${encodeURIComponent(sha)}`) as GitTree
        if (!Array.isArray(value?.tree) || value.truncated) throw new NotebookStoreError('github', '无法完整读取远端目录，请保留本地内容。')
        return value
      })())
      return cache.get(sha)!
    }
    async function findPath(path: string): Promise<GitTreeEntry | null> {
      const parts = path.split('/')
      let current = baseTree
      for (let i = 0; i < parts.length; i++) {
        const entry = (await tree(current)).tree.find(item => item.path === parts[i])
        if (!entry) return null
        if (i === parts.length - 1) return entry
        if (entry.type !== 'tree' || !entry.sha) throw new NotebookStoreError('conflict', '远端目录结构已变化，请刷新后重试。')
        current = entry.sha
      }
      return null
    }
    const isRegularFile = (entry: GitTreeEntry) => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)
    for (const [bookId, files] of selectedBooks) {
      const dir = await findPath(`docs/${ROOT}/${bookId}`)
      if (!dir || dir.type !== 'tree' || !dir.sha) throw new NotebookStoreError('conflict', `远端笔记本已发生变化：${bookId}。`)
      const entries = (await tree(dir.sha)).tree
      // Retain only the application's validated, immutable attachment folder;
      // another note may reference an image even after this book is deleted.
      const assetFolder = entries.find(entry => entry.path === 'assets')
      if (assetFolder) {
        if (assetFolder.type !== 'tree' || !assetFolder.sha) throw new NotebookStoreError('conflict', `图片目录无效：${bookId}。`)
        const assets = (await tree(assetFolder.sha)).tree
        for (const asset of assets) {
          try { validateAttachmentPath(`docs/${ROOT}/${bookId}/assets/${asset.path}`) } catch { throw new NotebookStoreError('conflict', `图片目录含未识别文件：${bookId}。`) }
          if (!isRegularFile(asset)) throw new NotebookStoreError('conflict', `图片目录含未识别文件：${bookId}。`)
        }
      }
      const markdownEntries = entries.filter(entry => entry !== assetFolder)
      // Never remove an unseen file, nested directory or newly added chapter.
      if (markdownEntries.length !== files.size || markdownEntries.some(entry => !isRegularFile(entry) || !files.has(entry.path) || files.get(entry.path) !== entry.sha)) {
        throw new NotebookStoreError('conflict', `远端笔记本内容已变化或含有未识别文件：${bookId}。请刷新并检查后重试。`)
      }
    }
    const deletions: Array<{ path: string; mode: string; type: 'blob'; sha: null }> = []
    for (const [path, sha] of expected) {
      const entry = await findPath(path)
      if (!entry || !isRegularFile(entry) || entry.sha !== sha) throw new NotebookStoreError('conflict', `远端文件已变化：${path}。请刷新并检查后重试。`)
      deletions.push({ path, mode: entry.mode, type: 'blob', sha: null })
    }

    let catalog: CabinetCatalog | undefined
    let catalogSha: string | undefined
    let catalogChange: { path: string; mode: string; type: 'blob'; content: string } | undefined
    if (selectedBooks.size || pages.length) {
      const entry = await findPath('docs/cabinets.json')
      if (entry) {
        if (!isRegularFile(entry)) throw new NotebookStoreError('conflict', '远端书柜目录不是普通文件，请检查后重试。')
        const blob = await gitRequest(`blobs/${encodeURIComponent(entry.sha)}`) as GitHubFile
        catalog = checkedCatalog(decode(blob))
        let changed = false
        for (const bookId of selectedBooks.keys()) {
          if (Object.prototype.hasOwnProperty.call(catalog.assignments, bookId)) { delete catalog.assignments[bookId]; changed = true }
        }
        for (const page of pages) {
          const key = `page_${page.id}`
          if (Object.prototype.hasOwnProperty.call(catalog.assignments, key)) { delete catalog.assignments[key]; changed = true }
        }
        if (changed) {
          const content = catalogText(catalog)
          catalogSha = await blobSha(content)
          catalogChange = { path: 'docs/cabinets.json', mode: entry.mode, type: 'blob', content }
        }
      }
    }
    const createdTree = await gitRequest('trees', 'POST', {
      base_tree: baseTree,
      tree: catalogChange ? [...deletions, catalogChange] : deletions
    }) as { sha?: string }
    if (!createdTree?.sha) throw new NotebookStoreError('github', 'GitHub 未返回文件树版本；请保留本地内容。')
    const createdCommit = await gitRequest('commits', 'POST', {
      message: `Delete ${books.length} notebook(s), ${chapters.length} chapter(s), ${pages.length} page(s)`, tree: createdTree.sha, parents: [parent]
    }) as { sha?: string }
    if (!createdCommit?.sha) throw new NotebookStoreError('github', 'GitHub 未返回提交版本；请保留本地内容。')
    await gitRequest('refs/heads/main', 'PATCH', { sha: createdCommit.sha, force: false })
    return { parent, head: createdCommit.sha, ...(catalog && catalogSha ? { catalog: { catalog, sha: catalogSha } } : {}) }
  }

  async function file(path: string): Promise<GitHubFile> {
    const result = await request(path) as GitHubFile
    if (!result || result.type !== 'file' || typeof result.sha !== 'string') {
      throw new NotebookStoreError('github', 'GitHub 返回的文件信息无效。')
    }
    return result
  }

  async function entries(path: string, allowMissing = false): Promise<GitHubEntry[]> {
    const result = await request(path, { allowMissing })
    if (result === null) return []
    if (!Array.isArray(result)) throw new NotebookStoreError('github', 'GitHub 返回的目录信息无效。')
    // The contents API returns at most 1,000 entries; never silently hide entries.
    if (result.length >= 1000) throw new NotebookStoreError('github', '目录文件过多，无法完整读取。')
    return result as GitHubEntry[]
  }

  async function readChapter(bookId: string, chapterId: string, ext = 'md'): Promise<Chapter> {
    checkId(bookId); checkChapterId(chapterId)
    const normalized = normalizeFileExt(ext)
    const data = await file(`${ROOT}/${bookId}/${chapterId}.${normalized}`)
    if (BINARY_DOCUMENT_EXTENSIONS.has(normalized)) {
      const source = data.encoding === 'base64' && typeof data.content === 'string' ? data : await gitRequest(`blobs/${encodeURIComponent(data.sha)}`) as GitHubFile
      const bytes = decodeBinaryBlob(source)
      const title = titleFromEncodedId(chapterId, 'c')
      return { bookId, id: chapterId, title, content: '', sha: data.sha, ext: normalized, fileName: `${title}.${normalized}`, fileSize: bytes.length, binaryBytes: bytes }
    }
    const content = await fileContent(data)
    const title = normalized === 'md' ? titleFrom(content, titleFromEncodedId(chapterId, 'c')) : titleFromEncodedId(chapterId, 'c')
    return { bookId, id: chapterId, title, content, sha: data.sha, ...(normalized === 'md' ? {} : { ext: normalized }) }
  }

  // A directory listing is enough for shelf counts; don't download every
  // Markdown body just to render a chapter badge.
  async function listChapterIds(bookId: string): Promise<string[]> {
    checkId(bookId)
    const list = await entries(`${ROOT}/${bookId}`)
    return list.flatMap(item => {
      if (item.type !== 'file' || item.name.toLowerCase() === 'index.md') return []
      const parsed = splitDocumentFileName(item.name)
      return parsed && parsed.id.toLowerCase() !== 'index' ? [parsed.id] : []
    })
  }

  async function readPage(id: string, ext = 'md'): Promise<Page> {
    checkPageId(id)
    const normalized = normalizeFileExt(ext)
    const data = await file(`pages/${id}.${normalized}`)
    if (BINARY_DOCUMENT_EXTENSIONS.has(normalized)) {
      const source = data.encoding === 'base64' && typeof data.content === 'string' ? data : await gitRequest(`blobs/${encodeURIComponent(data.sha)}`) as GitHubFile
      const bytes = decodeBinaryBlob(source)
      const title = titleFromEncodedId(id, 'p')
      return { id, title, content: '', sha: data.sha, ext: normalized, fileName: `${title}.${normalized}`, fileSize: bytes.length, binaryBytes: bytes }
    }
    const content = await fileContent(data)
    const title = normalized === 'md' ? titleFrom(content, titleFromEncodedId(id, 'p')) : titleFromEncodedId(id, 'p')
    return { id, title, content, sha: data.sha, ...(normalized === 'md' ? {} : { ext: normalized }) }
  }

  // Contents may omit base64 for files over 1 MB; Git blobs still provide it.
  async function fileContent(data: GitHubFile): Promise<string> {
    if (data.encoding === 'base64' && typeof data.content === 'string') return decode(data)
    if (!/^[a-f0-9]{40}$/.test(data.sha)) throw new NotebookStoreError('github', 'GitHub 返回的文件版本号无效。')
    return decode(await gitRequest(`blobs/${encodeURIComponent(data.sha)}`) as GitHubFile)
  }

  async function readAttachment(path: string): Promise<NoteAttachment> {
    try { validateAttachmentPath(path) } catch { throw new NotebookStoreError('invalid', '图片附件路径无效。') }
    const data = await file(path.slice('docs/'.length))
    if (!/^[a-f0-9]{40}$/.test(data.sha)) throw new NotebookStoreError('github', 'GitHub 返回的图片版本无效。')
    const source = data.encoding === 'base64' && typeof data.content === 'string' ? data : await gitRequest(`blobs/${encodeURIComponent(data.sha)}`) as GitHubFile
    const attachment = { path, bytes: decodeBytes(source), sha: data.sha }
    try { validateAttachment(attachment) } catch (error) { throw new NotebookStoreError('invalid', error instanceof Error ? error.message : '图片附件无效。') }
    if (await blobBytesSha(attachment.bytes) !== data.sha) throw new NotebookStoreError('github', '图片校验失败，请重试。')
    return attachment
  }

  return {
    setToken(value: string): void { token = value.trim() },
    clearToken(): void { token = '' },
    async verifyRepository(): Promise<void> {
      if (!repoApi) throw new NotebookStoreError('invalid', '请先设置 GitHub 仓库地址。')
      let response: Response
      try {
        response = await fetch(repoApi, { headers: {
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }, cache: 'no-store' })
      } catch { throw new NotebookStoreError('network', '无法连接 GitHub，请检查网络后重试。') }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new NotebookStoreError('auth', 'GitHub 拒绝访问，请检查令牌权限。')
        if (response.status === 404) throw new NotebookStoreError('not-found', '仓库不存在或无权访问，请检查仓库地址和令牌。')
        throw new NotebookStoreError('github', `GitHub 请求失败（HTTP ${response.status}）。`)
      }
    },
    async readHead(): Promise<string> {
      const ref = await gitRequest('ref/heads/main') as { object?: { sha?: string } }
      if (!ref.object?.sha || !/^[a-f0-9]{40}$/.test(ref.object.sha)) throw new NotebookStoreError('github', 'GitHub 返回的分支版本无效。')
      return ref.object.sha
    },
    syncBatch,
    readAttachment,
    deleteBatch,
    async readCatalog(snapshot = true): Promise<CatalogVersion> {
      if (snapshot) {
        return { catalog: defaultCatalog(), sha: '' }
      }
      const data = await request('cabinets.json', { allowMissing: true }) as GitHubFile | null
      if (data === null) return { catalog: defaultCatalog(), sha: '' }
      if (data.type !== 'file' || typeof data.sha !== 'string') throw new NotebookStoreError('github', 'GitHub 返回的书柜文件信息无效。')
      return { catalog: checkedCatalog(decode(data)), sha: data.sha }
    },
    async listNotebooks(): Promise<Notebook[]> {
      const list = await entries(ROOT, true)
      const books = list.filter(item => item.type === 'dir' && ID.test(item.name))
      const found = await Promise.all(books.map(async item => {
        let data: GitHubFile
        try { data = await file(`${ROOT}/${item.name}/index.md`) }
        catch (error) {
          if (!(error instanceof NotebookStoreError) || error.code !== 'not-found') throw error
          // Deleting a book keeps its shared images; its assets-only directory
          // is not a notebook and must not break the rest of the library.
          const remaining = await entries(`${ROOT}/${item.name}`)
          if (remaining.length !== 1 || remaining[0].type !== 'dir' || remaining[0].name !== 'assets') throw error
          const assets = await entries(`${ROOT}/${item.name}/assets`)
          if (!assets.length || assets.some(asset => {
            if (asset.type !== 'file') return true
            try { validateAttachmentPath(`docs/${ROOT}/${item.name}/assets/${asset.name}`); return false } catch { return true }
          })) throw error
          return null
        }
        const content = decode(data)
        return { id: item.name, title: titleFrom(content, item.name), sha: data.sha, description: readNotebookDescription(content), indexContent: content, chapterOrder: readNotebookChapterOrder(content) }
      }))
      return found.filter((book): book is Notebook => book !== null)
    },
    async listChapters(bookId: string): Promise<Chapter[]> {
      checkId(bookId)
      const list = await entries(`${ROOT}/${bookId}`)
      const items = list.flatMap(item => {
        if (item.type !== 'file' || item.name.toLowerCase() === 'index.md') return []
        const parsed = splitDocumentFileName(item.name)
        return parsed && parsed.id.toLowerCase() !== 'index' ? [parsed] : []
      })
      return Promise.all(items.map(item => readChapter(bookId, item.id, item.ext)))
    },
    listChapterIds,
    async listPages(): Promise<Page[]> {
      const list = await entries('pages', true)
      const pages = list.flatMap(item => {
        if (item.type !== 'file') return []
        const parsed = splitDocumentFileName(item.name)
        return parsed ? [parsed] : []
      })
      return Promise.all(pages.map(item => readPage(item.id, item.ext)))
    },
    readChapter,
    readPage,
  }
}
