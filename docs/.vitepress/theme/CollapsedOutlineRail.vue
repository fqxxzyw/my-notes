<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OutlineHeading } from './markdownOutline'
import { nearestHeadingIndex } from './outlineRail'

const props = defineProps<{ headings: OutlineHeading[]; sourceLength: number }>()
const emit = defineEmits<{ jump: [offset: number] }>()

const rail = ref<HTMLElement | null>(null)
const active = ref(0)
const hovering = ref(false)
const focused = ref(false)
const position = ref(0)
const pointerTop = ref(0)
const tooltipSide = ref<'left' | 'right'>('right')
const tooltipLeft = ref(0)
const tooltipWidth = ref(230)
const heading = computed(() => props.headings[active.value])
const visible = computed(() => hovering.value || focused.value)

watch(() => props.headings, headings => {
  active.value = Math.max(0, Math.min(active.value, headings.length - 1))
}, { deep: true })

function placeTooltip(clientY: number) {
  const bounds = rail.value?.getBoundingClientRect()
  if (!bounds) return
  // Prefer the outside margin even when narrow, so the preview does not
  // cover the editable document. On narrow screens use a compact fallback.
  tooltipSide.value = bounds.left >= 72 ? 'left' : 'right'
  tooltipLeft.value = tooltipSide.value === 'left' ? bounds.left - 8 : bounds.right + 8
  tooltipWidth.value = tooltipSide.value === 'left' ? Math.min(230, bounds.left - 16) : Math.min(160, window.innerWidth - bounds.right - 16)
  pointerTop.value = Math.max(32, Math.min(window.innerHeight - 32, clientY))
}

function point(event: PointerEvent) {
  const bounds = rail.value?.getBoundingClientRect()
  if (!bounds || !bounds.height) return
  const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  position.value = ratio * 1000
  if (props.headings.length) active.value = nearestHeadingIndex(props.headings, ratio * Math.max(1, props.sourceLength))
  placeTooltip(event.clientY)
}

function showFocus() {
  focused.value = true
  const bounds = rail.value?.getBoundingClientRect()
  if (!bounds) return
  const ratio = heading.value ? Math.max(0, Math.min(1, heading.value.offset / Math.max(1, props.sourceLength))) : .5
  position.value = ratio * 1000
  placeTooltip(bounds.top + bounds.height * ratio)
}

function moveFocus(step: number | 'first' | 'last') {
  if (!props.headings.length) return
  active.value = step === 'first' ? 0 : step === 'last' ? props.headings.length - 1 : Math.max(0, Math.min(props.headings.length - 1, active.value + step))
  showFocus()
}

function jump() { if (heading.value) emit('jump', heading.value.offset) }

const bulge = computed(() => {
  const y = position.value
  return `M 11 ${y - 95} Q 11 ${y - 55} 7 ${y - 25} Q 4 ${y} 7 ${y + 25} Q 11 ${y + 55} 11 ${y + 95} L 13 ${y + 95} Q 13 ${y + 55} 17 ${y + 25} Q 20 ${y} 17 ${y - 25} Q 13 ${y - 55} 13 ${y - 95} Z`
})
</script>

<template>
  <nav class="collapsed-outline" aria-label="折叠目录">
    <div ref="rail" class="collapsed-outline__rail" :class="{ 'is-active': visible }"
      :role="headings.length ? 'slider' : undefined" tabindex="0"
      :aria-label="headings.length ? '目录标题，方向键切换，回车跳转' : '当前文档暂无标题'"
      :aria-valuemin="headings.length ? 1 : undefined" :aria-valuemax="headings.length || undefined"
      :aria-valuenow="headings.length ? active + 1 : undefined" :aria-valuetext="heading?.title"
      @pointerenter="hovering = true; point($event)" @pointermove="point" @pointerleave="hovering = false"
      @focus="showFocus" @blur="focused = false" @click="jump"
      @keydown.up.prevent="moveFocus(-1)" @keydown.left.prevent="moveFocus(-1)"
      @keydown.down.prevent="moveFocus(1)" @keydown.right.prevent="moveFocus(1)"
      @keydown.home.prevent="moveFocus('first')" @keydown.end.prevent="moveFocus('last')"
      @keydown.enter.prevent="jump" @keydown.space.prevent="jump">
      <svg viewBox="0 0 24 1000" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 12 0 V 1000" class="collapsed-outline__line" />
        <path v-if="visible" :d="bulge" class="collapsed-outline__bulge" />
      </svg>
    </div>
    <Teleport to="body">
      <div v-if="visible" class="collapsed-outline__tooltip" :class="`is-${tooltipSide}`"
        :style="{ left: `${tooltipLeft}px`, top: `${pointerTop}px`, maxWidth: `${Math.max(48, tooltipWidth)}px` }" role="tooltip">
        <span>{{ heading?.title || '当前文档暂无标题' }}</span>
      </div>
    </Teleport>
  </nav>
</template>

<style scoped>
.collapsed-outline { min-width: 0; align-self: stretch; }
.collapsed-outline__rail {
  position: sticky; top: 100px; width: 24px; height: min(54vh, 420px); min-height: 180px;
  cursor: pointer; touch-action: none; color: var(--ink, #111); outline: 0;
}
.collapsed-outline__rail:focus-visible { outline: 2px solid var(--ink, #111); outline-offset: 2px; border-radius: 4px; }
.collapsed-outline__rail svg { display: block; width: 100%; height: 100%; overflow: hidden; }
.collapsed-outline__line { fill: none; stroke: currentColor; stroke-width: 2; vector-effect: non-scaling-stroke; }
.collapsed-outline__bulge { fill: currentColor; }
.collapsed-outline__tooltip {
  position: fixed; z-index: 110; display: flex; align-items: baseline; gap: 7px;
  max-width: min(230px, calc(100vw - 40px)); padding: 6px 9px; border: 1px solid var(--ink, #111);
  border-radius: 4px; background: var(--panel, #fff); color: var(--ink, #111); box-shadow: 2px 2px 0 var(--ink, #111);
  font: 13px/1.4 var(--paper-sans, sans-serif); overflow-wrap: anywhere; pointer-events: none; transform: translateY(-50%);
}
.collapsed-outline__tooltip.is-left { transform: translate(-100%, -50%); }
:global(.paper-night) .collapsed-outline__tooltip { --ink: #ede9e2; --panel: #222427; }
.collapsed-outline__tooltip span:last-child { overflow: hidden; max-height: min(45vh, 320px); }
@media (prefers-reduced-motion: reduce) { .collapsed-outline__bulge { display: none; } }
</style>
