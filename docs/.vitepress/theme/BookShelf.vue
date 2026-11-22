<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Notebook } from './notebookStore'

type ShelfItem = Notebook & { kind?: 'page' }
const props = defineProps<{ books: ShelfItem[]; selectedId?: string; disabled?: boolean }>()
const emit = defineEmits<{ select: [book: ShelfItem] }>()

const refs = new Map<number, HTMLElement>()
const scroll = ref<HTMLElement | null>(null)
const weights = ref<number[]>([])
let targets: number[] = []
const focused = ref<number | null>(null)
const hovered = ref<number | null>(null)
const lastActive = ref<number | null>(null)
const reducedMotion = ref(false)
const isMobile = ref(false)
const dragging = ref(false)
let dragPointer: number | null = null
let dragStartX = 0
let dragStartScroll = 0
let suppressDragClick = false
let motionQuery: MediaQueryList | undefined
let sizeQuery: MediaQueryList | undefined
let frame = 0

const activeBook = computed(() => props.books[hovered.value ?? focused.value ?? lastActive.value ?? 0] || null)

// Each book has a real front cover, extending to the right of its spine in 3D.
// Reserve the projected width of that cover as the book rotates and grows.
const coverDepth = 144
function spacingFor(width: number, rotation: number) {
  const radians = Math.abs(rotation) * Math.PI / 180
  return Math.ceil(Math.max(0, width * (Math.cos(radians) - 1) + coverDepth * Math.sin(radians)) + 12)
}
const metrics = computed(() => isMobile.value
  ? { baseW: 54, maxW: 72, baseH: 206, maxH: 238, gap: 14, radius: 160, maxLift: 12 }
  : { baseW: 66, maxW: 88, baseH: 254, maxH: 294, gap: 26, radius: 220, maxLift: 18 })

function setBookRef(element: unknown, index: number) {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) refs.set(index, element)
  else refs.delete(index)
}

function animate() {
  frame = 0
  let moving = false
  weights.value = targets.map((target, index) => {
    const previous = weights.value[index] || 0
    const value = reducedMotion.value ? target : previous + (target - previous) * 0.16
    if (Math.abs(value - target) < 0.0005) return target
    moving = true
    return value
  })
  if (moving) frame = requestAnimationFrame(animate)
}

function setTargets(center: number, preferred: number | null = null) {
  const m = metrics.value
  const centers = props.books.map((_, index) => {
    const spine = refs.get(index)?.querySelector('.volume__spine')
    const rect = spine?.getBoundingClientRect()
    return rect ? (rect.left + rect.right) / 2 : center
  })
  const preferredSpine = preferred === null ? null : refs.get(preferred)?.querySelector('.volume__spine')?.getBoundingClientRect()
  // A cover belongs to the book on its left. Clamp its influence to that book's
  // visible spine so hovering a cover does not activate its neighbour.
  if (preferredSpine) center = Math.max(preferredSpine.left, Math.min(preferredSpine.right, center))
  targets = props.books.map((_, index) => {
    const distance = Math.abs(center - centers[index])
    if (distance >= m.radius || reducedMotion.value) return 0
    return Math.pow(0.5 * (1 + Math.cos(Math.PI * distance / m.radius)), 1.15)
  })
  let nearest = -1
  let best = -Infinity
  props.books.forEach((_, index) => {
    const weight = -Math.abs(center - centers[index])
    if (weight > best) { best = weight; nearest = index }
  })
  hovered.value = preferred ?? (nearest >= 0 ? nearest : null)
  if (hovered.value !== null) lastActive.value = hovered.value
  if (!frame) frame = requestAnimationFrame(animate)
}

function move(event: PointerEvent) {
  const element = scroll.value
  if (!element || event.pointerType === 'touch' || props.disabled) return
  if (event.pointerId === dragPointer && !(event.buttons & 1)) endDrag(event)
  if (event.pointerId === dragPointer) {
    const offset = event.clientX - dragStartX
    if (!dragging.value && Math.abs(offset) > 6) {
      dragging.value = true
      suppressDragClick = true
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
  refs.forEach((item, index) => { if (item === target) preferred = index })
  setTargets(event.clientX, preferred)
}

function startDrag(event: PointerEvent) {
  const element = scroll.value
  suppressDragClick = false
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
  hovered.value = null
  targets = props.books.map(() => 0)
  if (!frame) frame = requestAnimationFrame(animate)
}

function bookStyle(index: number) {
  const f = weights.value[index] || 0
  const m = metrics.value
  const page = props.books[index]?.kind === 'page'
  const width = m.baseW + (m.maxW - m.baseW) * f
  const tiltY = -26 - 14 * f
  const touchesPage = page || props.books[index + 1]?.kind === 'page'
  const baseline = touchesPage ? Math.max(m.gap, spacingFor(width, tiltY)) : m.gap
  const spacing = baseline + (Math.max(baseline, spacingFor(width, tiltY)) - baseline) * f
  return {
    '--book-width': `${width}px`,
    '--book-spacing': `${spacing}px`,
    '--book-height': `${m.baseH + (m.maxH - m.baseH) * f}px`,
    '--tilt-y': `${tiltY}deg`,
    '--tilt-x': `${-6 + 2.5 * f}deg`,
    '--lift': `${-m.maxLift * f}px`,
    '--depth': `${26 * f}px`,
    '--stack-order': 10 + Math.round(f * 30)
  }
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
function updateSize(event: MediaQueryList | MediaQueryListEvent) { isMobile.value = event.matches; leave() }
watch(() => props.books.map(book => book.id).join('|'), () => {
  targets = props.books.map(() => 0)
  weights.value = [...targets]
  hovered.value = null
  focused.value = null
  lastActive.value = null
})
onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  sizeQuery = window.matchMedia('(max-width: 719px)')
  updateMotion(motionQuery)
  updateSize(sizeQuery)
  motionQuery.addEventListener('change', updateMotion)
  sizeQuery.addEventListener('change', updateSize)
})
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  motionQuery?.removeEventListener('change', updateMotion)
  sizeQuery?.removeEventListener('change', updateSize)
})
</script>

<template>
  <section class="bookshelf" aria-label="笔记本书架">
    <div class="bookshelf__stage">
    <div class="bookshelf__stage-heading">
      <span>3D 书脊 · 笔记本与书页</span>
      <span>移动鼠标放大 · 点击打开</span>
    </div>
    <div ref="scroll" class="bookshelf__scroll" :class="{ 'is-dragging': dragging }"
      @pointerdown="startDrag" @pointermove="move" @pointerup="endDrag" @pointercancel="endDrag"
      @lostpointercapture="endDrag" @pointerleave="leave" @scroll="leave" @click.capture="guardDragClick"
      @dragstart.prevent>
      <div v-if="books.length" class="bookshelf__row" :style="{ '--rest-spacing': `${metrics.gap}px` }">
        <button
          v-for="(book, index) in books"
          :key="book.id"
          :ref="element => setBookRef(element, index)"
          class="volume"
          :class="{ 'volume--selected': book.id === selectedId, 'volume--page': book.kind === 'page' }"
          :style="bookStyle(index)"
          :disabled="disabled"
          :aria-label="`${book.kind === 'page' ? '书页' : '笔记本'}：${book.title}`"
          :title="book.title"
          type="button"
          @focus="focusBook(index)"
          @blur="focused = null; leave()"
          @keydown.left.prevent="focusAdjacent(index, -1)"
          @keydown.right.prevent="focusAdjacent(index, 1)"
          @click="emit('select', book)"
        >
          <span class="volume__floor-shadow" aria-hidden="true"></span>
          <span v-if="book.kind === 'page'" class="volume__body page__body" aria-hidden="true">
            <span class="volume__top"></span>
            <span class="volume__spine page__sheet">
              <span class="volume__number">MD</span>
              <span class="volume__title">{{ book.title }}</span>
              <span class="page__lines"><span></span><span></span><span></span></span>
              <span class="volume__tag">PAGE</span>
            </span>
            <span class="volume__cover page__cover">
              <span class="page__folder-tab">ARCHIVE</span>
              <span class="volume__cover-frame"></span>
              <span class="volume__cover-label"><span>FILE.{{ String(index + 1).padStart(2, '0') }}</span><span>MD</span></span>
              <span class="volume__cover-title">{{ book.title }}<span class="volume__cover-lines"><span></span><span></span><span></span></span></span>
              <span class="volume__cover-rule">SINGLE PAGE</span>
            </span>
          </span>
          <span v-else class="volume__body" aria-hidden="true">
            <span class="volume__top"></span>
            <span class="volume__spine">
              <span class="volume__number">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="volume__title">{{ book.title }}</span>
              <span class="volume__footer"><span class="volume__tailband"></span><span class="volume__tag">NOTES</span></span>
            </span>
            <span class="volume__cover">
              <span class="volume__cover-frame"></span>
              <span class="volume__cover-label"><span>VOL.{{ String(index + 1).padStart(2, '0') }}</span><span>MD</span></span>
              <span class="volume__cover-title">{{ book.title }}<span class="volume__cover-lines"><span></span><span></span><span></span></span></span>
              <span class="volume__cover-rule">NOTES</span>
            </span>
          </span>
        </button>
      </div>
      <div v-else class="bookshelf__empty">创建第一本笔记本，开始记录。</div>
    </div>
    <div class="bookshelf__board" aria-hidden="true"><span></span><span>UNIFORM EDITION · PURE WHITE</span><span></span></div>
    </div>
    <div class="bookshelf__info">
      <div class="bookshelf__info-copy">
        <span class="bookshelf__info-label">{{ activeBook?.kind === 'page' ? '当前书页' : '当前笔记本' }}</span>
        <strong v-if="activeBook">{{ activeBook.title }}</strong>
        <span v-else>移动鼠标或用键盘选择书本</span>
      </div>
      <button v-if="activeBook" class="bookshelf__open" type="button" :disabled="disabled" @click="emit('select', activeBook)">{{ activeBook.kind === 'page' ? '打开书页' : '打开目录' }} →</button>
    </div>
  </section>
</template>

<style scoped src="./bookshelf.css"></style>
