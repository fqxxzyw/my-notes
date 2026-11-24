<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Notebook } from './notebookStore'
import { formatBadgeLabel } from './documentFiles'
import { createScrollTickTracker, ensureShelfAudioUnlocked, playMiniShelfTick, playShelfEdgeBump, type ScrollTickTracker } from './shelfAudio'

type Cabinet = { id: string; title: string; books: (Notebook & { kind?: 'page'; ext?: string })[] }
const props = defineProps<{ items: Cabinet[] }>()
const emit = defineEmits<{ select: [id: string]; create: []; rename: [id: string]; share: [id: string] }>()
const MAX_PREVIEW_SPINES = 32

let clickTimer: ReturnType<typeof setTimeout> | undefined
const trackRefs = new Map<string, HTMLElement>()
const trackers = new Map<string, ScrollTickTracker>()
const overflowState = reactive<Record<string, { left: boolean; right: boolean; active: boolean }>>({})

const reducedMotion = ref(false)
let motionQuery: MediaQueryList | undefined

// Hover auto-glide state (one active cabinet preview at a time)
let glideCabinetId: string | null = null
let glideVelocity = 0
let glideFrame = 0

// Pointer drag state inside cabinet__drawing
let dragCabinetId: string | null = null
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartScroll = 0
let isDraggingPreview = false
let suppressCardClick = false

function clearClickTimer() {
  if (clickTimer !== undefined) {
    clearTimeout(clickTimer)
    clickTimer = undefined
  }
}

function handleCardClick(id: string) {
  if (suppressCardClick) {
    suppressCardClick = false
    return
  }
  emit('select', id)
}

function handleNameClick(id: string) {
  clearClickTimer()
  clickTimer = setTimeout(() => {
    clickTimer = undefined
    emit('select', id)
  }, 220)
}

function handleNameDblClick(id: string) {
  clearClickTimer()
  emit('rename', id)
}

function shortExt(ext?: string): string {
  const label = formatBadgeLabel(ext)
  return label.length > 3 ? label.slice(0, 3) : label
}

function getTracker(id: string): ScrollTickTracker {
  let tracker = trackers.get(id)
  if (!tracker) {
    tracker = createScrollTickTracker(28, {
      onTick: velocity => playMiniShelfTick(velocity),
      onEdgeBump: () => playShelfEdgeBump()
    })
    trackers.set(id, tracker)
  }
  return tracker
}

function syncOverflow(id: string) {
  const el = trackRefs.get(id)
  if (!el) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  const left = el.scrollLeft > 2
  const right = maxScroll > 2 && el.scrollLeft < maxScroll - 2
  const active = glideCabinetId === id
  const prev = overflowState[id]
  // Only mutate reactive state when a boolean actually changed — prevents infinite re-render loops!
  if (prev && prev.left === left && prev.right === right && prev.active === active) return
  overflowState[id] = { left, right, active }
}

function syncAllOverflows() {
  for (const id of trackRefs.keys()) syncOverflow(id)
}

function setTrackRef(element: unknown, id: string) {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) {
    if (trackRefs.get(id) === element) return
    trackRefs.set(id, element)
    getTracker(id).reset(element.scrollLeft)
  } else if (element === null) {
    trackRefs.delete(id)
    trackers.delete(id)
  }
}

function stopGlide() {
  glideCabinetId = null
  glideVelocity = 0
  if (glideFrame) {
    cancelAnimationFrame(glideFrame)
    glideFrame = 0
  }
  for (const id of Object.keys(overflowState)) {
    if (overflowState[id]?.active) overflowState[id].active = false
  }
}

function stepGlide() {
  glideFrame = 0
  if (!glideCabinetId || Math.abs(glideVelocity) < 0.05 || reducedMotion.value || isDraggingPreview) {
    return
  }
  const el = trackRefs.get(glideCabinetId)
  if (!el) { stopGlide(); return }
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  if (maxScroll <= 1) { stopGlide(); return }
  const prev = el.scrollLeft
  const next = Math.max(0, Math.min(maxScroll, prev + glideVelocity))
  el.scrollLeft = next
  syncOverflow(glideCabinetId)
  if (Math.abs(next - prev) > 0.05) {
    glideFrame = requestAnimationFrame(stepGlide)
  } else {
    // Reached boundary smoothly; pause until cursor moves to the opposite side
    glideVelocity = 0
  }
}

function startOrUpdateGlide(id: string, event: PointerEvent) {
  if (event.pointerType === 'touch' || reducedMotion.value || isDraggingPreview) return
  const el = trackRefs.get(id)
  if (!el) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  if (maxScroll <= 2) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))

  // Hovering anywhere over the preview box smoothly glides across hidden books:
  // Left 26% glides back left; center/right (26%..100%) smoothly glides right, accelerating near the right edge.
  if (ratio < 0.26) {
    const strength = (0.26 - ratio) / 0.26
    glideVelocity = -(1.4 + strength * 4.4)
  } else {
    const strength = (ratio - 0.26) / 0.74
    glideVelocity = 1.45 + Math.pow(strength, 1.35) * 4.8
  }
  glideCabinetId = id
  syncOverflow(id)
  if (!glideFrame) glideFrame = requestAnimationFrame(stepGlide)
}

function handlePreviewEnter(id: string, event: PointerEvent) {
  ensureShelfAudioUnlocked()
  startOrUpdateGlide(id, event)
}

function handlePreviewMove(id: string, event: PointerEvent) {
  if (dragPointerId === event.pointerId && dragCabinetId === id) {
    const el = trackRefs.get(id)
    if (!el) return
    const delta = event.clientX - dragStartX
    if (!isDraggingPreview && Math.abs(delta) > 5) {
      isDraggingPreview = true
      suppressCardClick = true
      stopGlide()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }
    if (isDraggingPreview) {
      event.preventDefault()
      el.scrollLeft = dragStartScroll - delta
      syncOverflow(id)
      return
    }
  }
  startOrUpdateGlide(id, event)
}

function handlePreviewDown(id: string, event: PointerEvent) {
  ensureShelfAudioUnlocked()
  if (event.button !== 0) return
  const el = trackRefs.get(id)
  if (!el || el.scrollWidth <= el.clientWidth + 2) return
  dragCabinetId = id
  dragPointerId = event.pointerId
  dragStartX = event.clientX
  dragStartScroll = el.scrollLeft
  isDraggingPreview = false
}

function handlePreviewUp(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  dragPointerId = null
  dragCabinetId = null
  if (isDraggingPreview) {
    isDraggingPreview = false
    setTimeout(() => { suppressCardClick = false }, 40)
  }
}

function handlePreviewLeave(id: string) {
  if (glideCabinetId === id) stopGlide()
  syncOverflow(id)
}

function handlePreviewWheel(id: string, event: WheelEvent) {
  const el = trackRefs.get(id)
  if (!el) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  if (maxScroll <= 2) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  const atStart = el.scrollLeft <= 1 && delta < 0
  const atEnd = el.scrollLeft >= maxScroll - 1 && delta > 0
  if (atStart || atEnd) return
  event.preventDefault()
  event.stopPropagation()
  ensureShelfAudioUnlocked()
  stopGlide()
  el.scrollLeft += delta
  syncOverflow(id)
}

function handleTrackScroll(id: string) {
  const el = trackRefs.get(id)
  if (!el) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  getTracker(id).update(el.scrollLeft, maxScroll)
  syncOverflow(id)
}

function updateMotion(e: MediaQueryList | MediaQueryListEvent) {
  reducedMotion.value = e.matches
  if (e.matches) stopGlide()
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined
function handleWindowResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(syncAllOverflows, 120)
}

watch(
  () => props.items.map(item => `${item.id}:${item.books.length}`).join('|'),
  () => { void nextTick(syncAllOverflows) }
)

onMounted(() => {
  ensureShelfAudioUnlocked()
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  updateMotion(motionQuery)
  motionQuery.addEventListener('change', updateMotion)
  window.addEventListener('resize', handleWindowResize, { passive: true })
  void nextTick(syncAllOverflows)
})

onBeforeUnmount(() => {
  clearClickTimer()
  clearTimeout(resizeTimer)
  stopGlide()
  window.removeEventListener('resize', handleWindowResize)
  motionQuery?.removeEventListener('change', updateMotion)
})
</script>

<template>
  <div class="cabinet-gallery" aria-label="书柜列表">
    <div v-for="(item, index) in items" :key="item.id" class="cabinet" role="button" tabindex="0"
      :aria-label="`${item.title}，${item.books.length} 项笔记${item.books.length ? '：' + item.books.slice(0, 4).map(book => book.title).join('、') + (item.books.length > 4 ? '等' : '') : ''}`"
      @click="handleCardClick(item.id)"
      @keydown.enter.self="handleCardClick(item.id)"
      @keydown.space.self.prevent="handleCardClick(item.id)">
      <span class="cabinet__top">
        <span class="cabinet__information">
          <span class="cabinet__meta"><span class="case-number">CASE {{ String(index + 1).padStart(2, '0') }}</span> {{ item.books.length }} 项</span>
          <span
            class="cabinet__name paper-renameable"
            title="双击修改书柜名称"
            @click.stop="handleNameClick(item.id)"
            @dblclick.stop.prevent="handleNameDblClick(item.id)"
          >{{ item.title }}</span>
        </span>
        <span
          class="cabinet__drawing"
          :class="{
            'has-overflow-left': overflowState[item.id]?.left,
            'has-overflow-right': overflowState[item.id]?.right,
            'is-gliding': overflowState[item.id]?.active
          }"
          :title="item.books.length > 5 ? '鼠标悬停自动滑览全部书脊，也支持左右拖动或滚轮滑动' : undefined"
          @pointerenter="handlePreviewEnter(item.id, $event)"
          @pointermove="handlePreviewMove(item.id, $event)"
          @pointerdown="handlePreviewDown(item.id, $event)"
          @pointerup="handlePreviewUp"
          @pointercancel="handlePreviewUp"
          @lostpointercapture="handlePreviewUp"
          @pointerleave="handlePreviewLeave(item.id)"
          @wheel="handlePreviewWheel(item.id, $event)"
          @dragstart.prevent
        >
          <span
            :ref="el => setTrackRef(el, item.id)"
            class="cabinet__books"
            @scroll="handleTrackScroll(item.id)"
          >
            <span v-for="(book, bookIndex) in item.books.slice(0, MAX_PREVIEW_SPINES)" :key="book.id" class="cabinet__book" :class="{ 'cabinet__book--page': book.kind === 'page' }">
              <span v-if="book.kind === 'page'" class="cabinet__page-tab"></span>
              <span class="cabinet__book-number">{{ book.kind === 'page' ? shortExt(book.ext) : String(bookIndex + 1).padStart(2, '0') }}</span>
              <span class="cabinet__book-title">{{ book.title }}</span>
              <span class="cabinet__book-rule"></span>
            </span>
            <span v-if="item.books.length > MAX_PREVIEW_SPINES" class="cabinet__book cabinet__book--more">
              <span class="cabinet__book-number">+{{ item.books.length - MAX_PREVIEW_SPINES }}</span>
              <span class="cabinet__book-title">更多</span>
            </span>
          </span>
          <span v-if="overflowState[item.id]?.left" class="cabinet__edge cabinet__edge--left" aria-hidden="true">‹</span>
          <span v-if="overflowState[item.id]?.right" class="cabinet__edge cabinet__edge--right" aria-hidden="true">›</span>
          <span class="cabinet__plank" aria-hidden="true"></span>
        </span>
      </span>
      <span class="cabinet__footer">
        <span class="cabinet__tags">
          <span v-for="book in item.books.slice(0, 3)" :key="book.id">{{ book.title }}</span>
          <span v-if="item.books.length > 3">+{{ item.books.length - 3 }}</span>
          <span v-if="!item.books.length" class="cabinet__empty">暂无笔记</span>
        </span>
        <span class="cabinet__footer-actions">
          <button type="button" class="cabinet__share-btn" title="生成书柜分享链接" @click.stop="emit('share', item.id)">分享</button>
          <strong>进入书柜 →</strong>
        </span>
      </span>
    </div>
    <button class="cabinet cabinet--create" type="button" @click="emit('create')">
      <span class="create-plus">+</span>
      <strong>新建书柜</strong>
      <span>创建知识分类并收纳笔记</span>
    </button>
  </div>
</template>

<style scoped>
.cabinet-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.cabinet {
  display: flex; flex-direction: column; gap: 24px; justify-content: space-between;
  min-width: 0; min-height: 184px; padding: 24px; background: #fff;
  border: 2px solid #111; border-radius: 7px; color: #111; text-align: left; cursor: pointer;
  transition: transform .16s ease, box-shadow .16s ease;
}
.cabinet:hover, .cabinet:focus-visible { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 var(--depth-edge, #111); }
.cabinet:focus-visible { outline: 2px solid #111; outline-offset: 4px; }
.cabinet__top, .cabinet__footer { display: flex; justify-content: space-between; gap: 16px; }
.cabinet__top { align-items: stretch; }
.cabinet__information { flex: 0 1 32%; min-width: 0; display: grid; align-content: start; gap: 10px; }
.cabinet__meta { color: #555; font-size: 12px; font-weight: 600; }
.case-number { display: inline-block; margin-right: 6px; padding: 2px 7px; color: #111; border: 1.5px solid #111; border-radius: 2px; box-shadow: 1px 1px 0 currentColor; font: 700 11px ui-monospace,monospace; letter-spacing: .04em; }
.cabinet__name { font-family: var(--paper-serif); font-size: 22px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.cabinet__drawing {
  flex: 1 1 0; min-width: 0; position: relative; height: 144px;
  border: 2px solid #111; background: #fff; box-shadow: 2px 2px 0 currentColor;
  overflow: hidden; user-select: none; -webkit-user-select: none;
}
.cabinet__books {
  position: absolute; inset: 0 0 13px; display: flex; align-items: end; gap: 2px;
  padding: 0 10px; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; -ms-overflow-style: none;
  overscroll-behavior-x: contain;
}
.cabinet__books::-webkit-scrollbar { display: none; }
.cabinet__book {
  display: flex; flex: 0 0 28px; width: 28px; height: calc(100% - 13px); min-width: 28px;
  flex-direction: column; align-items: center; padding: 5px 2px;
  border: 1.5px solid #111; box-shadow: inset 1px 0 #ddd, inset -1px 0 #ddd; background: #fff;
  transition: transform .14s ease;
}
.cabinet__book--page { position: relative; flex-basis: 22px; width: 22px; min-width: 22px; }
.cabinet__page-tab { position: absolute; top: -1px; left: 2px; width: 10px; height: 4px; border: 1px solid currentColor; border-top: 0; }
.cabinet__book--page .cabinet__book-number { margin-top: 5px; border-block: 0; font-size: 7.5px; }
.cabinet__book--page .cabinet__book-rule { width: 12px; background: currentColor; box-shadow: 0 -3px currentColor, 0 -6px currentColor; }
.cabinet__book-number { flex: none; padding: 1px 2px; border-block: 1px solid #111; font: 700 9px/1 ui-monospace, monospace; letter-spacing: .04em; }
.cabinet__book-title { min-height: 0; max-height: 86px; margin: auto 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; writing-mode: vertical-rl; text-orientation: upright; color: #6e4726; font: 700 13px/1.1 var(--paper-serif, serif); }
.cabinet__book-rule { flex: none; width: 12px; height: 1px; background: #111; }
.cabinet__edge {
  position: absolute; top: 0; bottom: 13px; width: 22px; pointer-events: none;
  display: grid; place-items: center; font: 700 15px/1 ui-monospace, monospace;
  color: var(--theme-ink, #111); z-index: 2;
}
.cabinet__edge--left { left: 0; background: linear-gradient(to right, var(--theme-paper, #fff) 45%, transparent); }
.cabinet__edge--right { right: 0; background: linear-gradient(to left, var(--theme-paper, #fff) 45%, transparent); }
.cabinet__plank { position: absolute; bottom: 0; left: 0; right: 0; display: block; height: 13px; border-top: 2px solid #111; border-bottom: 1px solid #111; background: var(--theme-paper, #fff); z-index: 3; }
.cabinet__footer { align-items: center; border-top: 1.5px solid #111; padding-top: 13px; font-size: 12px; }
.cabinet__footer strong { white-space: nowrap; }
.cabinet__footer-actions { display: inline-flex; align-items: center; gap: 10px; flex: none; }
.cabinet__share-btn {
  border: 1.2px solid var(--theme-edge, #111); border-radius: 5px; background: transparent;
  color: var(--theme-ink, #111); padding: 2px 8px; font-size: 11px; font-weight: 600; cursor: pointer;
}
.cabinet__share-btn:hover { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.cabinet__tags { display: flex; min-width: 0; flex-wrap: wrap; gap: 5px; }
.cabinet__tags span { border: 1px solid #111; border-radius: 4px; padding: 3px 6px; max-width: 140px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cabinet__tags .cabinet__empty { border-color: transparent; color: #666; padding-left: 0; }
.cabinet--create { border-style: dashed; align-items: center; justify-content: center; gap: 8px; min-height: 178px; font-size: 13px; }
.cabinet--create span:last-child { color: #555; font-size: 12px; }
.create-plus { display: grid; place-items: center; width: 40px; height: 40px; border: 2px solid #111; border-radius: 50%; font-size: 23px; }
@media (max-width: 700px) { .cabinet-gallery { grid-template-columns: 1fr; gap: 14px; } .cabinet { min-height: 155px; padding: 18px; } }
@media (max-width: 420px) {
  .cabinet__top { gap: 10px; }
  .cabinet__information { flex-basis: 38%; }
  .cabinet__name { font-size: 19px; }
  .cabinet__drawing { height: 128px; }
  .cabinet__books { padding-inline: 6px; }
  .cabinet__book-title { max-height: 64px; font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) { .cabinet, .cabinet__book { transition: none; } }
</style>
