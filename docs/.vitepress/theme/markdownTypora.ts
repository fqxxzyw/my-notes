/**
 * Typora-parity Markdown extensions for markdown-it:
 * - LaTeX Math ($...$ inline & $$...$$ block) via offline KaTeX (trust: false)
 * - Highlight (==text==), Subscript (~text~), Superscript (^text^), and strictly allowlisted safe tags
 * - GitHub / Typora Callouts (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION])
 * - Footnotes ([^id] and [^id]: explanation)
 * - [TOC] automatic clickable Table of Contents block
 * - Offline highlight.js code syntax highlighting (tree-shaken common languages)
 */
import type MarkdownIt from 'markdown-it'
import katex from 'katex'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import markdownLang from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import ini from 'highlight.js/lib/languages/ini'
import http from 'highlight.js/lib/languages/http'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import kotlin from 'highlight.js/lib/languages/kotlin'
import swift from 'highlight.js/lib/languages/swift'
import lua from 'highlight.js/lib/languages/lua'
import { headingSlug } from './markdownLinks'

const registeredLangs: Array<[string, any]> = [
  ['javascript', javascript], ['js', javascript], ['jsx', javascript],
  ['typescript', typescript], ['ts', typescript], ['tsx', typescript],
  ['python', python], ['py', python],
  ['java', java],
  ['c', c],
  ['cpp', cpp], ['c++', cpp], ['cc', cpp], ['cxx', cpp],
  ['csharp', csharp], ['cs', csharp], ['c#', csharp],
  ['go', go], ['golang', go],
  ['rust', rust], ['rs', rust],
  ['sql', sql],
  ['json', json], ['jsonc', json],
  ['yaml', yaml], ['yml', yaml],
  ['xml', xml], ['html', xml], ['vue', xml], ['svg', xml],
  ['css', css], ['scss', css],
  ['bash', bash], ['sh', bash], ['shell', bash], ['zsh', bash],
  ['powershell', powershell], ['ps1', powershell], ['pwsh', powershell],
  ['markdown', markdownLang], ['md', markdownLang],
  ['diff', diff], ['patch', diff],
  ['ini', ini], ['toml', ini], ['properties', ini],
  ['http', http],
  ['dockerfile', dockerfile], ['docker', dockerfile],
  ['php', php],
  ['ruby', ruby], ['rb', ruby],
  ['kotlin', kotlin], ['kt', kotlin],
  ['swift', swift],
  ['lua', lua]
]
for (const [name, def] of registeredLangs) hljs.registerLanguage(name, def)

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Highlight source code offline with highlight.js, falling back safely to escaped plain text. */
export function highlightCodeBlock(code: string, rawInfo: string): string {
  const lang = (rawInfo || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch { /* fall through */ }
  }
  return escapeHtml(code)
}

/** Render LaTeX math via KaTeX with `trust: false` to prevent HTML/URL injection. */
export function renderKatexMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    })
  } catch {
    const escaped = escapeHtml(tex)
    return displayMode
      ? `<div class="paper-math-error"><code>$$${escaped}$$</code></div>`
      : `<code class="paper-math-error">$${escaped}$</code>`
  }
}

/** Extract inner LaTeX from a `$$ ... $$` block for live editor widgets. */
export function extractDisplayMathBlock(source: string): string | null {
  const trimmed = source.trim()
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) return null
  return trimmed.slice(2, -2).trim()
}

// --- MarkdownIt Rules ---

function enableMath(md: MarkdownIt) {
  // Display math block: `$$\n...\n$$` or single-line `$$...$$`
  md.block.ruler.after('blockquote', 'paper_math_block', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '$$') return false

    const firstLine = state.src.slice(pos + 2, max)
    // Single-line display math: `$$ E = mc^2 $$`
    if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
      if (silent) return true
      const inner = firstLine.trim().slice(0, -2).trim()
      const token = state.push('paper_math_block', 'div', 0)
      token.block = true
      token.content = inner
      token.map = [startLine, startLine + 1]
      state.line = startLine + 1
      return true
    }

    // Multi-line display math
    let nextLine = startLine + 1
    let foundClose = false
    let closeInlineTail = ''
    while (nextLine < endLine) {
      const lPos = state.bMarks[nextLine] + state.tShift[nextLine]
      const lMax = state.eMarks[nextLine]
      const text = state.src.slice(lPos, lMax)
      const trimmed = text.trim()
      if (trimmed === '$$') {
        foundClose = true
        break
      }
      if (trimmed.endsWith('$$') && !trimmed.endsWith('\\$$')) {
        closeInlineTail = trimmed.slice(0, -2)
        foundClose = true
        break
      }
      nextLine++
    }
    if (!foundClose) return false
    if (silent) return true

    const bodyLines: string[] = []
    if (firstLine.trim()) bodyLines.push(firstLine)
    for (let i = startLine + 1; i < nextLine; i++) {
      bodyLines.push(state.src.slice(state.bMarks[i], state.eMarks[i]))
    }
    if (closeInlineTail) bodyLines.push(closeInlineTail)

    const token = state.push('paper_math_block', 'div', 0)
    token.block = true
    token.content = bodyLines.join('\n').trim()
    token.map = [startLine, nextLine + 1]
    state.line = nextLine + 1
    return true
  })

  // Inline math: `$E = mc^2$` (Pandoc/Typora flanking rules so `$100 and $200` is NOT math, even on the same line as `$E = mc^2$`)
  md.inline.ruler.after('escape', 'paper_math_inline', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src[start] !== '$') return false
    // Do not match `$$` or escaped `\$`
    if (src[start + 1] === '$') return false
    if (start > 0 && src[start - 1] === '\\') return false
    // Opening `$` cannot be followed by whitespace
    const afterOpen = src[start + 1]
    if (!afterOpen || /\s/.test(afterOpen)) return false

    let match = start + 1
    while (match < state.posMax) {
      if (src[match] === '\\') { match += 2; continue }
      if (src[match] === '\n') return false
      if (src[match] === '$') {
        // An unescaped `$` is never valid inside inline math: either THIS `$` closes it, or `start` was a literal dollar sign.
        const beforeClose = src[match - 1]
        const afterClose = src[match + 1]
        const validClose = Boolean(
          beforeClose &&
          !/\s/.test(beforeClose) &&
          afterClose !== '$' &&
          !(afterClose && /[0-9]/.test(afterClose))
        )
        if (!validClose) return false
        const content = src.slice(start + 1, match)
        // Reject prose currency amounts followed by full-width CJK punctuation (e.g. `价格$100，公式$E=mc^2$`)
        if (!content.length || /^\d[\d,]*(?:\.\d+)?\s*[，。；：、！？]/.test(content)) return false
        if (!silent) {
          const token = state.push('paper_math_inline', 'span', 0)
          token.content = content
        }
        state.pos = match + 1
        return true
      }
      match++
    }
    return false
  })

  md.renderer.rules.paper_math_block = (tokens, idx) =>
    `<div class="paper-math-block">${renderKatexMath(tokens[idx].content, true)}</div>\n`
  md.renderer.rules.paper_math_inline = (tokens, idx) =>
    `<span class="paper-math-inline">${renderKatexMath(tokens[idx].content, false)}</span>`
}

function enableTyporaInline(md: MarkdownIt) {
  // ==highlight==
  md.inline.ruler.before('emphasis', 'paper_mark', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src[start] !== '=' || src[start + 1] !== '=') return false
    if (start + 2 >= state.posMax || /\s/.test(src[start + 2])) return false
    let end = start + 2
    while (end + 1 < state.posMax) {
      if (src[end] === '\\') { end += 2; continue }
      if (src[end] === '=' && src[end + 1] === '=' && !/\s/.test(src[end - 1])) {
        if (!silent) {
          const open = state.push('paper_mark_open', 'mark', 1)
          open.markup = '=='
          const oldMax = state.posMax
          state.pos = start + 2
          state.posMax = end
          state.md.inline.tokenize(state)
          state.posMax = oldMax
          const close = state.push('paper_mark_close', 'mark', -1)
          close.markup = '=='
        }
        state.pos = end + 2
        return true
      }
      end++
    }
    return false
  })

  // ^superscript^ (ignores footnotes `[^1]`)
  md.inline.ruler.after('emphasis', 'paper_sup', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src[start] !== '^' || (start > 0 && src[start - 1] === '[')) return false
    let end = start + 1
    while (end < state.posMax) {
      if (src[end] === '\\') { end += 2; continue }
      if (/\s/.test(src[end])) return false
      if (src[end] === '^') {
        if (end === start + 1) return false
        if (!silent) {
          const token = state.push('paper_sup', 'sup', 0)
          token.content = src.slice(start + 1, end).replace(/\\(.)/g, '$1')
        }
        state.pos = end + 1
        return true
      }
      end++
    }
    return false
  })

  // ~subscript~ (single tilde only; preserves ~~strikethrough~~)
  md.inline.ruler.after('strikethrough', 'paper_sub', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src[start] !== '~' || src[start + 1] === '~' || (start > 0 && src[start - 1] === '~')) return false
    let end = start + 1
    while (end < state.posMax) {
      if (src[end] === '\\') { end += 2; continue }
      if (/\s/.test(src[end])) return false
      if (src[end] === '~' && src[end + 1] !== '~') {
        if (end === start + 1) return false
        if (!silent) {
          const token = state.push('paper_sub', 'sub', 0)
          token.content = src.slice(start + 1, end).replace(/\\(.)/g, '$1')
        }
        state.pos = end + 1
        return true
      }
      end++
    }
    return false
  })

  // Strictly allowlisted safe Typora inline HTML tags (zero attributes allowed!)
  const SAFE_INLINE_TAG = /^<(?:(\/?)(u|kbd|sub|sup|mark|center|summary)|br\s*\/?)>/i
  md.inline.ruler.before('html_inline', 'paper_safe_inline_tag', (state, silent) => {
    const match = SAFE_INLINE_TAG.exec(state.src.slice(state.pos, state.posMax))
    if (!match) return false
    if (!silent) {
      const token = state.push('paper_safe_tag', '', 0)
      const raw = match[0]
      if (/^<br/i.test(raw)) token.content = '<br>'
      else token.content = `<${match[1] || ''}${match[2].toLowerCase()}>`
    }
    state.pos += match[0].length
    return true
  })

  // Safe block <details> / </details> / <summary>...</summary>
  const SAFE_DETAILS_OPEN = /^<details(\s+open)?\s*>$/i
  const SAFE_DETAILS_CLOSE = /^<\/details\s*>$/i
  const SAFE_SUMMARY_LINE = /^<summary\s*>([^<>]*)<\/summary\s*>$/i
  md.block.ruler.before('html_block', 'paper_safe_details', (state, startLine, _endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const trimmed = state.src.slice(pos, max).trim()
    let html = ''
    const openMatch = SAFE_DETAILS_OPEN.exec(trimmed)
    if (openMatch) html = openMatch[1] ? '<details class="paper-details" open>' : '<details class="paper-details">'
    else if (SAFE_DETAILS_CLOSE.test(trimmed)) html = '</details>'
    else {
      const sumMatch = SAFE_SUMMARY_LINE.exec(trimmed)
      if (sumMatch) html = `<summary>${escapeHtml(sumMatch[1])}</summary>`
    }
    if (!html) return false
    if (silent) return true
    const token = state.push('paper_safe_tag', '', 0)
    token.block = true
    token.content = html
    token.map = [startLine, startLine + 1]
    state.line = startLine + 1
    return true
  })

  md.renderer.rules.paper_sup = (tokens, idx) => `<sup>${escapeHtml(tokens[idx].content)}</sup>`
  md.renderer.rules.paper_sub = (tokens, idx) => `<sub>${escapeHtml(tokens[idx].content)}</sub>`
  md.renderer.rules.paper_safe_tag = (tokens, idx) => tokens[idx].content
}

const CALLOUT_META: Record<string, { label: string; icon: string }> = {
  note: { label: '备注 · NOTE', icon: 'ℹ' },
  tip: { label: '提示 · TIP', icon: '✦' },
  important: { label: '重要 · IMPORTANT', icon: '★' },
  warning: { label: '警告 · WARNING', icon: '▲' },
  caution: { label: '注意 · CAUTION', icon: '!' }
}

function enableCallouts(md: MarkdownIt) {
  md.core.ruler.after('inline', 'paper_callouts', state => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'blockquote_open') continue
      if (tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') continue
      const inline = tokens[i + 2]
      const children = inline.children || []
      if (!children.length || children[0].type !== 'text') continue
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(children[0].content.trim())
      if (!match) continue
      const kind = match[1].toLowerCase()
      const meta = CALLOUT_META[kind]
      if (!meta) continue

      tokens[i].attrJoin('class', `paper-callout paper-callout-${kind}`)
      // Strip the `[!KIND]` marker and optional following line break from the first paragraph
      children.shift()
      if (children[0] && (children[0].type === 'softbreak' || children[0].type === 'hardbreak')) {
        children.shift()
      }
      const titleToken = new state.Token('paper_callout_title', '', 0)
      titleToken.meta = { kind, label: meta.label, icon: meta.icon }
      tokens.splice(i + 1, 0, titleToken)
      // If the original paragraph is now completely empty, remove the empty <p></p>
      if (!children.length && tokens[i + 2]?.type === 'paragraph_open' && tokens[i + 4]?.type === 'paragraph_close') {
        tokens.splice(i + 2, 3)
      }
    }
  })

  md.renderer.rules.paper_callout_title = (tokens, idx) => {
    const { label, icon } = tokens[idx].meta as { label: string; icon: string }
    return `<div class="paper-callout-title"><span class="paper-callout-icon" aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></div>\n`
  }
}

function enableFootnotes(md: MarkdownIt) {
  // Block rule captures `[^label]: footnote body` definitions into env
  md.block.ruler.before('reference', 'paper_footnote_def', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const line = state.src.slice(pos, max)
    const match = /^\[\^([^\s\]]+)\]:[ \t]*(.*)$/.exec(line)
    if (!match) return false
    if (silent) return true

    const label = match[1]
    const lines = [match[2]]
    let nextLine = startLine + 1
    while (nextLine < endLine) {
      const lPos = state.bMarks[nextLine] + state.tShift[nextLine]
      const lMax = state.eMarks[nextLine]
      const indent = state.sCount[nextLine] - state.blkIndent
      if (lPos >= lMax) break
      if (indent < 2) break
      lines.push(state.src.slice(lPos, lMax))
      nextLine++
    }
    const env = state.env as Record<string, any>
    if (!env.__paperFnDefs) env.__paperFnDefs = new Map<string, string>()
    if (!env.__paperFnDefs.has(label)) {
      env.__paperFnDefs.set(label, lines.join(' ').trim())
    }
    state.line = nextLine
    return true
  })

  // Inline rule turns `[^label]` into numbered superscript jump anchor
  md.inline.ruler.after('image', 'paper_footnote_ref', (state, silent) => {
    const start = state.pos
    const src = state.src
    if (src[start] !== '[' || src[start + 1] !== '^') return false
    const close = src.indexOf(']', start + 2)
    if (close < 0 || close >= state.posMax) return false
    const label = src.slice(start + 2, close)
    if (!label || /\s/.test(label)) return false
    const env = state.env as Record<string, any>
    const defs: Map<string, string> | undefined = env.__paperFnDefs
    if (!defs || !defs.has(label)) return false
    if (silent) return true

    if (!env.__paperFnOrder) env.__paperFnOrder = [] as string[]
    let index = (env.__paperFnOrder as string[]).indexOf(label)
    if (index < 0) {
      index = (env.__paperFnOrder as string[]).length
      ;(env.__paperFnOrder as string[]).push(label)
    }
    const token = state.push('paper_footnote_ref', 'sup', 0)
    token.meta = { index: index + 1, label }
    state.pos = close + 1
    return true
  })

  // Append footnote list section at bottom of rendered document
  md.core.ruler.push('paper_footnote_tail', state => {
    const env = state.env as Record<string, any>
    if (state.inlineMode || env.__paperSingleBlock || env.__paperRenderingFootnotes) return
    const order: string[] | undefined = env.__paperFnOrder
    const defs: Map<string, string> | undefined = env.__paperFnDefs
    if (!order?.length || !defs) return
    env.__paperRenderingFootnotes = true
    try {
      const items = order.map((label, idx) => ({
        num: idx + 1,
        label,
        html: md.renderInline(defs.get(label) || '', env)
      }))
      const token = new state.Token('paper_footnote_section', 'section', 0)
      token.meta = { items }
      state.tokens.push(token)
    } finally {
      env.__paperRenderingFootnotes = false
    }
  })

  md.renderer.rules.paper_footnote_ref = (tokens, idx) => {
    const { index } = tokens[idx].meta as { index: number; label: string }
    return `<sup class="paper-fn-ref" id="fnref-${index}"><a href="#fn-${index}" data-paper-href="#fn-${index}" class="paper-hash-link vp-raw">[${index}]</a></sup>`
  }

  md.renderer.rules.paper_footnote_section = (tokens, idx) => {
    const { items } = tokens[idx].meta as { items: Array<{ num: number; html: string }> }
    const rows = items.map(item =>
      `<li id="fn-${item.num}">${item.html} <a href="#fnref-${item.num}" data-paper-href="#fnref-${item.num}" class="paper-hash-link paper-fn-back vp-raw" title="返回正文">↩</a></li>`
    ).join('')
    return `<section class="paper-footnotes" aria-label="脚注"><ol>${rows}</ol></section>\n`
  }
}

function enableTocBlock(md: MarkdownIt) {
  md.block.ruler.before('paragraph', 'paper_toc_block', (state, startLine, _endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const text = state.src.slice(pos, max).trim()
    if (!/^\[TOC\]$/i.test(text)) return false
    if (silent) return true
    const token = state.push('paper_toc_block', 'nav', 0)
    token.block = true
    token.map = [startLine, startLine + 1]
    state.line = startLine + 1
    return true
  })

  md.core.ruler.push('paper_toc_fill', state => {
    if (state.inlineMode) return
    const env = state.env as Record<string, any>
    const headings: Array<{ level: number; text: string; slug: string }> = []
    const seen = new Map<string, number>()
    for (let i = 0; i < state.tokens.length; i++) {
      if (state.tokens[i].type !== 'heading_open') continue
      const level = Number(state.tokens[i].tag.slice(1)) || 1
      const inline = state.tokens[i + 1]
      const rawText = inline?.type === 'inline'
        ? (inline.children || []).map(c => c.content).join('').trim() || inline.content.trim()
        : ''
      if (!rawText) continue
      const existingId = state.tokens[i].attrGet('id')
      let slug = existingId || headingSlug(rawText)
      if (!existingId) {
        const count = seen.get(slug) || 0
        seen.set(slug, count + 1)
        if (count > 0) slug = `${slug}-${count}`
      }
      headings.push({ level, text: rawText, slug })
    }
    if (!env.__paperSingleBlock) {
      env.__paperDocHeadings = headings
    }
    const tocTokens = state.tokens.filter(t => t.type === 'paper_toc_block')
    if (!tocTokens.length) return
    const resolved = headings.length ? headings : (env.__paperDocHeadings || [])
    for (const toc of tocTokens) toc.meta = { headings: resolved }
  })

  md.renderer.rules.paper_toc_block = (tokens, idx) => {
    const headings = (tokens[idx].meta?.headings || []) as Array<{ level: number; text: string; slug: string }>
    if (!headings.length) {
      return '<nav class="paper-inline-toc" aria-label="目录"><div class="paper-inline-toc-title">目录 · TOC</div><p class="paper-inline-toc-empty">（本文暂无标题）</p></nav>\n'
    }
    const minLevel = Math.min(...headings.map(h => h.level))
    const list = headings.map(h => {
      const indent = Math.max(0, h.level - minLevel) * 16
      return `<li style="padding-left:${indent}px"><a href="#${escapeHtml(h.slug)}" data-paper-href="#${escapeHtml(h.slug)}" class="paper-hash-link vp-raw">${escapeHtml(h.text)}</a></li>`
    }).join('')
    return `<nav class="paper-inline-toc" aria-label="目录"><div class="paper-inline-toc-title">目录 · TOC</div><ul>${list}</ul></nav>\n`
  }
}

export interface TyporaPluginOptions {
  toc?: boolean
  footnotes?: boolean
}

/** Enable the full Typora Markdown syntax suite on a MarkdownIt instance safely. */
export function enableTyporaMarkdown(md: MarkdownIt, options: TyporaPluginOptions = {}): void {
  enableMath(md)
  enableTyporaInline(md)
  enableCallouts(md)
  if (options.footnotes !== false) enableFootnotes(md)
  if (options.toc !== false) enableTocBlock(md)
}
