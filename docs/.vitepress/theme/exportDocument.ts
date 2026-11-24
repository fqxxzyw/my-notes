/** Typora-style document exporters (.md download, standalone offline .html, print/PDF). */
import type { PaperThemeKind } from './mermaidRenderer'

function safeDownloadName(title: string, ext: string): string {
  const clean = (title || '未命名').trim().replace(/[\\/:*?"<>|\r\n]+/g, '_') || '未命名'
  return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function exportMarkdownFile(title: string, content: string): void {
  triggerBlobDownload(new Blob([content], { type: 'text/markdown;charset=utf-8' }), safeDownloadName(title, 'md'))
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Collect KaTeX rules from loaded document stylesheets so exported HTML renders math offline. */
function collectKatexStyles(): string {
  if (typeof document === 'undefined') return ''
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (!rules) continue
      let hasKatex = false
      for (let i = 0; i < Math.min(rules.length, 40); i++) {
        if (rules[i].cssText.includes('.katex')) { hasKatex = true; break }
      }
      if (!hasKatex) continue
      for (const rule of Array.from(rules)) {
        // Skip external @font-face relative URLs that wouldn't resolve in a standalone HTML file.
        if (rule.cssText.includes('@font-face')) continue
        if (rule.cssText.includes('.katex')) chunks.push(rule.cssText)
      }
    } catch { /* cross-origin stylesheet */ }
  }
  return chunks.join('\n')
}

/**
 * Export the currently rendered Markdown DOM (including Mermaid SVGs, KaTeX math,
 * syntax-highlighted code, tables, callouts, and footnotes) as a standalone HTML file.
 */
export function exportStandaloneHtml(title: string, articleEl: HTMLElement | null, theme: PaperThemeKind): void {
  if (!articleEl) return
  const clone = articleEl.cloneNode(true) as HTMLElement
  // Strip interactive-only chrome buttons from the exported static document.
  clone.querySelectorAll('.paper-code-copy, .paper-mermaid-actions').forEach(el => el.remove())

  const palette = theme === 'night'
    ? { bg: '#17191c', paper: '#222427', ink: '#ede9e2', muted: '#bcb6ad', edge: '#97938a', soft: '#2b2d31', accent: '#d5ad80' }
    : theme === 'green'
      ? { bg: '#e9f3e7', paper: '#f2f8ef', ink: '#25392c', muted: '#5d7261', edge: '#415d49', soft: '#dfeddd', accent: '#6e4726' }
      : theme === 'yellow'
        ? { bg: '#fbf5e0', paper: '#fff9e9', ink: '#473c2a', muted: '#786b55', edge: '#756548', soft: '#f1e8cc', accent: '#6e4726' }
        : { bg: '#f6f6f4', paper: '#ffffff', ink: '#111111', muted: '#555555', edge: '#111111', soft: '#f4f3f0', accent: '#6e4726' }

  const katexCss = collectKatexStyles()
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { --bg: ${palette.bg}; --paper: ${palette.paper}; --ink: ${palette.ink}; --muted: ${palette.muted}; --edge: ${palette.edge}; --soft: ${palette.soft}; --accent: ${palette.accent}; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--ink); font: 15px/1.85 "Source Sans 3", "PingFang SC", "Microsoft YaHei", sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 36px 42px; background: var(--paper); border: 2px solid var(--edge); border-radius: 10px; }
h1, h2, h3, h4 { line-height: 1.35; margin: 1.4em 0 0.55em; }
h1 { margin-top: 0; font-size: 2rem; border-bottom: 2px solid var(--edge); padding-bottom: 10px; }
a { color: var(--accent); text-underline-offset: 3px; }
mark { background: #fff099; color: #111; padding: 0 3px; border-radius: 3px; }
kbd { padding: 1px 5px; border: 1px solid var(--edge); border-radius: 4px; background: var(--soft); font: 600 12px ui-monospace, monospace; }
code { padding: 1px 5px; border-radius: 4px; background: var(--soft); font: 13.5px ui-monospace, Consolas, monospace; }
pre { overflow-x: auto; padding: 14px; border-radius: 6px; background: var(--soft); border: 1px solid var(--edge); }
pre code { padding: 0; background: transparent; }
blockquote { margin: 14px 0; padding: 8px 14px; border-left: 3px solid var(--edge); background: var(--soft); color: var(--muted); }
.paper-callout { margin: 16px 0; padding: 12px 16px; border: 1.5px solid var(--edge); border-left-width: 4px; border-radius: 8px; background: var(--soft); }
.paper-callout-title { font-weight: 700; margin-bottom: 6px; }
.paper-table-wrap { margin: 14px 0; border: 1.5px solid var(--edge); border-radius: 8px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 12px; border: 1px solid var(--edge); }
th { background: var(--soft); }
.paper-mermaid-card { margin: 16px 0; border: 1.5px solid var(--edge); border-radius: 8px; overflow: hidden; }
.paper-mermaid-bar { padding: 6px 12px; border-bottom: 1px solid var(--edge); background: var(--soft); font: 700 11px ui-monospace, monospace; color: var(--muted); }
.paper-mermaid-viewport { padding: 16px; text-align: center; overflow-x: auto; }
.paper-mermaid-stage svg { max-width: 100%; height: auto; }
.paper-code-block { margin: 14px 0; border: 1.5px solid var(--edge); border-radius: 8px; overflow: hidden; }
.paper-code-bar { padding: 5px 12px; border-bottom: 1px solid var(--edge); background: var(--soft); font: 700 11px ui-monospace, monospace; color: var(--muted); }
.paper-code-block pre { margin: 0; border: 0; border-radius: 0; }
img { max-width: 100%; height: auto; border-radius: 4px; }
.paper-footnotes { margin-top: 28px; padding-top: 14px; border-top: 1.5px solid var(--edge); font-size: 13px; color: var(--muted); }
${katexCss}
@media print { body { background: #fff; padding: 0; } main { border: 0; padding: 0; max-width: none; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${clone.innerHTML}
</main>
</body>
</html>`
  triggerBlobDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), safeDownloadName(title, 'html'))
}
