/** Offline Mermaid diagram rendering and interactive SVG hydration. */

export type PaperThemeKind = 'day' | 'night' | 'green' | 'yellow'

export type MermaidTemplate = {
  id: string
  label: string
  code: string
}

export const MERMAID_TEMPLATES: readonly MermaidTemplate[] = [
  {
    id: 'flowchart',
    label: '流程图 (Flowchart)',
    code: [
      'flowchart TD',
      '    A["开始节点"] --> B{"条件判断?"}',
      '    B -->|是| C["执行处理"]',
      '    B -->|否| D["备选分支"]',
      '    C --> E["结束"]',
      '    D --> E'
    ].join('\n')
  },
  {
    id: 'sequence',
    label: '时序图 (Sequence)',
    code: [
      'sequenceDiagram',
      '    participant U as 用户',
      '    participant S as 服务',
      '    U->>S: 发起请求',
      '    S-->>U: 返回结果'
    ].join('\n')
  },
  {
    id: 'state',
    label: '状态图 (State)',
    code: [
      'stateDiagram-v2',
      '    [*] --> 草稿',
      '    草稿 --> 审核中: 提交',
      '    审核中 --> 已发布: 通过',
      '    审核中 --> 草稿: 退回',
      '    已发布 --> [*]'
    ].join('\n')
  },
  {
    id: 'class',
    label: '类图 (Class)',
    code: [
      'classDiagram',
      '    class Notebook {',
      '        +String title',
      '        +addChapter()',
      '    }',
      '    class Chapter {',
      '        +String content',
      '    }',
      '    Notebook "1" --> "*" Chapter'
    ].join('\n')
  },
  {
    id: 'mindmap',
    label: '思维导图 (Mindmap)',
    code: [
      'mindmap',
      '  root((中心主题))',
      '    分支一',
      '      要点 A',
      '      要点 B',
      '    分支二',
      '      要点 C'
    ].join('\n')
  },
  {
    id: 'gantt',
    label: '甘特图 (Gantt)',
    code: [
      'gantt',
      '    title 项目计划',
      '    dateFormat YYYY-MM-DD',
      '    section 阶段一',
      '    需求整理 :a1, 2026-01-01, 5d',
      '    开发实现 :after a1, 10d'
    ].join('\n')
  }
]

/** Check whether a fenced code info string denotes a Mermaid diagram. */
export function isMermaidLanguage(info: string): boolean {
  const token = (info || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
  return token === 'mermaid'
}

/** Extract the inner Mermaid diagram code from a fenced Markdown block. */
export function extractMermaidFence(source: string): { code: string; language: string; fence: string } | null {
  if (!source) return null
  const lines = source.split(/\r?\n/)
  if (!lines.length) return null
  const open = /^\s{0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(lines[0])
  if (!open) return null
  const fence = open[1]
  const info = open[2].trim()
  if (!isMermaidLanguage(info)) return null
  let endIndex = lines.length
  if (lines.length > 1) {
    const closePattern = new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`)
    if (closePattern.test(lines[lines.length - 1])) endIndex = lines.length - 1
  }
  const code = lines.slice(1, endIndex).join('\n').trim()
  return { code, language: info.split(/\s+/)[0], fence }
}

export function currentPaperTheme(): PaperThemeKind {
  if (typeof document === 'undefined') return 'day'
  const classes = document.documentElement.classList
  if (classes.contains('paper-night')) return 'night'
  if (classes.contains('paper-theme-green')) return 'green'
  if (classes.contains('paper-theme-yellow')) return 'yellow'
  return 'day'
}

function themeConfig(theme: PaperThemeKind) {
  const fontFamily = '"Source Sans 3", "PingFang SC", "Microsoft YaHei", sans-serif'
  if (theme === 'night') {
    return {
      theme: 'base' as const,
      themeVariables: {
        darkMode: true,
        fontFamily,
        fontSize: '14px',
        background: '#222427',
        mainBkg: '#2d3035',
        primaryColor: '#2d3035',
        primaryTextColor: '#ede9e2',
        primaryBorderColor: '#b4aea4',
        secondaryColor: '#36393f',
        secondaryTextColor: '#ede9e2',
        secondaryBorderColor: '#97938a',
        tertiaryColor: '#25282c',
        tertiaryTextColor: '#ede9e2',
        tertiaryBorderColor: '#88857e',
        lineColor: '#c8c2b8',
        textColor: '#ede9e2',
        edgeLabelBackground: '#222427',
        clusterBkg: '#1d1f22',
        clusterBorder: '#97938a',
        nodeBorder: '#b4aea4',
        actorBkg: '#2d3035',
        actorBorder: '#b4aea4',
        actorTextColor: '#ede9e2',
        signalColor: '#c8c2b8',
        signalTextColor: '#ede9e2',
        noteBkgColor: '#343639',
        noteTextColor: '#ede9e2',
        noteBorderColor: '#d5ad80'
      }
    }
  }
  if (theme === 'green') {
    return {
      theme: 'base' as const,
      themeVariables: {
        darkMode: false,
        fontFamily,
        fontSize: '14px',
        background: '#f2f8ef',
        mainBkg: '#ffffff',
        primaryColor: '#e5f1e2',
        primaryTextColor: '#25392c',
        primaryBorderColor: '#415d49',
        secondaryColor: '#dfeddd',
        secondaryTextColor: '#25392c',
        secondaryBorderColor: '#415d49',
        tertiaryColor: '#f7fbf5',
        tertiaryTextColor: '#25392c',
        tertiaryBorderColor: '#718976',
        lineColor: '#35503d',
        textColor: '#25392c',
        edgeLabelBackground: '#f2f8ef',
        clusterBkg: '#e9f3e7',
        clusterBorder: '#5d7261',
        nodeBorder: '#415d49',
        noteBkgColor: '#dfeddd',
        noteTextColor: '#25392c',
        noteBorderColor: '#415d49'
      }
    }
  }
  if (theme === 'yellow') {
    return {
      theme: 'base' as const,
      themeVariables: {
        darkMode: false,
        fontFamily,
        fontSize: '14px',
        background: '#fff9e9',
        mainBkg: '#fffdf5',
        primaryColor: '#f6edd4',
        primaryTextColor: '#473c2a',
        primaryBorderColor: '#756548',
        secondaryColor: '#f1e8cc',
        secondaryTextColor: '#473c2a',
        secondaryBorderColor: '#756548',
        tertiaryColor: '#fbf5e0',
        tertiaryTextColor: '#473c2a',
        tertiaryBorderColor: '#aa9a79',
        lineColor: '#5c4d35',
        textColor: '#473c2a',
        edgeLabelBackground: '#fff9e9',
        clusterBkg: '#fbf5e0',
        clusterBorder: '#8c7a5b',
        nodeBorder: '#756548',
        noteBkgColor: '#f1e8cc',
        noteTextColor: '#473c2a',
        noteBorderColor: '#756548'
      }
    }
  }
  return {
    theme: 'base' as const,
    themeVariables: {
      darkMode: false,
      fontFamily,
      fontSize: '14px',
      background: '#ffffff',
      mainBkg: '#ffffff',
      primaryColor: '#f7f5f0',
      primaryTextColor: '#111111',
      primaryBorderColor: '#111111',
      secondaryColor: '#f2f2f0',
      secondaryTextColor: '#111111',
      secondaryBorderColor: '#111111',
      tertiaryColor: '#fafafa',
      tertiaryTextColor: '#111111',
      tertiaryBorderColor: '#555555',
      lineColor: '#111111',
      textColor: '#111111',
      edgeLabelBackground: '#ffffff',
      clusterBkg: '#faf9f6',
      clusterBorder: '#111111',
      nodeBorder: '#111111',
      noteBkgColor: '#f7f3ea',
      noteTextColor: '#111111',
      noteBorderColor: '#6e4726'
    }
  }
}

type MermaidModule = typeof import('mermaid')['default']
let mermaidPromise: Promise<MermaidModule> | null = null
let renderQueue: Promise<unknown> = Promise.resolve()
let renderCounter = 0
const svgCache = new Map<string, string>()
const MAX_CACHE = 120

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => mod.default)
  }
  return mermaidPromise
}

function setCachedSvg(key: string, svg: string) {
  if (svgCache.has(key)) svgCache.delete(key)
  svgCache.set(key, svg)
  if (svgCache.size > MAX_CACHE) {
    const oldest = svgCache.keys().next().value
    if (oldest !== undefined) svgCache.delete(oldest)
  }
}

/** Auto-quote unquoted flowchart edge labels like `-->|命中! (~1ms)|` that contain Mermaid lexer tokens `()[]{}<>`. */
export function sanitizeMermaidSource(code: string): string {
  return code.replace(/(-->|-\.->|==>|---)\|([^|"\r\n][^|\r\n]*)\|/g, (full, arrow: string, label: string) => {
    const trimmed = label.trim()
    if (!trimmed || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return full
    if (/[()[\]{}<>]/.test(trimmed)) {
      return `${arrow}|"${trimmed.replace(/"/g, "'")}"|`
    }
    return full
  })
}

export async function renderMermaidSvg(
  code: string,
  theme: PaperThemeKind = currentPaperTheme()
): Promise<{ svg: string } | { error: string }> {
  const trimmed = code.trim()
  if (!trimmed) return { error: '节点图内容为空。' }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { error: '图表将在页面加载后渲染。' }
  }
  const cacheKey = `${theme}\0${trimmed}`
  const cached = svgCache.get(cacheKey)
  if (cached) return { svg: cached }

  const task = renderQueue.then(async (): Promise<{ svg: string } | { error: string }> => {
    const again = svgCache.get(cacheKey)
    if (again) return { svg: again }
    const mermaid = await loadMermaid()
    const cfg = themeConfig(theme)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: 'basis', padding: 14 },
      sequence: { useMaxWidth: true, wrap: true },
      gantt: { useMaxWidth: true },
      class: { useMaxWidth: true },
      state: { useMaxWidth: true },
      ...cfg
    })
    const id = `paper-mermaid-${++renderCounter}`
    const sandbox = document.createElement('div')
    sandbox.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none;font-family:"Source Sans 3","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.45;'
    document.body.appendChild(sandbox)
    try {
      let rendered: { svg: string }
      try {
        rendered = await mermaid.render(id, trimmed, sandbox)
      } catch (firstErr) {
        const sanitized = sanitizeMermaidSource(trimmed)
        if (sanitized === trimmed) throw firstErr
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
        rendered = await mermaid.render(`${id}-s`, sanitized, sandbox)
      }
      const svg = rendered.svg
      setCachedSvg(cacheKey, svg)
      return { svg }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '语法错误')
      return { error: message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'Mermaid 语法解析失败。' }
    } finally {
      sandbox.remove()
      // Clean up any stray error element Mermaid might have appended to body.
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
    }
  })
  renderQueue = task.catch(() => {})
  return task
}

export interface MermaidMountOptions {
  theme?: PaperThemeKind
  onEdit?: () => void
  onVisualEdit?: () => void
  editLabel?: string
  showSourceToggle?: boolean
  compact?: boolean
}

/**
 * Mount a full interactive Mermaid diagram card into `host`.
 * Returns a cleanup callback that cancels stale async renders.
 */
export function mountMermaidCard(host: HTMLElement, code: string, options: MermaidMountOptions = {}): () => void {
  let cancelled = false
  let zoom = 1
  let showingSource = false
  let lastSvg = ''

  host.replaceChildren()
  host.classList.add('paper-mermaid-card')
  if (options.compact) host.classList.add('is-compact')

  const header = document.createElement('div')
  header.className = 'paper-mermaid-bar'

  const label = document.createElement('span')
  label.className = 'paper-mermaid-label'
  label.textContent = options.compact ? 'MERMAID · 实时预览' : 'MERMAID · 节点图'
  header.append(label)

  const actions = document.createElement('div')
  actions.className = 'paper-mermaid-actions'

  const makeButton = (text: string, title: string, onClick: (event: MouseEvent) => void) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'paper-mermaid-btn'
    button.textContent = text
    button.title = title
    button.addEventListener('pointerdown', e => e.stopPropagation())
    button.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      onClick(e)
    })
    return button
  }

  const viewport = document.createElement('div')
  viewport.className = 'paper-mermaid-viewport'

  const stage = document.createElement('div')
  stage.className = 'paper-mermaid-stage'
  stage.innerHTML = '<span class="paper-mermaid-loading">正在渲染节点图…</span>'
  viewport.append(stage)

  const sourcePre = document.createElement('pre')
  sourcePre.className = 'paper-mermaid-source'
  sourcePre.hidden = true
  const sourceCode = document.createElement('code')
  sourceCode.textContent = code
  sourcePre.append(sourceCode)

  const applyZoom = () => {
    const svg = stage.querySelector<SVGElement>('svg')
    if (!svg) return
    const baseWidth = Number(svg.dataset.baseWidth) || 0
    if (zoom === 1) {
      svg.style.width = baseWidth > 0 ? `${Math.round(baseWidth)}px` : ''
      svg.style.maxWidth = '100%'
      svg.style.transform = ''
    } else {
      svg.style.maxWidth = 'none'
      const width = baseWidth || svg.getBoundingClientRect().width || 600
      svg.style.width = `${Math.round(width * zoom)}px`
    }
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`
  }

  const zoomOutBtn = makeButton('−', '缩小图表', () => { zoom = Math.max(0.5, Number((zoom - 0.15).toFixed(2))); applyZoom() })
  const zoomLabel = makeButton('100%', '重置缩放', () => { zoom = 1; applyZoom() })
  const zoomInBtn = makeButton('+', '放大图表', () => { zoom = Math.min(2.4, Number((zoom + 0.15).toFixed(2))); applyZoom() })
  actions.append(zoomOutBtn, zoomLabel, zoomInBtn)

  if (options.showSourceToggle !== false) {
    const toggleBtn = makeButton('源码', '切换查看 Mermaid 源码', () => {
      showingSource = !showingSource
      viewport.hidden = showingSource
      sourcePre.hidden = !showingSource
      toggleBtn.textContent = showingSource ? '图表' : '源码'
      toggleBtn.setAttribute('aria-pressed', String(showingSource))
    })
    actions.append(toggleBtn)
  }

  const copyBtn = makeButton('复制', '复制 Mermaid 代码', () => {
    navigator.clipboard?.writeText(code).then(() => {
      copyBtn.textContent = '已复制'
      setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = '复制' }, 1500)
    }).catch(() => {})
  })
  actions.append(copyBtn)

  if (options.onVisualEdit) {
    const visualBtn = makeButton('可视化编辑', '打开可视化节点图编辑器', () => options.onVisualEdit?.())
    visualBtn.classList.add('is-primary')
    actions.append(visualBtn)
  }

  if (options.onEdit) {
    const editBtn = makeButton(options.editLabel || '编辑源码', '编辑 Mermaid 源码', () => options.onEdit?.())
    if (!options.onVisualEdit) editBtn.classList.add('is-primary')
    actions.append(editBtn)
  }

  header.append(actions)
  host.append(header, viewport, sourcePre)

  void renderMermaidSvg(code, options.theme).then(result => {
    if (cancelled || !host.isConnected) return
    if ('svg' in result) {
      lastSvg = result.svg
      stage.innerHTML = lastSvg
      const svg = stage.querySelector<SVGElement>('svg')
      if (svg) {
        const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
        const maxW = parseFloat(svg.style.maxWidth || '')
        const attrW = parseFloat(svg.getAttribute('width') || '')
        const naturalWidth = (vb.length === 4 && vb[2] > 0)
          ? vb[2]
          : (Number.isFinite(maxW) && maxW > 0 ? maxW : (Number.isFinite(attrW) && attrW > 0 ? attrW : 0))
        if (naturalWidth > 0) svg.dataset.baseWidth = String(naturalWidth)
        svg.removeAttribute('height')
        svg.style.height = 'auto'
      }
      applyZoom()
    } else {
      const box = document.createElement('div')
      box.className = 'paper-mermaid-error'
      const msg = document.createElement('p')
      msg.textContent = `节点图渲染失败：${result.error}`
      const raw = document.createElement('pre')
      const rawCode = document.createElement('code')
      rawCode.textContent = code
      raw.append(rawCode)
      box.append(msg, raw)
      stage.replaceChildren(box)
    }
  })

  return () => { cancelled = true }
}
