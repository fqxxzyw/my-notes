/** GitHub-backed notebook storage. Credentials live only in this store instance. */
import { defaultCatalog, parseCatalog, serializeCatalog, type CabinetCatalog, type CatalogVersion } from './cabinetStore'
export type { CabinetCatalog, CatalogVersion } from './cabinetStore'
export type Notebook = { id: string; title: string; sha: string }
export type Chapter = { bookId: string; id: string; title: string; content: string; sha: string }
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
type BatchResult = { books: Notebook[]; chapters: Chapter[]; catalog?: CatalogVersion }

const ROOT = 'notebooks'
const API = 'https://api.github.com/repos/fqxxzyw/my-notes/contents/docs'
const GIT_API = 'https://api.github.com/repos/fqxxzyw/my-notes/git'
const ID = /^[a-zA-Z0-9_-]+$/
// These files are bundled as raw text, so the bookshelf remains available
// without GitHub API access. The published snapshot represents a real commit.
const snapshotFiles = import.meta.glob<string>('../../notebooks/*/*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
})
const snapshotCatalogFile = import.meta.glob<string>('../../cabinets.json', {
  eager: true,
  query: '?raw',
  import: 'default'
})

function checkedCatalog(raw: string): CabinetCatalog {
  try { return parseCatalog(raw) }
  catch (error) { throw new NotebookStoreError('invalid', error instanceof Error ? error.message : '书柜目录格式无效。') }
}

function catalogText(catalog: CabinetCatalog): string {
  try { return serializeCatalog(catalog) }
  catch (error) { throw new NotebookStoreError('invalid', error instanceof Error ? error.message : '书柜目录格式无效。') }
}

async function blobSha(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new NotebookStoreError('github', '浏览器无法计算文件版本号，请使用安全连接访问。')
  }
  const encoder = new TextEncoder()
  const body = encoder.encode(content)
  const header = encoder.encode(`blob ${body.length}\0`)
  const data = new Uint8Array(header.length + body.length)
  data.set(header)
  data.set(body, header.length)
  const hash = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function snapshotEntries(): Array<{ bookId: string; name: string; content: string }> {
  return Object.entries(snapshotFiles).flatMap(([path, content]) => {
    const match = /^\.\.\/\.\.\/notebooks\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.md$/.exec(path)
    return match ? [{ bookId: match[1], name: match[2], content }] : []
  })
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

function checkTitle(title: string): string {
  const value = title.trim()
  if (!value || /[\r\n]/.test(value) || value.length > 120) {
    throw new NotebookStoreError('invalid', '标题不能为空、包含换行或超过 120 个字符。')
  }
  return value
}

function titleFrom(content: string, fallback: string): string {
  const match = /^#\s+(.+?)\s*$/m.exec(content.replace(/^\uFEFF/, ''))
  return match?.[1] || fallback
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

export function createNotebookStore() {
  let token = ''

  async function request(path: string, options: { allowMissing?: boolean } = {}): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${API}/${path.split('/').map(encodeURIComponent).join('/')}?ref=main`, {
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
    let response: Response
    try {
      response = await fetch(`${GIT_API}/${path}`, {
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
      throw new NotebookStoreError('network', '无法连接 GitHub。提交结果可能未知，请保留草稿并用相同内容重试。')
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

  async function syncBatch(newBooks: Notebook[], chapters: Chapter[], catalogChange?: CatalogVersion): Promise<BatchResult> {
    if (!token) throw new NotebookStoreError('auth', '请先输入具有仓库内容写入权限的 GitHub 令牌。')
    if (!newBooks.length && !chapters.length && !catalogChange) throw new NotebookStoreError('invalid', '请至少选择一本新笔记本、一篇章节或书柜目录。')

    const paths = new Set<string>()
    const changes: Array<{ path: string; content: string; baseline: string; desired: string; mode?: string }> = []
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
      const content = `# ${title}\n`
      changes.push({ path, content, baseline: book.sha || '', desired: await blobSha(content) })
    }
    for (const chapter of chapters) {
      checkId(chapter.bookId); checkChapterId(chapter.id)
      if (typeof chapter.content !== 'string' || typeof chapter.sha !== 'string') {
        throw new NotebookStoreError('invalid', '章节内容或版本号无效。')
      }
      const path = `docs/${ROOT}/${chapter.bookId}/${chapter.id}.md`
      if (paths.has(path)) throw new NotebookStoreError('invalid', '同步列表包含重复的章节。')
      paths.add(path)
      changes.push({ path, content: chapter.content, baseline: chapter.sha, desired: await blobSha(chapter.content) })
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

    if (pending.length) {
      const createdTree = await gitRequest('trees', 'POST', {
        base_tree: baseTree,
        tree: pending.map(change => ({ path: change.path, mode: change.mode, type: 'blob', content: change.content }))
      }) as { sha?: string }
      if (!createdTree?.sha) throw new NotebookStoreError('github', 'GitHub 未返回文件树版本，请保留草稿。')
      const summary = [
        newBooks.length ? `${newBooks.length} notebook${newBooks.length === 1 ? '' : 's'}` : '',
        chapters.length ? `${chapters.length} note${chapters.length === 1 ? '' : 's'}` : '',
        catalogChange ? 'cabinet catalog' : ''
      ].filter(Boolean).join(', ')
      const createdCommit = await gitRequest('commits', 'POST', {
        message: `Sync ${summary}`,
        tree: createdTree.sha,
        parents: [parent]
      }) as { sha?: string }
      if (!createdCommit?.sha) throw new NotebookStoreError('github', 'GitHub 未返回提交版本，请保留草稿。')
      await gitRequest('refs/heads/main', 'PATCH', { sha: createdCommit.sha, force: false })
    }
    const desiredByPath = new Map(changes.map(change => [change.path, change.desired]))
    return {
      books: newBooks.map(book => ({ ...book, title: checkTitle(book.title), sha: desiredByPath.get(`docs/${ROOT}/${book.id}/index.md`)! })),
      chapters: chapters.map(chapter => ({ ...chapter, title: titleFrom(chapter.content, chapter.id), sha: desiredByPath.get(`docs/${ROOT}/${chapter.bookId}/${chapter.id}.md`)! })),
      ...(catalog ? { catalog: { catalog, sha: desiredByPath.get('docs/cabinets.json')! } } : {})
    }
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

  async function readChapter(bookId: string, chapterId: string): Promise<Chapter> {
    checkId(bookId); checkChapterId(chapterId)
    const data = await file(`${ROOT}/${bookId}/${chapterId}.md`)
    const content = decode(data)
    return { bookId, id: chapterId, title: titleFrom(content, chapterId), content, sha: data.sha }
  }

  return {
    setToken(value: string): void { token = value.trim() },
    clearToken(): void { token = '' },
    syncBatch,
    async readCatalog(snapshot = true): Promise<CatalogVersion> {
      if (snapshot) {
        const raw = snapshotCatalogFile['../../cabinets.json']
        return raw === undefined ? { catalog: defaultCatalog(), sha: '' } : { catalog: checkedCatalog(raw), sha: await blobSha(raw) }
      }
      const data = await request('cabinets.json', { allowMissing: true }) as GitHubFile | null
      if (data === null) return { catalog: defaultCatalog(), sha: '' }
      if (data.type !== 'file' || typeof data.sha !== 'string') throw new NotebookStoreError('github', 'GitHub 返回的书柜文件信息无效。')
      return { catalog: checkedCatalog(decode(data)), sha: data.sha }
    },
    async listSnapshotNotebooks(): Promise<Notebook[]> {
      return Promise.all(snapshotEntries().filter(item => item.name === 'index').map(async item => ({
        id: item.bookId,
        title: titleFrom(item.content, item.bookId),
        sha: await blobSha(item.content)
      })))
    },
    async listSnapshotChapters(bookId: string): Promise<Chapter[]> {
      checkId(bookId)
      return Promise.all(snapshotEntries().filter(item => item.bookId === bookId && item.name.toLowerCase() !== 'index').map(async item => ({
        bookId,
        id: item.name,
        title: titleFrom(item.content, item.name),
        content: item.content,
        sha: await blobSha(item.content)
      })))
    },
    async listNotebooks(): Promise<Notebook[]> {
      const list = await entries(ROOT, true)
      const books = list.filter(item => item.type === 'dir' && ID.test(item.name))
      return Promise.all(books.map(async item => {
        const data = await file(`${ROOT}/${item.name}/index.md`)
        return { id: item.name, title: titleFrom(decode(data), item.name), sha: data.sha }
      }))
    },
    async listChapters(bookId: string): Promise<Chapter[]> {
      checkId(bookId)
      const list = await entries(`${ROOT}/${bookId}`)
      const chapters = list.filter(item => item.type === 'file' && item.name.endsWith('.md') && item.name.toLowerCase() !== 'index.md' && ID.test(item.name.slice(0, -3)))
      return Promise.all(chapters.map(item => readChapter(bookId, item.name.slice(0, -3))))
    },
    readChapter,
  }
}
