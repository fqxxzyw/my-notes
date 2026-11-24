<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  displayFileName,
  documentMimeType,
  extractDocxPreview,
  extractPptxPreview,
  extractXlsxPreview,
  formatBadgeLabel,
  formatFileSize,
  formatKindCaption,
  getDocumentFile,
  normalizeFileExt,
  openDocumentExternally,
  parseCsvPreview,
  type PptxSlidePreview
} from './documentFiles'

const props = defineProps<{
  repository?: string | null
  title: string
  ext: string
  filePath?: string
  fileSize?: number
  isDesktop?: boolean
}>()

const loading = ref(false)
const loadError = ref('')
const openError = ref('')
const opening = ref(false)
const fileBytes = ref<Uint8Array | null>(null)
const pdfUrl = ref('')
const docxHtml = ref('')
const pptxSlides = ref<PptxSlidePreview[]>([])
const xlsxSheets = ref<Array<{ name: string; rows: string[][] }>>([])
const activeSheetIndex = ref(0)
const csvRows = ref<string[][]>([])
let ownedUrls: string[] = []
let loadToken = 0

const normalizedExt = computed(() => normalizeFileExt(props.ext))
const badgeLabel = computed(() => formatBadgeLabel(props.ext))
const kindCaption = computed(() => formatKindCaption(props.ext))
const fullFileName = computed(() => displayFileName(props.title, props.ext))
const sizeText = computed(() => formatFileSize(fileBytes.value?.length ?? props.fileSize))

function revokeOwnedUrls() {
  for (const url of ownedUrls) URL.revokeObjectURL(url)
  ownedUrls = []
  pdfUrl.value = ''
}

function resetPreviewState() {
  revokeOwnedUrls()
  loadError.value = ''
  openError.value = ''
  fileBytes.value = null
  docxHtml.value = ''
  pptxSlides.value = []
  xlsxSheets.value = []
  activeSheetIndex.value = 0
  csvRows.value = []
}

async function loadDocument() {
  const token = ++loadToken
  resetPreviewState()
  if (!props.filePath) {
    loadError.value = '缺少文档文件记录，请重新导入或从 GitHub 恢复。'
    return
  }
  loading.value = true
  try {
    const stored = await getDocumentFile(props.repository, props.filePath)
    if (token !== loadToken) return
    if (!stored) {
      loadError.value = '本机未找到该文档内容；如果曾在其他设备同步，请点击顶部“恢复”按钮下载。'
      return
    }
    fileBytes.value = stored.bytes
    const ext = normalizedExt.value
    if (ext === 'pdf') {
      const url = URL.createObjectURL(new Blob([stored.bytes], { type: 'application/pdf' }))
      ownedUrls.push(url)
      pdfUrl.value = url
    } else if (ext === 'docx') {
      try {
        const preview = extractDocxPreview(stored.bytes)
        ownedUrls.push(...preview.objectUrls)
        docxHtml.value = preview.html
      } catch (e) {
        loadError.value = `无法内嵌预览此 DOCX（${e instanceof Error ? e.message : '格式不兼容'}），请点击上方“用系统默认程序打开”查看。`
      }
    } else if (ext === 'pptx') {
      try {
        const preview = extractPptxPreview(stored.bytes)
        ownedUrls.push(...preview.objectUrls)
        pptxSlides.value = preview.slides
      } catch (e) {
        loadError.value = `无法内嵌预览此 PPTX（${e instanceof Error ? e.message : '格式不兼容'}），请点击上方“用系统默认程序打开”查看。`
      }
    } else if (ext === 'xlsx') {
      try {
        const preview = extractXlsxPreview(stored.bytes)
        xlsxSheets.value = preview.sheets
      } catch (e) {
        loadError.value = `无法内嵌预览此 XLSX（${e instanceof Error ? e.message : '格式不兼容'}），请点击上方“用系统默认程序打开”查看。`
      }
    } else if (ext === 'csv') {
      csvRows.value = parseCsvPreview(stored.bytes)
    }
  } catch (e) {
    if (token === loadToken) {
      loadError.value = e instanceof Error ? e.message : '无法读取本机文档。'
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function openExternal() {
  if (!props.filePath || opening.value) return
  openError.value = ''
  opening.value = true
  try {
    await openDocumentExternally(props.repository, props.filePath, fullFileName.value)
  } catch (e) {
    openError.value = e instanceof Error ? e.message : '无法调用系统默认程序打开文档。'
  } finally {
    opening.value = false
  }
}

function downloadCopy() {
  if (!fileBytes.value) return
  const url = URL.createObjectURL(new Blob([fileBytes.value], { type: documentMimeType(props.ext) }))
  const link = document.createElement('a')
  link.href = url
  link.download = fullFileName.value
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

watch(() => [props.repository, props.filePath, props.ext], () => { void loadDocument() }, { immediate: true })
onBeforeUnmount(() => { loadToken++; revokeOwnedUrls() })
</script>

<template>
  <div class="doc-viewer">
    <div class="doc-viewer-bar">
      <div class="doc-viewer-meta">
        <span class="paper-ext-pill">{{ badgeLabel }}</span>
        <strong class="doc-viewer-name" :title="fullFileName">{{ fullFileName }}</strong>
        <span v-if="sizeText" class="doc-viewer-size">{{ sizeText }}</span>
        <span class="doc-viewer-badge">只读 · 不支持编辑</span>
      </div>
      <div class="doc-viewer-actions">
        <button v-if="isDesktop" type="button" class="doc-btn doc-btn-primary" :disabled="opening || !filePath" @click="openExternal">
          {{ opening ? '正在打开…' : '用系统默认程序打开 ↗' }}
        </button>
        <button type="button" class="doc-btn" :disabled="!fileBytes" @click="downloadCopy">另存为 / 下载</button>
      </div>
    </div>

    <p v-if="openError" class="doc-notice doc-error" role="alert">{{ openError }}</p>
    <p v-if="loading" class="doc-notice" role="status">正在加载文档预览…</p>
    <p v-else-if="loadError" class="doc-notice doc-error" role="alert">{{ loadError }}</p>

    <template v-else-if="fileBytes">
      <!-- PDF embedded viewer (Edge/WebView2 native PDF reader) -->
      <div v-if="normalizedExt === 'pdf' && pdfUrl" class="doc-pdf-shell">
        <iframe class="doc-pdf-frame" :src="pdfUrl" :title="fullFileName" />
      </div>

      <!-- DOCX offline rendered preview -->
      <article v-else-if="normalizedExt === 'docx' && docxHtml" class="doc-docx-body vp-doc" v-html="docxHtml" />

      <!-- PPTX slide deck preview -->
      <div v-else-if="normalizedExt === 'pptx' && pptxSlides.length" class="doc-pptx-deck">
        <section v-for="slide in pptxSlides" :key="slide.index" class="doc-slide-card">
          <div class="doc-slide-header">
            <span class="doc-slide-num">SLIDE {{ String(slide.index).padStart(2, '0') }}</span>
            <h3>{{ slide.title }}</h3>
          </div>
          <div class="doc-slide-body">
            <ul v-if="slide.paragraphs.length" class="doc-slide-list">
              <li v-for="(line, idx) in slide.paragraphs" :key="idx">{{ line }}</li>
            </ul>
            <div v-for="(tbl, tIdx) in slide.tables" :key="tIdx" class="paper-table-wrap">
              <div class="paper-table-scroll">
                <table>
                  <tbody>
                    <tr v-for="(row, rIdx) in tbl" :key="rIdx">
                      <component :is="rIdx === 0 ? 'th' : 'td'" v-for="(cell, cIdx) in row" :key="cIdx">{{ cell }}</component>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-if="slide.images.length" class="doc-slide-images">
              <img v-for="(src, iIdx) in slide.images" :key="iIdx" :src="src" alt="幻灯片图片">
            </div>
            <p v-if="!slide.paragraphs.length && !slide.tables.length && !slide.images.length" class="doc-empty-hint">（此页无可提取文字或图片，可用系统默认程序查看完整版式）</p>
          </div>
        </section>
      </div>

      <!-- XLSX multi-sheet preview -->
      <div v-else-if="normalizedExt === 'xlsx' && xlsxSheets.length" class="doc-sheet-viewer">
        <div v-if="xlsxSheets.length > 1" class="doc-sheet-tabs" role="tablist">
          <button
            v-for="(sheet, idx) in xlsxSheets"
            :key="sheet.name + idx"
            type="button"
            role="tab"
            :aria-selected="activeSheetIndex === idx"
            :class="{ active: activeSheetIndex === idx }"
            @click="activeSheetIndex = idx"
          >{{ sheet.name }}</button>
        </div>
        <div class="paper-table-wrap">
          <div class="paper-table-scroll">
            <table>
              <tbody>
                <tr v-for="(row, rIdx) in xlsxSheets[activeSheetIndex]?.rows || []" :key="rIdx">
                  <component :is="rIdx === 0 ? 'th' : 'td'" v-for="(cell, cIdx) in row" :key="cIdx">{{ cell }}</component>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- CSV table preview -->
      <div v-else-if="normalizedExt === 'csv' && csvRows.length" class="paper-table-wrap">
        <div class="paper-table-scroll">
          <table>
            <tbody>
              <tr v-for="(row, rIdx) in csvRows" :key="rIdx">
                <component :is="rIdx === 0 ? 'th' : 'td'" v-for="(cell, cIdx) in row" :key="cIdx">{{ cell }}</component>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Fallback card for legacy binary formats (.doc / .ppt / .xls / .rtf) -->
      <div v-else class="doc-fallback-card">
        <div class="doc-fallback-icon">{{ badgeLabel }}</div>
        <h3>{{ fullFileName }}</h3>
        <p>{{ kindCaption }} · {{ sizeText || '已保存于本机' }}</p>
        <p class="doc-fallback-desc">
          此类外部文件在「纸间」中作为只读归档保存（仅 <code>.md</code> 和 <code>.txt</code> 支持直接编辑）。
          {{ isDesktop ? '你可以直接调用 Windows 系统默认程序打开完整版式，或另存一份副本。' : '请点击上方“另存为 / 下载”使用本地软件查看完整内容。' }}
        </p>
        <div class="doc-fallback-actions">
          <button v-if="isDesktop" type="button" class="doc-btn doc-btn-primary" :disabled="opening" @click="openExternal">
            {{ opening ? '正在打开…' : '用系统默认程序打开 ↗' }}
          </button>
          <button type="button" class="doc-btn" @click="downloadCopy">另存为 / 下载</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.doc-viewer {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.doc-viewer-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 8px;
  background: var(--theme-soft, #f4f3f0);
}
.doc-viewer-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.doc-viewer-name {
  font-size: 14px;
  color: var(--theme-ink, #111);
  overflow-wrap: anywhere;
}
.doc-viewer-size {
  font: 600 11px/1.3 ui-monospace, Consolas, monospace;
  color: var(--theme-muted, #555);
}
.doc-viewer-badge {
  padding: 2px 7px;
  border: 1px dashed var(--theme-edge, #111);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--theme-muted, #555);
}
.doc-viewer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.doc-btn {
  padding: 6px 12px;
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 6px;
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.doc-btn:hover:not(:disabled) {
  background: var(--theme-ink, #111);
  color: var(--theme-paper, #fff);
}
.doc-btn-primary {
  background: var(--theme-ink, #111);
  color: var(--theme-paper, #fff);
}
.doc-btn-primary:hover:not(:disabled) {
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
}
.doc-notice {
  margin: 0;
  padding: 10px 14px;
  border-left: 3px solid var(--theme-edge, #111);
  background: var(--theme-soft, #f4f3f0);
  color: var(--theme-muted, #555);
  font-size: 13px;
}
.doc-error {
  border-left-color: #a12626;
  color: #a12626;
}
.doc-pdf-shell {
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 8px;
  overflow: hidden;
  background: var(--theme-soft, #f4f3f0);
}
.doc-pdf-frame {
  display: block;
  width: 100%;
  height: max(72vh, 580px);
  border: 0;
}
.doc-docx-body {
  line-height: 1.85;
  color: var(--theme-ink, #111);
  overflow-wrap: anywhere;
}
.doc-docx-body :deep(.docx-list-item) {
  padding-left: 1.1em;
}
.doc-docx-body :deep(.docx-img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 12px 0;
  border: 1px solid var(--theme-edge, #111);
  border-radius: 4px;
}
.doc-pptx-deck {
  display: grid;
  gap: 18px;
}
.doc-slide-card {
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 8px;
  background: var(--theme-paper, #fff);
  overflow: hidden;
  box-shadow: 3px 3px 0 color-mix(in srgb, var(--theme-edge, #111) 25%, transparent);
}
.doc-slide-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1.5px solid var(--theme-edge, #111);
  background: var(--theme-soft, #f4f3f0);
}
.doc-slide-num {
  flex: none;
  padding: 2px 6px;
  border: 1px solid var(--theme-edge, #111);
  border-radius: 4px;
  font: 700 10px/1.2 ui-monospace, Consolas, monospace;
}
.doc-slide-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--theme-ink, #111);
}
.doc-slide-body {
  padding: 16px 18px;
  display: grid;
  gap: 12px;
}
.doc-slide-list {
  margin: 0;
  padding-left: 1.3em;
  line-height: 1.8;
}
.doc-slide-images {
  display: grid;
  gap: 10px;
}
.doc-slide-images img {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--theme-edge, #111);
  border-radius: 4px;
}
.doc-sheet-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.doc-sheet-tabs button {
  padding: 5px 12px;
  border: 1.5px solid var(--theme-edge, #111);
  border-radius: 5px;
  background: var(--theme-paper, #fff);
  color: var(--theme-ink, #111);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.doc-sheet-tabs button.active {
  background: var(--theme-ink, #111);
  color: var(--theme-paper, #fff);
}
.doc-fallback-card {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 10px;
  padding: 40px 24px;
  border: 1.5px dashed var(--theme-edge, #111);
  border-radius: 10px;
  background: color-mix(in srgb, var(--theme-soft, #f4f3f0) 45%, var(--theme-paper, #fff));
}
.doc-fallback-icon {
  display: grid;
  place-items: center;
  width: 68px;
  height: 78px;
  border: 2px solid var(--theme-edge, #111);
  border-radius: 6px;
  background: var(--theme-paper, #fff);
  box-shadow: 3px 3px 0 var(--theme-edge, #111);
  font: 700 15px/1 ui-monospace, Consolas, monospace;
}
.doc-fallback-card h3 {
  margin: 4px 0 0;
  font-size: 18px;
  overflow-wrap: anywhere;
}
.doc-fallback-desc {
  max-width: 480px;
  margin: 0;
  color: var(--theme-muted, #555);
  font-size: 13px;
  line-height: 1.7;
}
.doc-fallback-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 6px;
}
.doc-empty-hint {
  margin: 0;
  color: var(--theme-muted, #666);
  font-size: 13px;
}
</style>
