<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { enableSafeHtmlImages } from './safeHtmlImage'
import { enableTaskMarkers } from './markdownTasks'

const props = defineProps<{ source: string }>()
// Notebook text never enters the Vue compiler. MarkdownIt escapes embedded HTML
// and validates link protocols before producing the read view.
const markdown = new MarkdownIt({ html: false })
enableSafeHtmlImages(markdown)
enableTaskMarkers(markdown)
const rendered = computed(() => markdown.render(props.source))
</script>

<template>
  <article class="chapter-prose vp-doc" v-html="rendered" />
</template>

<style scoped>
.chapter-prose { overflow-wrap: anywhere; min-width: 0; }
.chapter-prose :deep(h1) { font-size: 1.85rem; }
.chapter-prose :deep(h2) { margin: 1.6em 0 .55em; padding: 0; border: none; font-size: 1.35rem; }
.chapter-prose :deep(p), .chapter-prose :deep(li) { line-height: 1.9; }
.chapter-prose :deep(pre) { overflow-x: auto; background: var(--vp-c-bg-soft); padding: 1em; border-radius: 4px; }
.chapter-prose :deep(pre code) { background: transparent; color: inherit; }
.chapter-prose :deep(img) { max-width: 100%; height: auto; }
.chapter-prose :deep(ul) { padding-inline-start: 1.4em; list-style: disc; }
.chapter-prose :deep(ol) { padding-inline-start: 1.4em; list-style: decimal; }
</style>
