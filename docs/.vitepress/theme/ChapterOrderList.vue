<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import type { Chapter } from './notebookStore'
import { formatBadgeLabel, isMarkdownExt } from './documentFiles'
import { chapterDisplayInfo, groupChaptersForDirectory } from './notebookChapterOrder'
import { cleanMarkdownTitle } from './notebookTitle'

function displayInfo(chapter: Chapter) {
  const cleaned = isMarkdownExt(chapter.ext) ? (cleanMarkdownTitle(chapter.title) || chapter.title) : chapter.title
  return chapterDisplayInfo(chapter, cleaned)
}

const props = defineProps<{ chapters: Chapter[]; filtered: Chapter[]; selectedId?: string; disabled?: boolean; searching?: boolean }>()
const emit = defineEmits<{ open: [chapter: Chapter]; reorder: [ids: string[]]; rename: [chapter: Chapter] }>()
const drag = ref<{ id: string; ids: string[] } | null>(null)
const target = ref<{ id: string; after: boolean } | null>(null)
const collapsedGroups = reactive<Record<string, boolean>>({})

const canReorder = computed(() => !props.disabled && !props.searching && props.chapters.length > 1)
const groups = computed(() => groupChaptersForDirectory(props.filtered))
const namedGroups = computed(() => groups.value.filter(g => !!g.groupName))
const hasNamedGroups = computed(() => namedGroups.value.length > 0)
const allCollapsed = computed(() => hasNamedGroups.value && namedGroups.value.every(g => collapsedGroups[g.key]))

function toggleGroup(key: string) {
  collapsedGroups[key] = !collapsedGroups[key]
}
function toggleAllGroups() {
  const next = !allCollapsed.value
  for (const g of namedGroups.value) collapsedGroups[g.key] = next
}

function groupChapterOrdinal(groupKey: string): number {
  let ord = 0
  for (const g of groups.value) {
    if (!g.groupName) continue
    ord++
    if (g.key === groupKey) return ord
  }
  return 1
}

const fullIndex = (id: string) => props.chapters.findIndex(item => item.id === id)
let titleClickTimer: ReturnType<typeof setTimeout> | undefined
function clearTitleClick() { if (titleClickTimer !== undefined) { clearTimeout(titleClickTimer); titleClickTimer = undefined } }
function handleTitleClick(chapter: Chapter) {
  clearTitleClick()
  titleClickTimer = setTimeout(() => { titleClickTimer = undefined; emit('open', chapter) }, 220)
}
function handleTitleDblClick(chapter: Chapter) {
  clearTitleClick()
  emit('rename', chapter)
}
onBeforeUnmount(clearTitleClick)

function move(from: number, to: number) {
  if (!canReorder.value || from < 0 || to < 0 || from >= props.chapters.length || to >= props.chapters.length || from === to) return
  const ids = props.chapters.map(item => item.id)
  ids.splice(to, 0, ids.splice(from, 1)[0])
  emit('reorder', ids)
}
function startDrag(event: DragEvent, id: string) {
  if (!canReorder.value) { event.preventDefault(); return }
  const handle = event.currentTarget as HTMLElement | null
  const row = handle?.closest<HTMLElement>('.chapter-order__row')
  if (row && event.dataTransfer) {
    const bounds = row.getBoundingClientRect()
    const offsetX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
    const offsetY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    event.dataTransfer.setDragImage(row, offsetX, offsetY)
  }
  drag.value = { id, ids: props.chapters.map(item => item.id) }
  event.dataTransfer?.setData('application/x-paper-notes-chapter', '1')
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function finishDrag() { drag.value = null; target.value = null }
function dragLeave(event: DragEvent, id: string) {
  const row = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return
  if (target.value?.id === id) target.value = null
}
function dragOver(event: DragEvent, id: string) {
  if (!drag.value || !canReorder.value) return
  event.preventDefault(); event.stopPropagation()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  target.value = { id, after: event.clientY >= box.top + box.height / 2 }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function commitDrop(id: string, after: boolean) {
  if (!drag.value || !canReorder.value) return
  const before = drag.value.ids, sourceId = drag.value.id
  const current = props.chapters.map(item => item.id)
  if (before.length !== current.length || before.some((value, i) => value !== current[i])) { finishDrag(); return }
  const from = current.indexOf(sourceId)
  const targetIndex = current.indexOf(id)
  if (from < 0 || targetIndex < 0) { finishDrag(); return }
  let to = targetIndex + (after ? 1 : 0)
  if (from < to) to--
  finishDrag(); move(from, to)
}
function drop(event: DragEvent, id: string) {
  if (!drag.value || !canReorder.value) return
  event.preventDefault(); event.stopPropagation()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  commitDrop(id, event.clientY >= bounds.top + bounds.height / 2)
}
function gapTarget(list: HTMLElement, y: number): { id: string; after: boolean } | null {
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.chapter-order__row[data-chapter-id]'))
  if (!rows.length) return null
  for (const row of rows) {
    const bounds = row.getBoundingClientRect()
    if (y < bounds.top + bounds.height / 2) return { id: row.dataset.chapterId!, after: false }
  }
  return { id: rows[rows.length - 1].dataset.chapterId!, after: true }
}
function dragOverGap(event: DragEvent) {
  if (!drag.value || !canReorder.value) return
  const next = gapTarget(event.currentTarget as HTMLElement, event.clientY)
  if (!next) return
  event.preventDefault(); event.stopPropagation()
  target.value = next
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function dropGap(event: DragEvent) {
  if (!drag.value || !canReorder.value) return
  const next = gapTarget(event.currentTarget as HTMLElement, event.clientY)
  if (!next) return
  event.preventDefault(); event.stopPropagation()
  commitDrop(next.id, next.after)
}
</script>

<template>
  <div class="chapter-order" aria-label="章节列表" @dragover="dragOverGap" @drop="dropGap">
    <div v-if="hasNamedGroups || (searching && chapters.length > 1)" class="chapter-order__topbar">
      <p v-if="searching && chapters.length > 1" class="chapter-order__hint">清除搜索后可调整章节顺序。</p>
      <button v-if="hasNamedGroups" type="button" class="chapter-order__collapse-all" @click="toggleAllGroups">
        {{ allCollapsed ? '展开全部章 ▾' : '收起全部章 ▴' }}
      </button>
    </div>

    <template v-for="group in groups" :key="group.key">
      <section v-if="group.groupName" class="chapter-group" :class="{ 'is-collapsed': collapsedGroups[group.key] }">
        <button
          type="button"
          class="chapter-group__header"
          :aria-expanded="!collapsedGroups[group.key]"
          @click="toggleGroup(group.key)"
        >
          <span class="chapter-group__chevron" aria-hidden="true">{{ collapsedGroups[group.key] ? '▸' : '▾' }}</span>
          <span class="chapter-group__badge">第 {{ String(groupChapterOrdinal(group.key)).padStart(2, '0') }} 章</span>
          <strong class="chapter-group__name">{{ group.groupName }}</strong>
          <span class="chapter-group__count">{{ group.items.length }} 话</span>
        </button>

        <div v-show="!collapsedGroups[group.key]" class="chapter-group__items">
          <div
            v-for="(chapter, itemIdx) in group.items"
            :key="chapter.id"
            class="chapter-order__row chapter-order__row--nested"
            :data-chapter-id="chapter.id"
            :class="{ 'is-selected': selectedId === chapter.id, 'is-dragging': drag?.id === chapter.id, 'drop-before': target?.id === chapter.id && !target.after, 'drop-after': target?.id === chapter.id && target.after }"
            @dragover="dragOver($event, chapter.id)"
            @dragleave="dragLeave($event, chapter.id)"
            @drop="drop($event, chapter.id)"
          >
            <button v-if="chapters.length > 1" class="chapter-order__handle" type="button" :disabled="!canReorder"
              :draggable="canReorder" :aria-label="`拖动调整${displayInfo(chapter).primaryTitle}的顺序`" title="拖动调整章节顺序"
              @dragstart="startDrag($event, chapter.id)" @dragend="finishDrag">⠿</button>
            <button type="button" class="chapter-order__open" :disabled="disabled" @click="emit('open', chapter)">
              <span class="chapter-order__number">{{ String(itemIdx + 1).padStart(2, '0') }} 话</span>
              <span class="chapter-order__body">
                <span class="chapter-order__title paper-renameable" title="双击修改章节名称" @click.stop="handleTitleClick(chapter)" @dblclick.stop.prevent="handleTitleDblClick(chapter)">{{ displayInfo(chapter).primaryTitle }}</span>
                <span v-if="displayInfo(chapter).summaryTitle" class="chapter-order__summary">{{ displayInfo(chapter).summaryTitle }}</span>
              </span>
              <span v-if="!isMarkdownExt(chapter.ext)" class="paper-ext-pill">{{ formatBadgeLabel(chapter.ext) }}</span>
              <span aria-hidden="true">↗</span>
            </button>
            <div v-if="chapters.length > 1" class="chapter-order__controls">
              <button type="button" :disabled="!canReorder || fullIndex(chapter.id) === 0" :aria-label="`上移${displayInfo(chapter).primaryTitle}`" title="上移章节" @click="move(fullIndex(chapter.id), fullIndex(chapter.id) - 1)">↑</button>
              <button type="button" :disabled="!canReorder || fullIndex(chapter.id) === chapters.length - 1" :aria-label="`下移${displayInfo(chapter).primaryTitle}`" title="下移章节" @click="move(fullIndex(chapter.id), fullIndex(chapter.id) + 1)">↓</button>
            </div>
          </div>
        </div>
      </section>

      <div
        v-else
        v-for="chapter in group.items"
        :key="chapter.id"
        class="chapter-order__row"
        :data-chapter-id="chapter.id"
        :class="{ 'is-selected': selectedId === chapter.id, 'is-dragging': drag?.id === chapter.id, 'drop-before': target?.id === chapter.id && !target.after, 'drop-after': target?.id === chapter.id && target.after }"
        @dragover="dragOver($event, chapter.id)"
        @dragleave="dragLeave($event, chapter.id)"
        @drop="drop($event, chapter.id)"
      >
        <button v-if="chapters.length > 1" class="chapter-order__handle" type="button" :disabled="!canReorder"
          :draggable="canReorder" :aria-label="`拖动调整${displayInfo(chapter).primaryTitle}的顺序`" title="拖动调整章节顺序"
          @dragstart="startDrag($event, chapter.id)" @dragend="finishDrag">⠿</button>
        <button type="button" class="chapter-order__open" :disabled="disabled" @click="emit('open', chapter)">
          <span class="chapter-order__number">{{ String(fullIndex(chapter.id) + 1).padStart(2, '0') }}</span>
          <span class="chapter-order__body">
            <span class="chapter-order__title paper-renameable" title="双击修改章节名称" @click.stop="handleTitleClick(chapter)" @dblclick.stop.prevent="handleTitleDblClick(chapter)">{{ displayInfo(chapter).primaryTitle }}</span>
            <span v-if="displayInfo(chapter).summaryTitle" class="chapter-order__summary">{{ displayInfo(chapter).summaryTitle }}</span>
          </span>
          <span v-if="!isMarkdownExt(chapter.ext)" class="paper-ext-pill">{{ formatBadgeLabel(chapter.ext) }}</span>
          <span aria-hidden="true">↗</span>
        </button>
        <div v-if="chapters.length > 1" class="chapter-order__controls">
          <button type="button" :disabled="!canReorder || fullIndex(chapter.id) === 0" :aria-label="`上移${displayInfo(chapter).primaryTitle}`" title="上移章节" @click="move(fullIndex(chapter.id), fullIndex(chapter.id) - 1)">↑</button>
          <button type="button" :disabled="!canReorder || fullIndex(chapter.id) === chapters.length - 1" :aria-label="`下移${displayInfo(chapter).primaryTitle}`" title="下移章节" @click="move(fullIndex(chapter.id), fullIndex(chapter.id) + 1)">↓</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chapter-order { display: flow-root; }
.chapter-order__topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.chapter-order__hint { margin: 0; color: var(--muted, #666); font-size: 12px; }
.chapter-order__collapse-all {
  margin-left: auto;
  padding: 4px 10px;
  border: 1px solid var(--line, #111);
  border-radius: 6px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.chapter-order__collapse-all:hover { background: var(--ink, #111); color: var(--panel, #fff); }
.chapter-group {
  margin-bottom: 14px;
  border: 1.5px solid var(--line, #111);
  border-radius: 10px;
  background: color-mix(in srgb, var(--theme-soft, #f4f3f0) 45%, var(--panel, #fff));
  overflow: hidden;
}
.chapter-group__header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 0;
  background: transparent;
  color: var(--ink, #111);
  text-align: left;
  cursor: pointer;
}
.chapter-group__header:hover { background: color-mix(in srgb, var(--theme-soft, #f4f3f0) 85%, var(--panel, #fff)); }
.chapter-group__chevron { width: 14px; font-size: 12px; color: var(--muted, #666); }
.chapter-group__badge {
  flex: none;
  padding: 2px 7px;
  border: 1px solid var(--line, #111);
  border-radius: 4px;
  background: var(--panel, #fff);
  font: 700 11px ui-monospace, monospace;
}
.chapter-group__name { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
.chapter-group__count { flex: none; font-size: 11px; color: var(--muted, #666); font-weight: 600; }
.chapter-group__items { padding: 4px 10px 6px; border-top: 1px dashed color-mix(in srgb, var(--line, #111) 35%, transparent); }
.chapter-order__row { position: relative; display: flex; align-items: stretch; min-width: 0; margin-bottom: 12px; border: 1.5px solid var(--line, #111); border-radius: 9px; background: var(--panel, #fff); color: var(--ink, #111); transition: box-shadow .15s ease, transform .15s ease; }
.chapter-order__row--nested { margin-bottom: 8px; }
.chapter-order__row--nested:last-child { margin-bottom: 4px; }
.chapter-order__row:hover, .chapter-order__row:has(:focus-visible) { box-shadow: 3px 3px 0 var(--depth-edge, #111); transform: translate(-1px, -1px); }
.chapter-order__row.is-dragging { opacity: .45; }
.chapter-order__row.drop-before::before, .chapter-order__row.drop-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 3px; background: var(--ink, #111); z-index: 1; }
.chapter-order__row.drop-before::before { top: -6px; } .chapter-order__row.drop-after::after { bottom: -6px; }
.chapter-order__handle { flex: 0 0 34px; padding: 0 4px 0 9px; color: var(--muted, #666); cursor: grab; font-size: 18px; touch-action: manipulation; }
.chapter-order__handle:active { cursor: grabbing; }
.chapter-order__open { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; padding: 13px 15px; text-align: left; font-size: 14px; font-weight: 600; }
.chapter-order__number { flex: none; min-width: 34px; padding: 4px 6px; border: 1px solid var(--line, #111); border-radius: 4px; font: 700 11px ui-monospace, monospace; text-align: center; white-space: nowrap; }
.chapter-order__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.chapter-order__title { min-width: 0; overflow-wrap: anywhere; }
.chapter-order__summary { font-size: 12px; font-weight: 400; color: var(--muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-order__controls { display: flex; align-items: center; gap: 4px; padding-right: 12px; }
.chapter-order__controls button { width: 28px; height: 28px; border: 1px solid var(--line, #111); border-radius: 4px; font-size: 14px; }
.chapter-order__controls button:disabled, .chapter-order__handle:disabled { opacity: .4; cursor: default; }
.chapter-order__controls button:not(:disabled):hover { background: var(--ink, #111); color: var(--panel, #fff); }
@media (prefers-reduced-motion: reduce) { .chapter-order__row { transition: none; } }
</style>
