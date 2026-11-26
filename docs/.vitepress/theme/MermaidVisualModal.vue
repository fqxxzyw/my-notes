<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { currentPaperTheme, MERMAID_TEMPLATES, mountMermaidCard } from './mermaidRenderer'
import {
  nextNodeId,
  parseFlowchartMermaid,
  serializeFlowchartMermaid,
  type EdgeStyle,
  type FlowDirection,
  type MermaidFlowGraph,
  type NodeShape
} from './mermaidGraphModel'

const props = defineProps<{
  open: boolean
  initialCode: string
}>()

const emit = defineEmits<{
  close: []
  apply: [code: string]
}>()

const tab = ref<'visual' | 'source' | 'templates'>('visual')
const code = ref('')
const graph = ref<MermaidFlowGraph | null>(null)
const previewHost = ref<HTMLElement | null>(null)
let disposePreview: (() => void) | undefined
let renderTimer: ReturnType<typeof setTimeout> | undefined

const directions: { value: FlowDirection; label: string }[] = [
  { value: 'TD', label: '自上而下 (TD)' },
  { value: 'LR', label: '自左向右 (LR)' },
  { value: 'BT', label: '自下而上 (BT)' },
  { value: 'RL', label: '自右向左 (RL)' }
]

const shapes: { value: NodeShape; label: string }[] = [
  { value: 'rect', label: '矩形 [ ]' },
  { value: 'round', label: '圆角 ( )' },
  { value: 'diamond', label: '菱形判断 { }' },
  { value: 'stadium', label: '胶囊起止 ([ ])' },
  { value: 'circle', label: '圆形 (( ))' },
  { value: 'cylinder', label: '数据库 [( )]' }
]

const edgeStyles: { value: EdgeStyle; label: string }[] = [
  { value: 'solid', label: '实线箭头 →' },
  { value: 'dashed', label: '虚线箭头 ⇢' },
  { value: 'thick', label: '加粗箭头 ⟹' }
]

function schedulePreview() {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    disposePreview?.()
    if (!previewHost.value || !props.open) return
    disposePreview = mountMermaidCard(previewHost.value, code.value, {
      theme: currentPaperTheme(),
      showSourceToggle: false
    })
  }, 90)
}

watch(() => props.open, isOpen => {
  if (!isOpen) {
    clearTimeout(renderTimer)
    disposePreview?.()
    disposePreview = undefined
    return
  }
  code.value = props.initialCode?.trim() || MERMAID_TEMPLATES[0].code
  const parsed = parseFlowchartMermaid(code.value)
  graph.value = parsed
  tab.value = parsed ? 'visual' : 'source'
  void nextTick(schedulePreview)
})

watch(code, () => {
  if (props.open) schedulePreview()
})

function syncFromGraph() {
  if (!graph.value) return
  code.value = serializeFlowchartMermaid(graph.value)
}

function switchTab(next: 'visual' | 'source' | 'templates') {
  if (next === 'visual') {
    const parsed = parseFlowchartMermaid(code.value)
    if (parsed) {
      graph.value = parsed
      tab.value = 'visual'
    } else {
      tab.value = 'visual'
      graph.value = null
    }
  } else {
    tab.value = next
  }
}

function createNewFlowchart() {
  graph.value = {
    direction: 'TD',
    nodes: [
      { id: 'A', label: '开始', shape: 'stadium' },
      { id: 'B', label: '处理步骤', shape: 'rect' },
      { id: 'C', label: '结束', shape: 'stadium' }
    ],
    edges: [
      { from: 'A', to: 'B', style: 'solid', label: '' },
      { from: 'B', to: 'C', style: 'solid', label: '' }
    ]
  }
  syncFromGraph()
  tab.value = 'visual'
}

function addNode() {
  if (!graph.value) return
  const id = nextNodeId(graph.value.nodes)
  const prev = graph.value.nodes[graph.value.nodes.length - 1]
  graph.value.nodes.push({ id, label: `节点 ${id}`, shape: 'rect' })
  if (prev) {
    graph.value.edges.push({ from: prev.id, to: id, style: 'solid', label: '' })
  }
  syncFromGraph()
}

function removeNode(id: string) {
  if (!graph.value || graph.value.nodes.length <= 1) return
  graph.value.nodes = graph.value.nodes.filter(n => n.id !== id)
  graph.value.edges = graph.value.edges.filter(e => e.from !== id && e.to !== id)
  syncFromGraph()
}

function addEdge() {
  if (!graph.value || graph.value.nodes.length < 2) return
  const first = graph.value.nodes[0].id
  const last = graph.value.nodes[graph.value.nodes.length - 1].id
  graph.value.edges.push({ from: first, to: last, style: 'solid', label: '' })
  syncFromGraph()
}

function removeEdge(idx: number) {
  if (!graph.value) return
  graph.value.edges.splice(idx, 1)
  syncFromGraph()
}

function pickTemplate(tplCode: string) {
  code.value = tplCode
  graph.value = parseFlowchartMermaid(tplCode)
  tab.value = graph.value ? 'visual' : 'source'
}

onBeforeUnmount(() => {
  clearTimeout(renderTimer)
  disposePreview?.()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="paper-visual-modal" @click.self="emit('close')" @keydown.esc.prevent.stop="emit('close')">
      <section class="paper-visual-dialog paper-visual-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="mermaid-visual-title">
        <header class="paper-visual-head">
          <div>
            <span class="paper-visual-kicker">MERMAID · VISUAL DIAGRAM STUDIO</span>
            <h2 id="mermaid-visual-title">可视化节点图编辑</h2>
          </div>
          <div class="paper-visual-tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="tab === 'visual'" :class="{ active: tab === 'visual' }" @click="switchTab('visual')">可视化节点</button>
            <button type="button" role="tab" :aria-selected="tab === 'source'" :class="{ active: tab === 'source' }" @click="switchTab('source')">Mermaid 源码</button>
            <button type="button" role="tab" :aria-selected="tab === 'templates'" :class="{ active: tab === 'templates' }" @click="switchTab('templates')">快捷模板</button>
          </div>
          <button type="button" class="paper-visual-close" aria-label="关闭节点图编辑器" @click="emit('close')">×</button>
        </header>

        <div class="paper-visual-body">
          <div class="paper-visual-editor-col">
            <template v-if="tab === 'visual'">
              <div v-if="!graph" class="paper-visual-notice">
                <p>当前图表属于高级类型（如时序图、思维导图、状态图或甘特图），请使用「Mermaid 源码」标签实时编辑，或新建可视化流程图。</p>
                <div class="paper-visual-notice-actions">
                  <button type="button" class="paper-ui-btn" @click="tab = 'source'">切换到源码编辑</button>
                  <button type="button" class="paper-ui-btn is-primary" @click="createNewFlowchart">新建可视化流程图</button>
                </div>
              </div>
              <template v-else>
                <div class="paper-flow-section">
                  <div class="paper-flow-row-head">
                    <strong>布局方向</strong>
                    <select v-model="graph.direction" class="paper-ui-select" @change="syncFromGraph">
                      <option v-for="d in directions" :key="d.value" :value="d.value">{{ d.label }}</option>
                    </select>
                  </div>
                </div>

                <div class="paper-flow-section">
                  <div class="paper-flow-row-head">
                    <strong>节点列表（{{ graph.nodes.length }}）</strong>
                    <button type="button" class="paper-ui-btn" @click="addNode">＋ 添加节点</button>
                  </div>
                  <div class="paper-flow-list">
                    <div v-for="node in graph.nodes" :key="node.id" class="paper-flow-item">
                      <span class="paper-flow-id">{{ node.id }}</span>
                      <input v-model="node.label" type="text" class="paper-ui-input" placeholder="节点文字" @input="syncFromGraph">
                      <select v-model="node.shape" class="paper-ui-select" @change="syncFromGraph">
                        <option v-for="s in shapes" :key="s.value" :value="s.value">{{ s.label }}</option>
                      </select>
                      <button type="button" class="paper-ui-icon-btn" :disabled="graph.nodes.length <= 1" title="删除节点" @click="removeNode(node.id)">×</button>
                    </div>
                  </div>
                </div>

                <div class="paper-flow-section">
                  <div class="paper-flow-row-head">
                    <strong>连线关系（{{ graph.edges.length }}）</strong>
                    <button type="button" class="paper-ui-btn" :disabled="graph.nodes.length < 2" @click="addEdge">＋ 添加连线</button>
                  </div>
                  <div class="paper-flow-list">
                    <div v-for="(edge, idx) in graph.edges" :key="idx" class="paper-flow-item paper-flow-edge-item">
                      <select v-model="edge.from" class="paper-ui-select" aria-label="起点" @change="syncFromGraph">
                        <option v-for="n in graph.nodes" :key="n.id" :value="n.id">{{ n.id }}: {{ n.label }}</option>
                      </select>
                      <select v-model="edge.style" class="paper-ui-select" aria-label="连线样式" @change="syncFromGraph">
                        <option v-for="es in edgeStyles" :key="es.value" :value="es.value">{{ es.label }}</option>
                      </select>
                      <select v-model="edge.to" class="paper-ui-select" aria-label="终点" @change="syncFromGraph">
                        <option v-for="n in graph.nodes" :key="n.id" :value="n.id">{{ n.id }}: {{ n.label }}</option>
                      </select>
                      <input v-model="edge.label" type="text" class="paper-ui-input" placeholder="连线说明（选填）" @input="syncFromGraph">
                      <button type="button" class="paper-ui-icon-btn" title="删除连线" @click="removeEdge(idx)">×</button>
                    </div>
                  </div>
                </div>
              </template>
            </template>

            <template v-else-if="tab === 'source'">
              <label class="paper-visual-label" for="mermaid-source-textarea">Mermaid 语法代码（右侧实时渲染）</label>
              <textarea
                id="mermaid-source-textarea"
                v-model="code"
                class="paper-visual-textarea"
                spellcheck="false"
                rows="15"
                placeholder="输入 Mermaid 代码，例如 flowchart TD ..."
              ></textarea>
            </template>

            <template v-else>
              <div class="paper-template-grid">
                <button v-for="tpl in MERMAID_TEMPLATES" :key="tpl.id" type="button" class="paper-template-card" @click="pickTemplate(tpl.code)">
                  <strong>{{ tpl.label }}</strong>
                  <pre>{{ tpl.code }}</pre>
                </button>
              </div>
            </template>
          </div>

          <div class="paper-visual-preview-col">
            <span class="paper-visual-label">实时预览</span>
            <div ref="previewHost" class="paper-visual-preview-box"></div>
          </div>
        </div>

        <footer class="paper-visual-footer">
          <button type="button" class="paper-ui-btn" @click="emit('close')">取消</button>
          <button type="button" class="paper-ui-btn is-primary" :disabled="!code.trim()" @click="emit('apply', code.trim())">应用到文档</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.paper-visual-modal { position: fixed; inset: 0; z-index: 1050; display: grid; place-items: center; padding: 18px; background: rgba(0, 0, 0, 0.55); }
.paper-visual-dialog {
  width: min(96vw, 1020px); max-height: 90vh; display: flex; flex-direction: column;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111);
  border: 2px solid var(--theme-edge, #111); border-radius: 12px;
  box-shadow: 6px 6px 0 var(--theme-edge, #111); overflow: hidden;
}
.paper-visual-head {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 20px; border-bottom: 2px solid var(--theme-edge, #111);
}
.paper-visual-kicker { display: block; font: 700 10px/1.2 ui-monospace, monospace; letter-spacing: .1em; color: var(--theme-muted, #666); }
.paper-visual-head h2 { margin: 3px 0 0; font-size: 18px; font-weight: 700; }
.paper-visual-tabs { display: flex; gap: 4px; padding: 3px; border: 1.5px solid var(--theme-edge, #111); border-radius: 8px; background: var(--theme-soft, #f3f3f1); }
.paper-visual-tabs button { padding: 5px 11px; border: 0; border-radius: 6px; background: transparent; color: var(--theme-ink, #111); font-size: 12px; font-weight: 600; cursor: pointer; }
.paper-visual-tabs button.active { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-visual-close {
  width: 30px; height: 30px; border: 1.5px solid var(--theme-edge, #111); border-radius: 7px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 19px; line-height: 1; cursor: pointer;
}
.paper-visual-close:hover { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-visual-body {
  flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px; padding: 16px 20px; overflow-y: auto;
}
.paper-visual-editor-col, .paper-visual-preview-col { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.paper-visual-label { font-size: 12px; font-weight: 700; color: var(--theme-muted, #555); }
.paper-visual-preview-box { min-height: 260px; }
.paper-flow-section { padding: 12px; border: 1.5px solid var(--theme-edge, #111); border-radius: 9px; background: color-mix(in srgb, var(--theme-soft, #f4f3f0) 45%, var(--theme-paper, #fff)); display: grid; gap: 10px; }
.paper-flow-row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
.paper-flow-list { display: grid; gap: 8px; max-height: 210px; overflow-y: auto; padding-right: 2px; }
.paper-flow-item { display: grid; grid-template-columns: 32px minmax(0, 1fr) 128px 28px; gap: 6px; align-items: center; }
.paper-flow-edge-item { grid-template-columns: minmax(0, 1fr) 104px minmax(0, 1fr) minmax(0, 0.9fr) 28px; }
.paper-flow-id {
  display: grid; place-items: center; height: 30px; border: 1.5px solid var(--theme-edge, #111);
  border-radius: 6px; background: var(--theme-paper, #fff); font: 700 11px ui-monospace, monospace;
}
.paper-ui-input, .paper-ui-select {
  min-width: 0; height: 32px; padding: 0 9px; border: 1.5px solid var(--theme-edge, #111);
  border-radius: 7px; background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 12px;
}
.paper-ui-icon-btn {
  width: 28px; height: 28px; border: 1.5px solid var(--theme-edge, #111); border-radius: 6px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 15px; line-height: 1; cursor: pointer;
}
.paper-ui-icon-btn:hover:not(:disabled) { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-ui-icon-btn:disabled { opacity: .4; cursor: default; }
.paper-visual-textarea {
  width: 100%; min-height: 300px; padding: 12px; border: 1.5px solid var(--theme-edge, #111);
  border-radius: 9px; background: var(--theme-paper, #fff); color: var(--theme-ink, #111);
  font: 13px/1.7 ui-monospace, Consolas, monospace; resize: vertical;
}
.paper-template-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.paper-template-card {
  text-align: left; padding: 10px; border: 1.5px solid var(--theme-edge, #111); border-radius: 9px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); cursor: pointer; display: grid; gap: 6px;
}
.paper-template-card:hover { background: var(--theme-soft, #f3f3f1); box-shadow: 3px 3px 0 var(--theme-edge, #111); transform: translate(-1px, -1px); }
.paper-template-card strong { font-size: 12.5px; }
.paper-template-card pre { margin: 0; max-height: 82px; overflow: hidden; font: 11px/1.4 ui-monospace, monospace; color: var(--theme-muted, #555); }
.paper-visual-notice { padding: 14px; border: 1.5px dashed var(--theme-edge, #111); border-radius: 9px; font-size: 13px; display: grid; gap: 10px; }
.paper-visual-notice-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.paper-visual-footer {
  display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px;
  border-top: 1.5px solid var(--theme-edge, #111);
}
.paper-ui-btn {
  padding: 6px 14px; border: 1.5px solid var(--theme-edge, #111); border-radius: 8px;
  background: var(--theme-paper, #fff); color: var(--theme-ink, #111); font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.paper-ui-btn:hover:not(:disabled) { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-ui-btn.is-primary { background: var(--theme-ink, #111); color: var(--theme-paper, #fff); }
.paper-ui-btn.is-primary:hover:not(:disabled) { opacity: .88; }
@media (max-width: 820px) {
  .paper-visual-body { grid-template-columns: 1fr; }
  .paper-flow-edge-item { grid-template-columns: 1fr 1fr; }
}
</style>
