<script setup lang="ts">
import type { Notebook } from './notebookStore'
type Cabinet = { id: string; title: string; books: Notebook[] }
defineProps<{ items: Cabinet[] }>()
const emit = defineEmits<{ select: [id: string]; create: [] }>()
</script>

<template>
  <div class="cabinet-gallery" aria-label="书柜列表">
    <button v-for="(item, index) in items" :key="item.id" class="cabinet" type="button"
      :aria-label="`${item.title}，${item.books.length} 本笔记本${item.books.length ? '：' + item.books.slice(0, 4).map(book => book.title).join('、') + (item.books.length > 4 ? '等' : '') : ''}`" @click="emit('select', item.id)">
      <span class="cabinet__top">
        <span class="cabinet__information">
          <span class="cabinet__meta"><span class="case-number">CASE {{ String(index + 1).padStart(2, '0') }}</span> {{ item.books.length }} 册</span>
          <span class="cabinet__name">{{ item.title }}</span>
        </span>
        <span class="cabinet__drawing" aria-hidden="true">
          <span class="cabinet__books">
            <span v-for="(book, bookIndex) in item.books.slice(0, 4)" :key="book.id" class="cabinet__book">
              <span class="cabinet__book-number">{{ String(bookIndex + 1).padStart(2, '0') }}</span>
              <span class="cabinet__book-title">{{ book.title }}</span>
              <span class="cabinet__book-rule"></span>
            </span>
          </span>
          <span v-if="item.books.length > 4" class="cabinet__more">+{{ item.books.length - 4 }}</span>
          <span class="cabinet__plank"></span>
        </span>
      </span>
      <span class="cabinet__footer">
        <span class="cabinet__tags">
          <span v-for="book in item.books.slice(0, 3)" :key="book.id">{{ book.title }}</span>
          <span v-if="item.books.length > 3">+{{ item.books.length - 3 }}</span>
          <span v-if="!item.books.length" class="cabinet__empty">暂无笔记本</span>
        </span>
        <strong>进入书柜 →</strong>
      </span>
    </button>
    <button class="cabinet cabinet--create" type="button" @click="emit('create')">
      <span class="create-plus">+</span>
      <strong>新建书柜</strong>
      <span>创建知识分类并收纳笔记本</span>
    </button>
  </div>
</template>

<style scoped>
.cabinet-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.cabinet {
  display: flex; flex-direction: column; gap: 24px; justify-content: space-between;
  min-width: 0; min-height: 184px; padding: 24px; background: #fff;
  border: 2px solid #111; border-radius: 7px; color: #111; text-align: left;
  transition: transform .16s ease, box-shadow .16s ease;
}
.cabinet:hover, .cabinet:focus-visible { transform: translate(-2px,-2px); box-shadow: 4px 4px #111; }
.cabinet:focus-visible { outline: 2px solid #111; outline-offset: 4px; }
.cabinet__top, .cabinet__footer { display: flex; justify-content: space-between; gap: 16px; }
.cabinet__top { align-items: stretch; }
.cabinet__information { flex: 0 1 32%; min-width: 0; display: grid; align-content: start; gap: 10px; }
.cabinet__meta { color: #555; font-size: 12px; font-weight: 600; }
.case-number { display: inline-block; margin-right: 6px; padding: 2px 7px; color: #111; border: 1.5px solid #111; border-radius: 2px; box-shadow: 1px 1px 0 currentColor; font: 700 11px ui-monospace,monospace; letter-spacing: .04em; }
.cabinet__name { font-family: var(--paper-serif); font-size: 22px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.cabinet__drawing { flex: 1 1 0; min-width: 0; position: relative; height: 144px; border: 2px solid #111; background: #fff; box-shadow: 2px 2px 0 currentColor; }
.cabinet__books { position: absolute; inset: 0 0 13px; display: flex; align-items: end; gap: 1px; padding: 0 7px; overflow: hidden; }
.cabinet__book { display: flex; flex: 0 1 28px; width: 28px; height: calc(100% - 13px); min-width: 0; flex-direction: column; align-items: center; padding: 5px 2px; border: 1.5px solid #111; box-shadow: inset 1px 0 #ddd, inset -1px 0 #ddd; background: #fff; }
.cabinet__book-number { flex: none; padding: 1px 2px; border-block: 1px solid #111; font: 700 9px/1 ui-monospace, monospace; letter-spacing: .04em; }
.cabinet__book-title { min-height: 0; max-height: 86px; margin: auto 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; writing-mode: vertical-rl; text-orientation: upright; color: #6e4726; font: 700 13px/1.1 var(--paper-serif, serif); }
.cabinet__book-rule { flex: none; width: 12px; height: 1px; background: #111; }
.cabinet__more { position: absolute; top: 3px; right: 4px; font: 700 9px/1 ui-monospace, monospace; }
.cabinet__plank { position: absolute; bottom: 0; left: 0; right: 0; display: block; height: 13px; border-top: 2px solid #111; border-bottom: 1px solid #111; }
.cabinet__footer { align-items: center; border-top: 1.5px solid #111; padding-top: 13px; font-size: 12px; }
.cabinet__footer strong { white-space: nowrap; }
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
  .cabinet__books { padding-inline: 4px; }
  .cabinet__book-title { max-height: 64px; font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) { .cabinet { transition: none; } }
</style>
