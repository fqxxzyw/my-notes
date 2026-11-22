<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Notebook } from './notebookStore'

const props = defineProps<{ books: Notebook[]; selectedId?: string; disabled?: boolean }>()
const emit = defineEmits<{ select: [book: Notebook] }>()

const refs = new Map<number, HTMLElement>()
const weights = ref<number[]>([])
const focused = ref<number | null>(null)
const hovered = ref<number | null>(null)
const lastActive = ref<number | null>(null)
const pointerInside = ref(false)
const reducedMotion = ref(false)
let motionQuery: MediaQueryList | undefined
let pointerX = 0
let frame = 0

const scales = computed(() => props.books.map((book, index) => {
  if (reducedMotion.value) return 1
  const pointerWeight = pointerInside.value ? (weights.value[index] || 0) : 0
  const focusWeight = focused.value === null ? 0 : Math.max(0, 1 - Math.abs(index - focused.value) * 0.62)
  const selectedWeight = book.id === props.selectedId ? 0.18 : 0
  return 1 + Math.max(pointerWeight, focusWeight, selectedWeight) * 0.3
}))
const activeBook = computed(() => props.books[focused.value ?? hovered.value ?? lastActive.value ?? -1] || null)

function setBookRef(element: unknown, index: number) {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) refs.set(index, element)
  else refs.delete(index)
}

function measurePointer() {
  frame = 0
  weights.value = props.books.map((_, index) => {
    const rect = refs.get(index)?.getBoundingClientRect()
    if (!rect) return 0
    const distance = Math.abs(pointerX - (rect.left + rect.width / 2))
    // A smooth falloff gives nearby volumes a smaller, continuous response.
    return Math.exp(-0.5 * (distance / 68) ** 2)
  })
  let nearest = -1
  let best = 0
  weights.value.forEach((weight, index) => {
    if (weight > best) { best = weight; nearest = index }
  })
  hovered.value = best > 0.35 ? nearest : null
  if (hovered.value !== null) lastActive.value = hovered.value
}

function move(event: PointerEvent) {
  if (event.pointerType === 'touch' || props.disabled) return
  pointerInside.value = true
  pointerX = event.clientX
  if (!frame) frame = requestAnimationFrame(measurePointer)
}

function leave() {
  pointerInside.value = false
  hovered.value = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

function bookStyle(index: number) {
  const scale = scales.value[index] || 1
  return {
    '--book-width': `${104 * scale}px`,
    '--scale': scale,
    '--lift': `${(scale - 1) * -43}px`,
    '--stack-order': Math.round(scale * 100)
  }
}

function updateMotion(event: MediaQueryList | MediaQueryListEvent) { reducedMotion.value = event.matches }
onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  updateMotion(motionQuery)
  motionQuery.addEventListener('change', updateMotion)
})
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  motionQuery?.removeEventListener('change', updateMotion)
})
</script>

<template>
  <section class="bookshelf" aria-label="笔记本书架">
    <div class="bookshelf__stage">
    <div class="bookshelf__scroll" @pointermove="move" @pointerleave="leave" @scroll="leave">
      <div v-if="books.length" class="bookshelf__row">
        <button
          v-for="(book, index) in books"
          :key="book.id"
          :ref="element => setBookRef(element, index)"
          class="volume"
          :class="{ 'volume--selected': book.id === selectedId }"
          :style="bookStyle(index)"
          :disabled="disabled"
          :aria-label="book.title"
          :aria-pressed="book.id === selectedId"
          :title="book.title"
          type="button"
          @focus="focused = index; lastActive = index"
          @blur="focused = null"
          @click="emit('select', book)"
        >
          <span class="volume__body" aria-hidden="true">
            <span class="volume__top"></span>
            <span class="volume__spine">
              <span class="volume__number">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="volume__title">{{ book.title }}</span>
              <span class="volume__tailband"></span>
            </span>
            <span class="volume__cover">
              <span class="volume__cover-frame"></span>
              <span class="volume__cover-label">NOTEBOOK</span>
              <span class="volume__cover-title">{{ book.title }}</span>
              <span class="volume__cover-rule"></span>
            </span>
          </span>
        </button>
      </div>
      <div v-else class="bookshelf__empty">创建第一本笔记本，开始记录。</div>
    </div>
    <div class="bookshelf__board" aria-hidden="true"></div>
    </div>
    <div class="bookshelf__info">
      <div class="bookshelf__info-copy">
        <span class="bookshelf__info-label">当前笔记本</span>
        <strong v-if="activeBook">{{ activeBook.title }}</strong>
        <span v-else>移动鼠标或用键盘选择书本</span>
      </div>
      <button v-if="activeBook" class="bookshelf__open" type="button" :disabled="disabled" @click="emit('select', activeBook)">打开目录 →</button>
    </div>
  </section>
</template>

<style scoped src="./bookshelf.css"></style>
