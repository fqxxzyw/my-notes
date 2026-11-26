export type GitProvider = 'github' | 'gitee' | 'gitlab' | 'gitcode'

export interface ParsedRepository {
  provider: GitProvider
  providerLabel: string
  owner: string
  repo: string
  slug: string
  canonical: string
  webUrl: string
}

const HOST_TO_PROVIDER: Record<string, GitProvider> = {
  'github.com': 'github',
  'gitee.com': 'gitee',
  'gitlab.com': 'gitlab',
  'gitcode.com': 'gitcode'
}

const PROVIDER_META: Record<GitProvider, { label: string; host: string }> = {
  github: { label: 'GitHub', host: 'github.com' },
  gitee: { label: 'Gitee 码云', host: 'gitee.com' },
  gitlab: { label: 'GitLab', host: 'gitlab.com' },
  gitcode: { label: 'GitCode', host: 'gitcode.com' }
}

/** Repository identity is fixed for a session and is never inferred from a token. */
export function normalizeRepository(input: string): string {
  let value = input.trim()
  let provider: GitProvider = 'github'

  const prefixMatch = /^(github|gitee|gitlab|gitcode):(.+)$/i.exec(value)
  if (prefixMatch) {
    provider = prefixMatch[1].toLowerCase() as GitProvider
    value = prefixMatch[2].trim()
  } else if (/^https?:\/\//i.test(value)) {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('请输入有效的 Git 仓库地址（支持 GitHub / Gitee / GitLab / GitCode）或 owner/repository。') }
    const mapped = HOST_TO_PROVIDER[url.hostname.toLowerCase()]
    if (url.protocol !== 'https:' || !mapped || url.port || url.username || url.password || url.search || url.hash) {
      throw new Error('请输入 GitHub、Gitee、GitLab 或 GitCode 上的 HTTPS 仓库地址。')
    }
    provider = mapped
    value = url.pathname.replace(/^\/+|\/+$/g, '')
  }

  if (value.toLowerCase().endsWith('.git')) value = value.slice(0, -4)
  const parts = value.split('/')
  const owner = parts[0] || '', repo = parts[1] || ''
  if (parts.length !== 2 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,37}[a-zA-Z0-9])?$/.test(owner) || owner.includes('--') ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new Error('仓库格式应为 owner/repository，例如 octocat/my-notes 或 https://gitee.com/owner/my-notes。')
  }
  const slug = `${owner}/${repo}`.toLowerCase()
  return provider === 'github' ? slug : `${provider}:${slug}`
}

/** Parse a normalized or raw repository string into provider, owner, repo and web URL. */
export function parseRepository(input: string): ParsedRepository {
  const canonical = normalizeRepository(input)
  const colon = canonical.indexOf(':')
  const provider: GitProvider = colon > 0 ? (canonical.slice(0, colon) as GitProvider) : 'github'
  const slug = colon > 0 ? canonical.slice(colon + 1) : canonical
  const [owner, repo] = slug.split('/')
  const meta = PROVIDER_META[provider]
  return {
    provider,
    providerLabel: meta.label,
    owner,
    repo,
    slug,
    canonical,
    webUrl: `https://${meta.host}/${slug}`
  }
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
