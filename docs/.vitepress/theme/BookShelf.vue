<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Notebook } from './notebookStore'
import { formatBadgeLabel, formatKindCaption, isBinaryDocumentExt } from './documentFiles'
import {
  createScrollTickTracker,
  ensureShelfAudioUnlocked,
  playBookHover,
  playShelfEdgeBump,
  playShelfTick
} from './shelfAudio'

type ShelfItem = Notebook & { kind?: 'page'; ext?: string; chapterCount?: number; previewText?: string; description?: string }
const props = defineProps<{ books: ShelfItem[]; selectedId?: string; disabled?: boolean }>()
const emit = defineEmits<{ select: [book: ShelfItem]; rename: [book: ShelfItem] }>()

let volumeClickTimer: ReturnType<typeof setTimeout> | undefined
function clearVolumeClickTimer() {
  if (volumeClickTimer !== undefined) {
    clearTimeout(volumeClickTimer)
    volumeClickTimer = undefined
  }
}
function handleVolumeClick(book: ShelfItem) {
  clearVolumeClickTimer()
  volumeClickTimer = setTimeout(() => {
    volumeClickTimer = undefined
    emit('select', book)
  }, 220)
}
function handleVolumeDblClick(book: ShelfItem) {
  clearVolumeClickTimer()
  emit('rename', book)
}
function shortBadge(ext?: string): string {
  const label = formatBadgeLabel(ext)
  return label.length > 3 ? label.slice(0, 3) : label
}

const refs = new Map<number, HTMLElement>()
const scroll = ref<HTMLElement | null>(null)
const rail = ref<HTMLElement | null>(null)
// Non-reactive hot animation arrays so 60fps hover motion updates ONLY the 5-7 affected books
// via direct CSS custom properties, avoiding full Vue VNode diffing on large 30-100+ book shelves.
let weights: number[] = []
let targets: number[] = []
// Cached rest-position spine centers (in scroll-content coordinates) to avoid calling
// getBoundingClientRect() on every book on every pointermove pixel (eliminates layout thrashing!).
let cachedCenters: number[] = []
let cachedScrollRectLeft = 0
let cachedScrollRectWidth = 1
let centersDirty = true

const focused = ref<number | null>(null)
const hovered = ref<number | null>(null)
const lastActive = ref<number | null>(null)
const reducedMotion = ref(false)
const isMobile = ref(false)
const dragging = ref(false)
const canScroll = ref(false)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const scrollRatio = ref(0)
const thumbRatio = ref(1)
const autoGlidingDir = ref<-1 | 0 | 1>(0)

let dragPointer: number | null = null
let dragStartX = 0
let dragStartScroll = 0
let suppressDragClick = false
let railDragging = false
let railPointerId: number | null = null
let motionQuery: MediaQueryList | undefined
let sizeQuery: MediaQueryList | undefined
let resizeObserver: ResizeObserver | undefined
let frame = 0
let autoScrollFrame = 0
let autoScrollSpeed = 0
let pendingMoveFrame = 0
let pendingMoveClientX = 0
let pendingMovePreferred: number | null = null

const tickTracker = createScrollTickTracker(74, {
  onTick: velocity => playShelfTick(velocity),
  onEdgeBump: () => playShelfEdgeBump()
})

const activeBook = computed(() => props.books[hovered.value ?? focused.value ?? lastActive.value ?? 0] || null)

// Each book has a real front cover, extending to the right of its spine in 3D.
// Reserve the projected width of that cover as the book rotates and grows.
const coverDepth = 144
function spacingFor(width: number, rotation: number, depth = coverDepth) {
  const radians = Math.abs(rotation) * Math.PI / 180
  return Math.ceil(Math.max(0, width * (Math.cos(radians) - 1) + depth * Math.sin(radians)) + 12)
}
const metrics = computed(() => isMobile.value
  ? { baseW: 54, maxW: 72, baseH: 206, maxH: 238, gap: 14, radius: 160, maxLift: 12 }
  : { baseW: 66, maxW: 88, baseH: 254, maxH: 294, gap: 26, radius: 220, maxLift: 18 })

const initializedElements = new WeakSet<HTMLElement>()

function setBookRef(element: unknown, index: number) {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) {
    refs.set(index, element)
    if (!initializedElements.has(element)) {
      initializedElements.add(element)
      applyBookStyleToElement(index, weights[index] || 0)
      centersDirty = true
    }
  }
}

function applyAllRestStyles() {
  for (let i = 0; i < props.books.length; i++) {
    applyBookStyleToElement(i, weights[i] || 0)
  }
}

function measureCentersIfNeeded() {
  const el = scroll.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  cachedScrollRectLeft = rect.left
  cachedScrollRectWidth = Math.max(1, rect.width)
  if (!centersDirty && cachedCenters.length === props.books.length) return
  // Single read-only layout pass using offsetLeft (scroll-independent!) so we NEVER thrash layout during pointermove.
  const m = metrics.value
  const next: number[] = new Array(props.books.length)
  for (let i = 0; i < props.books.length; i++) {
    const item = refs.get(i)
    const baseW = props.books[i]?.kind === 'page' ? 24 : m.baseW
    next[i] = item ? item.offsetLeft + baseW * 0.5 : i * (baseW + m.gap)
  }
  cachedCenters = next
  centersDirty = false
}

function applyBookStyleToElement(index: number, f: number) {
  const el = refs.get(index)
  if (!el) return
  const m = metrics.value
  const page = props.books[index]?.kind === 'page'
  const width = page ? 24 + 5 * f : m.baseW + (m.maxW - m.baseW) * f
  const tiltY = -26 - 14 * f
  const touchesPage = page || props.books[index + 1]?.kind === 'page'
  const projected = spacingFor(width, tiltY, page ? 170 : coverDepth)
  const baseline = touchesPage ? Math.max(m.gap, projected) : m.gap
  const spacing = baseline + (Math.max(baseline, projected) - baseline) * f
  const s = el.style
  s.setProperty('--book-width', `${width}px`)
  s.setProperty('--book-spacing', `${spacing}px`)
  s.setProperty('--book-height', `${m.baseH + (m.maxH - m.baseH) * f}px`)
  s.setProperty('--tilt-y', `${tiltY}deg`)
  s.setProperty('--tilt-x', `${-6 + 2.5 * f}deg`)
  s.setProperty('--lift', `${-m.maxLift * f}px`)
  s.setProperty('--depth', `${26 * f}px`)
  s.setProperty('--stack-order', String(10 + Math.round(f * 30)))
}

function updateScrollMetrics() {
  const el = scroll.value
  if (!el) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  canScroll.value = maxScroll > 2
  canScrollLeft.value = el.scrollLeft > 2
  canScrollRight.value = maxScroll > 2 && el.scrollLeft < maxScroll - 2
  scrollRatio.value = maxScroll > 0 ? Math.max(0, Math.min(1, el.scrollLeft / maxScroll)) : 0
  thumbRatio.value = el.scrollWidth > 0 ? Math.max(0.12, Math.min(1, el.clientWidth / el.scrollWidth)) : 1
}

function handleShelfScroll() {
  const el = scroll.value
  if (!el) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  updateScrollMetrics()
  tickTracker.update(el.scrollLeft, maxScroll)
}

function stopAutoScroll() {
  autoScrollSpeed = 0
  autoGlidingDir.value = 0
  if (autoScrollFrame) {
    cancelAnimationFrame(autoScrollFrame)
    autoScrollFrame = 0
  }
}

function stepAutoScroll() {
  autoScrollFrame = 0
  const el = scroll.value
  if (!el || Math.abs(autoScrollSpeed) < 0.08 || dragging.value || reducedMotion.value) {
    autoGlidingDir.value = 0
    return
  }
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  if (maxScroll <= 1) { stopAutoScroll(); return }
  const prev = el.scrollLeft
  const next = Math.max(0, Math.min(maxScroll, prev + autoScrollSpeed))
  el.scrollLeft = next
  updateScrollMetrics()
  if (Math.abs(next - prev) > 0.05) {
    autoScrollFrame = requestAnimationFrame(stepAutoScroll)
  } else {
    autoGlidingDir.value = 0
  }
}

function setEdgeAutoScroll(speed: number) {
  if (reducedMotion.value || dragging.value) {
    stopAutoScroll()
    return
  }
  autoScrollSpeed = speed
  autoGlidingDir.value = speed > 0.1 ? 1 : speed < -0.1 ? -1 : 0
  if (Math.abs(speed) >= 0.08 && !autoScrollFrame) {
    autoScrollFrame = requestAnimationFrame(stepAutoScroll)
  } else if (Math.abs(speed) < 0.08) {
    stopAutoScroll()
  }
}

function pageScroll(direction: -1 | 1) {
  const el = scroll.value
  if (!el) return
  ensureShelfAudioUnlocked()
  const step = Math.max(240, Math.round(el.clientWidth * 0.65))
  el.scrollBy({ left: direction * step, behavior: reducedMotion.value ? 'auto' : 'smooth' })
}

function animate() {
  frame = 0
  let moving = false
  const len = targets.length
  for (let i = 0; i < len; i++) {
    const target = targets[i] || 0
    const previous = weights[i] || 0
    if (previous === target) continue
    const next = reducedMotion.value ? target : previous + (target - previous) * 0.18
    const finalValue = Math.abs(next - target) < 0.001 ? target : next
    if (finalValue !== target) moving = true
    weights[i] = finalValue
    applyBookStyleToElement(i, finalValue)
  }
  if (moving) frame = requestAnimationFrame(animate)
}

function setTargets(clientX: number, preferred: number | null = null) {
  const el = scroll.value
  if (!el || !props.books.length) return
  measureCentersIfNeeded()
  const m = metrics.value
  // Convert pointer clientX into scroll-content X coordinate (zero DOM reads per book!)
  let contentX = clientX - cachedScrollRectLeft + el.scrollLeft
  if (preferred !== null && cachedCenters[preferred] !== undefined) {
    const half = (props.books[preferred]?.kind === 'page' ? 12 : m.baseW * 0.5)
    const c = cachedCenters[preferred]
    contentX = Math.max(c - half, Math.min(c + half, contentX))
  }
  let nearest = -1
  let best = Infinity
  const len = props.books.length
  if (targets.length !== len) targets = new Array(len).fill(0)
  for (let i = 0; i < len; i++) {
    const distance = Math.abs(contentX - cachedCenters[i])
    if (distance < best) { best = distance; nearest = i }
    if (distance >= m.radius || reducedMotion.value) {
      targets[i] = 0
    } else {
      targets[i] = Math.pow(0.5 * (1 + Math.cos(Math.PI * distance / m.radius)), 1.15)
    }
  }
  const nextHovered = preferred ?? (nearest >= 0 ? nearest : null)
  if (nextHovered !== null && nextHovered !== hovered.value && !dragging.value) {
    playBookHover()
  }
  hovered.value = nextHovered
  if (hovered.value !== null) lastActive.value = hovered.value
  if (!frame) frame = requestAnimationFrame(animate)
}

function flushPointerMove() {
  pendingMoveFrame = 0
  const element = scroll.value
  if (!element || dragging.value || props.disabled) return
  setTargets(pendingMoveClientX, pendingMovePreferred)

  // Edge hover auto-scroll: moving mouse into outer 20% left/right zones glides smoothly across the whole shelf!
  const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth)
  if (maxScroll > 2 && !reducedMotion.value) {
    const ratio = (pendingMoveClientX - cachedScrollRectLeft) / cachedScrollRectWidth
    const edgeZone = 0.2
    if (ratio > 1 - edgeZone && element.scrollLeft < maxScroll - 1) {
      const intensity = Math.min(1, (ratio - (1 - edgeZone)) / edgeZone)
      setEdgeAutoScroll(2.2 + Math.pow(intensity, 1.35) * 9.8)
    } else if (ratio < edgeZone && element.scrollLeft > 1) {
      const intensity = Math.min(1, (edgeZone - ratio) / edgeZone)
      setEdgeAutoScroll(-(2.2 + Math.pow(intensity, 1.35) * 9.8))
    } else {
      setEdgeAutoScroll(0)
    }
  } else {
    setEdgeAutoScroll(0)
  }
}

function move(event: PointerEvent) {
  const element = scroll.value
  if (!element || event.pointerType === 'touch' || props.disabled) return
  ensureShelfAudioUnlocked()
  if (event.pointerId === dragPointer && !(event.buttons & 1)) endDrag(event)
  if (event.pointerId === dragPointer) {
    const offset = event.clientX - dragStartX
    if (!dragging.value && Math.abs(offset) > 6) {
      dragging.value = true
      suppressDragClick = true
      stopAutoScroll()
      element.setPointerCapture(event.pointerId)
      leave()
    }
    if (dragging.value) {
      event.preventDefault()
      element.scrollLeft = dragStartScroll - offset
      return
    }
  }
  const target = event.target instanceof Element ? event.target.closest('.volume') : null
  let preferred: number | null = null
  if (target instanceof HTMLElement && target.dataset.bookIndex !== undefined) {
    const parsed = Number(target.dataset.bookIndex)
    if (Number.isInteger(parsed)) preferred = parsed
  }
  pendingMoveClientX = event.clientX
  pendingMovePreferred = preferred
  if (!pendingMoveFrame) {
    pendingMoveFrame = requestAnimationFrame(flushPointerMove)
  }
}

function handleWheel(event: WheelEvent) {
  const element = scroll.value
  if (!element) return
  const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth)
  if (maxScroll <= 2) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY * 1.15
  if (!delta) return
  const atStart = element.scrollLeft <= 1 && delta < 0
  const atEnd = element.scrollLeft >= maxScroll - 1 && delta > 0
  if (atStart || atEnd) return
  event.preventDefault()
  ensureShelfAudioUnlocked()
  stopAutoScroll()
  element.scrollLeft += delta
  updateScrollMetrics()
}

function startDrag(event: PointerEvent) {
  const element = scroll.value
  suppressDragClick = false
  ensureShelfAudioUnlocked()
  if (!element || event.pointerType === 'touch' || event.button !== 0 ||
    element.scrollWidth <= element.clientWidth + 1) return
  dragPointer = event.pointerId
  dragStartX = event.clientX
  dragStartScroll = element.scrollLeft
}

function endDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointer) return
  dragPointer = null
  dragging.value = false
}

function guardDragClick(event: MouseEvent) {
  if (!suppressDragClick) return
  suppressDragClick = false
  event.preventDefault()
  event.stopPropagation()
}

function leave() {
  if (pendingMoveFrame) {
    cancelAnimationFrame(pendingMoveFrame)
    pendingMoveFrame = 0
  }
  stopAutoScroll()
  hovered.value = null
  targets = props.books.map(() => 0)
  if (!frame) frame = requestAnimationFrame(animate)
}

// Draggable paper-craft progress rail directly below the books
function scrubRailToClientX(clientX: number) {
  const el = scroll.value
  const track = rail.value
  if (!el || !track) return
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
  if (maxScroll <= 0) return
  const rect = track.getBoundingClientRect()
  const thumbW = rect.width * thumbRatio.value
  const usable = Math.max(1, rect.width - thumbW)
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left - thumbW / 2) / usable))
  el.scrollLeft = ratio * maxScroll
  updateScrollMetrics()
}

function startRailDrag(event: PointerEvent) {
  if (event.button !== 0 || !rail.value) return
  event.preventDefault()
  ensureShelfAudioUnlocked()
  stopAutoScroll()
  railDragging = true
  railPointerId = event.pointerId
  rail.value.setPointerCapture(event.pointerId)
  scrubRailToClientX(event.clientX)
}

function moveRailDrag(event: PointerEvent) {
  if (!railDragging || event.pointerId !== railPointerId) return
  event.preventDefault()
  scrubRailToClientX(event.clientX)
}

function endRailDrag(event: PointerEvent) {
  if (event.pointerId !== railPointerId) return
  railDragging = false
  railPointerId = null
}

// The page face is a small preview of the real Markdown, never placeholder text.
function pageExcerpt(markdown?: string) {
  return (markdown || '').replace(/```[\s\S]*?```/g, ' ').replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\d.\s]+/gm, '').replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 115)
}

function focusBook(index: number) {
  focused.value = index
  lastActive.value = index
  const spine = refs.get(index)?.querySelector('.volume__spine')?.getBoundingClientRect()
  if (spine) setTargets((spine.left + spine.right) / 2, index)
  hovered.value = null
}
function focusAdjacent(index: number, direction: number) {
  const next = Math.max(0, Math.min(props.books.length - 1, index + direction))
  refs.get(next)?.focus()
}
function updateMotion(event: MediaQueryList | MediaQueryListEvent) {
  reducedMotion.value = event.matches
  if (event.matches) leave()
}
function updateSize(event: MediaQueryList | MediaQueryListEvent) {
  isMobile.value = event.matches
  centersDirty = true
  leave()
  void nextTick(() => {
    applyAllRestStyles()
    updateScrollMetrics()
  })
}
watch(() => props.books.map(book => book.id).join('|'), () => {
  for (const key of Array.from(refs.keys())) {
    if (key >= props.books.length) refs.delete(key)
  }
  targets = props.books.map(() => 0)
  weights = props.books.map(() => 0)
  centersDirty = true
  hovered.value = null
  focused.value = null
  lastActive.value = null
  stopAutoScroll()
  void nextTick(() => {
    applyAllRestStyles()
    if (scroll.value) tickTracker.reset(scroll.value.scrollLeft)
    updateScrollMetrics()
    measureCentersIfNeeded()
  })
})
onMounted(() => {
  ensureShelfAudioUnlocked()
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  sizeQuery = window.matchMedia('(max-width: 719px)')
  updateMotion(motionQuery)
  updateSize(sizeQuery)
  motionQuery.addEventListener('change', updateMotion)
  sizeQuery.addEventListener('change', updateSize)
  if (typeof ResizeObserver !== 'undefined' && scroll.value) {
    resizeObserver = new ResizeObserver(() => {
      centersDirty = true
      updateScrollMetrics()
    })
    resizeObserver.observe(scroll.value)
  }
  void nextTick(() => {
    if (scroll.value) tickTracker.reset(scroll.value.scrollLeft)
    updateScrollMetrics()
    measureCentersIfNeeded()
  })
})
onBeforeUnmount(() => {
  clearVolumeClickTimer()
  stopAutoScroll()
  if (frame) cancelAnimationFrame(frame)
  if (pendingMoveFrame) cancelAnimationFrame(pendingMoveFrame)
  resizeObserver?.disconnect()
  motionQuery?.removeEventListener('change', updateMotion)
  sizeQuery?.removeEventListener('change', updateSize)
})
</script>

<template>
  <section class="bookshelf" aria-label="笔记本书架">
    <div class="bookshelf__stage">
      <button
        v-if="canScrollLeft"
        type="button"
        class="bookshelf__edge-btn bookshelf__edge-btn--left"
        :class="{ 'is-active': autoGlidingDir === -1 }"
        aria-label="向左滑动书架"
        title="悬停向左滑览，点击翻页"
        @pointerenter="setEdgeAutoScroll(-7.5)"
        @pointerleave="setEdgeAutoScroll(0)"
        @click.stop="pageScroll(-1)"
      >‹</button>
      <button
        v-if="canScrollRight"
        type="button"
        class="bookshelf__edge-btn bookshelf__edge-btn--right"
        :class="{ 'is-active': autoGlidingDir === 1 }"
        aria-label="向右滑动书架"
        title="悬停向右滑览，点击翻页"
        @pointerenter="setEdgeAutoScroll(7.5)"
        @pointerleave="setEdgeAutoScroll(0)"
        @click.stop="pageScroll(1)"
      >›</button>

      <div ref="scroll" class="bookshelf__scroll" :class="{ 'is-dragging': dragging }"
        @pointerdown="startDrag" @pointermove="move" @pointerup="endDrag" @pointercancel="endDrag"
        @lostpointercapture="endDrag" @pointerleave="leave" @scroll="handleShelfScroll" @wheel="handleWheel"
        @click.capture="guardDragClick" @dragstart.prevent>
        <div v-if="books.length" class="bookshelf__row" :style="{ '--rest-spacing': `${metrics.gap}px` }">
          <button
            v-for="(book, index) in books"
            :key="book.id"
            :ref="element => setBookRef(element, index)"
            :data-book-index="index"
            class="volume"
            :class="{ 'volume--selected': book.id === selectedId, 'volume--page': book.kind === 'page' }"
            :disabled="disabled"
            :aria-label="`${book.kind === 'page' ? '书页' : '笔记本'}：${book.title}`"
            :title="`${book.title}（单击打开，双击重命名）`"
            type="button"
            @focus="focusBook(index)"
            @blur="focused = null; leave()"
            @keydown.left.prevent="focusAdjacent(index, -1)"
            @keydown.right.prevent="focusAdjacent(index, 1)"
            @click="handleVolumeClick(book)"
            @dblclick.stop.prevent="handleVolumeDblClick(book)"
          >
            <span class="volume__floor-shadow" aria-hidden="true"></span>
            <span v-if="book.kind === 'page'" class="volume__body page__body" aria-hidden="true">
              <span class="volume__top page__top"></span>
              <span class="volume__spine page__edge">
                <span class="page__md">{{ shortBadge(book.ext) }}</span>
                <span class="volume__title">{{ book.title }}</span>
                <span class="page__diamond"></span>
              </span>
              <span class="page__face">
                <svg class="page__outline" viewBox="0 0 170 260" preserveAspectRatio="none">
                  <path d="M 0,0.75 L 144,0.75 L 169.25,26 L 169.25,259.25 L 0,259.25 Z" />
                  <path d="M 144,0.75 L 144,26 L 169.25,26 Z" />
                </svg>
                <span class="page__content">
                  <span><span class="page__badge">{{ isBinaryDocumentExt(book.ext) ? 'FILE' : 'PAGE' }} · {{ formatBadgeLabel(book.ext) }}</span><span class="page__title">{{ book.title }}</span></span>
                  <span class="page__manuscript">{{ isBinaryDocumentExt(book.ext) ? `${formatKindCaption(book.ext)}（只读查看）` : pageExcerpt(book.previewText) }}</span>
                  <span class="page__foot">{{ formatKindCaption(book.ext) }}</span>
                </span>
              </span>
            </span>
            <span v-else class="volume__body" aria-hidden="true">
              <span class="volume__top"></span>
              <span class="volume__spine">
                <span class="volume__number">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="volume__title">{{ book.title }}</span>
                <span class="volume__footer"><span class="volume__tailband"></span><span v-if="book.chapterCount !== undefined" class="volume__chapter-count">{{ book.chapterCount }} 章</span></span>
              </span>
              <span class="volume__cover">
                <span class="volume__cover-frame"></span>
                <span class="volume__cover-label"><span>VOL.{{ String(index + 1).padStart(2, '0') }}</span><span>MD</span></span>
                <span class="volume__cover-title">{{ book.title }}<span v-if="book.description?.trim()" class="volume__cover-description">{{ book.description }}</span><span v-else class="volume__cover-lines"><span></span><span></span><span></span></span></span>
                <span class="volume__cover-rule">NOTES <span v-if="book.chapterCount !== undefined" class="volume__cover-chapters">{{ book.chapterCount }} CH</span></span>
              </span>
            </span>
          </button>
        </div>
        <div v-else class="bookshelf__empty">创建第一本笔记本，开始记录。</div>
      </div>

      <div
        v-if="canScroll"
        ref="rail"
        class="bookshelf__rail"
        role="slider"
        aria-label="书架横向滑动进度"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="Math.round(scrollRatio * 100)"
        title="拖动或点击滑轨快速浏览整排书架"
        @pointerdown="startRailDrag"
        @pointermove="moveRailDrag"
        @pointerup="endRailDrag"
        @pointercancel="endRailDrag"
        @lostpointercapture="endRailDrag"
      >
        <span
          class="bookshelf__rail-thumb"
          :style="{
            width: `${(thumbRatio * 100).toFixed(2)}%`,
            left: `${(scrollRatio * (1 - thumbRatio) * 100).toFixed(2)}%`
          }"
        ></span>
      </div>

      <div class="bookshelf__board" aria-hidden="true"><span></span><span>UNIFORM EDITION · PURE WHITE</span><span></span></div>
    </div>
    <div class="bookshelf__info">
      <div class="bookshelf__info-copy">
        <span class="bookshelf__info-label">{{ activeBook?.kind === 'page' ? (isBinaryDocumentExt(activeBook.ext) ? `当前文档（${formatBadgeLabel(activeBook.ext)} · 只读）` : `当前书页（${formatBadgeLabel(activeBook.ext)}）`) : '当前笔记本' }}</span>
        <strong v-if="activeBook" class="paper-renameable" title="双击修改名称" @dblclick.stop.prevent="emit('rename', activeBook)">{{ activeBook.title }}</strong>
        <span v-else>移动鼠标或用键盘选择书本（双击可修改名称）</span>
      </div>
      <button v-if="activeBook" class="bookshelf__open" type="button" :disabled="disabled" @click="emit('select', activeBook)">{{ activeBook.kind === 'page' ? (isBinaryDocumentExt(activeBook.ext) ? '查看文档' : '打开书页') : '打开目录' }} →</button>
    </div>
  </section>
</template>

<style scoped src="./bookshelf.css"></style>
