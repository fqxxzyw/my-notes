<script setup lang="ts">
import type { Notebook } from './notebookStore'
type Cabinet = { id: string; title: string; books: Notebook[] }
defineProps<{ items: Cabinet[] }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="cabinet-gallery" aria-label="书柜列表">
    <button v-for="item in items" :key="item.id" class="cabinet" type="button"
      :aria-label="`${item.title}，${item.books.length} 本笔记本`" @click="emit('select', item.id)">
      <span class="cabinet__top">
        <span class="cabinet__information">
          <span class="cabinet__meta">{{ item.books.length }} 册笔记本</span>
          <span class="cabinet__name">{{ item.title }}</span>
        </span>
        <span class="cabinet__drawing" aria-hidden="true">
          <span class="cabinet__books"><i v-for="book in item.books.slice(0, 5)" :key="book.id"></i></span>
          <span class="cabinet__plank"></span>
        </span>
      </span>
      <span class="cabinet__footer">
        <span class="cabinet__tags">
          <span v-for="book in item.books.slice(0, 3)" :key="book.id">{{ book.title }}</span>
          <span v-if="item.books.length > 3">+{{ item.books.length - 3 }}</span>
          <span v-if="!item.books.length" class="cabinet__empty">暂无笔记本</span>
        </span>
        <strong>打开书柜 →</strong>
      </span>
    </button>
  </div>
</template>

<style scoped>
.cabinet-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.cabinet {
  display: flex; flex-direction: column; gap: 24px; justify-content: space-between;
  min-width: 0; min-height: 184px; padding: 24px; background: #fff;
  border: 2px solid #111; border-radius: 10px; color: #111; text-align: left;
  transition: transform .16s ease, box-shadow .16s ease;
}
.cabinet:hover, .cabinet:focus-visible { transform: translate(-2px,-2px); box-shadow: 4px 4px #111; }
.cabinet:focus-visible { outline: 2px solid #111; outline-offset: 4px; }
.cabinet__top, .cabinet__footer { display: flex; justify-content: space-between; gap: 16px; }
.cabinet__information { min-width: 0; display: grid; align-content: start; gap: 10px; }
.cabinet__meta { color: #555; font-size: 12px; font-weight: 600; }
.cabinet__name { font-family: var(--paper-serif); font-size: 22px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.cabinet__drawing { flex: 0 0 80px; position: relative; height: 74px; border: 2px solid #111; background: #fff; }
.cabinet__books { display: flex; align-items: end; gap: 3px; height: 52px; padding: 0 7px; overflow: hidden; }
.cabinet__books i { flex: 0 0 10px; height: 32px; border: 1.5px solid #111; background: #fff; }
.cabinet__books i:nth-child(even) { height: 38px; }
.cabinet__plank { display: block; height: 7px; border-top: 2px solid #111; border-bottom: 1px solid #111; }
.cabinet__footer { align-items: center; border-top: 1.5px solid #111; padding-top: 13px; font-size: 12px; }
.cabinet__footer strong { white-space: nowrap; }
.cabinet__tags { display: flex; min-width: 0; flex-wrap: wrap; gap: 5px; }
.cabinet__tags span { border: 1px solid #111; border-radius: 4px; padding: 3px 6px; max-width: 140px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cabinet__tags .cabinet__empty { border-color: transparent; color: #666; padding-left: 0; }
@media (max-width: 700px) { .cabinet-gallery { grid-template-columns: 1fr; gap: 14px; } .cabinet { min-height: 155px; padding: 18px; } }
@media (prefers-reduced-motion: reduce) { .cabinet { transition: none; } }
</style>
