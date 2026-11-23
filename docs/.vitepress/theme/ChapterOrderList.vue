<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Chapter } from './notebookStore'

const props = defineProps<{ chapters: Chapter[]; filtered: Chapter[]; selectedId?: string; disabled?: boolean; searching?: boolean }>()
const emit = defineEmits<{ open: [chapter: Chapter]; reorder: [ids: string[]] }>()
const drag = ref<{ id: string; ids: string[] } | null>(null)
const target = ref<{ id: string; after: boolean } | null>(null)
const canReorder = computed(() => !props.disabled && !props.searching && props.chapters.length > 1)
const fullIndex = (id: string) => props.chapters.findIndex(item => item.id === id)

function move(from: number, to: number) {
  if (!canReorder.value || from < 0 || to < 0 || from >= props.chapters.length || to >= props.chapters.length || from === to) return
  const ids = props.chapters.map(item => item.id)
  ids.splice(to, 0, ids.splice(from, 1)[0])
  emit('reorder', ids)
}
function startDrag(event: DragEvent, id: string) {
  if (!canReorder.value) { event.preventDefault(); return }
  drag.value = { id, ids: props.chapters.map(item => item.id) }
  event.dataTransfer?.setData('application/x-paper-notes-chapter', '1')
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function finishDrag() { drag.value = null; target.value = null }
function dragOver(event: DragEvent, id: string) {
  if (!drag.value || !canReorder.value) return
  event.preventDefault(); event.stopPropagation()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  target.value = { id, after: event.clientY >= box.top + box.height / 2 }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function drop(event: DragEvent, id: string) {
  if (!drag.value || !canReorder.value) return
  event.preventDefault(); event.stopPropagation()
  const before = drag.value.ids, sourceId = drag.value.id
  const current = props.chapters.map(item => item.id)
  if (before.length !== current.length || before.some((value, i) => value !== current[i])) { finishDrag(); return }
  const from = current.indexOf(sourceId)
  let to = current.indexOf(id) + (target.value?.id === id && target.value.after ? 1 : 0)
  if (from < to) to--
  finishDrag(); move(from, to)
}
</script>

<template>
  <div class="chapter-order" aria-label="章节列表">
    <p v-if="searching && chapters.length > 1" class="chapter-order__hint">清除搜索后可调整章节顺序。</p>
    <div v-for="chapter in filtered" :key="chapter.id" class="chapter-order__row"
      :class="{ 'is-selected': selectedId === chapter.id, 'drop-before': target?.id === chapter.id && !target.after, 'drop-after': target?.id === chapter.id && target.after }"
      @dragover="dragOver($event, chapter.id)" @dragleave="target = null" @drop="drop($event, chapter.id)">
      <button v-if="chapters.length > 1" class="chapter-order__handle" type="button" :disabled="!canReorder"
        :draggable="canReorder" :aria-label="`拖动调整${chapter.title}的顺序`" title="拖动调整章节顺序"
        @dragstart="startDrag($event, chapter.id)" @dragend="finishDrag">⠿</button>
      <button type="button" class="chapter-order__open" :disabled="disabled" @click="emit('open', chapter)">
        <span class="chapter-order__number">{{ String(fullIndex(chapter.id) + 1).padStart(2, '0') }}</span>
        <span class="chapter-order__title">{{ chapter.title }}</span><span aria-hidden="true">↗</span>
      </button>
      <div v-if="chapters.length > 1" class="chapter-order__controls">
        <button type="button" :disabled="!canReorder || fullIndex(chapter.id) === 0" :aria-label="`上移${chapter.title}`" title="上移章节" @click="move(fullIndex(chapter.id), fullIndex(chapter.id) - 1)">↑</button>
        <button type="button" :disabled="!canReorder || fullIndex(chapter.id) === chapters.length - 1" :aria-label="`下移${chapter.title}`" title="下移章节" @click="move(fullIndex(chapter.id), fullIndex(chapter.id) + 1)">↓</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chapter-order__hint { margin: 0 0 10px; color: var(--muted, #666); font-size: 12px; }
.chapter-order__row { position: relative; display: flex; align-items: stretch; min-width: 0; margin-bottom: 12px; border: 1.5px solid var(--line, #111); border-radius: 9px; background: var(--panel, #fff); color: var(--ink, #111); transition: box-shadow .15s ease, transform .15s ease; }
.chapter-order__row:hover, .chapter-order__row:has(:focus-visible) { box-shadow: 3px 3px 0 var(--depth-edge, #111); transform: translate(-1px, -1px); }
.chapter-order__row.drop-before::before, .chapter-order__row.drop-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 3px; background: var(--ink, #111); z-index: 1; }
.chapter-order__row.drop-before::before { top: -6px; } .chapter-order__row.drop-after::after { bottom: -6px; }
.chapter-order__handle { flex: 0 0 34px; padding: 0 4px 0 9px; color: var(--muted, #666); cursor: grab; font-size: 18px; touch-action: manipulation; }
.chapter-order__handle:active { cursor: grabbing; }
.chapter-order__open { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; padding: 15px; text-align: left; font-size: 14px; font-weight: 600; }
.chapter-order__number { flex: none; min-width: 28px; padding: 4px; border: 1px solid var(--line, #111); border-radius: 4px; font: 700 11px ui-monospace, monospace; text-align: center; }
.chapter-order__title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.chapter-order__controls { display: flex; align-items: center; gap: 4px; padding-right: 12px; }
.chapter-order__controls button { width: 28px; height: 28px; border: 1px solid var(--line, #111); border-radius: 4px; font-size: 14px; }
.chapter-order__controls button:disabled, .chapter-order__handle:disabled { opacity: .4; cursor: default; }
.chapter-order__controls button:not(:disabled):hover { background: var(--ink, #111); color: var(--panel, #fff); }
@media (prefers-reduced-motion: reduce) { .chapter-order__row { transition: none; } }
</style>
