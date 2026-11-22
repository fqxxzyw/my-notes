/** Repository identity is fixed for a session and is never inferred from a token. */
export function normalizeRepository(input: string): string {
  let value = input.trim()
  if (/^https?:\/\//i.test(value)) {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('请输入 GitHub 仓库地址或 owner/repository。') }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
      throw new Error('请输入 github.com 上的 HTTPS 仓库地址。')
    }
    value = url.pathname.replace(/^\/+|\/+$/g, '')
  }
  if (value.toLowerCase().endsWith('.git')) value = value.slice(0, -4)
  const parts = value.split('/')
  const owner = parts[0] || '', repo = parts[1] || ''
  if (parts.length !== 2 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) || owner.includes('--') ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new Error('仓库格式应为 owner/repository，例如 octocat/my-notes。')
  }
  return `${owner}/${repo}`.toLowerCase()
}

/** Keep local drafts, journals and credentials isolated across repositories. */
export function namespaceKey(base: string, repository?: string | null): string {
  const scope = repository ? `repo:${encodeURIComponent(normalizeRepository(repository))}` : 'local'
  return `paper-notes:v2:${scope}:${base}`
}

const configurationKey = 'paper-notes:repository:v2'

export function getConfiguredRepository(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    const saved = localStorage.getItem(configurationKey)
    return saved ? normalizeRepository(saved) : ''
  } catch { return '' }
}

export function setConfiguredRepository(repository: string): void {
  if (typeof localStorage === 'undefined') throw new Error('本机存储不可用，无法保存仓库设置。')
  if (!repository.trim()) localStorage.removeItem(configurationKey)
  else localStorage.setItem(configurationKey, normalizeRepository(repository))
}
