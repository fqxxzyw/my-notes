<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OutlineHeading } from './markdownOutline'
import { movableOutlineOffsets, moveOutlineSection, shiftOutlineSection } from './outlineTransform'

type Node = OutlineHeading & { id: string; depth: number; parentIds: string[]; hasChildren: boolean; movable: boolean }
const props = defineProps<{ headings: OutlineHeading[]; source: string; disabled?: boolean }>()
const emit = defineEmits<{ jump: [offset: number]; change: [before: string, after: string, focus: number]; error: [message: string] }>()
const collapsed = ref(new Set<string>())
const dragging = ref<{ offset: number; source: string } | null>(null)
const dropTarget = ref<number | null>(null)

const nodes = computed<Node[]>(() => {
  const stack: Node[] = [], count = new Map<string, number>()
  const movable = new Set(movableOutlineOffsets(props.source))
  return props.headings.map(item => {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop()
    const signature = `${item.level}:${item.title}`
    const occurrence = (count.get(signature) || 0) + 1
    count.set(signature, occurrence)
    const node: Node = { ...item, id: `${signature}:${occurrence}`, depth: stack.length,
      parentIds: stack.map(parent => parent.id), hasChildren: false, movable: movable.has(item.offset) }
    if (stack.length) stack[stack.length - 1].hasChildren = true
    stack.push(node)
    return node
  })
})
const visibleNodes = computed(() => nodes.value.filter(node => !node.parentIds.some(id => collapsed.value.has(id))))

function toggle(node: Node) {
  const next = new Set(collapsed.value)
  if (next.has(node.id)) next.delete(node.id); else next.add(node.id)
  collapsed.value = next
}
function startDrag(event: DragEvent, node: Node) {
  if (props.disabled || !node.movable) { event.preventDefault(); return }
  dragging.value = { offset: node.offset, source: props.source }
  // A custom type prevents an accidental drop into the editor from inserting
  // the heading as plain text. The source of truth stays in this component.
  event.dataTransfer?.setData('application/x-paper-notes-outline', '1')
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function endDrag() { dragging.value = null; dropTarget.value = null }
function acceptDrag(event: DragEvent, node: Node) {
  if (!dragging.value || !node.movable || props.disabled) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = node.offset
}
function drop(event: DragEvent, node: Node) {
  if (!dragging.value || props.disabled) return
  event.preventDefault()
  const drag = dragging.value
  endDrag()
  if (drag.source !== props.source) { emit('error', '正文在拖动时发生变化，请重新拖动。'); return }
  try {
    const result = moveOutlineSection(props.source, drag.offset, node.offset)
    emit('change', props.source, result.text, result.focus)
    // A newly moved child should remain visible beneath its parent.
    if (collapsed.value.has(node.id)) toggle(node)
  } catch (error) { emit('error', error instanceof Error ? error.message : '无法移动标题。') }
}
function shift(node: Node, delta: -1 | 1) {
  if (props.disabled || !node.movable) return
  try {
    const result = shiftOutlineSection(props.source, node.offset, delta)
    emit('change', props.source, result.text, result.focus)
  } catch (error) { emit('error', error instanceof Error ? error.message : '无法调整标题层级。') }
}
</script>

<template>
  <nav class="outline-tree reference-sidebar-list" aria-label="当前章节标题">
    <p v-if="!nodes.length" class="outline-tree__empty">暂无标题</p>
    <div v-else role="tree" aria-label="文档目录">
      <div v-for="node in visibleNodes" :key="node.id" role="treeitem"
        class="outline-tree__row" :class="{ 'is-drop': dropTarget === node.offset }"
        :style="{ '--depth': Math.min(node.depth, 5) }" :aria-level="node.depth + 1"
        :aria-expanded="node.hasChildren ? !collapsed.has(node.id) : undefined"
        :draggable="node.movable && !disabled" @dragstart="startDrag($event, node)" @dragend="endDrag"
        @dragover="acceptDrag($event, node)" @dragleave="dropTarget = null" @drop="drop($event, node)">
        <button v-if="node.hasChildren" class="outline-tree__toggle" type="button"
          :aria-label="`${collapsed.has(node.id) ? '展开' : '折叠'}${node.title}的子标题`" @click.stop="toggle(node)">{{ collapsed.has(node.id) ? '▸' : '▾' }}</button>
        <span v-else class="outline-tree__toggle outline-tree__spacer" aria-hidden="true"></span>
        <button class="outline-tree__title" type="button" :title="node.title" @click="emit('jump', node.offset)">{{ node.title }}</button>
        <span v-if="node.movable" class="outline-tree__actions">
          <button type="button" :disabled="disabled" :aria-label="`提升${node.title}的标题层级`" title="提升层级" @click.stop="shift(node, -1)">−</button>
          <button type="button" :disabled="disabled" :aria-label="`降低${node.title}的标题层级`" title="降低层级" @click.stop="shift(node, 1)">＋</button>
        </span>
        <span v-else class="outline-tree__locked" title="引用或列表中的标题可点击跳转，不能拖动调整" aria-label="引用或列表中的标题不可拖动">·</span>
      </div>
    </div>
    <p v-if="nodes.length" class="outline-tree__hint">拖到标题上可成为其子标题；也可用 − / ＋ 调整层级</p>
  </nav>
</template>

<style scoped>
.outline-tree { min-height: 0; }
.outline-tree__row { display: flex; align-items: center; gap: 2px; padding-left: calc(var(--depth) * 12px); border: 1px solid transparent; border-radius: 4px; min-width: 0; }
.outline-tree__row[draggable="true"] { cursor: grab; }
.outline-tree__row.is-drop { border-color: var(--ink, #111); background: var(--vp-c-bg-soft, #f5f5f5); }
.outline-tree__toggle { flex: 0 0 18px; width: 18px; padding: 3px 0; background: none; color: var(--ink, #111); }
.outline-tree__spacer { display: inline-block; }
.outline-tree__title { flex: 1; min-width: 0; padding: 6px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; color: var(--ink, #111); }
.outline-tree__title:hover, .outline-tree__title:focus-visible { text-decoration: underline; text-underline-offset: 3px; }
.outline-tree__actions { display: flex; flex: none; opacity: 0; }
.outline-tree__row:hover .outline-tree__actions, .outline-tree__row:focus-within .outline-tree__actions { opacity: 1; }
.outline-tree__actions button { width: 21px; height: 24px; padding: 0; border: 1px solid var(--line, #111); border-radius: 3px; font-size: 12px; line-height: 1; }
.outline-tree__locked { flex: none; color: var(--muted, #666); }
.outline-tree__hint, .outline-tree__empty { margin: 8px 2px; color: var(--muted, #666); font-size: 11px; line-height: 1.5; }
@media (hover: none) { .outline-tree__actions { opacity: 1; } }
</style>
