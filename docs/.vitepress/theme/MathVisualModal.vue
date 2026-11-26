<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { renderKatexMath } from './markdownTypora'

const props = defineProps<{
  open: boolean
  initialTex: string
  initialBlock: boolean
}>()

const emit = defineEmits<{
  close: []
  apply: [payload: { tex: string; block: boolean }]
}>()

const tex = ref('')
const isBlock = ref(true)
const activeGroup = ref<'structure' | 'calculus' | 'greek' | 'relations' | 'templates'>('structure')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const renderedHtml = computed(() => {
  const source = tex.value.trim()
  if (!source) return '<span class="math-preview-empty">在下方输入 LaTeX 或点击符号面板插入公式…</span>'
  return renderKatexMath(source, isBlock.value)
})

interface MathSnippet {
  label: string
  snippet: string
  cursorOffset?: number
  hint?: string
}

const groups: Record<typeof activeGroup.value, { title: string; items: MathSnippet[] }> = {
  structure: {
    title: '常用结构',
    items: [
      { label: 'a / b 分数', snippet: '\\frac{a}{b}', cursorOffset: 6 },
      { label: 'xⁿ 上标', snippet: '^{n}', cursorOffset: 2 },
      { label: 'xᵢ 下标', snippet: '_{i}', cursorOffset: 2 },
      { label: '√x 平方根', snippet: '\\sqrt{x}', cursorOffset: 6 },
      { label: 'ⁿ√x 次根', snippet: '\\sqrt[n]{x}', cursorOffset: 6 },
      { label: '( ) 自适应括号', snippet: '\\left(  \\right)', cursorOffset: 7 },
      { label: 'x̄ 顶线', snippet: '\\overline{x}', cursorOffset: 10 },
      { label: 'x⃗ 向量', snippet: '\\vec{x}', cursorOffset: 5 },
      { label: '矩阵 (2×2)', snippet: '\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}' },
      { label: '分段函数', snippet: '\\begin{cases}\nx, & x \\geq 0 \\\\\n-x, & x < 0\n\\end{cases}' },
      { label: '多行对齐', snippet: '\\begin{aligned}\na &= b + c \\\\\n  &= d\n\\end{aligned}' },
      { label: '粗体 \\mathbf', snippet: '\\mathbf{x}', cursorOffset: 8 }
    ]
  },
  calculus: {
    title: '微积分与求和',
    items: [
      { label: '∑ 求和', snippet: '\\sum_{i=1}^{n} ' },
      { label: '∏ 连乘', snippet: '\\prod_{i=1}^{n} ' },
      { label: '∫ 定积分', snippet: '\\int_{a}^{b} f(x)\\,dx' },
      { label: '∬ 二重积分', snippet: '\\iint_{D} ' },
      { label: 'lim 极限', snippet: '\\lim_{x \\to \\infty} ' },
      { label: '∂/∂x 偏导', snippet: '\\frac{\\partial f}{\\partial x}' },
      { label: 'd/dx 导数', snippet: '\\frac{dy}{dx}' },
      { label: '∇ 梯度', snippet: '\\nabla ' },
      { label: '∞ 无穷', snippet: '\\infty' },
      { label: 'log 对数', snippet: '\\log_{2} x' },
      { label: 'sin 正弦', snippet: '\\sin(x)' },
      { label: 'cos 余弦', snippet: '\\cos(x)' }
    ]
  },
  greek: {
    title: '希腊字母',
    items: [
      { label: 'α', snippet: '\\alpha ' },
      { label: 'β', snippet: '\\beta ' },
      { label: 'γ', snippet: '\\gamma ' },
      { label: 'δ', snippet: '\\delta ' },
      { label: 'ε', snippet: '\\varepsilon ' },
      { label: 'θ', snippet: '\\theta ' },
      { label: 'λ', snippet: '\\lambda ' },
      { label: 'μ', snippet: '\\mu ' },
      { label: 'π', snippet: '\\pi ' },
      { label: 'ρ', snippet: '\\rho ' },
      { label: 'σ', snippet: '\\sigma ' },
      { label: 'φ', snippet: '\\phi ' },
      { label: 'ω', snippet: '\\omega ' },
      { label: 'Δ', snippet: '\\Delta ' },
      { label: 'Θ', snippet: '\\Theta ' },
      { label: 'Λ', snippet: '\\Lambda ' },
      { label: 'Σ', snippet: '\\Sigma ' },
      { label: 'Ω', snippet: '\\Omega ' }
    ]
  },
  relations: {
    title: '关系与集合',
    items: [
      { label: '≤', snippet: '\\leq ' },
      { label: '≥', snippet: '\\geq ' },
      { label: '≠', snippet: '\\neq ' },
      { label: '≈', snippet: '\\approx ' },
      { label: '≡', snippet: '\\equiv ' },
      { label: '±', snippet: '\\pm ' },
      { label: '×', snippet: '\\times ' },
      { label: '·', snippet: '\\cdot ' },
      { label: '∈', snippet: '\\in ' },
      { label: '∉', snippet: '\\notin ' },
      { label: '⊂', snippet: '\\subset ' },
      { label: '∪', snippet: '\\cup ' },
      { label: '∩', snippet: '\\cap ' },
      { label: '→', snippet: '\\to ' },
      { label: '⇒', snippet: '\\Rightarrow ' },
      { label: '⇔', snippet: '\\Leftrightarrow ' },
      { label: '∀', snippet: '\\forall ' },
      { label: '∃', snippet: '\\exists ' }
    ]
  },
  templates: {
    title: '常用模板',
    items: [
      { label: '二次求根公式', snippet: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
      { label: '欧拉恒等式', snippet: 'e^{i\\pi} + 1 = 0' },
      { label: '高斯积分', snippet: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}' },
      { label: '贝叶斯定理', snippet: 'P(A \\mid B) = \\frac{P(B \\mid A) P(A)}{P(B)}' },
      { label: '正态分布密度', snippet: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{1}{2}\\left(\\frac{x-\\mu}{\\sigma}\\right)^2}' },
      { label: '注意力机制', snippet: '\\mathrm{Attention}(Q,K,V) = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V' }
    ]
  }
}

watch(() => props.open, isOpen => {
  if (!isOpen) return
  tex.value = props.initialTex || ''
  isBlock.value = props.initialBlock
  void nextTick(() => textareaRef.value?.focus())
})

function insertSnippet(item: MathSnippet) {
  const el = textareaRef.value
  if (!el) {
    tex.value += item.snippet
    return
  }
  const start = el.selectionStart
  const end = el.selectionEnd
  const before = tex.value.slice(0, start)
  const after = tex.value.slice(end)
  tex.value = before + item.snippet + after
  const nextPos = start + (item.cursorOffset ?? item.snippet.length)
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(nextPos, nextPos)
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="paper-math-modal" @click.self="emit('close')" @keydown.esc.prevent.stop="emit('close')">
      <section class="paper-math-dialog" role="dialog" aria-modal="true" aria-labelledby="math-visual-title">
        <header class="paper-math-head">
          <div>
            <span class="paper-math-kicker">LATEX · FORMULA COMPOSER</span>
            <h2 id="math-visual-title">公式可视化编辑</h2>
          </div>
          <div class="paper-math-mode" role="group" aria-label="公式显示模式">
            <button type="button" :aria-pressed="isBlock" @click="isBlock = true">公式块 $$</button>
            <button type="button" :aria-pressed="!isBlock" @click="isBlock = false">行内公式 $</button>
          </div>
          <button type="button" class="paper-math-close" aria-label="关闭公式编辑器" @click="emit('close')">×</button>
        </header>

        <div class="paper-math-preview" aria-live="polite" v-html="renderedHtml"></div>

        <div class="paper-math-palette">
          <div class="paper-math-tabs" role="tablist">
            <button
              v-for="(group, key) in groups"
              :key="key"
              type="button"
              role="tab"
              :aria-selected="activeGroup === key"
              :class="{ active: activeGroup === key }"
              @click="activeGroup = key"
            >{{ group.title }}</button>
          </div>
          <div class="paper-math-grid">
            <button
              v-for="item in groups[activeGroup].items"
              :key="item.label"
              type="button"
              class="paper-math-chip"
              :title="item.snippet"
              @mousedown.prevent
              @click="insertSnippet(item)"
            >{{ item.label }}</button>
          </div>
        </div>

        <div class="paper-math-input-wrap">
          <label for="math-tex-input">LaTeX 源码</label>
          <textarea
            id="math-tex-input"
            ref="textareaRef"
            v-model="tex"
            rows="4"
            spellcheck="false"
            placeholder="例如：\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
          ></textarea>
        </div>

        <footer class="paper-math-footer">
          <button type="button" class="paper-math-btn" @click="emit('close')">取消</button>
          <button type="button" class="paper-math-btn is-primary" :disabled="!tex.trim()" @click="emit('apply', { tex: tex.trim(), block: isBlock })">应用公式</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.paper-math-modal { position: fixed; inset: 0; z-index: 1050; display: grid; place-items: center; padding: 18px; background: rgba(0, 0, 0, 0.55); }
.paper-math-dialog {
  width: min(96vw, 760px); max-height: 90vh; overflow-y: auto; display: grid; gap: 14px;
  padding: 20px; background: var(--theme-paper, #fff); color: var(--theme-ink, #111);
  border: 2px solid var(--theme-edge, #111); border-radius: 12px;
  box-shadow: 6px 6px 0 var(--theme-edge, #111);
}
.paper-math-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 12px; border-bottom: 2px solid var(--theme-edge, #111); }
.paper-math-kicker { display: block; font: 700 10px/1.2 ui-monospace, monospace; letter-spacing: .1em; color: var(--theme-muted, #666); }
.paper-math-head h2 { margin: 3px 0 0; font-size: 18px; font-weight: 700; }
.paper-math-mode { display: flex; overflow: hidden; border: 1.5px solid var(--theme-edge, #111); border-radius: 8px; }
.paper-math-mode button { padding: 5px 11px; border: 0; background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 12px; font-weight: 600; cursor: pointer; }
.paper-math-mode button[aria-pressed="true"] { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-math-close { width: 30px; height: 30px; border: 1.5px solid var(--theme-edge, #111); border-radius: 7px; background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 19px; line-height: 1; cursor: pointer; }
.paper-math-close:hover { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-math-preview {
  min-height: 82px; padding: 16px; display: grid; place-items: center; overflow-x: auto;
  border: 1.5px solid var(--theme-edge, #111); border-radius: 9px;
  background: color-mix(in srgb, var(--theme-soft, #f4f3f0) 55%, var(--theme-paper, #fff));
  font-size: 18px;
}
.paper-math-preview :deep(.math-preview-empty) { font-size: 13px; color: var(--theme-muted, #666); }
.paper-math-palette { display: grid; gap: 8px; }
.paper-math-tabs { display: flex; flex-wrap: wrap; gap: 5px; }
.paper-math-tabs button {
  padding: 4px 10px; border: 1.5px solid var(--theme-edge, #111); border-radius: 7px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 12px; font-weight: 600; cursor: pointer;
}
.paper-math-tabs button.active { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-math-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.paper-math-chip {
  padding: 5px 10px; border: 1.5px solid var(--theme-edge, #111); border-radius: 7px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 12px; font-weight: 600; cursor: pointer;
}
.paper-math-chip:hover { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-math-input-wrap { display: grid; gap: 6px; }
.paper-math-input-wrap label { font-size: 12px; font-weight: 700; color: var(--theme-muted, #555); }
.paper-math-input-wrap textarea {
  width: 100%; padding: 10px 12px; border: 1.5px solid var(--theme-edge, #111); border-radius: 8px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111);
  font: 14px/1.65 ui-monospace, Consolas, monospace; resize: vertical;
}
.paper-math-footer { display: flex; justify-content: flex-end; gap: 10px; padding-top: 10px; border-top: 1.5px solid var(--theme-edge, #111); }
.paper-math-btn {
  padding: 6px 14px; border: 1.5px solid var(--theme-edge, #111); border-radius: 8px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.paper-math-btn:hover:not(:disabled) { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-math-btn.is-primary { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
</style>
