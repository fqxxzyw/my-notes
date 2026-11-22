<script setup lang="ts">
import type { Notebook } from './notebookStore'

type Cabinet = { id: string; title: string; books: Notebook[] }
defineProps<{ items: Cabinet[] }>()
const emit = defineEmits<{ select: [id: string] }>()

function firstShelf(books: Notebook[]) { return books.slice(0, Math.ceil(books.length / 2)) }
function secondShelf(books: Notebook[]) { return books.slice(Math.ceil(books.length / 2)) }
</script>

<template>
  <div class="cabinet-gallery" aria-label="书柜列表">
    <button
      v-for="item in items"
      :key="item.id"
      class="cabinet"
      type="button"
      :aria-label="`${item.title}，${item.books.length} 本笔记本`"
      @click="emit('select', item.id)"
    >
      <span class="cabinet__scene" aria-hidden="true">
        <span class="cabinet__shadow"></span>
        <span class="cabinet__leg cabinet__leg--left"></span>
        <span class="cabinet__leg cabinet__leg--right"></span>
        <span class="cabinet__top"></span>
        <span class="cabinet__side"></span>
        <span class="cabinet__front">
          <span class="cabinet__inside">
            <span class="cabinet__shelf">
              <span
                v-for="book in firstShelf(item.books)"
                :key="book.id"
                class="cabinet__book"
                :title="book.title"
              ></span>
            </span>
            <span class="cabinet__shelf">
              <span
                v-for="book in secondShelf(item.books)"
                :key="book.id"
                class="cabinet__book"
                :title="book.title"
              ></span>
            </span>
          </span>
        </span>
      </span>
      <span class="cabinet__caption">
        <span class="cabinet__name">{{ item.title }}</span>
        <span class="cabinet__count">{{ item.books.length }} 本</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.cabinet-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
  align-items: start;
  gap: 34px 32px;
  max-width: 1060px;
}

.cabinet {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.cabinet:focus-visible {
  outline: 3px solid #252830;
  outline-offset: 7px;
}
.cabinet:focus:not(:focus-visible) { outline: none; }

.cabinet__scene {
  position: relative;
  display: block;
  width: min(100%, 265px);
  height: 258px;
  margin: 0 auto;
  transition: transform 180ms ease;
}
.cabinet:hover .cabinet__scene, .cabinet:focus-visible .cabinet__scene {
  transform: translateY(-4px);
}

.cabinet__shadow {
  position: absolute;
  right: -3px;
  bottom: 0;
  left: 14px;
  height: 12px;
  background: #d8e8eb;
  transform: skewX(-38deg);
  box-shadow: 5px 5px 0 #edf3f2;
}

.cabinet__leg {
  position: absolute;
  z-index: 0;
  bottom: 5px;
  width: 15px;
  height: 23px;
  border: 2px solid #252830;
  border-radius: 0 0 2px 1px;
  background: #e6eff0;
  box-shadow: 3px 2px 0 #b9ced4;
}
.cabinet__leg--left { left: 15px; }
.cabinet__leg--right { right: 28px; }

.cabinet__top {
  position: absolute;
  z-index: 1;
  top: 7px;
  right: 9px;
  left: 9px;
  height: 15px;
  border: 2px solid #252830;
  border-radius: 2px 3px 0 0;
  background: #fdfbf2;
  box-shadow: inset 0 -3px #e1eced;
  transform: skewX(-42deg);
  transform-origin: left bottom;
}

.cabinet__side {
  position: absolute;
  z-index: 0;
  top: 20px;
  right: 2px;
  bottom: 25px;
  width: 17px;
  border: 2px solid #252830;
  background: #cbdfe4;
  box-shadow: inset -5px 0 #b7ced6;
  transform: skewY(-37deg);
  transform-origin: left top;
}

.cabinet__front {
  position: absolute;
  z-index: 2;
  top: 20px;
  right: 18px;
  bottom: 24px;
  left: 0;
  display: block;
  padding: 11px 10px 12px;
  border: 3px solid #252830;
  border-radius: 2px 3px 2px 2px;
  background: #fffcf4;
  box-shadow: inset -4px 0 #e5eeee, 3px 3px 0 #aabfc5;
}

.cabinet__inside {
  display: grid;
  grid-template-rows: 1fr 1fr;
  height: 100%;
  gap: 10px;
  padding: 2px 5px 0;
  border: 2px solid #252830;
  background: #eaf2f1;
  box-shadow: inset 5px 4px #d5e4e6;
}

.cabinet__shelf {
  position: relative;
  display: flex;
  align-items: end;
  min-width: 0;
  gap: 1px;
  padding: 0 5px;
}
.cabinet__shelf::after {
  content: '';
  position: absolute;
  z-index: 2;
  right: -5px;
  bottom: -7px;
  left: -5px;
  height: 8px;
  border: 2px solid #252830;
  border-radius: 1px 1px 2px 1px;
  background: #fffcf4;
  box-shadow: 0 3px 0 #bccfd4;
}

.cabinet__book {
  position: relative;
  display: block;
  flex: 0 1 16px;
  min-width: 0;
  max-width: 16px;
  height: 65%;
  border: 1.5px solid #252830;
  border-radius: 1px 2px 1px 1px;
  background: #90c7d3;
  box-shadow: inset -3px 0 #57879c;
}
.cabinet__book::before, .cabinet__book::after {
  content: '';
  position: absolute;
  right: 2px;
  left: 2px;
  background: #fff5dc;
}
.cabinet__book::before { top: 7px; height: 9px; border: 1px solid #252830; }
.cabinet__book::after { bottom: 7px; height: 1px; background: #252830; }

.cabinet__caption {
  display: flex;
  width: min(100%, 265px);
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  margin: 17px auto 0;
}
.cabinet__name {
  overflow: hidden;
  color: #252830;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cabinet__count {
  flex: 0 0 auto;
  color: #718486;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 500px) {
  .cabinet-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 20px; }
  .cabinet__scene { height: 190px; }
  .cabinet__front { padding: 9px 8px 10px; }
  .cabinet__inside { padding-right: 3px; padding-left: 3px; }
  .cabinet__caption { margin-top: 12px; }
  .cabinet__name { font-size: 15px; }
}

@media (prefers-reduced-motion: reduce) {
  .cabinet__scene { transition: none; }
  .cabinet:hover .cabinet__scene, .cabinet:focus-visible .cabinet__scene { transform: none; }
}
</style>
