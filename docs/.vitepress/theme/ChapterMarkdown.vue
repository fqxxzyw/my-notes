<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import { enableSafeHtmlImages } from './safeHtmlImage'
import { enableTaskMarkers } from './markdownTasks'
import { currentPaperTheme, isMermaidLanguage, mountMermaidCard } from './mermaidRenderer'
import { headingSlug, normalizeHeadingKey, parseMarkdownLinkHref } from './markdownLinks'
import { enableTyporaMarkdown, highlightCodeBlock } from './markdownTypora'

const props = defineProps<{ source: string; editableTasks?: boolean }>()
const emit = defineEmits<{ 'navigate-link': [href: string]; 'toggle-task': [index: number] }>()
const articleRef = ref<HTMLElement | null>(null)
const lightbox = ref<{ src: string; alt: string; scale: number } | null>(null)
let mermaidDisposers: Array<() => void> = []
let themeObserver: MutationObserver | undefined

// Notebook text never enters the Vue compiler. MarkdownIt escapes embedded HTML
// and validates link protocols before producing the read view.
const markdown = new MarkdownIt({ html: false, linkify: true })
enableSafeHtmlImages(markdown)
enableTaskMarkers(markdown)
enableTyporaMarkdown(markdown)

// Assign deterministic IDs to headings so #anchor links and the Read-mode TOC can jump cleanly.
markdown.core.ruler.before('paper_toc_fill', 'paper-heading-ids', state => {
  const seen = new Map<string, number>()
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const inline = tokens[i + 1]
    const rawText = inline?.type === 'inline'
      ? (inline.children || []).map(child => child.content).join('') || inline.content
      : ''
    const base = headingSlug(rawText)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    const slug = count === 0 ? base : `${base}-${count}`
    tokens[i].attrSet('id', slug)
    tokens[i].attrSet('data-heading-text', rawText.trim())
  }
})

// Mark external links to open safely; keep local/relative and hash links in-app (bypass VitePress router via vp-raw).
const defaultLinkOpen = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const href = token.attrGet('href') || ''
  const parsed = parseMarkdownLinkHref(href)
  if (parsed.kind === 'external' && /^https?:/i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  } else if (parsed.kind === 'local') {
    token.attrJoin('class', 'paper-internal-link vp-raw')
    token.attrSet('data-paper-href', href)
  } else if (parsed.kind === 'hash') {
    token.attrJoin('class', 'paper-hash-link vp-raw')
    token.attrSet('data-paper-href', href)
  }
  return defaultLinkOpen ? defaultLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
}

markdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = (token.info || '').trim()
  if (isMermaidLanguage(info)) {
    const escaped = markdown.utils.escapeHtml(token.content)
    return `<div class="paper-mermaid-host" data-mermaid-code="${encodeURIComponent(token.content)}"><pre class="paper-mermaid-source"><code>${escaped}</code></pre></div>`
  }
  const lang = info.split(/\s+/)[0] || ''
  const highlighted = highlightCodeBlock(token.content, lang)
  const rawLines = token.content.replace(/\n$/, '').split('\n')
  const lineCount = Math.max(1, rawLines.length)
  let gutter = ''
  for (let i = 1; i <= lineCount; i++) gutter += `<span>${i}</span>`
  const langLabel = markdown.utils.escapeHtml(lang || 'TEXT')
  const langClass = lang ? ` class="hljs language-${markdown.utils.escapeHtml(lang.toLowerCase())}"` : ' class="hljs"'
  return `<div class="paper-code-block"><div class="paper-code-bar"><span class="paper-code-lang">${langLabel}</span><button type="button" class="paper-code-copy" data-copy-code="1">复制</button></div><div class="paper-code-body"><div class="paper-code-gutter" aria-hidden="true">${gutter}</div><pre><code${langClass}>${highlighted}</code></pre></div></div>\n`
}

const defaultTableOpen = markdown.renderer.rules.table_open
const defaultTableClose = markdown.renderer.rules.table_close
markdown.renderer.rules.table_open = (tokens, idx, options, env, self) =>
  `<div class="paper-table-wrap"><div class="paper-table-scroll">${defaultTableOpen ? defaultTableOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)}`
markdown.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  `${defaultTableClose ? defaultTableClose(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)}</div></div>`

const rendered = computed(() => markdown.render(props.source))

function disposeMermaids() {
  for (const dispose of mermaidDisposers) dispose()
  mermaidDisposers = []
}

function hydrateRichBlocks() {
  disposeMermaids()
  const root = articleRef.value
  if (!root || typeof window === 'undefined') return
  const theme = currentPaperTheme()
  root.querySelectorAll<HTMLElement>('.paper-mermaid-host[data-mermaid-code]').forEach(host => {
    const encoded = host.dataset.mermaidCode
    if (!encoded) return
    let code = ''
    try { code = decodeURIComponent(encoded) } catch { return }
    mermaidDisposers.push(mountMermaidCard(host, code, { theme, showSourceToggle: true }))
  })
  // Enable direct interactive task checkbox clicks in Read mode when allowed.
  const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
  boxes.forEach((box, index) => {
    box.dataset.taskIndex = String(index)
    box.disabled = !props.editableTasks
    if (props.editableTasks) {
      box.classList.add('paper-task-interactive')
      box.title = box.checked ? '点击标记为未完成' : '点击标记为已完成'
    }
  })
  // Mark images as clickable for Lightbox preview.
  root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    img.classList.add('paper-zoomable-img')
    if (!img.title) img.title = '点击放大查看图片'
  })
}

function scrollToElement(match: HTMLElement): boolean {
  const headerBottom = document.querySelector('.archive-header')?.getBoundingClientRect().bottom || 60
  const top = match.getBoundingClientRect().top + window.scrollY - headerBottom - 16
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  match.classList.remove('paper-heading-flash')
  void match.offsetWidth
  match.classList.add('paper-heading-flash')
  return true
}

function scrollToHeading(target: string): boolean {
  const root = articleRef.value
  if (!root || !target) return false
  const raw = target.replace(/^#/, '').trim()
  // Support exact element IDs first (including footnotes #fn-1 / #fnref-1 and heading slugs).
  const byId = Array.from(root.querySelectorAll<HTMLElement>('[id]')).find(el => el.id === raw)
  if (byId) return scrollToElement(byId)

  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
  if (!headings.length) return false
  const wantedSlug = headingSlug(raw)
  const wantedNorm = normalizeHeadingKey(raw)
  const match =
    headings.find(el => el.id === wantedSlug) ||
    headings.find(el => normalizeHeadingKey(el.id) === wantedNorm || normalizeHeadingKey(el.dataset.headingText || el.textContent || '') === wantedNorm) ||
    headings.find(el => wantedNorm && normalizeHeadingKey(el.dataset.headingText || el.textContent || '').includes(wantedNorm))
  return match ? scrollToElement(match) : false
}

function onArticleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  // 1. Copy code button
  const button = target?.closest<HTMLButtonElement>('button.paper-code-copy[data-copy-code]')
  if (button) {
    const code = button.closest('.paper-code-block')?.querySelector('pre code')?.textContent ?? ''
    navigator.clipboard?.writeText(code).then(() => {
      button.textContent = '已复制'
      setTimeout(() => { if (button.isConnected) button.textContent = '复制' }, 1500)
    }).catch(() => {})
    return
  }
  // 2. Interactive task checkbox toggle
  if (props.editableTasks && target instanceof HTMLInputElement && target.type === 'checkbox' && target.dataset.taskIndex !== undefined) {
    const idx = Number(target.dataset.taskIndex)
    if (Number.isInteger(idx) && idx >= 0) {
      event.preventDefault()
      emit('toggle-task', idx)
    }
    return
  }
  // 3. Internal / hash Markdown link navigation
  const link = target?.closest<HTMLAnchorElement>('a[href]')
  if (link) {
    const href = link.getAttribute('data-paper-href') || link.getAttribute('href') || ''
    const parsed = parseMarkdownLinkHref(href)
    if (parsed.kind === 'hash') {
      event.preventDefault()
      scrollToHeading(parsed.hash)
      return
    }
    if (parsed.kind === 'local') {
      event.preventDefault()
      emit('navigate-link', href)
      return
    }
    return
  }
  // 4. Image lightbox zoom
  if (target instanceof HTMLImageElement && target.classList.contains('paper-zoomable-img')) {
    event.preventDefault()
    lightbox.value = { src: target.currentSrc || target.src, alt: target.alt || '图片预览', scale: 1 }
  }
}

function onLightboxKeydown(event: KeyboardEvent) {
  if (!lightbox.value) return
  if (event.key === 'Escape') { lightbox.value = null }
  else if (event.key === '+' || event.key === '=') { lightbox.value = { ...lightbox.value, scale: Math.min(3, Number((lightbox.value.scale + 0.25).toFixed(2))) } }
  else if (event.key === '-') { lightbox.value = { ...lightbox.value, scale: Math.max(0.4, Number((lightbox.value.scale - 0.25).toFixed(2))) } }
  else if (event.key === '0') { lightbox.value = { ...lightbox.value, scale: 1 } }
}

watch([rendered, () => props.editableTasks], () => { void nextTick(hydrateRichBlocks) })

onMounted(() => {
  hydrateRichBlocks()
  window.addEventListener('keydown', onLightboxKeydown)
  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => hydrateRichBlocks())
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-paper-theme'] })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onLightboxKeydown)
  disposeMermaids()
  themeObserver?.disconnect()
})

defineExpose({ scrollToHeading, articleElement: () => articleRef.value })
</script>

<template>
  <article ref="articleRef" class="chapter-prose vp-doc" @click="onArticleClick" v-html="rendered" />
  <div v-if="lightbox" class="paper-lightbox" role="dialog" aria-modal="true" :aria-label="lightbox.alt" @click.self="lightbox = null">
    <div class="paper-lightbox-bar">
      <span class="paper-lightbox-caption">{{ lightbox.alt }}</span>
      <div class="paper-lightbox-actions">
        <button type="button" @click="lightbox.scale = Math.max(0.4, Number((lightbox.scale - 0.25).toFixed(2)))">−</button>
        <button type="button" @click="lightbox.scale = 1">{{ Math.round(lightbox.scale * 100) }}%</button>
        <button type="button" @click="lightbox.scale = Math.min(3, Number((lightbox.scale + 0.25).toFixed(2)))">+</button>
        <button type="button" aria-label="关闭预览" @click="lightbox = null">×</button>
      </div>
    </div>
    <div class="paper-lightbox-stage" @click.self="lightbox = null">
      <img :src="lightbox.src" :alt="lightbox.alt" :style="{ transform: `scale(${lightbox.scale})` }">
    </div>
  </div>
</template>

<style scoped>
.chapter-prose { overflow-wrap: anywhere; min-width: 0; }
.chapter-prose :deep(h1) { font-size: 1.85rem; }
.chapter-prose :deep(h2) { margin: 1.6em 0 .55em; padding: 0; border: none; font-size: 1.35rem; }
.chapter-prose :deep(h3) { margin: 1.35em 0 .45em; font-size: 1.15rem; }
.chapter-prose :deep(p), .chapter-prose :deep(li) { line-height: 1.9; }
.chapter-prose :deep(blockquote) {
  margin: 14px 0;
  padding: 6px 14px;
  border-left: 3px solid var(--theme-edge, #111);
  background: color-mix(in srgb, var(--theme-soft, #f4f3f0) 45%, transparent);
  color: var(--theme-muted, #555);
}
.chapter-prose :deep(hr) {
  margin: 22px 0;
  border: 0;
  border-top: 1.5px solid var(--theme-edge, #111);
}
.chapter-prose :deep(a.paper-internal-link) {
  color: var(--red, #6e4726);
  text-decoration: underline;
  text-decoration-style: dashed;
  text-underline-offset: 3px;
  cursor: pointer;
}
.chapter-prose :deep(a.paper-internal-link:hover) { text-decoration-style: solid; }
.chapter-prose :deep(.paper-heading-flash) { animation: paper-heading-highlight 1.2s ease; }
@keyframes paper-heading-highlight {
  0%, 30% { background: color-mix(in srgb, var(--red, #6e4726) 22%, transparent); border-radius: 4px; }
  100% { background: transparent; }
}
.chapter-prose :deep(pre) { overflow-x: auto; background: var(--vp-c-bg-soft); padding: 1em; border-radius: 4px; }
.chapter-prose :deep(pre code) { background: transparent; color: inherit; }
.chapter-prose :deep(img) { max-width: 100%; height: auto; border-radius: 4px; }
.chapter-prose :deep(img.paper-zoomable-img) { cursor: zoom-in; }
.chapter-prose :deep(ul) { padding-inline-start: 1.4em; list-style: disc; }
.chapter-prose :deep(ol) { padding-inline-start: 1.4em; list-style: decimal; }
.chapter-prose :deep(input[type="checkbox"]) { margin-right: 0.45em; accent-color: var(--theme-ink, #111); }
.chapter-prose :deep(input.paper-task-interactive) { cursor: pointer; }
</style>
