<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { createNotebookStore, chapterIdFromTitle, pageIdFromTitle, type Notebook, type Chapter, type Page } from './notebookStore'
import { normalizeRepository, parseRepository, namespaceKey, getConfiguredRepository, setConfiguredRepository } from './repository'
import ChapterMarkdown from './ChapterMarkdown.vue'
import MarkdownEditor, { type EditorDisplayMode } from './MarkdownEditor.vue'
import PlainTextEditor from './PlainTextEditor.vue'
import DocumentViewer from './DocumentViewer.vue'
import CollapsedOutlineRail from './CollapsedOutlineRail.vue'
import BookShelf from './BookShelf.vue'
import CabinetGallery from './CabinetGallery.vue'
import { useCabinets } from './useCabinets'
import { readRemoteCache, writeRemoteCache, clearRemoteCache, type RemoteSnapshot } from './remoteCache'
import { addWelcomeNotebook } from './welcomeStore'
import { prepareWelcomeImport, type WelcomeCandidate } from './welcomeDuplicate'
import { markdownOutline } from './markdownOutline'
import OutlineTree from './OutlineTree.vue'
import ChapterOrderList from './ChapterOrderList.vue'
import ThemePicker from './ThemePicker.vue'
import SettingsModal from './SettingsModal.vue'
import { createSyncIndicator, type TransferState } from './syncIndicator'
import { hasUserData } from './workspaceData'
import { localImageReferences, readDroppedMarkdown, type DroppedMarkdownResult } from './readDroppedMarkdown'
import { pickDesktopImportFiles, pickDesktopImportFolder, pickDesktopMarkdownFiles, pickDesktopMarkdownFolder, resolveDesktopImportedImages } from './desktopImportImages'
import { chapterDisplayInfo, compareImportedPaths, decodeEncodedChapterPath, sortChapters, validateChapterOrder } from './notebookChapterOrder'
import { prepareLocalCollection, assertLocalMetadataWritable, restoreNotebookBase } from './localMetadataSafety'
import { newAttachmentPath, putAttachment, getAttachment, attachmentMime, MAX_ATTACHMENT_BYTES, type NoteAttachment } from './attachmentStore'
import { attachmentReferences, workspaceAttachmentPaths, workspaceEntriesMatch } from './attachmentReferences'
import { applyImageUrls } from './imageUrls'
import { rewriteImportedImages } from './rewriteImportedImages'
import { finishAttachmentRestore } from './attachmentRestore'
import { BINARY_DOCUMENT_EXTENSIONS, displayFileName, formatBadgeLabel, getDocumentFile, isBinaryDocumentExt, isEditableExt, isMarkdownExt, isPlainTextExt, newDocumentPath, normalizeFileExt, putDocumentFile, stripSupportedExtension, type StoredDocumentFile } from './documentFiles'
import { cleanMarkdownTitle, extractMarkdownTitle, validateRenameTitle, writeMarkdownDocumentTitle, writeNotebookIndexTitle } from './notebookTitle'
import { normalizeHeadingKey, parseMarkdownLinkHref, resolveMarkdownTarget, type LinkableItem } from './markdownLinks'
import { computeDocumentStats, toggleMarkdownTaskAtIndex } from './markdownStats'
import { exportMarkdownFile, exportStandaloneHtml } from './exportDocument'
import { currentPaperTheme } from './mermaidRenderer'
import { ensureShelfAudioUnlocked } from './shelfAudio'
import {
  base64ToBytes,
  bytesToBase64,
  decodeShareInput,
  encodeGitHubShareLink,
  encodeShareLink,
  MAX_OFFLINE_RAW_BYTES,
  MAX_OFFLINE_SINGLE_IMAGE_BYTES,
  MAX_OFFLINE_TOTAL_IMAGE_BYTES,
  stripShareAttachments,
  summarizeSharePayload,
  type GitHubShareRef,
  type PaperSharePayloadV1,
  type SharedAttachment,
  type SharedBook,
  type SharedChapter,
  type SharedPage,
  type ShareSummary
} from './shareLink'

const themePickerRef = ref<InstanceType<typeof ThemePicker> | null>(null)
const settingsModalRef = ref<InstanceType<typeof SettingsModal> | null>(null)
const headerMenuOpen = ref(false)
const folderImportMode = ref<'book' | 'cabinet'>('book')
const editorDisplayMode = ref<EditorDisplayMode>('visual')
const showBackToTop = ref(false)

function selectEditorMode(mode: EditorDisplayMode) {
  if (mode === 'read') {
    view.value = 'read'
    return
  }
  editorDisplayMode.value = mode
  view.value = 'edit'
}

function handleWindowScroll() {
  showBackToTop.value = typeof window !== 'undefined' && window.scrollY > 360
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function displayChapterItem(chapter: Chapter) {
  const cleaned = isMarkdownExt(chapter.ext) ? (cleanMarkdownTitle(chapter.title) || chapter.title) : chapter.title
  return chapterDisplayInfo(chapter, cleaned)
}

// Full-hierarchy Share Dialog state (Cabinet / Bookshelf / Book / Chapter / Page)
const shareModal = ref<null | {
  payload: PaperSharePayloadV1
  summary: ShareSummary
  githubLink: string | null
  omittedBinaryCount: number
  omittedLargeImages: number
  offlineBlockedReason: string
}>(null)
const shareMode = ref<'offline' | 'github'>('offline')
const shareIncludeImages = ref(true)
const shareCopied = ref(false)
const shareLinkTextarea = ref<HTMLTextAreaElement | null>(null)

const activeShareLink = computed(() => {
  const modal = shareModal.value
  if (!modal) return { link: '', webUrl: '', tooLarge: false, overMemoryLimit: false, rawBytes: 0, charLength: 0 }
  if (shareMode.value === 'github' && modal.githubLink) {
    return { link: modal.githubLink, webUrl: '', tooLarge: false, overMemoryLimit: false, rawBytes: 0, charLength: modal.githubLink.length }
  }
  if (modal.offlineBlockedReason) {
    return { link: '', webUrl: '', tooLarge: true, overMemoryLimit: true, rawBytes: MAX_OFFLINE_RAW_BYTES + 1, charLength: 0 }
  }
  const sourcePayload = shareIncludeImages.value ? modal.payload : stripShareAttachments(modal.payload)
  const encoded = encodeShareLink(sourcePayload, {
    webOriginUrl: typeof window !== 'undefined' ? window.location.href : undefined
  })
  return {
    link: encoded.overMemoryLimit ? '' : (encoded.webUrl || encoded.uri),
    uri: encoded.uri,
    webUrl: encoded.webUrl || '',
    tooLarge: encoded.tooLarge,
    overMemoryLimit: encoded.overMemoryLimit,
    rawBytes: encoded.rawBytes,
    charLength: encoded.charLength
  }
})

function formatShareKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

// Share Link Import state inside Import modal
const shareImportInput = ref('')
const shareImportError = ref('')
const shareImportLoading = ref(false)
const shareImportTargetCabinet = ref('')
const shareImportChapterMode = ref<'current-book' | 'standalone-page'>('standalone-page')
const pendingShareImport = ref<null | { payload: PaperSharePayloadV1; summary: ShareSummary; sourceLabel: string }>(null)

function currentChapterText(chapter: Chapter): string {
  if (selectedChapter.value && chapterKey(selectedChapter.value) === chapterKey(chapter)) {
    return content.value
  }
  return drafts.value[chapterKey(chapter)]?.content ?? chapter.content
}

interface ShareMemoryBudget {
  textBytes: number
  imageBytes: number
  textExceeded: boolean
}

function estimateUtf8Bytes(text: string): number {
  return text ? new TextEncoder().encode(text).length : 0
}

async function collectSharedAttachments(
  bookId: string | null,
  markdowns: string[],
  budget: ShareMemoryBudget
): Promise<{ attachments: SharedAttachment[]; omittedLarge: number }> {
  const seen = new Set<string>()
  const attachments: SharedAttachment[] = []
  let omittedLarge = 0
  for (const md of markdowns) {
    if (!md) continue
    for (const ref of attachmentReferences(md, bookId)) {
      if (seen.has(ref.src)) continue
      seen.add(ref.src)
      // Hard early-exit memory guard: stop reading image bytes once total offline image budget is reached!
      if (budget.imageBytes >= MAX_OFFLINE_TOTAL_IMAGE_BYTES || budget.textBytes + Math.ceil(budget.imageBytes * 1.37) >= MAX_OFFLINE_RAW_BYTES) {
        omittedLarge++
        continue
      }
      try {
        let local = await getAttachment(initialRepository, ref.path)
        if (!local && connected.value && !offlineMode.value) {
          local = await store.readAttachment(ref.path)
        }
        if (!local) continue
        if (
          local.bytes.length > MAX_OFFLINE_SINGLE_IMAGE_BYTES ||
          budget.imageBytes + local.bytes.length > MAX_OFFLINE_TOTAL_IMAGE_BYTES ||
          budget.textBytes + Math.ceil((budget.imageBytes + local.bytes.length) * 1.37) > MAX_OFFLINE_RAW_BYTES
        ) {
          omittedLarge++
          continue
        }
        const mime = attachmentMime(ref.path) as SharedAttachment['mime']
        budget.imageBytes += local.bytes.length
        attachments.push({ relPath: ref.src, mime, base64: bytesToBase64(local.bytes) })
      } catch { /* skip unreadable attachment without aborting share */ }
    }
  }
  return { attachments, omittedLarge }
}

function presentShareModal(
  payload: PaperSharePayloadV1,
  githubLink: string | null,
  omittedBinaryCount: number,
  omittedLargeImages: number,
  offlineBlockedReason = '',
  summaryOverride?: ShareSummary
) {
  const summary = summaryOverride || summarizeSharePayload(payload)
  shareModal.value = { payload, summary, githubLink, omittedBinaryCount, omittedLargeImages, offlineBlockedReason }
  shareIncludeImages.value = !offlineBlockedReason && summary.imageCount > 0
  shareCopied.value = false
  if (offlineBlockedReason) {
    shareMode.value = githubLink ? 'github' : 'offline'
    return
  }
  // Auto-prefer GitHub short link if offline payload exceeds safe size and GitHub link is available.
  const probe = encodeShareLink(payload)
  if ((probe.tooLarge || probe.overMemoryLimit) && githubLink) {
    shareMode.value = 'github'
  } else {
    shareMode.value = 'offline'
    if ((probe.tooLarge || probe.overMemoryLimit) && summary.imageCount > 0) shareIncludeImages.value = false
  }
}

async function openShareCabinet(cabinetId: string) {
  const cab = catalog.cabinets.value.find(c => c.id === cabinetId)
  if (!cab) return
  clearMessages()
  await run(async () => {
    const cabItems = books.value.filter(b => catalog.assigned(b.id) === cabinetId)
    const sharedBooks: SharedBook[] = []
    const sharedPages: SharedPage[] = []
    let omittedBinaryCount = 0
    let omittedLargeImages = 0
    const budget: ShareMemoryBudget = { textBytes: 0, imageBytes: 0, textExceeded: false }

    for (const item of cabItems) {
      if (budget.textExceeded) break
      if (item.kind === 'page') {
        if (isBinaryDocumentExt(item.ext)) { omittedBinaryCount++; continue }
        const list = await getChapters(item)
        const ch = list[0]
        const text = ch ? currentChapterText(ch) : ''
        budget.textBytes += estimateUtf8Bytes(text) + estimateUtf8Bytes(item.title) + 64
        if (budget.textBytes > MAX_OFFLINE_RAW_BYTES) { budget.textExceeded = true; break }
        const { attachments, omittedLarge } = item.ext === 'txt'
          ? { attachments: [], omittedLarge: 0 }
          : await collectSharedAttachments(null, [text], budget)
        omittedLargeImages += omittedLarge
        sharedPages.push({
          title: item.title,
          content: text,
          ...(item.ext === 'txt' ? { ext: 'txt' as const } : {}),
          ...(attachments.length ? { attachments } : {})
        })
      } else {
        const list = await getChapters(item)
        const chaptersData: SharedChapter[] = []
        const mdBodies: string[] = []
        for (const ch of list) {
          if (isBinaryDocumentExt(ch.ext)) { omittedBinaryCount++; continue }
          const text = currentChapterText(ch)
          budget.textBytes += estimateUtf8Bytes(text) + estimateUtf8Bytes(ch.title) + 64
          if (budget.textBytes > MAX_OFFLINE_RAW_BYTES) { budget.textExceeded = true; break }
          chaptersData.push({ title: ch.title, content: text, ...(ch.ext === 'txt' ? { ext: 'txt' as const } : {}) })
          if (ch.ext !== 'txt') mdBodies.push(text)
        }
        if (budget.textExceeded) break
        const { attachments, omittedLarge } = await collectSharedAttachments(item.id, mdBodies, budget)
        omittedLargeImages += omittedLarge
        const desc = bookDescriptionDrafts.value[item.id]?.description ?? item.description
        sharedBooks.push({
          title: item.title,
          ...(desc?.trim() ? { description: desc.trim() } : {}),
          chapters: chaptersData,
          ...(attachments.length ? { attachments } : {})
        })
      }
    }
    const offlineBlockedReason = budget.textExceeded
      ? `该书柜文本内容已超过离线分享内存上限（${Math.round(MAX_OFFLINE_RAW_BYTES / 1024)} KB），为防卡顿已停止打包；请改用 GitHub 短链接，或进入单本笔记本/章节分享。`
      : ''
    const payload: PaperSharePayloadV1 = {
      v: 1,
      scope: 'cabinet',
      createdAt: new Date().toISOString(),
      cabinet: { title: cab.title, books: offlineBlockedReason ? [] : sharedBooks, pages: offlineBlockedReason ? [] : sharedPages }
    }
    const cabinetSynced = cab.id === 'general' || !catalog.journal.value.created?.[cab.id]
    const ghLink = connected.value && initialRepository && cabinetSynced && cabItems.some(item => !!item.sha)
      ? encodeGitHubShareLink({ repo: initialRepository, scope: 'cabinet', id: cab.id, title: cab.title })
      : null
    const summaryOverride: ShareSummary | undefined = offlineBlockedReason
      ? {
          scope: 'cabinet',
          scopeLabel: '书柜分享',
          title: cab.title,
          bookCount: cabItems.filter(i => i.kind !== 'page').length,
          chapterCount: 0,
          pageCount: cabItems.filter(i => i.kind === 'page').length,
          imageCount: 0
        }
      : undefined
    presentShareModal(payload, ghLink, omittedBinaryCount, omittedLargeImages, offlineBlockedReason, summaryOverride)
  })
}

async function openShareBook(book: ShelfBook) {
  if (book.kind === 'page') {
    const list = await getChapters(book)
    if (list[0]) await openShareChapter(list[0], book)
    return
  }
  clearMessages()
  await run(async () => {
    const list = await getChapters(book)
    const chaptersData: SharedChapter[] = []
    const mdBodies: string[] = []
    let omittedBinaryCount = 0
    const budget: ShareMemoryBudget = { textBytes: 0, imageBytes: 0, textExceeded: false }
    for (const ch of list) {
      if (isBinaryDocumentExt(ch.ext)) { omittedBinaryCount++; continue }
      const text = currentChapterText(ch)
      budget.textBytes += estimateUtf8Bytes(text) + estimateUtf8Bytes(ch.title) + 64
      if (budget.textBytes > MAX_OFFLINE_RAW_BYTES) { budget.textExceeded = true; break }
      chaptersData.push({ title: ch.title, content: text, ...(ch.ext === 'txt' ? { ext: 'txt' as const } : {}) })
      if (ch.ext !== 'txt') mdBodies.push(text)
    }
    const { attachments, omittedLarge } = budget.textExceeded
      ? { attachments: [], omittedLarge: 0 }
      : await collectSharedAttachments(book.id, mdBodies, budget)
    const offlineBlockedReason = budget.textExceeded
      ? `该笔记本内容超过离线分享内存上限（${Math.round(MAX_OFFLINE_RAW_BYTES / 1024)} KB），请改用 GitHub 短链接，或进入单篇章节分享。`
      : ''
    const desc = bookDescriptionDrafts.value[book.id]?.description ?? book.description
    const payload: PaperSharePayloadV1 = {
      v: 1,
      scope: 'book',
      createdAt: new Date().toISOString(),
      book: {
        title: book.title,
        ...(desc?.trim() ? { description: desc.trim() } : {}),
        chapters: offlineBlockedReason ? [] : chaptersData,
        ...(attachments.length ? { attachments } : {})
      }
    }
    const ghLink = connected.value && initialRepository && book.sha
      ? encodeGitHubShareLink({ repo: initialRepository, scope: 'book', id: book.id, title: book.title })
      : null
    presentShareModal(payload, ghLink, omittedBinaryCount, omittedLarge, offlineBlockedReason)
  })
}

async function openShareChapter(chapter: Chapter, ownerBook: ShelfBook | null = selectedBook.value) {
  if (isBinaryDocumentExt(chapter.ext)) {
    error.value = '只读二进制文档（PDF/Word/PPT 等）暂不支持通过文本链接分享，请直接发送原文件。'
    return
  }
  clearMessages()
  await run(async () => {
    const isPage = ownerBook?.kind === 'page' || isPageBookId(chapter.bookId)
    const text = currentChapterText(chapter)
    const budget: ShareMemoryBudget = { textBytes: estimateUtf8Bytes(text) + estimateUtf8Bytes(chapter.title) + 64, imageBytes: 0, textExceeded: false }
    if (budget.textBytes > MAX_OFFLINE_RAW_BYTES) budget.textExceeded = true
    const assetBookId = isPage ? null : chapter.bookId
    const { attachments, omittedLarge } = chapter.ext === 'txt' || budget.textExceeded
      ? { attachments: [], omittedLarge: 0 }
      : await collectSharedAttachments(assetBookId, [text], budget)
    const offlineBlockedReason = budget.textExceeded
      ? `当前文档正文超过离线分享内存上限（${Math.round(MAX_OFFLINE_RAW_BYTES / 1024)} KB），请改用 GitHub 短链接或导出文件发送。`
      : ''
    const payload: PaperSharePayloadV1 = isPage
      ? {
          v: 1,
          scope: 'page',
          createdAt: new Date().toISOString(),
          page: {
            title: chapter.title,
            content: offlineBlockedReason ? '' : text,
            ...(chapter.ext === 'txt' ? { ext: 'txt' as const } : {}),
            ...(attachments.length ? { attachments } : {})
          }
        }
      : {
          v: 1,
          scope: 'chapter',
          createdAt: new Date().toISOString(),
          chapter: {
            title: chapter.title,
            bookTitle: ownerBook?.title,
            content: offlineBlockedReason ? '' : text,
            ...(chapter.ext === 'txt' ? { ext: 'txt' as const } : {}),
            ...(attachments.length ? { attachments } : {})
          }
        }
    const ghLink = connected.value && initialRepository && chapter.sha
      ? encodeGitHubShareLink({
          repo: initialRepository,
          scope: isPage ? 'page' : 'chapter',
          id: isPage ? pageId(chapter.bookId) : chapter.bookId,
          ...(isPage ? {} : { chapterId: chapter.id }),
          title: chapter.title
        })
      : null
    presentShareModal(payload, ghLink, 0, omittedLarge, offlineBlockedReason)
  })
}

async function copyActiveShareLink() {
  const value = activeShareLink.value.link
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    shareCopied.value = true
  } catch {
    shareLinkTextarea.value?.focus()
    shareLinkTextarea.value?.select()
    try { document.execCommand('copy'); shareCopied.value = true } catch { /* manual copy fallback */ }
  }
  if (shareCopied.value) {
    setTimeout(() => { shareCopied.value = false }, 2200)
  }
}

async function fetchGitHubSharePayload(ref: GitHubShareRef): Promise<PaperSharePayloadV1> {
  const parsed = parseRepository(ref.repo)
  const remoteStore = createNotebookStore(ref.repo)
  let hasToken = false
  if (connected.value && initialRepository === ref.repo) {
    const token = await readCredential().catch(() => null)
    if (token) {
      remoteStore.setToken(token)
      hasToken = true
    }
  }

  // Fast, rate-limit-free public GitHub reader: uses 1 single Git Trees call + raw.githubusercontent.com
  // so unauthenticated users can import an entire 50-chapter cabinet without hitting GitHub's 60 req/hr API cap!
  if (parsed.provider === 'github' && !hasToken && (ref.scope === 'cabinet' || ref.scope === 'book')) {
    const rawBase = `https://raw.githubusercontent.com/${parsed.slug}/main`
    const fetchRawText = async (path: string): Promise<string | null> => {
      const r = await fetch(`${rawBase}/${path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
      return r.ok ? r.text() : null
    }
    const fetchRawBytes = async (path: string): Promise<Uint8Array | null> => {
      const r = await fetch(`${rawBase}/${path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
    }
    const treeRes = await fetch(`https://api.github.com/repos/${parsed.slug}/git/trees/main?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    })
    if (treeRes.ok) {
      const treeJson = await treeRes.json() as { tree?: Array<{ path: string; type: string }> }
      const blobPaths = (treeJson.tree || []).filter(item => item.type === 'blob').map(item => item.path)
      const collectRawImages = async (bookId: string | null, markdowns: string[]): Promise<SharedAttachment[]> => {
        const out: SharedAttachment[] = []
        const seen = new Set<string>()
        for (const md of markdowns) {
          for (const r of attachmentReferences(md, bookId)) {
            if (seen.has(r.src)) continue
            seen.add(r.src)
            try {
              const bytes = await fetchRawBytes(r.path)
              if (bytes) out.push({ relPath: r.src, mime: attachmentMime(r.path) as SharedAttachment['mime'], base64: bytesToBase64(bytes) })
            } catch { /* skip missing image */ }
          }
        }
        return out
      }
      const loadRawBook = async (bookId: string): Promise<SharedBook | null> => {
        const prefix = `docs/notebooks/${bookId}/`
        const indexText = await fetchRawText(`${prefix}index.md`)
        if (indexText === null) return null
        const bookTitle = extractMarkdownTitle(indexText, bookId)
        const chPaths = blobPaths.filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && !p.endsWith('/index.md'))
        const loaded: Array<{ id: string; title: string; content: string; ext?: 'txt' }> = []
        for (const p of chPaths) {
          const name = p.slice(prefix.length)
          const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
          if (ext !== 'md' && ext !== 'txt') continue
          const id = name.slice(0, name.lastIndexOf('.'))
          const body = await fetchRawText(p)
          if (body === null) continue
          const fallback = decodeEncodedChapterPath(id) || id
          const title = ext === 'md' ? extractMarkdownTitle(body, fallback) : fallback
          loaded.push({ id, title, content: body, ...(ext === 'txt' ? { ext: 'txt' as const } : {}) })
        }
        const ordered = sortChapters(loaded)
        const attachments = await collectRawImages(bookId, ordered.filter(c => c.ext !== 'txt').map(c => c.content))
        return {
          title: bookTitle,
          chapters: ordered.map(c => ({ title: c.title, content: c.content, ...(c.ext ? { ext: c.ext } : {}) })),
          ...(attachments.length ? { attachments } : {})
        }
      }

      if (ref.scope === 'book') {
        const book = await loadRawBook(ref.id)
        if (book) return { v: 1, scope: 'book', book }
      } else {
        const catText = await fetchRawText('docs/cabinets.json')
        const cat = catText ? JSON.parse(catText) as { cabinets?: Array<{ id: string; title: string }>; assignments?: Record<string, string> } : { cabinets: [], assignments: {} }
        const cab = (cat.cabinets || []).find(c => c.id === ref.id)
        const cabTitle = cab?.title || ref.title || '分享书柜'
        const assignedTo = (id: string) => {
          const target = cat.assignments?.[id]
          return target && (cat.cabinets || []).some(c => c.id === target) ? target : 'general'
        }
        const bookIds = [...new Set(blobPaths.filter(p => p.startsWith('docs/notebooks/') && p.endsWith('/index.md')).map(p => p.split('/')[2]))]
        const sharedBooks: SharedBook[] = []
        for (const bid of bookIds.filter(id => assignedTo(id) === ref.id)) {
          const b = await loadRawBook(bid)
          if (b) sharedBooks.push(b)
        }
        const sharedPages: SharedPage[] = []
        for (const p of blobPaths.filter(path => path.startsWith('docs/pages/') && !path.slice('docs/pages/'.length).includes('/'))) {
          const name = p.slice('docs/pages/'.length)
          const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
          if (ext !== 'md' && ext !== 'txt') continue
          const id = name.slice(0, name.lastIndexOf('.'))
          if (assignedTo(pageBookId(id)) !== ref.id) continue
          const body = await fetchRawText(p)
          if (body === null) continue
          const title = ext === 'md' ? extractMarkdownTitle(body, id) : id
          const attachments = ext === 'txt' ? [] : await collectRawImages(null, [body])
          sharedPages.push({ title, content: body, ...(ext === 'txt' ? { ext: 'txt' as const } : {}), ...(attachments.length ? { attachments } : {}) })
        }
        return { v: 1, scope: 'cabinet', cabinet: { title: cabTitle, books: sharedBooks, pages: sharedPages } }
      }
    } else if (treeRes.status === 404) {
      throw new Error('无法免登录读取该仓库：原仓库可能是私有仓库（仅公开仓库支持免登录导入），请让分享者改发离线分享链接，或连接对应仓库令牌后重试。')
    } else if (treeRes.status === 403 && treeRes.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('当前网络已触发 GitHub 匿名访问频率上限（每小时 60 次），请稍后重试、连接个人 GitHub 令牌，或让分享者改发离线分享链接。')
    }
  }
  const collectRemoteImages = async (bookId: string | null, markdowns: string[]): Promise<SharedAttachment[]> => {
    const out: SharedAttachment[] = []
    const seen = new Set<string>()
    for (const md of markdowns) {
      for (const r of attachmentReferences(md, bookId)) {
        if (seen.has(r.src)) continue
        seen.add(r.src)
        try {
          const att = await remoteStore.readAttachment(r.path)
          out.push({ relPath: r.src, mime: attachmentMime(r.path) as SharedAttachment['mime'], base64: bytesToBase64(att.bytes) })
        } catch { /* skip missing remote image */ }
      }
    }
    return out
  }

  if (ref.scope === 'page') {
    const page = await remoteStore.readPage(ref.id)
    const attachments = page.ext === 'txt' ? [] : await collectRemoteImages(null, [page.content])
    return {
      v: 1,
      scope: 'page',
      page: { title: page.title, content: page.content, ...(page.ext === 'txt' ? { ext: 'txt' as const } : {}), ...(attachments.length ? { attachments } : {}) }
    }
  }
  if (ref.scope === 'chapter') {
    if (!ref.chapterId) throw new Error('GitHub 章节分享链接缺少章节标识。')
    const ch = await remoteStore.readChapter(ref.id, ref.chapterId)
    const attachments = ch.ext === 'txt' ? [] : await collectRemoteImages(ref.id, [ch.content])
    return {
      v: 1,
      scope: 'chapter',
      chapter: { title: ch.title, content: ch.content, ...(ch.ext === 'txt' ? { ext: 'txt' as const } : {}), ...(attachments.length ? { attachments } : {}) }
    }
  }
  if (ref.scope === 'book') {
    const allBooks = await remoteStore.listNotebooks()
    const targetBook = allBooks.find(b => b.id === ref.id)
    const chList = await remoteStore.listChapters(ref.id)
    const ordered = sortChapters(chList, targetBook?.chapterOrder)
    const mdBodies = ordered.filter(c => c.ext !== 'txt' && !isBinaryDocumentExt(c.ext)).map(c => c.content)
    const attachments = await collectRemoteImages(ref.id, mdBodies)
    return {
      v: 1,
      scope: 'book',
      book: {
        title: targetBook?.title || ref.title || ref.id,
        ...(targetBook?.description ? { description: targetBook.description } : {}),
        chapters: ordered.filter(c => !isBinaryDocumentExt(c.ext)).map(c => ({ title: c.title, content: c.content, ...(c.ext === 'txt' ? { ext: 'txt' as const } : {}) })),
        ...(attachments.length ? { attachments } : {})
      }
    }
  }
  // Cabinet share from GitHub
  const [catVersion, allBooks, allPages] = await Promise.all([
    remoteStore.readCatalog(false),
    remoteStore.listNotebooks(),
    remoteStore.listPages()
  ])
  const cat = catVersion?.catalog || { cabinets: [], assignments: {} }
  const cab = (cat.cabinets || []).find(c => c.id === ref.id)
  const cabTitle = cab?.title || ref.title || '分享书柜'
  const assignedTo = (id: string) => {
    const target = cat.assignments?.[id]
    return target && (cat.cabinets || []).some(c => c.id === target) ? target : 'general'
  }
  const sharedBooks: SharedBook[] = []
  for (const b of allBooks.filter(item => assignedTo(item.id) === ref.id)) {
    const chList = sortChapters(await remoteStore.listChapters(b.id), b.chapterOrder)
    const editableCh = chList.filter(c => !isBinaryDocumentExt(c.ext))
    const attachments = await collectRemoteImages(b.id, editableCh.filter(c => c.ext !== 'txt').map(c => c.content))
    sharedBooks.push({
      title: b.title,
      ...(b.description ? { description: b.description } : {}),
      chapters: editableCh.map(c => ({ title: c.title, content: c.content, ...(c.ext === 'txt' ? { ext: 'txt' as const } : {}) })),
      ...(attachments.length ? { attachments } : {})
    })
  }
  const sharedPages: SharedPage[] = []
  for (const p of allPages.filter(item => assignedTo(pageBookId(item.id)) === ref.id && !isBinaryDocumentExt(item.ext))) {
    const attachments = p.ext === 'txt' ? [] : await collectRemoteImages(null, [p.content])
    sharedPages.push({
      title: p.title,
      content: p.content,
      ...(p.ext === 'txt' ? { ext: 'txt' as const } : {}),
      ...(attachments.length ? { attachments } : {})
    })
  }
  return { v: 1, scope: 'cabinet', cabinet: { title: cabTitle, books: sharedBooks, pages: sharedPages } }
}

async function parseShareLinkInput(rawOverride?: string) {
  const input = (rawOverride ?? shareImportInput.value).trim()
  shareImportError.value = ''
  pendingShareImport.value = null
  if (!input) {
    shareImportError.value = '请先粘贴分享链接。'
    return
  }
  shareImportLoading.value = true
  try {
    const parsed = decodeShareInput(input)
    let payload: PaperSharePayloadV1
    let sourceLabel = '离线便携链接'
    if (parsed.kind === 'offline') {
      payload = parsed.payload
    } else {
      sourceLabel = `GitHub 仓库：${parsed.repo}`
      payload = await fetchGitHubSharePayload(parsed)
    }
    const summary = summarizeSharePayload(payload)
    pendingShareImport.value = { payload, summary, sourceLabel }
    shareImportTargetCabinet.value = activeCabinet.value || 'general'
    shareImportChapterMode.value = selectedBook.value && selectedBook.value.kind !== 'page' ? 'current-book' : 'standalone-page'
  } catch (e) {
    shareImportError.value = message(e)
  } finally {
    shareImportLoading.value = false
  }
}

function rewriteSharedAttachmentRefs(markdown: string, mapping: Map<string, string>): string {
  let next = markdown
  for (const [oldRel, newRel] of mapping.entries()) {
    if (oldRel === newRel) continue
    next = next.split(oldRel).join(newRel)
  }
  return next
}

async function stageSharedAttachments(
  targetBookId: string | null,
  attachments: SharedAttachment[] | undefined,
  staged: Map<string, NoteAttachment>
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>()
  if (!attachments?.length) return mapping
  for (const att of attachments) {
    try {
      const bytes = base64ToBytes(att.base64)
      const destPath = newAttachmentPath(targetBookId, att.mime)
      const destRel = destPath.slice(destPath.indexOf('assets/'))
      staged.set(destPath, { path: destPath, bytes })
      mapping.set(att.relPath, destRel)
    } catch { /* skip invalid attachment bytes safely */ }
  }
  return mapping
}

function safeEncodedTitleForId(raw: string, maxBytes = 148): string {
  const clean = (raw || '').replace(/[\r\n]+/g, ' ').trim() || '未命名笔记'
  const encoder = new TextEncoder()
  if (clean.length <= 120 && encoder.encode(clean).length <= maxBytes) return clean
  let out = ''
  let bytes = 0
  for (const ch of clean) {
    if (out.length >= 115) break
    const len = encoder.encode(ch).length
    if (bytes + len > maxBytes) break
    out += ch
    bytes += len
  }
  return out.trim() || '未命名笔记'
}

async function confirmImportShare() {
  const pending = pendingShareImport.value
  if (!pending) return
  if (busy.value || writing) { shareImportError.value = '正在保存或同步，请稍候。'; return }
  if (!saveDraft()) return
  shareImportError.value = ''
  clearMessages()

  const success = await run(async () => {
    assertLocalMetadataWritable(localMetadataDamaged)
    const { payload } = pending
    const beforeBooks = localBooks.value
    const beforeChapters = localChapters.value
    const addedBooks: ShelfBook[] = []
    const addedChapters: Chapter[] = []
    const staged = new Map<string, NoteAttachment>()

    let targetCabinetId = shareImportTargetCabinet.value || activeCabinet.value || 'general'
    let createdCabinetId = ''
    let importedIntoCurrentBook = false

    const addSharedBookToList = async (sb: SharedBook) => {
      const bookId = newId()
      const map = await stageSharedAttachments(bookId, sb.attachments, staged)
      const chapterOrder: string[] = []
      const usedChapterIds = new Set<string>()
      for (const ch of sb.chapters) {
        let cid = chapterIdFromTitle(safeEncodedTitleForId(ch.title))
        while (usedChapterIds.has(cid)) cid = `${cid.slice(0, 240)}-${newId().slice(0, 4)}`
        usedChapterIds.add(cid)
        chapterOrder.push(cid)
        addedChapters.push({
          bookId,
          id: cid,
          title: ch.title,
          content: ch.ext === 'txt' ? ch.content : rewriteSharedAttachmentRefs(ch.content, map),
          sha: '',
          ...(ch.ext === 'txt' ? { ext: 'txt' as const } : {})
        })
      }
      addedBooks.push({
        id: bookId,
        title: sb.title,
        sha: '',
        ...(sb.description ? { description: sb.description } : {}),
        ...(chapterOrder.length ? { chapterOrder } : {})
      })
      return bookId
    }

    const addSharedPageToList = async (sp: SharedPage) => {
      const safePageTitle = safeEncodedTitleForId(sp.title)
      let pid = pageIdFromTitle(safePageTitle)
      let bookId = pageBookId(pid)
      while (books.value.some(b => b.id === bookId) || addedBooks.some(b => b.id === bookId)) {
        pid = `${pageIdFromTitle(safePageTitle).slice(0, 240)}-${newId().slice(0, 4)}`
        bookId = pageBookId(pid)
      }
      const map = await stageSharedAttachments(null, sp.attachments, staged)
      addedBooks.push({ id: bookId, title: sp.title, sha: '', kind: 'page', ...(sp.ext === 'txt' ? { ext: 'txt' as const } : {}) })
      addedChapters.push({
        bookId,
        id: pid,
        title: sp.title,
        content: sp.ext === 'txt' ? sp.content : rewriteSharedAttachmentRefs(sp.content, map),
        sha: '',
        ...(sp.ext === 'txt' ? { ext: 'txt' as const } : {})
      })
      return bookId
    }

    if (payload.scope === 'cabinet' && payload.cabinet) {
      const baseName = payload.cabinet.title.trim() || '分享书柜'
      const hasName = (candidate: string) => catalog.cabinets.value.some(c => c.title.trim().toLowerCase() === candidate.toLowerCase())
      let uniqueTitle = baseName
      if (hasName(uniqueTitle)) {
        uniqueTitle = `${baseName}（分享）`
        let seq = 2
        while (hasName(uniqueTitle)) {
          uniqueTitle = `${baseName}（分享 ${seq++}）`
        }
      }
      createdCabinetId = catalog.create(uniqueTitle)
      targetCabinetId = createdCabinetId
      for (const sb of payload.cabinet.books) await addSharedBookToList(sb)
      for (const sp of payload.cabinet.pages) await addSharedPageToList(sp)
    } else if (payload.scope === 'book' && payload.book) {
      await addSharedBookToList(payload.book)
    } else if (payload.scope === 'page' && payload.page) {
      await addSharedPageToList(payload.page)
    } else if (payload.scope === 'chapter' && payload.chapter) {
      const ch = payload.chapter
      if (shareImportChapterMode.value === 'current-book' && selectedBook.value && selectedBook.value.kind !== 'page') {
        const destBookId = selectedBook.value.id
        const map = await stageSharedAttachments(destBookId, ch.attachments, staged)
        let cid = chapterIdFromTitle(ch.title)
        while (chapters.value.some(c => c.id === cid) || addedChapters.some(c => c.bookId === destBookId && c.id === cid)) {
          cid = `${chapterIdFromTitle(ch.title)}-${newId().slice(0, 4)}`
        }
        addedChapters.push({
          bookId: destBookId,
          id: cid,
          title: ch.title,
          content: ch.ext === 'txt' ? ch.content : rewriteSharedAttachmentRefs(ch.content, map),
          sha: '',
          ...(ch.ext === 'txt' ? { ext: 'txt' as const } : {})
        })
        importedIntoCurrentBook = true
      } else {
        await addSharedPageToList({
          title: ch.title,
          content: ch.content,
          ext: ch.ext,
          attachments: ch.attachments
        })
      }
    }

    for (const image of staged.values()) await putAttachment(initialRepository, image)
    localBooks.value = [...beforeBooks, ...addedBooks]
    localChapters.value = [...beforeChapters, ...addedChapters]
    try {
      persistLocal()
      if (addedBooks.length) catalog.moveMany(addedBooks.map(b => b.id), targetCabinetId)
    } catch (e) {
      localBooks.value = beforeBooks
      localChapters.value = beforeChapters
      if (createdCabinetId) { try { catalog.remove(createdCabinetId) } catch { /* ignore */ } }
      try { persistLocal() } catch { throw new Error('导入分享未完成，本地保存失败，请检查存储空间。') }
      throw e
    }
    books.value = [...books.value, ...addedBooks]
    if (importedIntoCurrentBook && selectedBook.value) {
      chapters.value = [...chapters.value, ...addedChapters.filter(c => c.bookId === selectedBook.value!.id)]
    }
    localMutationVersion++

    shareImportInput.value = ''
    pendingShareImport.value = null
    importing.value = false

    // Smoothly navigate into the newly imported cabinet / book / page
    if (createdCabinetId) {
      openCabinet(createdCabinetId)
    } else if (addedBooks.length === 1 && !importedIntoCurrentBook) {
      activeCabinet.value = targetCabinetId
      await openBook(addedBooks[0])
    } else if (importedIntoCurrentBook && addedChapters[0]) {
      openChapter(addedChapters[0])
    }
    notice.value = `已从分享链接导入「${pending.summary.title}」（${addedBooks.length} 项书本/书页、${addedChapters.filter(c => !isPageBookId(c.bookId)).length} 篇章节、${staged.size} 张图片）。`
  })
  if (!success && error.value) {
    shareImportError.value = error.value
  }
}

function checkInitialShareHash() {
  if (typeof window === 'undefined') return
  const hash = window.location.hash || ''
  if (!hash.startsWith('#paper-share=')) return
  shareImportInput.value = window.location.href
  importing.value = true
  void parseShareLinkInput(window.location.href)
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch { /* ignore */ }
}

const initialRepository = getConfiguredRepository()
const repository = ref(initialRepository)
const repositoryInput = ref(initialRepository)
const changingRepository = ref(false)
const hasLegacyWorkspace = ref(false)
const hasUnboundWorkspace = ref(false)
const legacyWorkspaceCheckFailed = ref(false)
const store = createNotebookStore(initialRepository)
const catalog = useCabinets(initialRepository)
const activeCabinet = ref('')
const creatingCabinet = ref(false)
const cabinetName = ref('')
type ShelfBook = Notebook & { kind?: 'page'; ext?: string; chapterCount?: number; previewText?: string }
const books = ref<ShelfBook[]>([])
const chapters = ref<Chapter[]>([])
const selectedBook = ref<ShelfBook | null>(null)
const selectedChapter = ref<Chapter | null>(null)
const content = ref('')
const selectedChapterExt = computed(() => normalizeFileExt(selectedChapter.value?.ext))
const selectedChapterEditable = computed(() => isEditableExt(selectedChapter.value?.ext))
const selectedChapterIsMarkdown = computed(() => isMarkdownExt(selectedChapter.value?.ext))
const selectedChapterIsPlainText = computed(() => isPlainTextExt(selectedChapter.value?.ext))
const imageUrls = ref<Record<string, string>>({})
const imageWarning = ref('')
const readingPaper = ref<HTMLElement | null>(null)
let imageRefresh = 0
let imageObjects = new Map<string, string>()
const tokenInput = ref('')
const connected = ref(false)
const tokenLoading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const transferState = ref<TransferState>({ phase: 'idle' })
const transferPercent = ref<number | null>(null)
const transferDetail = ref('')
const transferIndicator = createSyncIndicator(state => {
  transferState.value = state
  if (state.phase === 'idle') {
    transferPercent.value = null
    transferDetail.value = ''
  }
})
const view = ref<'read' | 'edit'>('read')
const query = ref('')
const bookTitle = ref('')
const bookDescription = ref('')
const editingDescription = ref(false)
const descriptionInput = ref('')
let descriptionEditBase: Notebook | null = null
const bookCabinet = ref('')
const newBookCabinetName = ref('')
const newNoteKind = ref<'book' | 'page'>('book')
const newPageFormat = ref<'md' | 'txt'>('md')
const newChapterFormat = ref<'md' | 'txt'>('md')
const importing = ref(false)
const draggingFiles = ref(false)
const importFileInput = ref<HTMLInputElement | null>(null)
const importFolderInput = ref<HTMLInputElement | null>(null)
const repairFolderInput = ref<HTMLInputElement | null>(null)
const repairImageFolderInput = ref<HTMLInputElement | null>(null)
const moveBooksTarget = ref('')
const deleteCabinetIds = ref<string[]>([])
const renamingCabinetId = ref('')
const renamingCabinetName = ref('')
const renameCabinetError = ref('')
const renamingItem = ref<null | { kind: 'book'; book: ShelfBook } | { kind: 'chapter'; chapter: Chapter }>(null)
const renamingItemName = ref('')
const renameItemError = ref('')
const editorSidebarOpen = ref(true)
const editorSidebarPreference = 'paper-notes-editor-sidebar-open'
const editorSidebarTab = ref<'chapters' | 'outline'>('chapters')
const editorSidebarTabPreference = 'paper-notes-editor-sidebar-tab'
const archiveHeader = ref<HTMLElement | null>(null)
const editorStickyTop = ref(66)
let headerResizeObserver: ResizeObserver | undefined
const markdownEditor = ref<{ focusHeading: (offset: number) => void; applyOutlineChange: (before: string, after: string, focus: number) => string; openFind?: (withReplace?: boolean) => void } | null>(null)
const chapterMarkdownRef = ref<{ scrollToHeading: (target: string) => boolean; articleElement?: () => HTMLElement | null } | null>(null)
const linkHistory = ref<Array<{ bookId: string; chapterId: string; title: string }>>([])
const currentStats = computed(() => computeDocumentStats(content.value))
const currentOutline = computed(() => markdownOutline(content.value))
const readOutline = computed(() => {
  const stripped = content.value.replace(/^# [^\r\n]+(?:\r?\n|$)/, '')
  return markdownOutline(stripped)
})
const chapterTitle = ref('')
const creatingBook = ref(false)
const creatingChapter = ref(false)
watch([creatingCabinet, creatingBook], ([cabinetOpen, bookOpen]) => {
  if (cabinetOpen || bookOpen) {
    void nextTick(() => document.getElementById(cabinetOpen ? 'cabinet-name' : 'book-name')?.focus())
  }
})
const remoteVersion = ref<Chapter | null>(null)
const snapshot = ref(true)
const restoredSnapshot = shallowRef<RemoteSnapshot | null>(null)
const offlineMode = ref(false)
const searchIndex = shallowRef<Chapter[]>([])
const searching = ref(false)
let searchRun = 0
let bookRun = 0
let localMutationVersion = 0
let suspendDraft = false
const localBooks = ref<ShelfBook[]>([])
// Description and chapter order share the same index.md version, so changes
// are kept in one draft and submitted together as notebook information.
const bookDescriptionDrafts = ref<Record<string, { base: Notebook; description: string; chapterOrder?: string[]; title?: string }>>({})
const latestBookMetadata = ref<Notebook[]>([])
let latestBookMetadataComplete = false
const welcomeInitialized = ref(false)
const welcomeBookId = ref('')
const bookVersions = ref<Record<string, string>>({})
const localChapters = ref<Chapter[]>([])
const remotePages = shallowRef<Page[]>([])
const pageBookId = (id: string) => `page_${id}`
const isPageBookId = (id: string) => remotePages.value.some(page => pageBookId(page.id) === id) || localBooks.value.some(book => book.id === id && book.kind === 'page') || (selectedBook.value?.id === id && selectedBook.value.kind === 'page')
const pageId = (bookId: string) => bookId.slice(5)
const pageAsBook = (page: Page): ShelfBook => ({ id: pageBookId(page.id), title: page.title, sha: page.sha, kind: 'page', ...(page.ext ? { ext: page.ext } : {}) })
const pageAsChapter = (page: Page): Chapter => ({ bookId: pageBookId(page.id), id: page.id, title: page.title, content: page.content, sha: page.sha, ...(page.ext ? { ext: page.ext } : {}), ...(page.filePath ? { filePath: page.filePath } : {}), ...(page.fileName ? { fileName: page.fileName } : {}), ...(page.fileSize !== undefined ? { fileSize: page.fileSize } : {}) })
const chapterAsPage = (chapter: Chapter): Page => ({ id: pageId(chapter.bookId), title: chapter.title, content: chapter.content, sha: chapter.sha, ...(chapter.ext ? { ext: chapter.ext } : {}), ...(chapter.filePath ? { filePath: chapter.filePath } : {}), ...(chapter.fileName ? { fileName: chapter.fileName } : {}), ...(chapter.fileSize !== undefined ? { fileSize: chapter.fileSize } : {}) })
const loadedBookIds = ref<string[]>([])
type SyncedCopy = { chapter: Chapter; baseSha: string | null; snapshotVersion: string }
const syncedCopies = ref<Record<string, SyncedCopy>>({})
const snapshotFiles = import.meta.glob('./builtin/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
let snapshotVersion = ''
async function identifySnapshot() {
  const text = JSON.stringify(Object.entries(snapshotFiles).sort(([a], [b]) => a.localeCompare(b)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  snapshotVersion = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
const chapterCache = new Map<string, Promise<Chapter[]>>()
const shelfChapterIds = new Map<string, Promise<string[] | null>>()
const shelfCounts = ref<Record<string, number>>({})
type Draft = { content: string; base: Chapter }
const drafts = ref<Record<string, Draft>>({})
const selectedKeys = ref<string[]>([])
const deleteBookIds = ref<string[]>([])
const deleteChapterIds = ref<string[]>([])
const isHosted = ref(false)
const isDesktop = ref(false)
const autoSave = ref(false)
const autoStatus = ref('自动保存已关闭')
let autoTimer: ReturnType<typeof setTimeout> | undefined
let writing = false
let disposed = false
const autoKeys = new Set<string>()
const autoBooks = new Set<string>()
const autoCabinets = new Set<string>()
const autoMoves = new Set<string>()
const inFlightKeys = new Set<string>()
const localKey = namespaceKey('paper-notes-local-collection', initialRepository)
let localMetadataDamaged = false
const credentialKey = namespaceKey('paper-notes-github-token', initialRepository)
const autoPreferenceKey = namespaceKey('paper-notes-auto-save-enabled', initialRepository)
const draftPrefix = `${namespaceKey('paper-notes-draft', initialRepository)}:`
function savedAutoPreference(): boolean {
  try { return localStorage.getItem(autoPreferenceKey) !== 'false' } catch { return false }
}
type DesktopBridge = {
  postMessage: (value: object) => void
  addEventListener: (name: 'message', handler: (event: MessageEvent) => void) => void
  removeEventListener: (name: 'message', handler: (event: MessageEvent) => void) => void
}
function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { chrome?: { webview?: DesktopBridge } }).chrome?.webview
}
function desktopRequest(action: 'token.get' | 'token.set' | 'token.clear' | 'token.importLegacy', token?: string, targetRepository = initialRepository): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const bridge = desktopBridge()
    if (!bridge) { reject(new Error('桌面安全存储不可用。')); return }
    const id = crypto.randomUUID()
    const timer = setTimeout(() => { bridge.removeEventListener('message', receive); reject(new Error('桌面安全存储没有响应。')) }, 8000)
    function receive(event: MessageEvent) {
      const result = event.data
      if (!result || result.channel !== 'paper-notes' || result.id !== id) return
      clearTimeout(timer)
      bridge!.removeEventListener('message', receive)
      if (result.ok !== true) reject(new Error(typeof result.error === 'string' && result.error.length < 200 ? result.error : '无法访问桌面安全存储。'))
      else resolve(typeof result.token === 'string' ? result.token : null)
    }
    bridge.addEventListener('message', receive)
    try { bridge.postMessage({ channel: 'paper-notes', id, action, repository: targetRepository, ...(action === 'token.set' ? { token } : {}) }) }
    catch { clearTimeout(timer); bridge.removeEventListener('message', receive); reject(new Error('无法访问桌面安全存储。')) }
  })
}
async function readCredential(): Promise<string | null> {
  if (!initialRepository) return null
  return isDesktop.value ? await desktopRequest('token.get') : localStorage.getItem(credentialKey)
}
async function saveCredential(token: string, targetRepository = initialRepository): Promise<void> {
  if (isDesktop.value) await desktopRequest('token.set', token, targetRepository)
  else localStorage.setItem(namespaceKey('paper-notes-github-token', targetRepository), token)
}
async function clearCredential(): Promise<void> {
  if (isDesktop.value) await desktopRequest('token.clear')
  else localStorage.removeItem(credentialKey)
}

// Older versions used one unscoped workspace. Never assign it to a repository
// without an explicit user choice; copy it rather than removing the original.
function workspaceEntries(kind: 'legacy' | 'local'): Array<[string, string]> {
  const prefix = kind === 'legacy' ? 'paper-notes-draft:' : `${namespaceKey('paper-notes-draft', '')}:`
  const keys = kind === 'legacy'
    ? ['paper-notes-local-collection', 'paper-notes:cabinets:v1']
    : [namespaceKey('paper-notes-local-collection', ''), namespaceKey('paper-notes:cabinets:v1', '')]
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  return keys.flatMap(key => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value] as [string, string]] })
}
function workspaceHasContent(kind: 'legacy' | 'local'): boolean {
  return workspaceEntries(kind).some(([key, value]) => hasUserData(key, value))
}
function assertWorkspaceUnchanged(kind: 'legacy' | 'local', expected: Array<[string, string]>) {
  if (!workspaceEntriesMatch(expected, workspaceEntries(kind))) {
    throw new Error('复制期间原工作区发生变化，已保留原数据，请重新复制。')
  }
}
function sameImageBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
async function copyWorkspaceAttachments(source: Array<[string, string]>, target: string) {
  // Never overwrite an unrelated target attachment. Copy before copying any
  // Markdown so an incomplete import cannot leave references to missing data.
  for (const path of workspaceAttachmentPaths(source)) {
    const original = await getAttachment('', path)
    if (!original) throw new Error('本机有图片附件缺失，未复制笔记；请先恢复图片。')
    const existing = await getAttachment(target, path)
    if (existing && !sameImageBytes(existing.bytes, original.bytes)) throw new Error('目标工作区存在同名但内容不同的图片，未复制笔记。')
    if (!existing) await putAttachment(target, original)
  }
}
function importWorkspace(kind: 'legacy' | 'local', target: string, source = workspaceEntries(kind)): void {
  assertLocalMetadataWritable(localMetadataDamaged)
  const oldPrefix = kind === 'legacy' ? 'paper-notes-draft:' : `${namespaceKey('paper-notes-draft', '')}:`
  const newPrefix = `${namespaceKey('paper-notes-draft', target)}:`
  const mapped = source.map(([key, value]): [string, string] => {
    if (key.startsWith(oldPrefix)) return [newPrefix + key.slice(oldPrefix.length), value]
    return [namespaceKey(key.includes('cabinets:v1') ? 'paper-notes:cabinets:v1' : 'paper-notes-local-collection', target), value]
  })
  const previous = new Map(mapped.map(([key]) => [key, localStorage.getItem(key)]))
  if (mapped.some(([key]) => { const old = previous.get(key); return old != null && hasUserData(key, old) })) throw new Error('目标仓库已有本机数据，请先处理现有数据，避免覆盖。')
  const written: string[] = []
  try { for (const [key, value] of mapped) { localStorage.setItem(key, value); written.push(key) } }
  catch (e) { for (const key of written) { const old = previous.get(key); if (old == null) localStorage.removeItem(key); else localStorage.setItem(key, old) } throw e }
}
async function importOlderWorkspace() {
  if (!initialRepository) { error.value = '请先连接自己的 GitHub 仓库，再选择是否导入旧版本地数据。'; return }
  if (writing || busy.value || !saveDraft()) return
  try {
    if (!workspaceHasContent('legacy')) { notice.value = '没有找到旧版本地数据。'; return }
    if (!window.confirm(`旧版本地数据没有记录仓库归属。只有确认这些笔记属于 ${initialRepository}，才应导入。原数据会保留，导入后仍需手动选择同步。\n\n确认导入？`)) return
    const success = await run(async () => {
      const source = workspaceEntries('legacy')
      await copyWorkspaceAttachments(source, initialRepository)
      assertWorkspaceUnchanged('legacy', source)
      importWorkspace('legacy', initialRepository, source)
    })
    if (success) location.reload()
  } catch (e) { error.value = `无法导入旧版本地数据：${message(e)}` }
}
async function readWelcomeCandidates(candidate: ReturnType<typeof createNotebookStore>): Promise<WelcomeCandidate[] | null> {
  try {
    const head = await candidate.readHead()
    const remote = await candidate.listNotebooks()
    const candidates = await Promise.all(remote.map(async book => ({ book, chapters: await candidate.listChapters(book.id) })))
    return await candidate.readHead() === head ? candidates : null
  } catch { return null }
}
async function importUnboundWorkspace() {
  if (!initialRepository) { error.value = '请先连接 GitHub 仓库。'; return }
  if (writing || busy.value || !saveDraft()) return
  try {
    if (!workspaceHasContent('local')) { notice.value = '没有找到未关联仓库的本机笔记。'; return }
    if (!window.confirm(`确认将未关联仓库的本机笔记复制到 ${initialRepository} 的工作区？原数据会保留，复制后仍需手动选择同步。`)) return
    const success = await run(async () => {
      const remote = connected.value ? await readWelcomeCandidates(store) : null
      const original = workspaceEntries('local')
      const source = prepareWelcomeImport(original, snapshotFiles, remote).entries
      await copyWorkspaceAttachments(source, initialRepository)
      assertWorkspaceUnchanged('local', original)
      importWorkspace('local', initialRepository, source)
    })
    if (success) location.reload()
  } catch (e) { error.value = `无法导入本机笔记：${message(e)}` }
}
function returnToLocalWorkspace() {
  if (writing || busy.value) { error.value = '正在同步，请稍后再切换工作区。'; return }
  if (!saveDraft()) return
  try {
    clearTimeout(autoTimer)
    connected.value = false
    autoSave.value = false
    store.clearToken()
    setConfiguredRepository('')
    location.reload()
  } catch (e) { error.value = `无法切换工作区：${message(e)}` }
}
function exportOlderWorkspace() {
  try {
    const entries = workspaceEntries('legacy')
    if (!workspaceHasContent('legacy')) { notice.value = '没有找到旧版本地数据。'; return }
    // Only known notebook/draft/catalog keys are exported; credentials are never included.
    const data = JSON.stringify({ format: 'paper-notes-legacy-backup', version: 1, entries: Object.fromEntries(entries) }, null, 2)
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'paper-notes-legacy-backup.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    notice.value = '旧版本地数据已导出；备份不包含令牌。'
  } catch (e) { error.value = `无法导出旧版本地数据：${message(e)}` }
}
function windowCommand(action: 'window.minimize' | 'window.maximize' | 'window.close' | 'window.drag') {
  if (isDesktop.value) desktopBridge()?.postMessage({ channel: 'paper-notes', action })
}
function dragWindow(event: MouseEvent) {
  if (!isDesktop.value || event.button !== 0 || (event.target as Element).closest('button, a, input, textarea, select, label')) return
  windowCommand('window.drag')
}
function maximizeWindow(event: MouseEvent) {
  if (!isDesktop.value || (event.target as Element).closest('button, a, input, textarea, select, label')) return
  windowCommand('window.maximize')
}
function persistLocal() {
  assertLocalMetadataWritable(localMetadataDamaged)
  try { localStorage.setItem(localKey, JSON.stringify({ books: localBooks.value, bookDescriptionDrafts: bookDescriptionDrafts.value, chapters: localChapters.value, synced: syncedCopies.value, bookVersions: bookVersions.value, welcomeInitialized: welcomeInitialized.value, welcomeBookId: welcomeBookId.value })) }
  catch { throw new Error('浏览器无法保存本地内容，请复制正文或释放存储空间后重试。') }
}
const chapterKey = (chapter: Pick<Chapter, 'bookId' | 'id'>) => `${chapter.bookId}/${chapter.id}`
const batchItems = computed(() => {
  const byKey = new Map<string, Chapter>()
  for (const chapter of localChapters.value) if (!chapter.sha) byKey.set(chapterKey(chapter), chapter)
  for (const [key, draft] of Object.entries(drafts.value)) byKey.set(key, { ...draft.base, content: draft.content })
  const titleByBook = new Map<string, string>()
  for (const book of books.value) titleByBook.set(book.id, book.title)
  return Array.from(byKey, ([key, chapter]) => ({ key, bookId: chapter.bookId, bookTitle: titleByBook.get(chapter.bookId) || chapter.bookId, title: chapter.title, chapter }))
})
const batchGroups = computed(() => {
  const groups = new Map<string, { id: string; title: string; isNew: boolean; hasDescription: boolean; items: typeof batchItems.value }>()
  for (const book of localBooks.value) {
    if (!book.sha && book.kind !== 'page') groups.set(book.id, { id: book.id, title: book.title, isNew: true, hasDescription: false, items: [] })
  }
  for (const [id, draft] of Object.entries(bookDescriptionDrafts.value)) groups.set(id, { id, title: draft.base.title, isNew: false, hasDescription: true, items: [] })
  for (const item of batchItems.value) {
    let group = groups.get(item.bookId)
    if (!group) {
      group = { id: item.bookId, title: item.bookTitle, isNew: false, hasDescription: false, items: [] }
      groups.set(item.bookId, group)
    }
    group.items.push(item)
  }
  return Array.from(groups.values())
})
const pendingBatchCount = computed(() => batchGroups.value.reduce((count, group) => count + group.items.length + Number(group.isNew || group.hasDescription), 0))
function batchGroupKeys(group: typeof batchGroups.value[number]): string[] {
  return [...(group.isNew || group.hasDescription ? [`book:${group.id}`] : []), ...group.items.map(item => item.key)]
}
function isBatchGroupSelected(group: typeof batchGroups.value[number]): boolean {
  const keys = batchGroupKeys(group)
  return keys.length > 0 && keys.every(key => selectedKeys.value.includes(key))
}
function toggleBatchGroup(group: typeof batchGroups.value[number], event: Event) {
  const keys = batchGroupKeys(group)
  const selected = new Set(selectedKeys.value)
  for (const key of keys) {
    if ((event.target as HTMLInputElement).checked) selected.add(key)
    else selected.delete(key)
  }
  selectedKeys.value = [...selected]
}
function normalizeChapterTitle(chapter: Chapter): Chapter {
  if (!isMarkdownExt(chapter.ext)) return chapter
  const cleaned = cleanMarkdownTitle(chapter.title)
  return cleaned && cleaned !== chapter.title ? { ...chapter, title: cleaned } : chapter
}
async function getChapters(book: Notebook): Promise<Chapter[]> {
  if (isPageBookId(book.id)) {
    const page = remotePages.value.find(item => pageBookId(item.id) === book.id)
    const local = localChapters.value.find(item => item.bookId === book.id)
    const base = page ? pageAsChapter(page) : local
    return base ? [normalizeChapterTitle(base)] : []
  }
  const useSnapshot = snapshot.value
  const key = `${offlineMode.value ? 'offline' : useSnapshot ? 'snapshot' : 'remote'}:${book.id}`
  let pending = chapterCache.get(key)
  if (!pending) {
    pending = !loadedBookIds.value.includes(book.id) ? Promise.resolve([]) : offlineMode.value && restoredSnapshot.value ? Promise.resolve(restoredSnapshot.value.chapters[book.id] || []) : useSnapshot ? Promise.resolve([]) : store.listChapters(book.id).then(list => Promise.all(list.map(storeRemoteBinaryChapter))).catch(error => {
      const cached = restoredSnapshot.value
      if (cached && Object.prototype.hasOwnProperty.call(cached.chapters, book.id)) {
        notice.value = '无法连接 GitHub，正在显示上次恢复的本机副本。'
        return cached.chapters[book.id]
      }
      throw error
    })
    chapterCache.set(key, pending)
    pending.catch(() => { if (chapterCache.get(key) === pending) chapterCache.delete(key) })
  }
  const source = await pending
  const merged = source.map(chapter => {
    const copy = syncedCopies.value[chapterKey(chapter)]
    return normalizeChapterTitle(useSnapshot && copy?.snapshotVersion === snapshotVersion && copy.baseSha === chapter.sha ? copy.chapter : chapter)
  })
  const extras = [ ...localChapters.value.filter(chapter => !chapter.sha), ...Object.values(drafts.value).map(draft => draft.base), ...(useSnapshot ? Object.values(syncedCopies.value).filter(copy => copy.snapshotVersion === snapshotVersion && copy.baseSha === null).map(copy => copy.chapter) : []) ]
  for (const chapter of extras) {
    if (chapter.bookId === book.id && !merged.some(item => item.id === chapter.id)) merged.push(normalizeChapterTitle(chapter))
  }
  return sortChapters(merged, bookDescriptionDrafts.value[book.id]?.chapterOrder ?? book.chapterOrder)
}
function newId() { return crypto.randomUUID().replaceAll('-', '') }
function safeImportedTitle(name: string): string {
  const title = stripSupportedExtension(name).replace(/[\r\n]/g, ' ').trim() || '未命名'
  let safe = ''
  for (const character of title) {
    if (new TextEncoder().encode(safe + character).length > 128) break
    safe += character
  }
  return safe || '未命名'
}
function hasDraggedFiles(event: DragEvent) { return Array.from(event.dataTransfer?.types || []).includes('Files') }
function isEditorImageDrag(event: DragEvent): boolean {
  if (view.value !== 'edit' || !selectedChapterIsMarkdown.value) return false
  const target = event.target as HTMLElement | null
  if (!target?.closest('.paper.editor')) return false
  const items = Array.from(event.dataTransfer?.items || [])
  return items.length > 0 && items.every(item => item.kind === 'file' && item.type.startsWith('image/'))
}
function dragOverImport(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  if (isEditorImageDrag(event)) { draggingFiles.value = false; return }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  draggingFiles.value = true
}
function dropImport(event: DragEvent) {
  if (!hasDraggedFiles(event) || !event.dataTransfer) return
  if (isEditorImageDrag(event)) { draggingFiles.value = false; return }
  event.preventDefault()
  draggingFiles.value = false
  if (busy.value || writing) { error.value = '请等待当前操作完成后再导入。'; return }
  // Capture entries while the browser's drag data store is still readable.
  void importMarkdown(readDroppedMarkdown(event.dataTransfer, { allowOtherFiles: true }))
}
function fileInputImport(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (files?.length && !busy.value && !writing) void importMarkdown(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer, { allowOtherFiles: true }))
  else if (files?.length) error.value = '请等待当前操作完成后再导入。'
  input.value = ''
}

/** Native desktop picker retains the Markdown directory for relative images and supports .txt & read-only documents. */
async function chooseImportFiles() {
  if (busy.value || writing) { error.value = '请等待当前操作完成后再导入。'; return }
  if (!isDesktop.value) { importFileInput.value?.click(); return }
  try {
    const files = await pickDesktopImportFiles()
    if (files === null) throw new Error('无法打开桌面文件选择器，请重试。')
    if (files.length) await importMarkdown(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer, { allowOtherFiles: true }))
  } catch (e) { error.value = e instanceof Error ? e.message : '无法打开文件，请重试。' }
}

/** Native desktop folder picker retains real directories for .md, .txt, images, and read-only documents. */
async function chooseImportFolder() {
  if (busy.value || writing) { error.value = '请等待当前操作完成后再导入。'; return }
  if (!isDesktop.value) { importFolderInput.value?.click(); return }
  try {
    const files = await pickDesktopImportFolder()
    if (files === null) throw new Error('无法打开桌面文件夹选择器，请重试。')
    if (files.length) await importMarkdown(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer, { allowOtherFiles: true }))
  } catch (e) { error.value = e instanceof Error ? e.message : '无法打开文件夹，请重试。' }
}
function importedImageMime(path: string): string {
  const extension = path.toLowerCase().split('.').pop()
  return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : ''
}

/** Prepare one Markdown file without touching the original or local drafts. */
function prepareImportedImages(file: DroppedMarkdownResult['files'][number], bookId: string | null, images: DroppedMarkdownResult['images'], staged: Map<string, NoteAttachment>, known: Map<string, string>) {
  const targets = new Map<string, string>()
  const paths = new Map<string, string>()
  for (const image of images) {
    for (const reference of image.references) {
      if (reference.markdownPath !== file.path) continue
      const previous = paths.get(reference.target)
      if (previous && previous !== image.path) throw new Error('图片路径存在歧义，未导入笔记；请检查原始文件夹。')
      paths.set(reference.target, image.path)
      const key = `${bookId || ''}\0${image.path}`
      let path = known.get(key)
      if (!path) { path = newAttachmentPath(bookId, importedImageMime(image.path)); known.set(key, path) }
      targets.set(reference.target, `assets/${path.split('/').pop()}`)
    }
  }
  const rewritten = rewriteImportedImages(file.content, targets)
  for (const target of rewritten.replaced) {
    const originalPath = paths.get(target)!
    const image = images.find(item => item.path === originalPath)!
    const path = known.get(`${bookId || ''}\0${originalPath}`)!
    staged.set(path, { path, bytes: image.bytes })
  }
  return { content: rewritten.content, unmatched: targets.size - rewritten.replaced.length, replaced: rewritten.replaced }
}

function repairFolderImport(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (files?.length && !busy.value && !writing) void repairCurrentImages(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer))
  else if (files?.length) error.value = '请等待当前操作完成后再补齐图片。'
  input.value = ''
}

async function chooseRepairFolder() {
  if (busy.value || writing || !selectedChapter.value) { error.value = '请先打开笔记，并等待当前操作完成后再补齐图片。'; return }
  if (!isDesktop.value) { repairFolderInput.value?.click(); return }
  const originalChapter = chapterKey(selectedChapter.value)
  try {
    const files = await pickDesktopMarkdownFolder()
    if (files === null) throw new Error('无法打开桌面文件夹选择器，请重试。')
    if (!files.length) return
    if (!selectedChapter.value || chapterKey(selectedChapter.value) !== originalChapter) throw new Error('笔记已切换，请返回原笔记后重试。')
    await repairCurrentImages(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer))
  } catch (e) { error.value = e instanceof Error ? e.message : '无法读取原笔记文件夹，请重试。' }
}

/** A standalone picture folder is scanned only after the user selects it. */
function repairImageFolderImport(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (files?.length && !busy.value && !writing && selectedChapter.value) {
    // The reader captures the picker files synchronously before the input is
    // reset. A virtual Markdown file carries the current draft without
    // requiring the original .md to be in the selected image folder.
    const source = { path: '当前笔记.md', name: '当前笔记.md', content: content.value }
    void repairCurrentImages(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer, { referenceFiles: [source], selectedImageFolder: true }), source)
  } else if (files?.length) error.value = '请先打开笔记，并等待当前操作完成后再补齐图片。'
  input.value = ''
}

/** Re-selecting a Markdown file authorizes the desktop to read its images. */
async function repairImagesFromOriginalPaths() {
  if (!isDesktop.value || !selectedChapter.value || busy.value || writing) return
  const originalChapter = chapterKey(selectedChapter.value)
  try {
    const files = await pickDesktopMarkdownFiles()
    if (files === null) throw new Error('无法打开桌面文件选择器，请重试。')
    if (!files.length) return
    if (files.length !== 1) throw new Error('请只选择当前笔记对应的一个原始 Markdown 文件。')
    if (!selectedChapter.value || chapterKey(selectedChapter.value) !== originalChapter) throw new Error('笔记已切换，请返回原笔记后重试。')
    await repairCurrentImages(readDroppedMarkdown({ files, items: [] } as unknown as DataTransfer), undefined, true)
  } catch (e) { error.value = e instanceof Error ? e.message : '无法读取原笔记，请重试。' }
}

async function repairCurrentImages(reading: Promise<DroppedMarkdownResult>, selectedImageSource?: { path: string; name: string; content: string }, resolveOriginalPaths = false) {
  if (busy.value || writing || !selectedChapter.value || !saveDraft()) return
  const chapter = selectedChapter.value
  const original = content.value
  if (selectedImageSource && selectedImageSource.content !== original) { error.value = '笔记内容已发生变化，请重新选择图片文件夹。'; return }
  clearMessages()
  const success = await run(async () => {
    const parsed = await reading
    const result = !selectedImageSource || resolveOriginalPaths ? await resolveDesktopImportedImages(parsed) : parsed
    const encodedChapterTitle = decodeEncodedChapterPath(chapter.id)
    const chapterPrimaryTitle = displayChapterItem(chapter).primaryTitle
    let matches = selectedImageSource ? result.files.filter(file => file.path === selectedImageSource.path && file.content === original) : result.files.filter(file => {
      const root = result.folders.find(folder => file.path.startsWith(`${folder}/`))
      const candidate = safeImportedTitle(root ? file.path.slice(root.length + 1) : file.name)
      const fileStem = safeImportedTitle(file.name)
      const fileH1 = extractMarkdownTitle(file.content, candidate)
      return (
        candidate === chapter.title ||
        fileStem === chapterPrimaryTitle ||
        fileH1 === chapter.title ||
        (encodedChapterTitle !== null && candidate === encodedChapterTitle)
      )
    })
    if (!selectedImageSource && !matches.length) {
      // A synced chapter may display its Markdown heading instead of its old
      // filename. Fall back only when one source file has matching image
      // references in the current text; never guess between multiple files.
      matches = result.files.filter(file => {
        const targets = new Map<string, string>()
        for (const image of result.images) for (const reference of image.references) {
          if (reference.markdownPath === file.path) targets.set(reference.target, `assets/${'0'.repeat(32)}.png`)
        }
        return rewriteImportedImages(original, targets).replaced.length > 0
      })
    }
    if (matches.length !== 1) throw new Error(matches.length ? '原文件夹中有多个同名章节，无法安全确定图片来源。' : '原文件夹中未找到与当前章节同名的 Markdown 文件，请选择导入时使用的文件夹。')
    const source = { ...matches[0], content: original }
    const staged = new Map<string, NoteAttachment>()
    const prepared = prepareImportedImages(source, isPageBookId(chapter.bookId) ? null : chapter.bookId, result.images, staged, new Map())
    const repaired = prepared.content
    const ambiguous = result.skipped.filter(item => item.reason === 'ambiguous').length
    const remaining = result.localResources.filter(item => item.markdownPath === source.path).length + prepared.unmatched
    if (!staged.size || repaired === original) throw new Error(ambiguous ? '图片文件夹中存在同名图片，无法安全确定来源；请选择不含重名图片的文件夹。' : resolveOriginalPaths ? '无法从原路径找到可补齐的图片；请检查原图片是否仍在本机，或选择“从图片文件夹补齐”。' : '没有找到可补齐的图片；请检查当前笔记的图片路径和所选文件夹。')
    if (selectedImageSource && !resolveOriginalPaths) {
      const readable = (value: string) => { try { return decodeURIComponent(value).replace(/[\r\n]/g, ' ') } catch { return value.replace(/[\r\n]/g, ' ') } }
      const mappings = prepared.replaced.flatMap(target => {
        const image = result.images.find(item => item.references.some(ref => ref.markdownPath === source.path && ref.target === target))
        return image ? [`${readable(target)} → ${readable(image.path)}`] : []
      })
      const preview = mappings.slice(0, 5).join('\n')
      const more = mappings.length > 5 ? `\n……另有 ${mappings.length - 5} 处匹配` : ''
      const unresolved = `${ambiguous ? `\n${ambiguous} 处图片重名，无法安全匹配。` : ''}${remaining ? `\n${remaining} 处图片或链接未能匹配，将保持原样。` : ''}`
      if (!window.confirm(`将从所选图片文件夹补齐 ${staged.size} 张图片到当前笔记“${chapter.title}”。\n\n${preview}${more}${unresolved}\n\n请确认所选文件夹中的图片对应这些路径；正文的其他内容会保留。`)) return
    }
    if (!selectedImageSource && !window.confirm(`将从“${source.path}”对应的文件夹补齐 ${staged.size} 张图片到当前笔记“${chapter.title}”。\n\n正文中匹配的图片路径会更新，其他编辑内容会保留。请确认这是原始笔记文件夹。`)) return
    for (const image of staged.values()) await putAttachment(initialRepository, image)
    if (selectedChapter.value !== chapter || content.value !== original) throw new Error('图片读取期间笔记已变化，未修改正文；请重新操作。')
    // Persist the new draft before replacing visible content. Existing remote
    // base and any unsynchronized edits stay intact if local storage fails.
    try { localStorage.setItem(draftKey(chapter), JSON.stringify({ content: repaired, base: chapter })) }
    catch { throw new Error('无法保存补齐后的本机草稿；原正文未改变，请检查存储空间。') }
    drafts.value = { ...drafts.value, [chapterKey(chapter)]: { content: repaired, base: chapter } }
    suspendDraft = true
    try { content.value = repaired } finally { suspendDraft = false }
    if (autoSave.value) { autoKeys.add(chapterKey(chapter)); scheduleAuto() }
    notice.value = `已补齐 ${staged.size} 张图片到当前笔记，请同步以保存到 GitHub。${ambiguous ? `${ambiguous} 处图片存在重名，未自动匹配。` : ''}${remaining ? `还有 ${remaining} 处图片或链接未能导入，请检查。` : ''}`
  })
  if (success) importing.value = false
}

async function importMarkdown(reading: Promise<DroppedMarkdownResult>) {
  if (busy.value || writing || !saveDraft()) { error.value = '请等待当前操作完成后再导入。'; return }
  const destination = selectedBook.value && selectedBook.value.kind !== 'page' ? selectedBook.value : null
  const targetCabinet = activeCabinet.value || 'general'
  clearMessages()
  const success = await run(async () => {
    const result = await resolveDesktopImportedImages(await reading)
    const droppedDocs = result.documents || []
    const beforeBooks = localBooks.value
    const beforeChapters = localChapters.value
    const addedBooks: ShelfBook[] = []
    const addedChapters: Chapter[] = []
    const sourceFiles: Array<{ file: DroppedMarkdownResult['files'][number]; chapter: Chapter; assetBookId: string | null }> = []
    const staged = new Map<string, NoteAttachment>()
    const stagedDocs: StoredDocumentFile[] = []
    const known = new Map<string, string>()
    // A separately dropped Typora .assets folder is not an empty notebook.
    const importFolders = result.folders.filter(folder => {
      if (result.files.some(file => file.path.startsWith(`${folder}/`)) || droppedDocs.some(doc => doc.path.startsWith(`${folder}/`))) return true
      const isResourceFolder = /\.assets$/i.test(folder) || result.images.some(image => image.path.startsWith(`${folder}/`)) || result.skipped.some(item => item.path.startsWith(`${folder}/`) && /\.(?:png|jpe?g|gif|webp)$/i.test(item.path))
      return !isResourceFolder
    })
    const createdCabinetBooks = new Map<string, string[]>()
    const createdCabinetIds: string[] = []
    const importAsCabinet = folderImportMode.value === 'cabinet' && !destination

    const appendEntriesToBook = (
      book: ShelfBook,
      entries: Array<
        | { kind: 'text'; relative: string; file: DroppedMarkdownResult['files'][number] }
        | { kind: 'doc'; relative: string; doc: NonNullable<DroppedMarkdownResult['documents']>[number] }
      >
    ) => {
      entries.sort((a, b) => compareImportedPaths(a.relative, b.relative))
      const folderOrder: string[] = []
      for (const entry of entries) {
        const pathTitle = safeImportedTitle(entry.relative)
        if (entry.kind === 'text') {
          const displayTitle = entry.file.ext === 'txt'
            ? pathTitle
            : extractMarkdownTitle(entry.file.content, pathTitle)
          const cid = chapterIdFromTitle(safeEncodedTitleForId(pathTitle))
          const chapter: Chapter = { bookId: book.id, id: cid, title: displayTitle, content: entry.file.content, sha: '', ...(entry.file.ext === 'txt' ? { ext: 'txt' } : {}) }
          addedChapters.push(chapter)
          folderOrder.push(cid)
          if (entry.file.ext !== 'txt') sourceFiles.push({ file: entry.file, chapter, assetBookId: book.id })
        } else {
          const filePath = newDocumentPath(book.id, entry.doc.ext)
          stagedDocs.push({ path: filePath, bytes: entry.doc.bytes })
          const cid = chapterIdFromTitle(safeEncodedTitleForId(pathTitle))
          const chapter: Chapter = { bookId: book.id, id: cid, title: pathTitle, content: '', sha: '', ext: entry.doc.ext, filePath, fileName: displayFileName(pathTitle, entry.doc.ext), fileSize: entry.doc.bytes.length }
          addedChapters.push(chapter)
          folderOrder.push(cid)
        }
      }
      if (folderOrder.length > 0 && folderOrder.length <= 999) {
        book.chapterOrder = folderOrder
      }
      addedBooks.push(book)
    }

    for (const folder of importFolders) {
      const folderEntries: Array<
        | { kind: 'text'; relative: string; file: DroppedMarkdownResult['files'][number] }
        | { kind: 'doc'; relative: string; doc: NonNullable<DroppedMarkdownResult['documents']>[number] }
      > = [
        ...result.files
          .filter(item => item.path.startsWith(`${folder}/`))
          .map(file => ({ kind: 'text' as const, relative: file.path.slice(folder.length + 1), file })),
        ...droppedDocs
          .filter(item => item.path.startsWith(`${folder}/`))
          .map(doc => ({ kind: 'doc' as const, relative: doc.path.slice(folder.length + 1), doc }))
      ]
      if (importAsCabinet) {
        const cabId = catalog.create(safeImportedTitle(folder))
        createdCabinetIds.push(cabId)
        const cabBookIds: string[] = []
        const subGroups = new Map<string, typeof folderEntries>()
        const rootEntries: typeof folderEntries = []
        for (const entry of folderEntries) {
          const slashIdx = entry.relative.indexOf('/')
          if (slashIdx > 0) {
            const subName = entry.relative.slice(0, slashIdx)
            const innerRel = entry.relative.slice(slashIdx + 1)
            const list = subGroups.get(subName) || []
            list.push({ ...entry, relative: innerRel } as typeof entry)
            subGroups.set(subName, list)
          } else {
            rootEntries.push(entry)
          }
        }
        const sortedSubNames = [...subGroups.keys()].sort((a, b) => compareImportedPaths(a, b))
        for (const subName of sortedSubNames) {
          const book: ShelfBook = { id: newId(), title: safeImportedTitle(subName), sha: '' }
          appendEntriesToBook(book, subGroups.get(subName)!)
          cabBookIds.push(book.id)
        }
        rootEntries.sort((a, b) => compareImportedPaths(a.relative, b.relative))
        for (const entry of rootEntries) {
          if (entry.kind === 'text') {
            const pathTitle = safeImportedTitle(entry.relative)
            const displayTitle = entry.file.ext === 'txt' ? pathTitle : extractMarkdownTitle(entry.file.content, pathTitle)
            const extProp = entry.file.ext === 'txt' ? { ext: 'txt' as const } : {}
            const id = pageIdFromTitle(safeEncodedTitleForId(pathTitle))
            const book: ShelfBook = { id: pageBookId(id), title: displayTitle, sha: '', kind: 'page', ...extProp }
            addedBooks.push(book)
            cabBookIds.push(book.id)
            const chapter: Chapter = { bookId: book.id, id, title: displayTitle, content: entry.file.content, sha: '', ...extProp }
            addedChapters.push(chapter)
            if (entry.file.ext !== 'txt') sourceFiles.push({ file: entry.file, chapter, assetBookId: null })
          } else {
            const title = safeImportedTitle(entry.relative)
            const id = pageIdFromTitle(title)
            const filePath = newDocumentPath(null, entry.doc.ext)
            stagedDocs.push({ path: filePath, bytes: entry.doc.bytes })
            const book: ShelfBook = { id: pageBookId(id), title, sha: '', kind: 'page', ext: entry.doc.ext }
            addedBooks.push(book)
            cabBookIds.push(book.id)
            const chapter: Chapter = { bookId: book.id, id, title, content: '', sha: '', ext: entry.doc.ext, filePath, fileName: displayFileName(title, entry.doc.ext), fileSize: entry.doc.bytes.length }
            addedChapters.push(chapter)
          }
        }
        createdCabinetBooks.set(cabId, cabBookIds)
      } else {
        const book: ShelfBook = { id: newId(), title: safeImportedTitle(folder), sha: '' }
        appendEntriesToBook(book, folderEntries)
      }
    }
    const looseTextFiles = result.files
      .filter(item => !importFolders.some(folder => item.path.startsWith(`${folder}/`)))
      .sort((a, b) => compareImportedPaths(a.path, b.path))
    for (const file of looseTextFiles) {
      const pathTitle = safeImportedTitle(file.name)
      const displayTitle = file.ext === 'txt' ? pathTitle : extractMarkdownTitle(file.content, pathTitle)
      const extProp = file.ext === 'txt' ? { ext: 'txt' as const } : {}
      if (destination) {
        const chapter: Chapter = { bookId: destination.id, id: chapterIdFromTitle(pathTitle), title: displayTitle, content: file.content, sha: '', ...extProp }
        addedChapters.push(chapter)
        if (file.ext !== 'txt') sourceFiles.push({ file, chapter, assetBookId: destination.id })
      } else {
        const id = pageIdFromTitle(pathTitle)
        const book: ShelfBook = { id: pageBookId(id), title: displayTitle, sha: '', kind: 'page', ...extProp }
        addedBooks.push(book)
        const chapter: Chapter = { bookId: book.id, id, title: displayTitle, content: file.content, sha: '', ...extProp }
        addedChapters.push(chapter)
        if (file.ext !== 'txt') sourceFiles.push({ file, chapter, assetBookId: null })
      }
    }
    const looseDocs = droppedDocs
      .filter(item => !importFolders.some(folder => item.path.startsWith(`${folder}/`)))
      .sort((a, b) => compareImportedPaths(a.path, b.path))
    for (const doc of looseDocs) {
      const title = safeImportedTitle(doc.name)
      if (destination) {
        const filePath = newDocumentPath(destination.id, doc.ext)
        stagedDocs.push({ path: filePath, bytes: doc.bytes })
        const chapter: Chapter = { bookId: destination.id, id: chapterIdFromTitle(title), title, content: '', sha: '', ext: doc.ext, filePath, fileName: displayFileName(title, doc.ext), fileSize: doc.bytes.length }
        addedChapters.push(chapter)
      } else {
        const id = pageIdFromTitle(title)
        const filePath = newDocumentPath(null, doc.ext)
        stagedDocs.push({ path: filePath, bytes: doc.bytes })
        const book: ShelfBook = { id: pageBookId(id), title, sha: '', kind: 'page', ext: doc.ext }
        addedBooks.push(book)
        const chapter: Chapter = { bookId: book.id, id, title, content: '', sha: '', ext: doc.ext, filePath, fileName: displayFileName(title, doc.ext), fileSize: doc.bytes.length }
        addedChapters.push(chapter)
      }
    }
    if (!addedBooks.length && !addedChapters.length) throw new Error('没有可导入的支持文件或文件夹（支持 Markdown、TXT、PDF、Word、PPT、Excel 等）。')
    let unmatched = 0
    for (const { file, chapter, assetBookId } of sourceFiles) {
      const prepared = prepareImportedImages(file, assetBookId, result.images, staged, known)
      chapter.content = prepared.content
      unmatched += prepared.unmatched
    }
    // Attachment and document writes may leave unused files if a later operation fails;
    // they are immutable and never overwrite any existing user data.
    for (const image of staged.values()) await putAttachment(initialRepository, image)
    for (const doc of stagedDocs) await putDocumentFile(initialRepository, doc)
    localBooks.value = [...beforeBooks, ...addedBooks]
    localChapters.value = [...beforeChapters, ...addedChapters]
    try {
      persistLocal()
      const assignedToNewCab = new Set<string>()
      for (const [cabId, bookIds] of createdCabinetBooks.entries()) {
        if (bookIds.length) {
          catalog.moveMany(bookIds, cabId)
          bookIds.forEach(id => assignedToNewCab.add(id))
        }
      }
      const remainingBookIds = addedBooks.map(book => book.id).filter(id => !assignedToNewCab.has(id))
      if (remainingBookIds.length) catalog.moveMany(remainingBookIds, targetCabinet)
    } catch (e) {
      localBooks.value = beforeBooks; localChapters.value = beforeChapters
      for (const cabId of createdCabinetIds) { try { catalog.remove(cabId) } catch { /* ignore */ } }
      try { persistLocal() } catch { throw new Error('导入未完成，本地保存失败，请检查存储空间。') }
      throw e
    }
    books.value = [...books.value, ...addedBooks]
    if (destination && selectedBook.value?.id === destination.id) chapters.value = [...chapters.value, ...addedChapters.filter(chapter => chapter.bookId === destination.id)]
    localMutationVersion++
    const unresolved = result.localResources.length + unmatched
    const extra = [result.skipped.length ? `${result.skipped.length} 项不支持或无法读取，已跳过` : '', unresolved ? `${unresolved} 处相对图片或链接未随文件导入（可打开文档后一键补齐图片）` : ''].filter(Boolean).join('；')
    const docHint = stagedDocs.length ? `（其中 ${stagedDocs.length} 个外部文档为只读查看）` : ''
    const cabHint = createdCabinetIds.length ? `${createdCabinetIds.length} 个书柜、` : ''
    notice.value = `已导入 ${cabHint}${addedBooks.length} 项书本/书页、${addedChapters.filter(item => !isPageBookId(item.bookId)).length} 篇章节、${staged.size} 张图片到本机${docHint}。${extra ? ` ${extra}。` : ''}`
    if (autoSave.value) {
      for (const cabId of createdCabinetIds) autoCabinets.add(cabId)
      for (const book of addedBooks) if (book.kind !== 'page') autoBooks.add(book.id)
      for (const chapter of addedChapters) autoKeys.add(chapterKey(chapter))
      scheduleAuto()
    }
  })
  if (success) importing.value = false
}
function addWelcome() {
  if (busy.value || writing) { error.value = '正在同步，请稍后添加使用说明。'; return }
  if (!saveDraft()) return
  clearMessages()
  try {
    assertLocalMetadataWritable(localMetadataDamaged)
    const added = addWelcomeNotebook(localStorage, initialRepository, snapshotFiles, newId, true)
    if (!added) return
    localBooks.value = [...localBooks.value, added.book]
    localChapters.value = [...localChapters.value, ...added.chapters]
    welcomeInitialized.value = true
    welcomeBookId.value = added.book.id
    books.value = [...books.value, added.book]
    localMutationVersion++
    notice.value = '使用说明已添加到本机，可编辑、删除或选择同步。'
  } catch (e) { error.value = `无法添加使用说明：${message(e)}` }
}
const draftKey = (chapter: Chapter) => `${draftPrefix}${chapter.bookId}:${chapter.id}`
const dirty = computed(() => !!selectedChapter.value && content.value !== selectedChapter.value.content)
const selectedChapterDisplay = computed(() => selectedChapter.value ? displayChapterItem(selectedChapter.value) : null)
const unresolvedLocalImageCount = computed(() => {
  if (!selectedChapter.value || !selectedChapterIsMarkdown.value || !content.value) return 0
  return localImageReferences(content.value).filter(src => !/^(?:\.\/)?assets\/[a-f0-9]{32}\.(?:png|jpe?g|gif|webp)$/i.test(src)).length
})
const chosenCabinet = computed(() => catalog.cabinets.value.find(cabinet => cabinet.id === activeCabinet.value) || null)
const cabinetItems = computed(() => catalog.cabinets.value.map(cabinet => ({ ...cabinet, books: books.value.filter(book => catalog.assigned(book.id) === cabinet.id) })))
const defaultCabinetTitle = computed(() => catalog.cabinets.value.find(cabinet => cabinet.id === 'general')?.title || '默认书柜')
const visibleCabinets = computed(() => cabinetItems.value.filter(cabinet => {
  const q = query.value.trim().toLowerCase()
  return !q || cabinet.title.toLowerCase().includes(q) || cabinet.books.some(book => book.title.toLowerCase().includes(q))
}))
const filteredBooks = computed(() => books.value.filter(book => catalog.assigned(book.id) === activeCabinet.value && book.title.toLowerCase().includes(query.value.trim().toLowerCase())))
function itemTotals(items: ShelfBook[]): string {
  const pages = items.filter(item => item.kind === 'page').length
  const notebooks = items.length - pages
  return [notebooks ? `${notebooks} 本笔记本` : '', pages ? `${pages} 张书页` : ''].filter(Boolean).join(' · ')
}
const introSummary = computed(() => {
  if (selectedBook.value) return `${chapters.value.length} 章`
  if (chosenCabinet.value) return itemTotals(filteredBooks.value)
  return [`${cabinetItems.value.length} 个书柜`, itemTotals(books.value)].filter(Boolean).join(' · ')
})
const shelfBooks = computed<ShelfBook[]>(() => filteredBooks.value.map(book => {
  if (book.kind === 'page') {
    const page = remotePages.value.find(item => pageBookId(item.id) === book.id)
    const local = localChapters.value.find(item => item.bookId === book.id)
    const chapter = page ? pageAsChapter(page) : local
    const ext = book.ext || chapter?.ext
    const text = chapter && !isBinaryDocumentExt(ext) ? (drafts.value[chapterKey(chapter)]?.content ?? local?.content ?? page?.content) : ''
    return { ...book, ...(ext ? { ext } : {}), ...(text ? { previewText: text } : {}) }
  }
  const count = shelfCounts.value[book.id]
  return { ...book, ...(count === undefined ? {} : { chapterCount: count }) }
}))

// Clear cached remote listings only when their underlying library can change;
// never deep-watch megabyte snapshots synchronously.
watch([books, localChapters, loadedBookIds, restoredSnapshot, offlineMode, snapshot], () => {
  shelfChapterIds.clear()
})
let shelfReadRun = 0
watch([filteredBooks, activeCabinet, selectedBook, localChapters, drafts, syncedCopies, loadedBookIds, restoredSnapshot, offlineMode, snapshot], async () => {
  const run = ++shelfReadRun
  if (!activeCabinet.value || selectedBook.value) return
  const visible = filteredBooks.value.filter(book => book.kind !== 'page')
  if (!visible.length) { shelfCounts.value = {}; return }
  // Pre-group local extra chapters by bookId once in O(M) instead of O(N*M) inside readOne.
  const extrasByBook = new Map<string, string[]>()
  const pushExtra = (chapter: Chapter) => {
    const list = extrasByBook.get(chapter.bookId)
    if (list) list.push(chapter.id)
    else extrasByBook.set(chapter.bookId, [chapter.id])
  }
  for (const chapter of localChapters.value) if (!chapter.sha) pushExtra(chapter)
  for (const draft of Object.values(drafts.value)) pushExtra(draft.base)
  if (snapshot.value) {
    for (const copy of Object.values(syncedCopies.value)) {
      if (copy.snapshotVersion === snapshotVersion && copy.baseSha === null) pushExtra(copy.chapter)
    }
  }
  const loadedSet = new Set(loadedBookIds.value)
  const snap = restoredSnapshot.value
  const nextCounts: Record<string, number> = {}
  const needRemote: ShelfBook[] = []

  // Fast local-first pass: resolve all locally cached books synchronously in a SINGLE batched update!
  for (const book of visible) {
    let ids: string[] | null
    if (!loadedSet.has(book.id)) ids = book.sha ? null : []
    else if (snap && Object.prototype.hasOwnProperty.call(snap.chapters, book.id)) ids = snap.chapters[book.id].map(chapter => chapter.id)
    else if (snapshot.value) ids = []
    else { needRemote.push(book); continue }
    if (ids !== null) {
      const extraIds = extrasByBook.get(book.id) || []
      nextCounts[book.id] = extraIds.length ? new Set([...ids, ...extraIds]).size : ids.length
    }
  }
  if (run !== shelfReadRun) return
  shelfCounts.value = { ...nextCounts }

  if (!needRemote.length || offlineMode.value) return
  let cursor = 0
  async function readOne(book: ShelfBook) {
    let pending = shelfChapterIds.get(book.id)
    if (!pending) {
      pending = store.listChapterIds(book.id).catch(() => null)
      shelfChapterIds.set(book.id, pending)
    }
    const ids = await pending
    if (run !== shelfReadRun || ids === null) return
    const extraIds = extrasByBook.get(book.id) || []
    nextCounts[book.id] = extraIds.length ? new Set([...ids, ...extraIds]).size : ids.length
  }
  await Promise.all(Array.from({ length: Math.min(3, needRemote.length) }, async () => {
    while (cursor < needRemote.length && run === shelfReadRun) await readOne(needRemote[cursor++])
  }))
  if (run === shelfReadRun) shelfCounts.value = { ...nextCounts }
})
const managedBooks = computed(() => filteredBooks.value)
const hasWelcomeBook = computed(() => !!welcomeBookId.value && books.value.some(book => book.id === welcomeBookId.value))
const filteredChapters = computed(() => {
  const q = query.value.trim().toLowerCase()
  return chapters.value.filter(chapter => !q || chapter.title.toLowerCase().includes(q) || chapter.content.toLowerCase().includes(q))
})
const searchResults = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return searchIndex.value.filter(chapter => chapter.title.toLowerCase().includes(q) || chapter.content.toLowerCase().includes(q))
})

function chapterAttachmentReferences(chapter: Chapter, body = chapter.content) {
  return attachmentReferences(body, isPageBookId(chapter.bookId) ? null : chapter.bookId)
}

/** Commit image bytes first; the editor inserts Markdown only after success. */
async function savePastedImages(files: File[]): Promise<string[]> {
  const chapter = selectedChapter.value
  if (!chapter || busy.value) throw new Error('请先打开可编辑的章节。')
  const context = chapterKey(chapter)
  const names: string[] = []
  for (const file of files) {
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error('单张图片为空或超过 20 MiB，请缩小后重试。')
    const path = newAttachmentPath(isPageBookId(chapter.bookId) ? null : chapter.bookId, file.type)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!selectedChapter.value || chapterKey(selectedChapter.value) !== context) throw new Error('已切换章节，请在目标位置重新粘贴图片。')
    await putAttachment(initialRepository, { path, bytes })
    names.push(`assets/${path.split('/').pop()}`)
  }
  return names
}
function reportImagePasteStatus(message: string) { error.value = message }

async function localOrRemoteImage(path: string): Promise<NoteAttachment | null> {
  const cached = await getAttachment(initialRepository, path)
  if (cached || !connected.value) return cached
  const remote = await store.readAttachment(path)
  await putAttachment(initialRepository, remote)
  return remote
}

async function refreshImageUrls() {
  const run = ++imageRefresh
  const chapter = selectedChapter.value
  const refs = chapter ? chapterAttachmentReferences(chapter, content.value) : []
  const previous = imageObjects
  const next = new Map<string, string>()
  const created: string[] = []
  let failed = false
  for (const ref of refs) {
    // Different valid relative spellings (assets/... and ./assets/...) can
    // name the same file; reuse this run's URL before allocating another.
    let url = next.get(ref.path) || previous.get(ref.path)
    if (!url) {
      try {
        const image = await localOrRemoteImage(ref.path)
        if (!image) { failed = true; continue }
        url = URL.createObjectURL(new Blob([image.bytes], { type: attachmentMime(image.path) }))
        created.push(url)
      } catch { failed = true; continue }
    }
    next.set(ref.path, url)
  }
  if (run !== imageRefresh || disposed) { created.forEach(url => URL.revokeObjectURL(url)); return }
  imageObjects = next
  imageUrls.value = Object.fromEntries(refs.flatMap(ref => next.has(ref.path) ? [[ref.src, next.get(ref.path)!]] : []))
  imageWarning.value = failed ? '部分图片附件暂不可用；请连接仓库并恢复，或检查本地存储。' : ''
  await nextTick()
  for (const [path, url] of previous) if (next.get(path) !== url) URL.revokeObjectURL(url)
}
let imageRefreshTimer: ReturnType<typeof setTimeout> | undefined
watch([selectedChapter, content, connected], () => {
  // Invalidate pending reads immediately, then coalesce typing into one parse.
  imageRefresh++
  clearTimeout(imageRefreshTimer)
  imageRefreshTimer = setTimeout(() => { void refreshImageUrls() }, 80)
})
watch([view, content, imageUrls], () => {
  void nextTick(() => { if (readingPaper.value) applyImageUrls(readingPaper.value, imageUrls.value) })
}, { flush: 'post' })

function message(e: unknown) {
  return e instanceof Error ? e.message : '操作没有完成，请稍后重试。'
}
function clearMessages() { error.value = ''; notice.value = ''; remoteVersion.value = null }
function revealConnection() {
  const panel = document.querySelector<HTMLDetailsElement>('details#connection')
  if (panel) panel.open = true
}
function goToConnection() {
  revealConnection()
  document.getElementById('connection')?.scrollIntoView({ behavior: 'smooth' })
}
function saveDraft(): boolean {
  const chapter = selectedChapter.value
  if (!chapter || typeof localStorage === 'undefined' || !isEditableExt(chapter.ext)) return true
  try {
    const key = chapterKey(chapter)
    if (content.value === chapter.content && !inFlightKeys.has(key)) {
      localStorage.removeItem(draftKey(chapter))
      const next = { ...drafts.value }; delete next[key]; drafts.value = next
    } else {
      const draft = { content: content.value, base: chapter }
      localStorage.setItem(draftKey(chapter), JSON.stringify(draft))
      drafts.value = { ...drafts.value, [key]: draft }
    }
    return true
  } catch { error.value = '浏览器无法保存本地草稿，请复制正文或释放存储空间后重试。'; return false }
}
watch(content, () => {
  if (suspendDraft) return
  if (!saveDraft()) { autoSave.value = false; autoStatus.value = '本地草稿保存失败，自动保存已暂停'; return }
  if (selectedChapter.value && autoSave.value) { autoKeys.add(chapterKey(selectedChapter.value)); scheduleAuto() }
}, { flush: 'sync' })

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try { await action(); return true } catch (e) { error.value = message(e); return false } finally { busy.value = false }
}
async function storeRemoteBinaryChapter(chapter: Chapter): Promise<Chapter> {
  if (!chapter.binaryBytes || !chapter.ext || !BINARY_DOCUMENT_EXTENSIONS.has(chapter.ext)) return chapter
  const filePath = `docs/notebooks/${chapter.bookId}/files/${chapter.sha.slice(0, 32)}.${chapter.ext}`
  await putDocumentFile(initialRepository, { path: filePath, bytes: chapter.binaryBytes })
  const { binaryBytes: _unused, ...clean } = chapter
  return { ...clean, filePath }
}
async function storeRemoteBinaryPage(page: Page): Promise<Page> {
  if (!page.binaryBytes || !page.ext || !BINARY_DOCUMENT_EXTENSIONS.has(page.ext)) return page
  const filePath = `docs/pages/files/${page.sha.slice(0, 32)}.${page.ext}`
  await putDocumentFile(initialRepository, { path: filePath, bytes: page.binaryBytes })
  const { binaryBytes: _unused, ...clean } = page
  return { ...clean, filePath }
}
async function loadBooks(useSnapshot = snapshot.value) {
  const [remoteBooks, rawPages] = useSnapshot ? [[], []] : await Promise.all([store.listNotebooks(), store.listPages()])
  const pages = await Promise.all(rawPages.map(storeRemoteBinaryPage))
  remotePages.value = pages
  chapterCache.clear()
  loadedBookIds.value = remoteBooks.map(book => book.id)
  books.value = mergeBooks([...remoteBooks, ...pages.map(pageAsBook)], useSnapshot)
  snapshot.value = useSnapshot
}
function mergeBooks(remoteBooks: ShelfBook[], useSnapshot: boolean): ShelfBook[] {
  latestBookMetadata.value = remoteBooks.filter(book => book.kind !== 'page')
  latestBookMetadataComplete = !useSnapshot
  const realIds = new Set([...remoteBooks, ...localBooks.value].filter(book => book.kind !== 'page').map(book => book.id))
  if (remoteBooks.some(book => book.kind === 'page' && realIds.has(book.id)) || localBooks.value.some(book => book.kind === 'page' && realIds.has(book.id))) throw new Error('GitHub 中的书页与笔记本编号重复，请先重命名其中一个文件以避免覆盖。')
  const merged = [...remoteBooks, ...localBooks.value.filter(local => !remoteBooks.some(book => book.id === local.id) && (!local.sha || localChapters.value.some(chapter => chapter.bookId === local.id && !chapter.sha) || Object.values(drafts.value).some(draft => draft.base.bookId === local.id) || (useSnapshot && bookVersions.value[local.id] === snapshotVersion)))]
  for (const draft of Object.values(bookDescriptionDrafts.value)) if (!merged.some(book => book.id === draft.base.id)) merged.push(draft.base)
  for (const draft of Object.values(drafts.value)) {
    if (!merged.some(book => book.id === draft.base.bookId)) merged.push({ id: draft.base.bookId, title: `本地草稿 · ${draft.base.bookId.slice(0, 8)}`, sha: '' })
  }
  return merged.map(book => {
    const draft = bookDescriptionDrafts.value[book.id]
    return draft ? { ...book, ...(draft.title ? { title: draft.title } : {}), description: draft.description, ...(draft.chapterOrder ? { chapterOrder: draft.chapterOrder } : {}) } : book
  })
}
function openCabinet(id = '') {
  if (!saveDraft()) return
  if (id && !catalog.cabinets.value.some(cabinet => cabinet.id === id)) { error.value = '书柜不存在，请刷新目录。'; return }
  ++bookRun
  activeCabinet.value = id
  deleteBookIds.value = []; deleteChapterIds.value = []
  selectedBook.value = null
  selectedChapter.value = null
  linkHistory.value = []
  chapters.value = []
  creatingBook.value = false; creatingChapter.value = false; creatingCabinet.value = false
  busy.value = false
  clearMessages()
}
function backToChapters() {
  if (!saveDraft()) return
  linkHistory.value = []
  if (selectedBook.value?.kind === 'page') { openCabinet(activeCabinet.value); return }
  selectedChapter.value = null
  view.value = 'read'
  clearMessages()
  void nextTick(() => document.getElementById('bookshelf')?.scrollIntoView({ block: 'start' }))
}
function addCabinet() {
  clearMessages()
  try {
    const id = catalog.create(cabinetName.value)
    cabinetName.value = ''; creatingCabinet.value = false
    notice.value = '书柜已保存在本机。'
    if (autoSave.value) { autoCabinets.add(id); scheduleAuto() }
  } catch (e) { error.value = `无法创建书柜：${message(e)}` }
}
function beginCabinetRename(id: string) {
  const cabinet = catalog.cabinets.value.find(item => item.id === id)
  if (!cabinet) { error.value = '书柜不存在，请刷新后重试。'; return }
  clearMessages()
  window.getSelection?.()?.removeAllRanges()
  renamingCabinetId.value = id
  renamingCabinetName.value = cabinet.title
  renameCabinetError.value = ''
  void nextTick(() => {
    const input = document.getElementById('rename-cabinet-name') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}
function saveCabinetRename() {
  const id = renamingCabinetId.value
  if (!id || busy.value) return
  try {
    const before = catalog.cabinets.value.find(item => item.id === id)?.title
    catalog.rename(id, renamingCabinetName.value)
    renamingCabinetId.value = ''
    renameCabinetError.value = ''
    if (before === renamingCabinetName.value.trim()) return
    localMutationVersion++
    notice.value = `书柜名称已保存在本机。${autoSave.value ? '正在准备同步。' : '请点击“同步书柜整理”提交到 GitHub。'}`
    if (autoSave.value) { autoCabinets.add(id); scheduleAuto() }
  } catch (e) { renameCabinetError.value = message(e) }
}
function beginBookRename(book: ShelfBook) {
  if (busy.value || writing) return
  if (!saveDraft()) return
  clearMessages()
  window.getSelection?.()?.removeAllRanges()
  renamingItem.value = { kind: 'book', book }
  renamingItemName.value = book.title
  renameItemError.value = ''
  void nextTick(() => {
    const input = document.getElementById('rename-item-name') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}
function beginChapterRename(chapter: Chapter) {
  if (busy.value || writing) return
  if (!saveDraft()) return
  clearMessages()
  window.getSelection?.()?.removeAllRanges()
  renamingItem.value = { kind: 'chapter', chapter }
  renamingItemName.value = chapter.title
  renameItemError.value = ''
  void nextTick(() => {
    const input = document.getElementById('rename-item-name') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}
function saveItemRename() {
  const target = renamingItem.value
  if (!target || busy.value || writing) return
  let nextTitle: string
  try { nextTitle = validateRenameTitle(renamingItemName.value) }
  catch (e) { renameItemError.value = message(e); return }

  try {
    assertLocalMetadataWritable(localMetadataDamaged)
    if (target.kind === 'book' && target.book.kind !== 'page') {
      const book = target.book
      if (nextTitle === book.title) { renamingItem.value = null; return }
      const oldBooks = localBooks.value, oldDrafts = bookDescriptionDrafts.value
      const current = bookDescriptionDrafts.value[book.id]
      if (!book.sha) {
        localBooks.value = localBooks.value.map(item => item.id === book.id
          ? { ...item, title: nextTitle, ...(item.indexContent !== undefined ? { indexContent: writeNotebookIndexTitle(item.indexContent, nextTitle) } : {}) }
          : item)
      } else {
        const base = current?.base || book
        if (typeof base.indexContent !== 'string') { renameItemError.value = '本机缺少原始笔记本内容，请先点击恢复再重命名。'; return }
        const description = current?.description ?? book.description ?? ''
        const chapterOrder = current?.chapterOrder
        const next = { ...bookDescriptionDrafts.value }
        if (nextTitle === base.title && description === (base.description || '') && (!chapterOrder || sameChapterOrder(chapterOrder, base.chapterOrder))) delete next[book.id]
        else next[book.id] = { base, description, ...(chapterOrder ? { chapterOrder } : {}), ...(nextTitle !== base.title ? { title: nextTitle } : {}) }
        bookDescriptionDrafts.value = next
      }
      try { persistLocal() } catch (e) { localBooks.value = oldBooks; bookDescriptionDrafts.value = oldDrafts; renameItemError.value = message(e); return }
      books.value = books.value.map(item => item.id === book.id ? { ...item, title: nextTitle } : item)
      if (selectedBook.value?.id === book.id) selectedBook.value = { ...selectedBook.value, title: nextTitle }
      localMutationVersion++
      renamingItem.value = null
      renameItemError.value = ''
      notice.value = '笔记本名称已修改并保存在本机，可同步到 GitHub。'
      if (autoSave.value && (!book.sha || bookDescriptionDrafts.value[book.id])) { autoBooks.add(book.id); scheduleAuto() }
      return
    }

    // Standalone page (triggered from Bookshelf) or Chapter (triggered from Chapter list / editor header).
    let chapter: Chapter | undefined
    if (target.kind === 'book') {
      const page = remotePages.value.find(item => pageBookId(item.id) === target.book.id)
      const local = localChapters.value.find(item => item.bookId === target.book.id)
      chapter = local || (page ? pageAsChapter(page) : undefined)
    } else {
      chapter = target.chapter
    }
    if (!chapter) { renameItemError.value = '未找到可重命名的文件，请刷新后重试。'; return }
    if (nextTitle === chapter.title) { renamingItem.value = null; return }

    const isMd = isMarkdownExt(chapter.ext)
    const key = chapterKey(chapter)
    const currentText = selectedChapter.value && chapterKey(selectedChapter.value) === key
      ? content.value
      : (drafts.value[key]?.content ?? chapter.content)
    const updatedContent = isMd ? writeMarkdownDocumentTitle(currentText, nextTitle) : currentText
    const updatedFileName = isBinaryDocumentExt(chapter.ext) ? displayFileName(nextTitle, chapter.ext) : chapter.fileName
    const updatedChapter: Chapter = {
      ...chapter,
      title: nextTitle,
      ...(updatedFileName ? { fileName: updatedFileName } : {}),
      ...(!chapter.sha ? { content: updatedContent } : {})
    }

    const oldBooks = localBooks.value, oldChapters = localChapters.value
    if (!chapter.sha) {
      localChapters.value = localChapters.value.map(item => chapterKey(item) === key ? updatedChapter : item)
    } else if (isMd) {
      // For synced Markdown files, store the renamed H1 heading as a local draft ready to sync.
      const baseWithTitle: Chapter = { ...chapter, title: nextTitle }
      const draft = { content: updatedContent, base: baseWithTitle }
      localStorage.setItem(draftKey(chapter), JSON.stringify(draft))
      drafts.value = { ...drafts.value, [key]: draft }
    } else {
      // For synced .txt or read-only files, update the local record & display title without altering binary bytes.
      const existsLocal = localChapters.value.some(item => chapterKey(item) === key)
      localChapters.value = existsLocal
        ? localChapters.value.map(item => chapterKey(item) === key ? updatedChapter : item)
        : [...localChapters.value, updatedChapter]
    }
    if (isPageBookId(chapter.bookId)) {
      localBooks.value = localBooks.value.map(item => item.id === chapter!.bookId ? { ...item, title: nextTitle } : item)
      remotePages.value = remotePages.value.map(item => pageBookId(item.id) === chapter!.bookId ? { ...item, title: nextTitle, ...(updatedFileName ? { fileName: updatedFileName } : {}) } : item)
      books.value = books.value.map(item => item.id === chapter!.bookId ? { ...item, title: nextTitle } : item)
      if (selectedBook.value?.id === chapter.bookId) selectedBook.value = { ...selectedBook.value, title: nextTitle }
    }
    try { persistLocal() } catch (e) { localBooks.value = oldBooks; localChapters.value = oldChapters; renameItemError.value = message(e); return }

    chapters.value = chapters.value.map(item => chapterKey(item) === key ? updatedChapter : item)
    if (selectedChapter.value && chapterKey(selectedChapter.value) === key) {
      suspendDraft = true
      try {
        selectedChapter.value = updatedChapter
        if (isMd) content.value = updatedContent
      } finally { suspendDraft = false }
    }
    localMutationVersion++
    renamingItem.value = null
    renameItemError.value = ''
    notice.value = '文件名已修改并保存在本机。'
    if (autoSave.value && isEditableExt(chapter.ext)) { autoKeys.add(key); scheduleAuto() }
  } catch (e) { renameItemError.value = message(e) }
}
function setEditorSidebar(open: boolean) {
  editorSidebarOpen.value = open
  try { localStorage.setItem(editorSidebarPreference, String(open)) } catch { /* Current view remains usable. */ }
  void nextTick(() => document.getElementById(open ? 'editor-hide-chapters' : 'editor-show-chapters')?.focus())
}
function setEditorSidebarTab(tab: 'chapters' | 'outline') {
  editorSidebarTab.value = tab
  try { localStorage.setItem(editorSidebarTabPreference, tab) } catch { /* Current view remains usable. */ }
}
function goToOutlineHeading(offset: number) { markdownEditor.value?.focusHeading(offset) }
function jumpReadHeading(text: string) {
  chapterMarkdownRef.value?.scrollToHeading(text)
}
function toggleReadTask(taskIndex: number) {
  if (busy.value || !selectedChapter.value || !selectedChapterIsMarkdown.value) return
  const updated = toggleMarkdownTaskAtIndex(content.value, taskIndex)
  if (updated !== null && updated !== content.value) {
    content.value = updated
  }
}
function closeExportMenus() {
  document.querySelectorAll<HTMLDetailsElement>('details.export-menu[open]').forEach(el => { el.open = false })
}
function exportCurrentMarkdown() {
  if (!selectedChapter.value) return
  closeExportMenus()
  if (selectedChapterIsPlainText.value) {
    const clean = (selectedChapter.value.title || '未命名').trim().replace(/[\\/:*?"<>|\r\n]+/g, '_') || '未命名'
    const url = URL.createObjectURL(new Blob([content.value], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = clean.toLowerCase().endsWith('.txt') ? clean : `${clean}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return
  }
  exportMarkdownFile(selectedChapter.value.title, content.value)
}
async function exportCurrentHtml() {
  if (!selectedChapter.value || !selectedChapterIsMarkdown.value) return
  closeExportMenus()
  if (view.value !== 'read') {
    view.value = 'read'
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 260))
  }
  exportStandaloneHtml(selectedChapter.value.title, chapterMarkdownRef.value?.articleElement?.() || null, currentPaperTheme())
}
async function printCurrentDocument() {
  closeExportMenus()
  if (selectedChapterIsMarkdown.value && view.value !== 'read') {
    view.value = 'read'
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 260))
  }
  window.print()
}
async function goBackLinkHistory() {
  const prev = linkHistory.value[linkHistory.value.length - 1]
  if (!prev) return
  linkHistory.value = linkHistory.value.slice(0, -1)
  if (selectedBook.value?.id === prev.bookId && !isPageBookId(prev.bookId)) {
    const ch = chapters.value.find(item => item.id === prev.chapterId)
    if (ch) { openChapter(ch); return }
  }
  const targetBook = books.value.find(book => book.id === prev.bookId)
  if (!targetBook) return
  await openBook(targetBook)
  if (selectedBook.value?.id !== targetBook.id) return
  if (targetBook.kind === 'page') {
    view.value = 'read'
  } else {
    const ch = chapters.value.find(item => item.id === prev.chapterId)
    if (ch) openChapter(ch)
  }
}
async function handleMarkdownLink(rawHref: string) {
  const parsed = parseMarkdownLinkHref(rawHref)
  if (parsed.kind === 'external') {
    if (/^https?:/i.test(parsed.href)) window.open(parsed.href, '_blank', 'noopener,noreferrer')
    return
  }
  const jumpHashInCurrent = (hash: string) => {
    if (!hash) return
    if (view.value === 'read' || !selectedChapterEditable.value) {
      void nextTick(() => {
        if (!chapterMarkdownRef.value?.scrollToHeading(hash)) {
          setTimeout(() => { chapterMarkdownRef.value?.scrollToHeading(hash) }, 120)
        }
      })
    } else {
      const wanted = normalizeHeadingKey(hash)
      const hit = currentOutline.value.find(h => normalizeHeadingKey(h.title) === wanted) ||
        currentOutline.value.find(h => wanted && normalizeHeadingKey(h.title).includes(wanted))
      if (hit) goToOutlineHeading(hit.offset)
    }
  }
  if (parsed.kind === 'hash') {
    jumpHashInCurrent(parsed.hash)
    return
  }
  const current = selectedChapter.value
  if (!current) return
  const fromReadView = view.value === 'read'
  const currentItem: LinkableItem = {
    bookId: current.bookId,
    id: current.id,
    title: current.title,
    ext: current.ext,
    fileName: current.fileName,
    cabinetId: activeCabinet.value,
    isPage: isPageBookId(current.bookId)
  }
  const sameBookItems: LinkableItem[] = isPageBookId(current.bookId)
    ? []
    : chapters.value.map(ch => ({ bookId: ch.bookId, id: ch.id, title: ch.title, ext: ch.ext, fileName: ch.fileName, cabinetId: activeCabinet.value, isPage: false }))

  const currentCab = activeCabinet.value || 'general'
  const pageLinkItems = (onlyCurrentCabinet: boolean): LinkableItem[] =>
    books.value
      .filter(book => book.kind === 'page' && (!onlyCurrentCabinet || catalog.assigned(book.id) === currentCab))
      .map(book => ({ bookId: book.id, id: pageId(book.id), title: book.title, ext: book.ext, cabinetId: catalog.assigned(book.id), isPage: true }))

  const allLocalChapterItems: LinkableItem[] = localChapters.value
    .filter(ch => !isPageBookId(ch.bookId) && ch.bookId !== current.bookId)
    .map(ch => ({ bookId: ch.bookId, id: ch.id, title: ch.title, ext: ch.ext, fileName: ch.fileName, cabinetId: catalog.assigned(ch.bookId), isPage: false }))

  const resolved = resolveMarkdownTarget(
    rawHref,
    currentItem,
    sameBookItems,
    pageLinkItems(true),
    [...pageLinkItems(false), ...allLocalChapterItems]
  )
  if (!resolved) {
    notice.value = `未找到链接目标“${parsed.path}”，请确认该文档已导入到当前笔记本或书柜。`
    return
  }
  const { target, hash } = resolved
  if (target.bookId === current.bookId && target.id === current.id) {
    jumpHashInCurrent(hash)
    return
  }
  const pushHistory = () => {
    const last = linkHistory.value[linkHistory.value.length - 1]
    if (!last || last.bookId !== current.bookId || last.chapterId !== current.id) {
      linkHistory.value = [...linkHistory.value.slice(-19), { bookId: current.bookId, chapterId: current.id, title: current.title }]
    }
  }
  if (!target.isPage && target.bookId === selectedBook.value?.id) {
    const ch = chapters.value.find(item => item.id === target.id)
    if (ch) {
      pushHistory()
      openChapter(ch)
      view.value = fromReadView || !isEditableExt(ch.ext) ? 'read' : 'edit'
      if (hash) jumpHashInCurrent(hash)
      return
    }
  }
  const targetBook = books.value.find(book => book.id === target.bookId)
  if (!targetBook) {
    notice.value = `未找到链接目标“${parsed.path}”。`
    return
  }
  pushHistory()
  await openBook(targetBook)
  if (selectedBook.value?.id !== targetBook.id) return
  if (targetBook.kind === 'page') {
    view.value = fromReadView || !isEditableExt(selectedChapter.value?.ext) ? 'read' : 'edit'
    if (hash) jumpHashInCurrent(hash)
  } else {
    const ch = chapters.value.find(item => item.id === target.id)
    if (ch) {
      openChapter(ch)
      view.value = fromReadView || !isEditableExt(ch.ext) ? 'read' : 'edit'
      if (hash) jumpHashInCurrent(hash)
    }
  }
}
function changeOutline(before: string, after: string, focus: number) {
  const problem = markdownEditor.value?.applyOutlineChange(before, after, focus) ?? '编辑器尚未准备好，请稍后重试。'
  if (problem) error.value = problem
  else error.value = ''
}
function openNewNote() {
  if (!saveDraft()) return
  clearMessages()
  bookCabinet.value = activeCabinet.value && activeCabinet.value !== 'general' ? activeCabinet.value : ''
  bookDescription.value = ''
  newBookCabinetName.value = ''
  newPageFormat.value = 'md'
  creatingCabinet.value = false
  creatingBook.value = true
}
function moveSelectedBooks() {
  const ids = managedBooks.value.filter(book => deleteBookIds.value.includes(book.id)).map(book => book.id)
  if (!ids.length || !moveBooksTarget.value) { error.value = '请先选择笔记本和目标书柜。'; return }
  clearMessages()
  try {
    catalog.moveMany(ids, moveBooksTarget.value)
    localMutationVersion++
    for (const id of ids) if (autoSave.value) autoMoves.add(id)
    deleteBookIds.value = []
    moveBooksTarget.value = ''
    notice.value = `已移动 ${ids.length} 本笔记本。${autoSave.value ? '正在准备同步。' : '请点击“同步书柜整理”提交到 GitHub。'}`
    if (autoSave.value) scheduleAuto()
  } catch (e) { error.value = `无法移动笔记本：${message(e)}` }
}
function deleteSelectedCabinets() {
  const selected = catalog.cabinets.value.filter(cabinet => cabinet.id !== 'general' && deleteCabinetIds.value.includes(cabinet.id))
  if (!selected.length) { error.value = '请先选择要删除的书柜。'; return }
  if (!window.confirm(`确认删除以下书柜？\n\n${selected.map(cabinet => cabinet.title).join('\n')}\n\n其中的笔记本会移入“${defaultCabinetTitle.value}”（默认书柜），不会删除笔记内容。`)) return
  clearMessages()
  try {
    for (const cabinet of selected) {
      catalog.remove(cabinet.id)
      if (autoSave.value && catalog.journal.value.removed?.[cabinet.id]) autoCabinets.add(cabinet.id)
      else autoCabinets.delete(cabinet.id)
    }
    localMutationVersion++
    deleteCabinetIds.value = []
    notice.value = `已删除 ${selected.length} 个书柜，笔记本已移入“${defaultCabinetTitle.value}”。${autoSave.value ? '正在准备同步。' : '请点击“同步书柜整理”提交到 GitHub。'}`
    if (autoSave.value) scheduleAuto()
  } catch (e) { error.value = `书柜整理尚未全部完成：${message(e)}` }
}
function undoCabinetDeletion(id: string) {
  clearMessages()
  try {
    catalog.undoRemove(id)
    autoCabinets.delete(id)
    localMutationVersion++
    notice.value = '已撤销删除书柜。'
  } catch (e) { error.value = `无法撤销删除：${message(e)}` }
}
function moveSelected(event: Event) {
  const book = selectedBook.value
  const select = event.target as HTMLSelectElement | null
  if (!book || !select) return
  const previous = catalog.assigned(book.id)
  try {
    catalog.move(book.id, select.value)
    activeCabinet.value = select.value
    notice.value = '笔记本归属已保存在本机。'
    if (autoSave.value) { autoMoves.add(book.id); scheduleAuto() }
  } catch (e) { activeCabinet.value = catalog.assigned(book.id); select.value = activeCabinet.value || previous; error.value = `书柜归属尚未保存：${message(e)}` }
}
function startDescriptionEdit() {
  if (!selectedBook.value || writing || busy.value) return
  descriptionEditBase = bookDescriptionDrafts.value[selectedBook.value.id]?.base || { ...selectedBook.value }
  descriptionInput.value = selectedBook.value.description || ''
  editingDescription.value = true
}
function sameChapterOrder(left?: readonly string[], right?: readonly string[]) {
  const a = left || [], b = right || []
  return a.length === b.length && a.every((id, index) => id === b[index])
}
function saveDescription() {
  const book = selectedBook.value
  if (!book || book.kind === 'page' || busy.value || writing) return
  const description = descriptionInput.value.trim()
  if (description.length > 500) { error.value = '简介不能超过 500 个字符。'; return }
  const oldBooks = localBooks.value, oldDrafts = bookDescriptionDrafts.value
  const current = bookDescriptionDrafts.value[book.id]
  if (!book.sha) {
    localBooks.value = localBooks.value.map(item => item.id === book.id ? { ...item, description } : item)
  } else {
    const base = current?.base || (descriptionEditBase?.id === book.id ? descriptionEditBase : book)
    if (typeof base.indexContent !== 'string') { error.value = '本机缺少原始笔记本内容，请先点击恢复再修改简介。'; return }
    const next = { ...bookDescriptionDrafts.value }
    const chapterOrder = current?.chapterOrder
    const title = current?.title
    if (description === (base.description || '') && (!chapterOrder || sameChapterOrder(chapterOrder, base.chapterOrder)) && (!title || title === base.title)) delete next[book.id]
    else next[book.id] = { base, description, ...(chapterOrder ? { chapterOrder } : {}), ...(title ? { title } : {}) }
    bookDescriptionDrafts.value = next
  }
  try { persistLocal() } catch (e) { localBooks.value = oldBooks; bookDescriptionDrafts.value = oldDrafts; error.value = message(e); return }
  books.value = books.value.map(item => item.id === book.id ? { ...item, description } : item)
  selectedBook.value = { ...book, description }
  localMutationVersion++
  editingDescription.value = false
  descriptionEditBase = null
  notice.value = '简介已保存在本机，可同步到 GitHub。'
  if (autoSave.value && (!book.sha || bookDescriptionDrafts.value[book.id])) { autoBooks.add(book.id); scheduleAuto() }
}
// Native dragging does not consistently autoscroll nested overflow containers.
// Follow the pointer near the edges while a chapter drag is active so every
// position in a long list remains reachable without moving the whole page.
let chapterDragFrame = 0
let chapterDragViewport: HTMLElement | null = null
let chapterDragSpeed = 0
function stopChapterDragScroll() {
  cancelAnimationFrame(chapterDragFrame)
  chapterDragFrame = 0
  chapterDragViewport = null
  chapterDragSpeed = 0
}
function scrollChapterDrag(event: DragEvent) {
  if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('application/x-paper-notes-chapter')) return
  const viewport = event.currentTarget as HTMLElement
  const bounds = viewport.getBoundingClientRect()
  const edge = Math.min(48, bounds.height / 4)
  const topDistance = event.clientY - bounds.top
  const bottomDistance = bounds.bottom - event.clientY
  chapterDragViewport = viewport
  chapterDragSpeed = topDistance < edge ? -Math.ceil((edge - Math.max(0, topDistance)) / edge * 14)
    : bottomDistance < edge ? Math.ceil((edge - Math.max(0, bottomDistance)) / edge * 14) : 0
  if (!chapterDragSpeed) { cancelAnimationFrame(chapterDragFrame); chapterDragFrame = 0; return }
  if (chapterDragFrame) return
  const tick = () => {
    if (!chapterDragViewport?.isConnected || !chapterDragSpeed) { stopChapterDragScroll(); return }
    chapterDragViewport.scrollTop += chapterDragSpeed
    chapterDragFrame = requestAnimationFrame(tick)
  }
  chapterDragFrame = requestAnimationFrame(tick)
}
function leaveChapterDrag(event: DragEvent) {
  if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return
  stopChapterDragScroll()
}

function reorderChapters(ids: string[]) {
  const book = selectedBook.value
  if (!book || book.kind === 'page' || busy.value || writing || query.value.trim()) return
  if (ids.length !== chapters.value.length || new Set(ids).size !== ids.length || ids.some(id => !chapters.value.some(chapter => chapter.id === id))) {
    error.value = '章节列表已发生变化，请重新排序。'; return
  }
  if (ids.every((id, index) => id === chapters.value[index].id)) return
  if (!saveDraft()) return
  clearMessages()
  const oldBooks = localBooks.value, oldDrafts = bookDescriptionDrafts.value
  const current = bookDescriptionDrafts.value[book.id]
  // Keep IDs absent from the current view; an offline snapshot or another
  // device may not have supplied those chapters yet.
  const previousOrder = current?.chapterOrder ?? book.chapterOrder ?? []
  let order: string[]
  try { order = validateChapterOrder([...ids, ...previousOrder.filter(id => !ids.includes(id))]) }
  catch (e) { error.value = message(e); return }
  if (!book.sha) {
    if (!localBooks.value.some(item => item.id === book.id)) { error.value = '无法找到本机笔记本，请刷新后重试。'; return }
    localBooks.value = localBooks.value.map(item => item.id === book.id ? { ...item, chapterOrder: order } : item)
  } else {
    const base = current?.base || book
    if (typeof base.indexContent !== 'string') { error.value = '本机缺少原始笔记本内容，请先点击恢复再调整顺序。'; return }
    const description = current?.description ?? book.description ?? ''
    const title = current?.title
    const next = { ...bookDescriptionDrafts.value }
    if (sameChapterOrder(order, base.chapterOrder) && description === (base.description || '') && (!title || title === base.title)) delete next[book.id]
    else next[book.id] = { base, description, chapterOrder: order, ...(title ? { title } : {}) }
    bookDescriptionDrafts.value = next
  }
  try { persistLocal() } catch (e) { localBooks.value = oldBooks; bookDescriptionDrafts.value = oldDrafts; error.value = message(e); return }
  chapters.value = sortChapters(chapters.value, ids)
  books.value = books.value.map(item => item.id === book.id ? { ...item, chapterOrder: order } : item)
  selectedBook.value = { ...book, chapterOrder: order }
  localMutationVersion++
  notice.value = '章节顺序已保存在本机；同步笔记本信息后可在其他设备恢复。'
  if (autoSave.value && (!book.sha || bookDescriptionDrafts.value[book.id])) { autoBooks.add(book.id); scheduleAuto() }
}
async function openBook(book: Notebook) {
  if (!saveDraft()) return
  const request = ++bookRun
  clearMessages()
  activeCabinet.value = catalog.assigned(book.id)
  creatingBook.value = false; creatingChapter.value = false
  selectedBook.value = book
  editingDescription.value = false
  deleteChapterIds.value = []
  selectedChapter.value = null
  chapters.value = []
  busy.value = true
  try {
    const result = await getChapters(book)
    if (request === bookRun && selectedBook.value?.id === book.id) {
      chapters.value = result
      if (isPageBookId(book.id) && result[0]) { openChapter(result[0]); view.value = isEditableExt(result[0].ext) ? 'edit' : 'read' }
    }
  } catch (e) { if (request === bookRun) error.value = message(e) }
  finally { if (request === bookRun) busy.value = false }
}
function openChapter(chapter: Chapter) {
  if (!saveDraft()) return
  clearMessages()
  suspendDraft = true
  selectedChapter.value = normalizeChapterTitle(chapter)
  content.value = chapter.content
  if (isEditableExt(chapter.ext)) {
    try {
      const raw = localStorage.getItem(draftKey(chapter))
      if (raw) {
        const saved = JSON.parse(raw)
        if (typeof saved.content === 'string' && saved.base?.id === chapter.id && saved.base?.bookId === chapter.bookId && typeof saved.base?.sha === 'string') {
          selectedChapter.value = normalizeChapterTitle({ ...chapter, ...saved.base })
          content.value = saved.content
          notice.value = '已恢复这篇章节的本地草稿。'
        }
      }
    } catch { error.value = '无法读取本地草稿。' }
  }
  suspendDraft = false
  view.value = 'read'
  void nextTick(() => document.getElementById('writing-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
async function refresh() {
  transferIndicator.dismissCompletion()
  if (!connected.value) { error.value = '请先连接 GitHub 仓库，再恢复笔记。'; goToConnection(); return false }
  if (!saveDraft()) return false
  if (writing) { error.value = '正在同步，请稍候再读取目录。'; return false }
  const request = ++bookRun
  const version = localMutationVersion
  clearMessages()
  clearTimeout(autoTimer)
  const restored = await run(async () => {
    const transfer = transferIndicator.start('restore')
    transferPercent.value = 6
    transferDetail.value = '正在连接 GitHub 读取目录…'
    try {
    const bookId = selectedBook.value?.id
    const chapterId = selectedChapter.value?.id
    const head = await store.readHead()
    transferPercent.value = 14
    const [remoteBooks, latestCatalog, rawPages] = await Promise.all([store.listNotebooks(), store.readCatalog(false), store.listPages()])
    transferPercent.value = 22
    transferDetail.value = `正在恢复书页与 ${remoteBooks.length} 本笔记本…`
    const pages = await Promise.all(rawPages.map(storeRemoteBinaryPage))
    const allChapters: Array<readonly [string, Chapter[]]> = new Array(remoteBooks.length)
    let bookCursor = 0
    let booksDone = 0
    await Promise.all(Array.from({ length: Math.min(4, remoteBooks.length) }, async () => {
      while (bookCursor < remoteBooks.length) {
        const idx = bookCursor++
        const book = remoteBooks[idx]
        const list = await Promise.all((await store.listChapters(book.id)).map(storeRemoteBinaryChapter))
        allChapters[idx] = [book.id, list] as const
        booksDone++
        transferPercent.value = Math.min(72, 22 + Math.round((booksDone / Math.max(1, remoteBooks.length)) * 50))
        transferDetail.value = `正在恢复笔记本 ${booksDone} / ${remoteBooks.length}…`
      }
    }))
    const imagePaths = new Set<string>()
    for (const [, items] of allChapters) for (const chapter of items) {
      for (const ref of attachmentReferences(chapter.content, chapter.bookId)) imagePaths.add(ref.path)
    }
    for (const page of pages) for (const ref of attachmentReferences(page.content, null)) imagePaths.add(ref.path)
    const imagePathList = [...imagePaths]
    const downloadedImages: NoteAttachment[] = []
    let imagesDone = 0
    for (const path of imagePathList) {
      const local = await getAttachment(initialRepository, path)
      const remote = await store.readAttachment(path)
      if (local && !sameImageBytes(local.bytes, remote.bytes)) throw new Error('本地和 GitHub 的同名图片内容不同；原有本地图片已保留，请先处理冲突。')
      if (!local) downloadedImages.push(remote)
      imagesDone++
      transferPercent.value = Math.min(92, 72 + Math.round((imagesDone / Math.max(1, imagePathList.length)) * 20))
      transferDetail.value = `正在核对图片附件 ${imagesDone} / ${imagePathList.length}…`
    }
    transferPercent.value = 95
    transferDetail.value = '正在写入本机离线缓存…'
    if (await store.readHead() !== head) throw new Error('恢复期间 GitHub 内容发生变化，请重新恢复。')
    if (writing || version !== localMutationVersion) throw new Error('同步期间目录发生变化，请稍后重新读取。')
    await finishAttachmentRestore(downloadedImages, head, {
      put: image => putAttachment(initialRepository, image),
      readHead: () => store.readHead(),
      isCurrent: () => !writing && version === localMutationVersion && request === bookRun && !disposed
    })
    const complete: RemoteSnapshot = { head, books: remoteBooks, chapters: Object.fromEntries(allChapters), pages, catalog: latestCatalog }
    try { writeRemoteCache(complete, initialRepository) } catch { throw new Error('无法保存完整的 GitHub 备份到本机；原有缓存和草稿均已保留。') }
    restoredSnapshot.value = complete
    backgroundHead = head
    offlineMode.value = true
    catalog.latest(latestCatalog)
    chapterCache.clear()
    remotePages.value = pages
    loadedBookIds.value = remoteBooks.map(book => book.id)
    books.value = mergeBooks([...remoteBooks, ...pages.map(pageAsBook)], false)
    snapshot.value = false
    if (selectedBook.value) activeCabinet.value = catalog.assigned(selectedBook.value.id)
    else if (activeCabinet.value && !catalog.cabinets.value.some(item => item.id === activeCabinet.value)) activeCabinet.value = ''
    if (request !== bookRun) { transferPercent.value = 100; transferIndicator.success(transfer); return }
    if (bookId) {
      selectedBook.value = books.value.find(book => book.id === bookId) || null
      if (selectedBook.value) {
        chapters.value = await getChapters(selectedBook.value)
        const chapter = chapters.value.find(item => item.id === chapterId)
        if (chapter) openChapter(chapter)
        else selectedChapter.value = null
      } else { chapters.value = []; selectedChapter.value = null }
    }
    transferPercent.value = 100
    transferDetail.value = '已全部保存到本地'
    notice.value = '已将 GitHub 的笔记恢复到本机，后续将优先从本机瞬间加载；未同步草稿仍保留。'
    transferIndicator.success(transfer)
    } catch (e) { transferPercent.value = null; transferDetail.value = ''; transferIndicator.fail(transfer); throw e }
  })
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
  return restored
}
async function connect() {
  const token = tokenInput.value.trim()
  if (!token) { error.value = '请输入 GitHub 令牌。'; return false }
  let target: string
  try { target = normalizeRepository(repositoryInput.value) }
  catch (e) { error.value = message(e); return false }
  if (writing || !saveDraft()) { if (writing) error.value = '正在同步，请稍后再切换仓库。'; return false }
  clearTimeout(autoTimer)
  const candidate = target === initialRepository ? store : createNotebookStore(target)
  candidate.setToken(token)
  const success = await run(async () => {
    await candidate.verifyRepository()
    await candidate.readHead()
    if (!initialRepository && workspaceHasContent('local') && window.confirm(`检测到尚未关联仓库的本机笔记。是否将它们复制到 ${target} 的本机工作区？原数据会保留，复制后仍需手动选择同步。`)) {
      const remote = await readWelcomeCandidates(candidate)
      const original = workspaceEntries('local')
      const source = prepareWelcomeImport(original, snapshotFiles, remote).entries
      await copyWorkspaceAttachments(source, target)
      assertWorkspaceUnchanged('local', original)
      importWorkspace('local', target, source)
    }
    try { await saveCredential(token, target) } catch { throw new Error('令牌无法保存到本机，请检查存储权限后重试。') }
    if (target !== initialRepository) setConfiguredRepository(target)
  })
  if (success) {
    tokenInput.value = ''
    if (target !== initialRepository) { location.reload(); return true }
    connected.value = true
    if (isHosted.value) autoSave.value = savedAutoPreference()
    changingRepository.value = false
    notice.value = '仓库已连接，正在从 GitHub 恢复到本地缓存…'
    if (!restoredSnapshot.value) void refresh()
    else void updateFromRemoteInBackground()
  } else {
    candidate.clearToken()
    if (target === initialRepository && connected.value) {
      try { const saved = await readCredential(); if (saved) store.setToken(saved); else connected.value = false }
      catch { connected.value = false }
    }
  }
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
  return success
}
async function importLegacyCredential() {
  let target: string
  try { target = normalizeRepository(repositoryInput.value) }
  catch (e) { error.value = message(e); return }
  if (busy.value || writing) { error.value = '正在同步，请稍后再操作。'; return }
  if (!window.confirm(`旧版保存的令牌没有记录仓库归属。请确认该令牌属于 ${target}，并仅用于连接此仓库；旧令牌会保留。继续？`)) return
  let importedToDesktop = false
  try {
    let token: string | null
    if (isDesktop.value) {
      await desktopRequest('token.importLegacy', undefined, target)
      importedToDesktop = true
      token = await desktopRequest('token.get', undefined, target)
    } else {
      if (localStorage.getItem(namespaceKey('paper-notes-github-token', target)) !== null) throw new Error('目标仓库已有保存的令牌，请使用现有令牌或先断开连接。')
      token = localStorage.getItem('paper-notes-github-token')
    }
    if (!token) throw new Error('没有找到旧版保存的令牌。')
    tokenInput.value = token
    const success = await connect()
    if (!success && importedToDesktop) await desktopRequest('token.clear', undefined, target)
  } catch (e) {
    if (importedToDesktop) {
      try { await desktopRequest('token.clear', undefined, target) }
      catch { error.value = '旧令牌验证未完成，且无法清除目标仓库的加密副本；请检查本机存储。'; tokenInput.value = ''; return }
    }
    error.value = `无法使用旧版令牌：${message(e)}`
  } finally { tokenInput.value = '' }
}
async function disconnect() {
  const success = await run(async () => {
    try { await clearCredential() } catch { throw new Error('无法清除已保存的令牌，请重试。') }
  })
  if (!success) return
  connected.value = false; autoSave.value = false; store.clearToken(); tokenInput.value = ''; changingRepository.value = false
  notice.value = '已断开连接并清除保存的令牌；本地草稿仍保留。'
}
async function addBook() {
  if (!saveDraft()) return
  clearMessages()
  await run(async () => {
    const title = bookTitle.value.trim()
    if (!title || title.length > 120 || /[\r\n]/.test(title)) throw new Error('请输入有效的笔记本名称。')
    let targetCabinet = bookCabinet.value || 'general'
    let createdCabinet = ''
    if (targetCabinet === '@@new@@') {
      const name = newBookCabinetName.value.trim()
      if (!name || name.length > 120 || /[\r\n]/.test(name)) throw new Error('请输入有效的书柜名称。')
      targetCabinet = catalog.create(name)
      createdCabinet = targetCabinet
    }
    if (!catalog.cabinets.value.some(cabinet => cabinet.id === targetCabinet)) throw new Error('目标书柜不存在，请重新选择。')
    const id = newNoteKind.value === 'page' ? pageIdFromTitle(title) : ''
    const pageExt = newNoteKind.value === 'page' && newPageFormat.value === 'txt' ? 'txt' : undefined
    const book: ShelfBook = id ? { id: pageBookId(id), title, sha: '', kind: 'page', ...(pageExt ? { ext: pageExt } : {}) } : { id: newId(), title, sha: '', description: bookDescription.value.trim() }
    const pageChapter: Chapter | null = id ? { bookId: book.id, id, title, content: pageExt === 'txt' ? '' : `# ${title}\n\n`, sha: '', ...(pageExt ? { ext: pageExt } : {}) } : null
    localBooks.value.push(book)
    if (pageChapter) localChapters.value.push(pageChapter)
    try {
      persistLocal()
      catalog.moveMany([book.id], targetCabinet)
    } catch (e) {
      localBooks.value = localBooks.value.filter(item => item.id !== book.id)
      if (pageChapter) localChapters.value = localChapters.value.filter(item => chapterKey(item) !== chapterKey(pageChapter))
      let rollbackFailed = false
      try { persistLocal() } catch { rollbackFailed = true }
      if (createdCabinet) { try { catalog.remove(createdCabinet) } catch { rollbackFailed = true } }
      if (rollbackFailed) throw new Error(`创建失败，部分本机状态无法回滚，请检查书柜和笔记：${message(e)}`)
      throw e
    }
    books.value = [...books.value, book]
    bookTitle.value = ''; creatingBook.value = false
    selectedBook.value = book; selectedChapter.value = null; chapters.value = pageChapter ? [pageChapter] : []; view.value = 'read'
    if (pageChapter) { openChapter(pageChapter); view.value = 'edit' }
    activeCabinet.value = targetCabinet
    localMutationVersion++
    notice.value = pageChapter ? `本地${pageExt === 'txt' ? '纯文本 (.txt) ' : ' Markdown '}书页已创建；准备好后可同步。` : '本地笔记本已创建。添加章节后可一并同步。'
    if (autoSave.value) { if (pageChapter) autoKeys.add(chapterKey(pageChapter)); else autoBooks.add(book.id); if (createdCabinet) autoCabinets.add(createdCabinet); scheduleAuto() }
  })
}
async function addChapter() {
  const book = selectedBook.value
  if (!book) return
  if (!saveDraft()) return
  clearMessages()
  await run(async () => {
    const title = chapterTitle.value.trim()
    if (!title || /[\r\n]/.test(title)) throw new Error('请输入有效的章节名称。')
    const isTxt = newChapterFormat.value === 'txt'
    const chapter: Chapter = {
      bookId: book.id,
      id: isTxt ? chapterIdFromTitle(title) : newId(),
      title,
      content: isTxt ? '' : `# ${title}\n\n`,
      sha: '',
      ...(isTxt ? { ext: 'txt' } : {})
    }
    localChapters.value.push(chapter)
    try { persistLocal() } catch (e) { localChapters.value.pop(); throw e }
    chapters.value = [...chapters.value, chapter]
    chapterTitle.value = ''; creatingChapter.value = false
    openChapter(chapter); view.value = 'edit'
    notice.value = `本地${isTxt ? '纯文本 (.txt) ' : ''}章节已创建；准备好后点击同步。`
    if (autoSave.value) { autoKeys.add(chapterKey(chapter)); scheduleAuto() }
  })
}
async function syncBook() {
  transferIndicator.dismissCompletion()
  const book = selectedBook.value
  if (!book) return
  if (!connected.value) { error.value = '请先在页面下方连接 GitHub，再同步笔记本。'; goToConnection(); return }
  if (!saveDraft()) return
  clearMessages()
  const keys = batchItems.value.filter(item => item.bookId === book.id).map(item => item.key)
  const success = await run(() => performBatch(keys, [book.id]))
  if (success) notice.value = '笔记本、其中的待同步章节及归属已同步到 GitHub。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
async function syncCatalog() {
  transferIndicator.dismissCompletion()
  if (!connected.value) { error.value = '请先连接 GitHub，再同步书柜整理。'; goToConnection(); return }
  if (!saveDraft()) return
  const bookIds = Object.keys(catalog.journal.value.moves)
  const cabinetIds = [...new Set([...Object.keys(catalog.journal.value.created), ...Object.keys(catalog.journal.value.removed || {}), ...Object.keys(catalog.journal.value.renamed || {})])]
  if (!bookIds.length && !cabinetIds.length) { notice.value = '没有待同步的书柜整理。'; return }
  clearMessages()
  const success = await run(() => performBatch([], bookIds, cabinetIds, []))
  if (success) notice.value = '书柜整理已同步到 GitHub。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
async function sync() {
  transferIndicator.dismissCompletion()
  const chapter = selectedChapter.value
  if (!chapter) return
  if (!connected.value) { error.value = '请先连接 GitHub，再同步本地草稿。'; goToConnection(); return }
  if (!saveDraft()) return
  clearMessages()
  const success = await run(() => performBatch([chapterKey(chapter)], []))
  if (success) notice.value = '已同步到 GitHub；网站将在构建完成后更新。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}

// Preserve the last complete offline download after a confirmed write. If the
// cache predates the submitted parent revision, apply our change but mark it
// stale: unrelated remote changes still require an explicit restore.
function updateOfflineAfterCommit(parent: string, head: string, change: {
  books?: Notebook[]; chapters?: Chapter[]; catalog?: import('./cabinetStore').CatalogVersion;
  pages?: Page[]; deletedPages?: string[]; deletedBooks?: string[]; deletedChapters?: Chapter[]
}) {
  const previous = restoredSnapshot.value || readRemoteCache(initialRepository)
  if (!previous) return
  const sameRevision = previous.head === parent && !previous.stale
  const removedBooks = new Set(change.deletedBooks || [])
  const removedChapters = new Set((change.deletedChapters || []).map(chapterKey))
  const books = previous.books.filter(book => !removedBooks.has(book.id)).map(book => ({ ...book }))
  const bookChapters: Record<string, Chapter[]> = Object.fromEntries(
    books.map(book => [book.id, (previous.chapters[book.id] || []).filter(chapter => !removedChapters.has(chapterKey(chapter))).map(chapter => ({ ...chapter }))])
  )
  for (const book of change.books || []) {
    const index = books.findIndex(item => item.id === book.id)
    if (index < 0) { books.push(book); bookChapters[book.id] = [] } else books[index] = book
  }
  let complete = sameRevision && previous.pages !== undefined
  for (const chapter of change.chapters || []) {
    const list = bookChapters[chapter.bookId]
    if (!list) { complete = false; continue }
    const index = list.findIndex(item => item.id === chapter.id)
    if (index < 0) list.push(chapter); else list[index] = chapter
  }
  const pages = (previous.pages || []).filter(page => !(change.deletedPages || []).includes(page.id))
  for (const page of change.pages || []) {
    const index = pages.findIndex(item => item.id === page.id)
    if (index < 0) pages.push(page); else pages[index] = page
  }
  const next: RemoteSnapshot = {
    head: complete ? head : previous.head, books, chapters: bookChapters, pages,
    catalog: change.catalog || previous.catalog, ...(complete ? {} : { stale: true })
  }
  try {
    writeRemoteCache(next, initialRepository)
    restoredSnapshot.value = next
    chapterCache.clear()
    if (!complete) error.value = '本机离线副本已更新所提交的内容，但可能缺少其他设备的更新；请点击“恢复”。'
  } catch {
    // Never keep a deleted item in a cache that would silently revive it.
    let cleared = false
    try { clearRemoteCache(initialRepository); restoredSnapshot.value = null; offlineMode.value = false; chapterCache.clear(); cleared = true }
    catch { /* an inaccessible old cache cannot be safely changed here */ }
    error.value = cleared ? 'GitHub 操作已完成，旧离线副本已移除；请检查存储空间后点击“恢复”。' : 'GitHub 操作已完成，但无法更新或清除旧离线副本；离线时可能显示旧内容，请检查存储权限后点击“恢复”。'
  }
}
async function inspectRemote() {
  const chapter = selectedChapter.value
  if (!chapter) return
  const ext = normalizeFileExt(chapter.ext)
  await run(async () => { remoteVersion.value = isPageBookId(chapter.bookId) ? pageAsChapter(await storeRemoteBinaryPage(await store.readPage(pageId(chapter.bookId), ext))) : await storeRemoteBinaryChapter(await store.readChapter(chapter.bookId, chapter.id, ext)) })
}
function useRemoteBase() {
  if (!remoteVersion.value) return
  const previous = selectedChapter.value
  selectedChapter.value = remoteVersion.value
  if (!saveDraft()) { selectedChapter.value = previous; return }
  remoteVersion.value = null
  error.value = ''
  notice.value = '已采用远程版本作为同步基准，当前草稿未改变。确认合并后再点击同步。'
}
async function performBatch(keys: string[], bookIds: string[], cabinetIds: string[] = [], descriptionBookIds: string[] = bookIds) {
  assertLocalMetadataWritable(localMetadataDamaged)
  transferIndicator.dismissCompletion()
  if (writing) throw new Error('正在同步，请稍候。')
  const entries = batchItems.value.filter(item => keys.includes(item.key) || (isPageBookId(item.bookId) && bookIds.includes(item.bookId) && !item.chapter.sha))
  const newBooks = localBooks.value.filter(book => !isPageBookId(book.id) && !book.sha && (bookIds.includes(book.id) || entries.some(item => item.bookId === book.id)))
  const changedBooks = descriptionBookIds.flatMap(id => {
    const draft = bookDescriptionDrafts.value[id]
    if (!draft) return []
    const base = draft.base
    const nextTitle = draft.title || base.title
    const nextIndexContent = draft.title && typeof base.indexContent === 'string'
      ? writeNotebookIndexTitle(base.indexContent, draft.title)
      : base.indexContent
    return [{ ...base, title: nextTitle, ...(nextIndexContent !== undefined ? { indexContent: nextIndexContent } : {}), description: draft.description, ...(draft.chapterOrder ? { chapterOrder: draft.chapterOrder } : {}) }]
  })
  writing = true
  for (const entry of entries) inFlightKeys.add(entry.key)
  let catalogPrepared = false
  let transfer: number | undefined
  try {
    const scopedBookIds = [...new Set([...bookIds, ...entries.map(item => item.bookId)])]
    const catalogChange = catalog.prepare(scopedBookIds, cabinetIds)
    catalogPrepared = !!catalogChange
    if (!entries.length && !newBooks.length && !changedBooks.length && !catalogChange) return
    const bases = entries.map(item => {
      const prior = syncedCopies.value[item.key]
      if (prior && prior.snapshotVersion === snapshotVersion && prior.chapter.sha === item.chapter.sha) return prior.baseSha
      return null
    })
    transfer = transferIndicator.start('sync')
    const imagePaths = new Set(entries.flatMap(item => isMarkdownExt(item.chapter.ext) ? chapterAttachmentReferences(item.chapter).map(ref => ref.path) : []))
    const images: NoteAttachment[] = []
    for (const path of imagePaths) {
      const image = await localOrRemoteImage(path)
      if (!image) throw new Error('笔记引用的图片附件缺失，未提交笔记；请先恢复图片。')
      images.push(image)
    }
    const documents: StoredDocumentFile[] = []
    for (const item of entries) {
      if (isBinaryDocumentExt(item.chapter.ext) && item.chapter.filePath) {
        const stored = await getDocumentFile(initialRepository, item.chapter.filePath)
        if (!stored) throw new Error(`缺少文档文件，未提交：${item.chapter.title}`)
        documents.push(stored)
      }
    }
    const result = await store.syncBatch([...newBooks, ...changedBooks], entries.filter(item => !isPageBookId(item.bookId)).map(item => item.chapter), catalogChange, entries.filter(item => isPageBookId(item.bookId)).map(item => chapterAsPage(item.chapter)), images, documents)
    const completedChapters = [...result.chapters, ...result.pages.map(pageAsChapter)]
    updateOfflineAfterCommit(result.parent, result.head, { books: result.books, chapters: result.chapters, pages: result.pages, catalog: result.catalog })
    if (catalogChange && !result.catalog) throw new Error('GitHub 未返回书柜目录版本，请保留本地整理后重试。')
    if (result.catalog) { catalog.acknowledge(result.catalog); catalogPrepared = false }
    localMutationVersion++
    for (const item of entries) chapterCache.delete(`remote:${item.bookId}`)
    for (const book of result.books) {
      const index = latestBookMetadata.value.findIndex(item => item.id === book.id)
      if (index < 0) latestBookMetadata.value = [...latestBookMetadata.value, book]
      else latestBookMetadata.value = latestBookMetadata.value.map(item => item.id === book.id ? book : item)
    }
    for (const book of [...result.books, ...result.pages.map(pageAsBook)]) {
      if (!loadedBookIds.value.includes(book.id) && !snapshot.value) loadedBookIds.value.push(book.id)
      bookVersions.value = { ...bookVersions.value, [book.id]: snapshotVersion }
      localBooks.value = localBooks.value.map(item => item.id === book.id ? book : item)
      books.value = books.value.map(item => item.id === book.id ? book : item)
      if (selectedBook.value?.id === book.id) selectedBook.value = book
    }
    const nextDescriptions = { ...bookDescriptionDrafts.value }
    for (const book of result.books) {
      const submitted = changedBooks.find(item => item.id === book.id)
      const current = nextDescriptions[book.id]
      if (submitted && current && current.description === submitted.description && (current.title || current.base.title) === submitted.title && current.base.sha === submitted.sha && sameChapterOrder(current.chapterOrder ?? current.base.chapterOrder, submitted.chapterOrder)) delete nextDescriptions[book.id]
      else if (submitted && current) nextDescriptions[book.id] = { base: book, description: current.description, ...(current.title ? { title: current.title } : {}), ...(current.chapterOrder ? { chapterOrder: current.chapterOrder } : {}) }
    }
    bookDescriptionDrafts.value = nextDescriptions
    books.value = books.value.map(book => nextDescriptions[book.id] ? { ...book, ...(nextDescriptions[book.id].title ? { title: nextDescriptions[book.id].title } : {}), description: nextDescriptions[book.id].description, ...(nextDescriptions[book.id].chapterOrder ? { chapterOrder: nextDescriptions[book.id].chapterOrder } : {}) } : book)
    if (selectedBook.value && nextDescriptions[selectedBook.value.id]) { const pending = nextDescriptions[selectedBook.value.id]; selectedBook.value = { ...selectedBook.value, ...(pending.title ? { title: pending.title } : {}), description: pending.description, ...(pending.chapterOrder ? { chapterOrder: pending.chapterOrder } : {}) } }
    for (const page of result.pages) {
      const index = remotePages.value.findIndex(item => item.id === page.id)
      if (index < 0) remotePages.value = [...remotePages.value, page]
      else remotePages.value = remotePages.value.map(item => item.id === page.id ? page : item)
    }
    for (let i = 0; i < completedChapters.length; i++) {
      const chapter = completedChapters[i]
      const index = entries.findIndex(item => item.key === chapterKey(chapter))
      if (index < 0) continue
      syncedCopies.value = { ...syncedCopies.value, [chapterKey(chapter)]: { chapter, baseSha: bases[index], snapshotVersion } }
      localChapters.value = localChapters.value.map(item => chapterKey(item) === chapterKey(chapter) ? chapter : item)
      chapters.value = chapters.value.map(item => chapterKey(item) === chapterKey(chapter) ? chapter : item)
    }
    try { persistLocal() } catch { throw new Error('内容已提交到 GitHub，但浏览器无法保存本地缓存。请保留草稿并刷新远程目录。') }
    for (const resultChapter of completedChapters) {
      const key = chapterKey(resultChapter)
      const entry = entries.find(item => item.key === key)
      if (!entry) continue
      const current = drafts.value[key]
      try {
        if (current && current.content !== entry.chapter.content) {
          const draft = { base: resultChapter, content: current.content }
          localStorage.setItem(draftKey(resultChapter), JSON.stringify(draft))
          drafts.value = { ...drafts.value, [key]: draft }
        } else {
          localStorage.removeItem(draftKey(resultChapter))
          const next = { ...drafts.value }; delete next[key]; drafts.value = next
        }
      } catch { throw new Error('内容已提交到 GitHub，但浏览器无法保存后续本地修改。请立即复制草稿。') }
      if (selectedChapter.value && chapterKey(selectedChapter.value) === key) selectedChapter.value = resultChapter
    }
    transferIndicator.success(transfer)
  } catch (e) {
    if (transfer !== undefined) transferIndicator.fail(transfer)
    throw e
  } finally {
    if (catalogPrepared) catalog.fail()
    for (const entry of entries) inFlightKeys.delete(entry.key)
    writing = false
  }
}
async function syncSelected() {
  transferIndicator.dismissCompletion()
  if (!connected.value) { error.value = '请先连接 GitHub，再同步勾选的章节。'; goToConnection(); return }
  if (!saveDraft()) return
  const validChapterKeys = new Set(batchItems.value.map(item => item.key))
  const validBookIds = new Set([...localBooks.value.filter(book => !book.sha).map(book => book.id), ...Object.keys(bookDescriptionDrafts.value)])
  const keys = selectedKeys.value.filter(key => validChapterKeys.has(key))
  const bookIds = selectedKeys.value.filter(key => key.startsWith('book:') && validBookIds.has(key.slice(5))).map(key => key.slice(5))
  if (!keys.length && !bookIds.length) { error.value = '请先勾选要同步的笔记本或章节。'; return }
  clearMessages()
  const success = await run(() => performBatch(keys, bookIds))
  if (success) { const sent = new Set([...keys, ...bookIds.map(id => `book:${id}`)]); selectedKeys.value = selectedKeys.value.filter(key => !sent.has(key)); notice.value = '所选笔记已同步到 GitHub。' }
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}

async function syncFromHeader() {
  transferIndicator.dismissCompletion()
  if (!saveDraft()) return
  if (selectedKeys.value.length) { await syncSelected(); return }
  if (selectedChapter.value && (dirty.value || !selectedChapter.value.sha)) { await sync(); return }
  if (selectedBook.value && bookDescriptionDrafts.value[selectedBook.value.id]) { await syncBook(); return }
  if (catalog.pending.value) { await syncCatalog(); return }
  if (view.value === 'edit') { view.value = 'read'; await nextTick() }
  const panel = document.querySelector<HTMLDetailsElement>('details.batch-box:not(.delete-manager)')
  if (panel) {
    panel.open = true
    notice.value = pendingBatchCount.value ? '请先勾选要同步的本机项目。' : '没有待同步的笔记本或章节。'
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// Remove local records only after a remote deletion has succeeded. The pending
// list also permits discarding a draft without deleting its published chapter.
function removeLocalRecords(bookIds: string[], chapterKeys: string[], draftOnlyKeys: string[] = [], descriptionIds: string[] = []) {
  const removedBooks = new Set(bookIds), removedChapters = new Set(chapterKeys)
  const discardedDrafts = new Set(draftOnlyKeys)
  for (const [key, draft] of Object.entries(drafts.value)) {
    if (removedBooks.has(draft.base.bookId) || removedChapters.has(key)) discardedDrafts.add(key)
  }
  const before = {
    books: localBooks.value, descriptions: bookDescriptionDrafts.value, chapters: localChapters.value, copies: syncedCopies.value,
    versions: bookVersions.value, drafts: drafts.value, storage: localStorage.getItem(localKey),
    draftStorage: Object.fromEntries([...discardedDrafts].map(key => {
      const draft = drafts.value[key]
      return [key, draft ? localStorage.getItem(draftKey(draft.base)) : null]
    })) as Record<string, string | null>
  }
  try {
    localBooks.value = localBooks.value.filter(book => !removedBooks.has(book.id))
    bookDescriptionDrafts.value = Object.fromEntries(Object.entries(bookDescriptionDrafts.value).filter(([id]) => !removedBooks.has(id) && !descriptionIds.includes(id)))
    localChapters.value = localChapters.value.filter(chapter => !removedBooks.has(chapter.bookId) && !removedChapters.has(chapterKey(chapter)))
    syncedCopies.value = Object.fromEntries(Object.entries(syncedCopies.value).filter(([key, copy]) => !removedBooks.has(copy.chapter.bookId) && !removedChapters.has(key)))
    bookVersions.value = Object.fromEntries(Object.entries(bookVersions.value).filter(([id]) => !removedBooks.has(id)))
    drafts.value = Object.fromEntries(Object.entries(drafts.value).filter(([key]) => !discardedDrafts.has(key)))
    persistLocal()
    for (const key of discardedDrafts) {
      const draft = before.drafts[key]
      if (draft) localStorage.removeItem(draftKey(draft.base))
    }
    catalog.discardMoves(bookIds)
  } catch (e) {
    localBooks.value = before.books; bookDescriptionDrafts.value = before.descriptions; localChapters.value = before.chapters
    syncedCopies.value = before.copies; bookVersions.value = before.versions; drafts.value = before.drafts
    try {
      if (before.storage === null) localStorage.removeItem(localKey); else localStorage.setItem(localKey, before.storage)
      for (const [key, value] of Object.entries(before.draftStorage)) {
        const draft = before.drafts[key]
        if (draft) { if (value === null) localStorage.removeItem(draftKey(draft.base)); else localStorage.setItem(draftKey(draft.base), value) }
      }
    } catch { /* report the original storage failure */ }
    throw e
  }
  localMutationVersion++
  books.value = books.value.filter(book => !removedBooks.has(book.id))
  loadedBookIds.value = loadedBookIds.value.filter(id => !removedBooks.has(id))
  chapters.value = chapters.value.filter(chapter => !removedBooks.has(chapter.bookId) && !removedChapters.has(chapterKey(chapter)))
  for (const id of removedBooks) { autoBooks.delete(id); autoMoves.delete(id); chapterCache.delete(`remote:${id}`); chapterCache.delete(`snapshot:${id}`) }
  for (const key of removedChapters) {
    const bookId = key.split('/')[0]
    chapterCache.delete(`remote:${bookId}`); chapterCache.delete(`snapshot:${bookId}`)
  }
  for (const key of [...removedChapters, ...discardedDrafts]) autoKeys.delete(key)
  selectedKeys.value = selectedKeys.value.filter(key => !removedChapters.has(key) && !discardedDrafts.has(key) && !removedBooks.has(key.startsWith('book:') ? key.slice(5) : key.split('/')[0]))
  for (const id of descriptionIds) {
    const latest = latestBookMetadata.value.find(book => book.id === id)
    const otherDrafts = localChapters.value.some(chapter => chapter.bookId === id && !chapter.sha) || Object.values(drafts.value).some(draft => draft.base.bookId === id)
    if (!latest && latestBookMetadataComplete && !otherDrafts) {
      books.value = books.value.filter(book => book.id !== id)
      if (selectedBook.value?.id === id) { selectedBook.value = null; selectedChapter.value = null; chapters.value = []; view.value = 'read' }
      selectedKeys.value = selectedKeys.value.filter(key => key !== `book:${id}`)
      autoBooks.delete(id)
      continue
    }
    const base = latest || before.descriptions[id]?.base
    if (base) {
      books.value = books.value.map(book => book.id === id ? restoreNotebookBase(book, base) : book)
      if (selectedBook.value?.id === id) selectedBook.value = restoreNotebookBase(selectedBook.value, base)
      selectedKeys.value = selectedKeys.value.filter(key => key !== `book:${id}`)
      autoBooks.delete(id)
    }
  }
  if (selectedBook.value && removedBooks.has(selectedBook.value.id)) {
    selectedBook.value = null; selectedChapter.value = null; chapters.value = []; view.value = 'read'
  } else if (selectedChapter.value) {
    const key = chapterKey(selectedChapter.value)
    if (removedChapters.has(key)) { selectedChapter.value = null; view.value = 'read' }
    else if (discardedDrafts.has(key)) {
      const base = before.drafts[key]?.base
      if (base) { suspendDraft = true; try { selectedChapter.value = base; content.value = base.content } finally { suspendDraft = false } }
    }
  }
}

async function deletePendingSelected() {
  if (writing || busy.value) { error.value = '正在同步，请稍后再删除。'; return }
  const chosen = new Set(selectedKeys.value)
  const selectedBooks = localBooks.value.filter(book => !book.sha && (chosen.has(`book:${book.id}`) || (book.kind === 'page' && batchItems.value.some(item => item.bookId === book.id && chosen.has(item.key)))))
  const bookIds = selectedBooks.map(book => book.id)
  const descriptionIds = Object.keys(bookDescriptionDrafts.value).filter(id => chosen.has(`book:${id}`))
  const entries = batchItems.value.filter(item => chosen.has(item.key) && !bookIds.includes(item.bookId))
  if (!bookIds.length && !entries.length && !descriptionIds.length) { error.value = '请先勾选要删除的本机项目。'; return }
  const names = [...selectedBooks.map(book => `整本：${book.title}`), ...descriptionIds.map(id => `丢弃本机笔记本信息修改（简介/章节顺序）：${bookDescriptionDrafts.value[id].base.title}`), ...entries.map(item => `${item.chapter.sha ? '丢弃本机草稿' : '本机章节'}：${item.title}`)]
  if (!window.confirm(`将删除以下本机内容：\n\n${names.join('\n')}\n\n新建笔记本包括其中所有本机章节和草稿；已同步章节仅丢弃本机草稿，GitHub 上的章节不受影响。此操作无法撤销。`)) return
  clearTimeout(autoTimer)
  const success = await run(async () => {
    removeLocalRecords(bookIds, entries.filter(item => !item.chapter.sha).map(item => item.key), entries.filter(item => !!item.chapter.sha).map(item => item.key), descriptionIds)
    if (selectedBook.value && descriptionIds.includes(selectedBook.value.id)) {
      // Re-read the cached baseline: a book with no saved order must return to
      // its original list order, not the order of the just-discarded draft.
      try { chapters.value = await getChapters(selectedBook.value) }
      catch { error.value = '本机信息修改已丢弃，但无法重新读取章节；请联网后恢复。' }
    }
  })
  if (success) notice.value = '已删除所选本机项目；GitHub 内容未改变。'
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}

async function deleteManaged(wholeBooks: Notebook[], selectedChapters: Chapter[]) {
  if (localMetadataDamaged) { try { assertLocalMetadataWritable(true) } catch (e) { error.value = message(e) }; return }
  if (writing || busy.value) { error.value = '正在同步，请稍后再删除。'; return }
  if (!wholeBooks.length && !selectedChapters.length) { error.value = '请先勾选要删除的内容。'; return }
  const localIds = new Set(localBooks.value.filter(book => !book.sha).map(book => book.id))
  if (wholeBooks.some(book => !book.sha && !localIds.has(book.id))) { error.value = '有笔记本来源不明确，请先刷新或处理其本机草稿。'; return }
  const remoteBooks = wholeBooks.filter(book => !localIds.has(book.id) && !isPageBookId(book.id))
  const remotePageBooks = wholeBooks.filter(book => !localIds.has(book.id) && isPageBookId(book.id))
  const remoteChapters = selectedChapters.filter(chapter => !!chapter.sha && !wholeBooks.some(book => book.id === chapter.bookId))
  if ((remoteBooks.length || remotePageBooks.length || remoteChapters.length) && !connected.value) { error.value = '删除已同步内容需要先连接 GitHub。'; goToConnection(); return }
  clearTimeout(autoTimer)
  let remotePayload: Array<{ book: Notebook; chapters: Chapter[] }> = []
  let remotePagePayload: Page[] = []
  const loaded = await run(async () => {
    remotePayload = await Promise.all(remoteBooks.map(async book => ({ book, chapters: await store.listChapters(book.id) })))
    remotePagePayload = await Promise.all(remotePageBooks.map(async book => {
      const page = remotePages.value.find(item => item.id === pageId(book.id))
      if (!page || page.sha !== book.sha) throw new Error('书页基准已变化，请先恢复后重试。')
      return page
    }))
  })
  if (!loaded) { if (autoSave.value) scheduleAuto(); return }
  const names = [...wholeBooks.map(book => `整本：${book.title}${localIds.has(book.id) ? '（仅本机）' : `（GitHub 和本机，${remotePayload.find(item => item.book.id === book.id)?.chapters.length ?? 0} 个远程章节）`}`), ...selectedChapters.map(chapter => `章节：${chapter.title}${chapter.sha ? '（GitHub 和本机）' : '（仅本机）'}`)]
  if (!window.confirm(`确认删除以下内容？\n\n${names.join('\n')}\n\n整本删除会同时删除其中全部章节和本机草稿。标记 GitHub 的内容会从仓库删除；如果远程内容发生变化将拒绝操作。此操作无法撤销。`)) { if (autoSave.value) scheduleAuto(); return }
  let remoteSucceeded = false
  const success = await run(async () => {
    writing = true
    try {
      if (remotePayload.length || remoteChapters.length || remotePagePayload.length) {
        const result = await store.deleteBatch(remotePayload, remoteChapters, remotePagePayload)
        remoteSucceeded = true
        updateOfflineAfterCommit(result.parent, result.head, { deletedBooks: remoteBooks.map(book => book.id), deletedChapters: remoteChapters, deletedPages: remotePagePayload.map(page => page.id), catalog: result.catalog })
        remotePages.value = remotePages.value.filter(page => !remotePagePayload.some(item => item.id === page.id))
        if (result.catalog) catalog.latest(result.catalog)
        snapshot.value = false
      }
      removeLocalRecords(wholeBooks.map(book => book.id), selectedChapters.map(chapterKey))
    } catch (e) {
      if (remoteSucceeded) throw new Error(`GitHub 已删除，但清理本机数据失败：${message(e)}。请检查本机草稿后刷新。`)
      throw e
    } finally { writing = false }
  })
  if (success) { deleteBookIds.value = []; deleteChapterIds.value = []; notice.value = '已删除所选内容。' }
  if (autoSave.value && (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size)) scheduleAuto()
}
function scheduleAuto() {
  if (disposed || !autoSave.value || !connected.value || !isHosted.value) return
  clearTimeout(autoTimer)
  autoStatus.value = '等待自动保存'
  autoTimer = setTimeout(() => { void flushAuto() }, 1600)
}
async function flushAuto() {
  transferIndicator.dismissCompletion()
  if (disposed || !autoSave.value || !connected.value || !isHosted.value) return
  if (writing) { scheduleAuto(); return }
  const keys = [...autoKeys]; const descriptionBookIds = [...autoBooks]; const bookIds = [...new Set([...autoBooks, ...autoMoves])]; const cabinetIds = [...autoCabinets]
  autoKeys.clear(); autoBooks.clear(); autoMoves.clear(); autoCabinets.clear()
  if (!keys.length && !bookIds.length && !cabinetIds.length) return
  autoStatus.value = '正在自动保存'
  try {
    await performBatch(keys, bookIds, cabinetIds, descriptionBookIds)
    autoStatus.value = '已自动同步'
    if (autoKeys.size || autoBooks.size || autoCabinets.size || autoMoves.size) scheduleAuto()
  } catch (e) {
    autoSave.value = false
    autoStatus.value = `自动保存已暂停：${message(e)}`
    error.value = `${autoStatus.value}。本地草稿仍保留，请检查后手动同步。`
    autoKeys.clear(); autoBooks.clear(); autoMoves.clear(); autoCabinets.clear()
  }
}
watch(autoSave, enabled => {
  if (enabled && (!isHosted.value || !connected.value)) { autoSave.value = false; autoStatus.value = '连接线上书架后可开启'; return }
  if (isHosted.value && connected.value && !disposed) {
    try { localStorage.setItem(autoPreferenceKey, String(enabled)) } catch { /* keep the active setting for this session */ }
  }
  if (enabled) autoStatus.value = '自动保存已开启'
  else { clearTimeout(autoTimer); autoKeys.clear(); autoBooks.clear(); autoMoves.clear(); autoCabinets.clear(); autoStatus.value = '自动保存已关闭' }
}, { flush: 'sync' })
let backgroundRunning = false
let backgroundReady = false
let backgroundRetry = false
let backgroundTimer: ReturnType<typeof setTimeout> | undefined
let backgroundLastCheck = 0
let backgroundHead = ''
function scheduleDesktopRemoteCheck() {
  if (!isDesktop.value || !backgroundReady || disposed) return
  if (backgroundRunning) { backgroundRetry = true; return }
  clearTimeout(backgroundTimer)
  // Limit unauthenticated GitHub API traffic while still checking after a quick
  // switch back from the web app, rather than losing that focus event.
  const delay = Math.max(0, 10000 - (Date.now() - backgroundLastCheck))
  backgroundTimer = setTimeout(() => { void updateFromRemoteInBackground() }, delay)
}
async function updateFromRemoteInBackground() {
  if (!initialRepository || !connected.value) return
  if ((!isHosted.value && !isDesktop.value) || disposed) return
  if (backgroundRunning) { if (isDesktop.value) backgroundRetry = true; return }
  if (isDesktop.value && (busy.value || writing)) { backgroundLastCheck = Date.now(); scheduleDesktopRemoteCheck(); return }
  backgroundRunning = true
  backgroundLastCheck = Date.now()
  const version = localMutationVersion
  try {
    const head = await store.readHead()
    if (restoredSnapshot.value) {
      if (head && restoredSnapshot.value.head === head && !restoredSnapshot.value.stale) {
        // Local cache is already at the exact GitHub HEAD — stay 100% local-first with zero network overhead!
        backgroundHead = head
        offlineMode.value = true
        return
      }
      if (head && restoredSnapshot.value.head !== head && !restoredSnapshot.value.stale) {
        const old = { ...restoredSnapshot.value, stale: true }
        try { writeRemoteCache(old, initialRepository); restoredSnapshot.value = old; notice.value = 'GitHub 有新内容；当前优先加载本地缓存，点击「恢复」可拉取最新。' }
        catch { error.value = '无法更新离线副本状态，请检查存储空间后点击“恢复”。' }
      }
      // Keep local-first mode active instead of switching to slow per-click GitHub requests!
      backgroundHead = head
      offlineMode.value = true
      return
    }
    if (isDesktop.value && head && head === backgroundHead) return
    const [latest, latestCatalog, rawPages] = await Promise.all([store.listNotebooks(), store.readCatalog(false), store.listPages()])
    const pages = await Promise.all(rawPages.map(storeRemoteBinaryPage))
    const selectedId = selectedBook.value?.id
    const request = bookRun
    const selectedExists = !!selectedId && (latest.some(book => book.id === selectedId) || pages.some(page => pageBookId(page.id) === selectedId))
    const latestChapters = selectedExists && !isPageBookId(selectedId!) ? await Promise.all((await store.listChapters(selectedId!)).map(storeRemoteBinaryChapter)) : []
    if (disposed || writing || version !== localMutationVersion) return
    catalog.latest(latestCatalog)
    remotePages.value = pages
    offlineMode.value = false
    chapterCache.clear()
    if (selectedExists && !isPageBookId(selectedId!)) chapterCache.set(`remote:${selectedId}`, Promise.resolve(latestChapters))
    loadedBookIds.value = latest.map(book => book.id)
    books.value = mergeBooks([...latest, ...pages.map(pageAsBook)], false)
    if (selectedBook.value) activeCabinet.value = catalog.assigned(selectedBook.value.id)
    else if (activeCabinet.value && !catalog.cabinets.value.some(item => item.id === activeCabinet.value)) activeCabinet.value = ''
    snapshot.value = false
    if (selectedId && selectedBook.value?.id === selectedId && request === bookRun) {
      selectedBook.value = books.value.find(book => book.id === selectedId) || selectedBook.value
      chapters.value = await getChapters(selectedBook.value)
      // Never replace an open editor or the baseline of a pending draft; the
      // existing GitHub SHA check must detect a concurrent edit on submission.
      const current = selectedChapter.value
      const latestChapter = current && chapters.value.find(item => item.id === current.id)
      if (current && latestChapter && view.value !== 'edit' && !drafts.value[chapterKey(current)] && content.value === current.content) {
        suspendDraft = true
        try { selectedChapter.value = latestChapter; content.value = latestChapter.content }
        finally { suspendDraft = false }
      }
    }
    if (isDesktop.value && request !== bookRun) { backgroundHead = ''; backgroundRetry = true }
    else backgroundHead = head
  } catch { /* Snapshot stays available when GitHub is unreachable. */ }
  finally {
    backgroundRunning = false
    if (backgroundRetry && !disposed) { backgroundRetry = false; scheduleDesktopRemoteCheck() }
  }
}
onMounted(() => {
  const updateStickyTop = () => { if (archiveHeader.value) editorStickyTop.value = Math.ceil(archiveHeader.value.getBoundingClientRect().height) + 10 }
  updateStickyTop()
  if (typeof ResizeObserver !== 'undefined' && archiveHeader.value) {
    headerResizeObserver = new ResizeObserver(updateStickyTop)
    headerResizeObserver.observe(archiveHeader.value)
  }
  try { editorSidebarOpen.value = localStorage.getItem(editorSidebarPreference) !== 'false' } catch { /* Use the default expanded view. */ }
  try { editorSidebarTab.value = localStorage.getItem(editorSidebarTabPreference) === 'outline' ? 'outline' : 'chapters' } catch { /* Use the default chapter view. */ }
  isDesktop.value = location.hostname === 'paper.local' && (location.pathname === '/my-notes' || location.pathname.startsWith('/my-notes/'))
  isHosted.value = !isDesktop.value && location.protocol !== 'file:'
  try { hasLegacyWorkspace.value = workspaceHasContent('legacy'); hasUnboundWorkspace.value = !!initialRepository && workspaceHasContent('local') }
  catch { legacyWorkspaceCheckFailed.value = true }
  const credentialReady = (async () => {
    try {
      const token = await readCredential()
      if (disposed) return
      if (token) {
        store.setToken(token)
        connected.value = true
        if (isHosted.value) autoSave.value = savedAutoPreference()
      }
    } catch { if (!disposed) error.value = '无法读取已保存的 GitHub 令牌，请检查本机存储。' }
    finally { tokenLoading.value = false }
  })()
  let restoreError = ''
  try {
    // A fresh unbound workspace receives an editable local copy once. A
    // connected repository never gets seeded automatically on a new device.
    const prepared = prepareLocalCollection(localStorage, localKey, () => !initialRepository ? addWelcomeNotebook(localStorage, '', snapshotFiles, newId) : null)
    const { saved, metadata, added: addedWelcome } = prepared
    localMetadataDamaged = prepared.damaged
    if (Array.isArray(saved.books)) localBooks.value = saved.books.map(book => ({ ...book, title: isMarkdownExt(book.ext) ? (cleanMarkdownTitle(book.title) || book.title) : book.title }))
    bookDescriptionDrafts.value = metadata.drafts
    if (prepared.damaged) restoreError = '本地笔记本信息损坏，已保留原始数据并暂停写入笔记目录和同步；请先备份本地数据，再检查或恢复。'
    if (Array.isArray(saved.chapters)) localChapters.value = saved.chapters.map(normalizeChapterTitle)
    if (saved.synced && typeof saved.synced === 'object' && !Array.isArray(saved.synced)) syncedCopies.value = saved.synced
    if (saved.bookVersions && typeof saved.bookVersions === 'object' && !Array.isArray(saved.bookVersions)) bookVersions.value = saved.bookVersions
    welcomeInitialized.value = saved.welcomeInitialized === true
    welcomeBookId.value = typeof saved.welcomeBookId === 'string' ? saved.welcomeBookId : ''
    if (addedWelcome) notice.value = '使用说明已添加到本机，可编辑、删除或选择同步。'
    const found: Record<string, Draft> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(draftPrefix)) continue
      try {
        const draft = JSON.parse(localStorage.getItem(key) || 'null')
        if (typeof draft?.content === 'string' && typeof draft?.base?.bookId === 'string' && typeof draft?.base?.id === 'string' && typeof draft?.base?.sha === 'string') found[chapterKey(draft.base)] = draft
      } catch { /* skip a malformed draft without discarding others */ }
    }
    drafts.value = found
  } catch { localMetadataDamaged = true; restoreError = '无法读取本地笔记本，已暂停写入笔记目录和同步以保护原始数据；请备份后检查浏览器存储。' }
  void (async () => {
    await identifySnapshot()
    const loaded = await run(async () => {
      const savedRemote = readRemoteCache(initialRepository)
      const snapshotCatalog = savedRemote?.catalog || await store.readCatalog(true)
      try { catalog.restore(snapshotCatalog) } catch { restoreError = '无法恢复本地书柜，请检查浏览器存储。'; catalog.latest(snapshotCatalog) }
      if (savedRemote) {
        restoredSnapshot.value = savedRemote
        backgroundHead = savedRemote.stale ? '' : savedRemote.head
        remotePages.value = savedRemote.pages || []
        offlineMode.value = true
        snapshot.value = false
        loadedBookIds.value = savedRemote.books.map(book => book.id)
        books.value = mergeBooks([...savedRemote.books, ...(savedRemote.pages || []).map(pageAsBook)], false)
        if (savedRemote.stale) notice.value = '本机离线副本可能缺少其他设备的更新，联网后请点击“恢复”。'
      } else await loadBooks(true)
    })
    if (restoreError) error.value = restoreError
    backgroundReady = loaded
    await credentialReady
    if (loaded && connected.value) {
      // Pure local-first: when a local snapshot already exists, do NOT hit GitHub on startup;
      // only check & sync when the user explicitly clicks「恢复」or「同步」.
      if (!restoredSnapshot.value) void refresh()
    }
  })()
  window.addEventListener('scroll', handleWindowScroll, { passive: true })
  ensureShelfAudioUnlocked()
  checkInitialShareHash()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleWindowScroll)
  stopChapterDragScroll()
  imageRefresh++
  clearTimeout(imageRefreshTimer)
  for (const url of imageObjects.values()) URL.revokeObjectURL(url)
  imageObjects.clear()
  disposed = true
  headerResizeObserver?.disconnect()
  clearTimeout(backgroundTimer)
  clearTimeout(autoTimer)
  transferIndicator.dispose()
  saveDraft()
  autoSave.value = false
  store.clearToken()
  tokenInput.value = ''
})
watch([query, books, localChapters, content, syncedCopies, drafts], async ([value]) => {
  const runId = ++searchRun
  if (!value.trim()) { searchIndex.value = []; searching.value = false; return }
  searching.value = true
  try {
    const all = await Promise.all(books.value.map(book => getChapters(book)))
    if (runId === searchRun) searchIndex.value = all.flat().map(chapter => {
      try { const draft = JSON.parse(localStorage.getItem(draftKey(chapter)) || 'null'); return typeof draft?.content === 'string' ? { ...chapter, content: draft.content } : chapter } catch { return chapter }
    })
  } catch (e) { if (runId === searchRun) error.value = `搜索暂不可用：${message(e)}` }
  finally { if (runId === searchRun) searching.value = false }
})
async function openSearchResult(chapter: Chapter) {
  const book = books.value.find(item => item.id === chapter.bookId)
  if (!book) return
  await openBook(book)
  if (selectedBook.value?.id !== chapter.bookId) return
  const original = chapters.value.find(item => item.id === chapter.id)
  if (original) {
    query.value = ''
    openChapter(original)
  }
}
</script>

<template>
  <div class="desk" :style="{ '--editor-sticky-top': `${editorStickyTop}px` }" @dragover="dragOverImport" @dragleave.self="draggingFiles = false" @drop="dropImport">
    <header ref="archiveHeader" class="archive-header" :class="{ 'desktop-header': isDesktop, 'has-transfer': transferState.phase !== 'idle' }" @mousedown="dragWindow" @dblclick="maximizeWindow">
      <div class="archive-header-inner">
        <div class="archive-path">
          <button class="archive-brand" type="button" @click="openCabinet()"><span aria-hidden="true"></span>纸间</button>
          <span class="archive-divider" aria-hidden="true"></span>
          <nav aria-label="当前位置">
            <button type="button" @click="openCabinet()">全部书柜</button>
            <template v-if="chosenCabinet">
              <span aria-hidden="true"> / </span>
              <button type="button" @click="openCabinet(chosenCabinet.id)">{{ chosenCabinet.title }}</button>
            </template>
            <template v-if="selectedBook">
              <span aria-hidden="true"> / </span>
              <button type="button" @click="openBook(selectedBook)">{{ selectedBook.title }}</button>
            </template>
            <template v-if="selectedChapter"><span aria-hidden="true"> / </span><span>{{ selectedChapterDisplay?.primaryTitle || selectedChapter.title }}</span></template>
          </nav>
        </div>
        <div class="archive-actions">
          <div class="archive-search-wrap archive-hide-sm">
            <label class="archive-search"><span class="sr-only">搜索笔记</span><input v-model="query" type="search" placeholder="搜索书柜 / 笔记本 / 章节..."></label>
            <div v-if="selectedChapter && view === 'edit' && query.trim()" class="archive-search-results">
              <p v-if="searching">正在查找章节…</p>
              <template v-else>
                <button v-for="result in searchResults" :key="result.bookId + '/' + result.id" type="button"
                  :disabled="busy" @click="openSearchResult(result)">
                  {{ books.find(book => book.id === result.bookId)?.title }} ／ {{ displayChapterItem(result).primaryTitle }}
                </button>
                <p v-if="!searchResults.length">没有匹配的章节。</p>
              </template>
            </div>
          </div>
          <span class="archive-hide-md"><ThemePicker ref="themePickerRef" /></span>
          <span class="archive-hide-md"><SettingsModal ref="settingsModalRef" /></span>
          <button class="archive-refresh archive-hide-lg" :disabled="busy" title="从 GitHub 恢复笔记到本机，保留未同步草稿" aria-label="从 GitHub 恢复笔记，保留未同步草稿" @click="refresh">恢复</button>
          <button class="archive-sync archive-hide-lg" :disabled="busy" title="将勾选的笔记、当前章节或书柜整理提交到 GitHub" aria-label="将勾选的笔记、当前章节或书柜整理同步到 GitHub" @click="syncFromHeader">同步</button>
          <button type="button" class="archive-new archive-hide-md" :disabled="busy" @click="importing = true">导入</button>
          <button type="button" class="archive-new" :disabled="busy" @click="openNewNote">＋ 新建笔记</button>
          <div class="archive-overflow-wrap">
            <button type="button" class="archive-new archive-overflow-btn" :aria-expanded="headerMenuOpen" aria-label="更多操作" title="更多操作" @click="headerMenuOpen = !headerMenuOpen">⋯</button>
            <div v-if="headerMenuOpen" class="archive-overflow-menu" role="menu" @click="headerMenuOpen = false">
              <button type="button" role="menuitem" :disabled="busy" @click="refresh">从 GitHub 恢复</button>
              <button type="button" role="menuitem" :disabled="busy" @click="syncFromHeader">同步到 GitHub</button>
              <button type="button" role="menuitem" :disabled="busy" @click="importing = true">导入笔记与文档</button>
              <button type="button" role="menuitem" @click="themePickerRef?.show()">主题与自定义配色</button>
              <button type="button" role="menuitem" @click="settingsModalRef?.show()">常规设置</button>
            </div>
          </div>
          <div v-if="isDesktop" class="window-controls" aria-label="窗口控制">
            <button type="button" class="window-btn" aria-label="最小化窗口" title="最小化" @click="windowCommand('window.minimize')">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            </button>
            <button type="button" class="window-btn" aria-label="最大化或还原窗口" title="最大化或还原" @click="windowCommand('window.maximize')">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.35"/></svg>
            </button>
            <button type="button" class="window-btn window-close" aria-label="关闭窗口" title="关闭" @click="windowCommand('window.close')">
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><line x1="2.6" y1="2.6" x2="9.4" y2="9.4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/><line x1="9.4" y1="2.6" x2="2.6" y2="9.4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div v-if="transferState.phase !== 'idle'" class="transfer-rail" :class="`is-${transferState.phase}`" aria-hidden="true">
        <span
          class="transfer-rail-fill"
          :style="{ width: transferState.phase === 'running' ? `${transferPercent ?? 100}%` : '100%' }"
        ></span>
        <span v-if="transferState.phase !== 'settling'" class="transfer-rail-label">
          {{
            transferState.phase === 'running'
              ? (transferDetail
                ? `${transferDetail}${transferPercent !== null ? ` (${transferPercent}%)` : ''}`
                : (transferState.kind === 'sync' ? '同步中…' : '正在从 GitHub 恢复…'))
              : (transferState.kind === 'sync' ? '同步完成 ✓' : '恢复完成 ✓')
          }}
        </span>
      </div>
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ transferState.phase === 'running' ? (transferState.kind === 'sync' ? '正在同步' : '正在恢复') : transferState.phase === 'success' ? (transferState.kind === 'sync' ? '同步完成' : '恢复完成') : '' }}</span>
    </header>
    <div v-if="draggingFiles" class="import-drop-indicator" aria-hidden="true">松开导入笔记或外部文档（MD / TXT / PDF / Word / PPT 等）</div>
    <div v-if="importing" class="archive-modal" @click.self="importing = false" @keydown.esc="importing = false">
      <div class="archive-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div class="archive-dialog-heading"><h2 id="import-title">导入笔记与文档</h2><button type="button" aria-label="关闭" @click="importing = false">×</button></div>
        <p>支持导入 Markdown（.md）、纯文本（.txt）及只读外部文档（PDF、Word .doc/.docx、PPT .ppt/.pptx、Excel .xls/.xlsx、CSV 等）；文件夹内引用的图片会一起导入。也可以直接拖入窗口。</p>
        <p>提示：仅 <strong>.md</strong> 与 <strong>.txt</strong> 支持在纸间内编辑，其他格式导入后仅支持只读预览或用系统默认程序打开。</p>
        <p>{{ selectedBook && selectedBook.kind !== 'page' ? '文件将导入当前笔记本的章节。' : '单个文件将作为独立书页，放入当前书柜。' }}</p>
        <fieldset v-if="!selectedBook || selectedBook.kind === 'page'" class="note-kind import-folder-mode">
          <legend>导入文件夹方式</legend>
          <label><input v-model="folderImportMode" type="radio" value="book"> 作为书本导入 <small>最外层为笔记本，子文件夹按“章 / 话”折叠</small></label>
          <label><input v-model="folderImportMode" type="radio" value="cabinet"> 作为书柜导入 <small>最外层为书柜，二层为笔记本，三层按“章 / 话”折叠</small></label>
        </fieldset>
        <p v-if="selectedChapter && selectedChapterIsMarkdown">如果原笔记中的图片位于其他文件夹，可选择图片文件夹补齐当前笔记。</p>
        <p v-if="error" class="feedback error" role="alert">{{ error }}</p>
        <div class="archive-dialog-actions">
          <button type="button" class="archive-new" :disabled="busy" @click="chooseImportFiles">选择文件</button>
          <button type="button" class="archive-new" :disabled="busy" @click="chooseImportFolder">选择文件夹</button>
          <button v-if="selectedChapter && selectedChapterIsMarkdown" type="button" class="archive-new" :disabled="busy" @click="chooseRepairFolder">补齐当前笔记图片</button>
          <button v-if="selectedChapter && selectedChapterIsMarkdown" type="button" class="archive-new" :disabled="busy" title="用于原图片放在其他位置或旧电脑绝对路径的情况" @click="repairImageFolderInput?.click()">从图片文件夹补齐</button>
          <button v-if="selectedChapter && selectedChapterIsMarkdown && isDesktop" type="button" class="archive-new" :disabled="busy" title="选择原始 Markdown，读取其中指向本机的图片路径" @click="repairImagesFromOriginalPaths">选择原笔记自动补齐</button>
        </div>
        <div class="share-import-box">
          <label for="share-link-input"><strong>通过分享链接导入</strong><small>支持纸间离线分享链接（paper-share://...）或 GitHub 笔记链接</small></label>
          <div class="share-import-row">
            <textarea
              id="share-link-input"
              v-model="shareImportInput"
              rows="2"
              placeholder="在此粘贴别人发给你的分享链接..."
            ></textarea>
            <button
              type="button"
              class="archive-new"
              :disabled="busy || shareImportLoading || !shareImportInput.trim()"
              @click="parseShareLinkInput()"
            >{{ shareImportLoading ? '解析中…' : '解析链接' }}</button>
          </div>
          <p v-if="shareImportError" class="feedback error" role="alert">{{ shareImportError }}</p>
          <div v-if="pendingShareImport" class="share-preview-card">
            <div class="share-preview-head">
              <span class="share-scope-badge">{{ pendingShareImport.summary.scopeLabel }}</span>
              <strong>{{ pendingShareImport.summary.title }}</strong>
            </div>
            <p class="share-preview-meta">
              来源：{{ pendingShareImport.sourceLabel }}
              <template v-if="pendingShareImport.summary.bookCount"> · {{ pendingShareImport.summary.bookCount }} 本笔记本</template>
              <template v-if="pendingShareImport.summary.chapterCount"> · {{ pendingShareImport.summary.chapterCount }} 篇章节</template>
              <template v-if="pendingShareImport.summary.pageCount"> · {{ pendingShareImport.summary.pageCount }} 张书页</template>
              <template v-if="pendingShareImport.summary.imageCount"> · {{ pendingShareImport.summary.imageCount }} 张图片</template>
            </p>
            <div v-if="pendingShareImport.payload.scope === 'chapter' && selectedBook && selectedBook.kind !== 'page'" class="share-dest-row">
              <label><input v-model="shareImportChapterMode" type="radio" value="current-book"> 导入到当前笔记本「{{ selectedBook.title }}」</label>
              <label><input v-model="shareImportChapterMode" type="radio" value="standalone-page"> 作为独立书页放入书柜</label>
            </div>
            <label v-if="pendingShareImport.payload.scope !== 'cabinet' && !(pendingShareImport.payload.scope === 'chapter' && shareImportChapterMode === 'current-book' && selectedBook && selectedBook.kind !== 'page')" class="share-dest-select">
              导入到书柜
              <select v-model="shareImportTargetCabinet">
                <option v-for="cab in catalog.cabinets.value" :key="cab.id" :value="cab.id">{{ cab.title }}</option>
              </select>
            </label>
            <p v-else-if="pendingShareImport.payload.scope === 'cabinet'" class="share-preview-hint">将新建同名书柜收纳全部笔记，不会覆盖你原有的书柜与内容。</p>
            <div class="archive-dialog-actions">
              <button type="button" class="archive-new" @click="pendingShareImport = null">取消预览</button>
              <button type="button" class="primary-button" :disabled="busy" @click="confirmImportShare">确认导入到本机</button>
            </div>
          </div>
        </div>
        <input ref="importFileInput" class="sr-only" type="file" accept=".md,.txt,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.rtf,text/markdown,text/plain,application/pdf" multiple @change="fileInputImport">
        <input ref="importFolderInput" class="sr-only" type="file" webkitdirectory multiple @change="fileInputImport">
        <input ref="repairFolderInput" class="sr-only" type="file" webkitdirectory multiple @change="repairFolderImport">
        <input ref="repairImageFolderInput" class="sr-only" type="file" webkitdirectory multiple @change="repairImageFolderImport">
      </div>
    </div>
    <div v-if="creatingCabinet && !chosenCabinet" class="archive-modal" @click.self="creatingCabinet = false" @keydown.esc="creatingCabinet = false">
      <form class="archive-dialog" role="dialog" aria-modal="true" aria-labelledby="new-cabinet-title" @submit.prevent="addCabinet">
        <div class="archive-dialog-heading"><h2 id="new-cabinet-title">新建书柜</h2><button type="button" aria-label="关闭" @click="creatingCabinet = false">×</button></div>
        <label for="cabinet-name">书柜名称</label>
        <input id="cabinet-name" v-model="cabinetName" maxlength="120" placeholder="例如，工作资料" required>
        <div class="archive-dialog-actions"><button type="button" class="archive-new" @click="creatingCabinet = false">取消</button><button class="primary-button" :disabled="busy">确认创建</button></div>
      </form>
    </div>
    <div v-if="renamingCabinetId" class="archive-modal" @click.self="renamingCabinetId = ''" @keydown.esc="renamingCabinetId = ''">
      <form class="archive-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-cabinet-title" @submit.prevent="saveCabinetRename">
        <div class="archive-dialog-heading"><h2 id="rename-cabinet-title">修改书柜名称</h2><button type="button" aria-label="关闭" @click="renamingCabinetId = ''">×</button></div>
        <label for="rename-cabinet-name">书柜名称</label>
        <input id="rename-cabinet-name" v-model="renamingCabinetName" maxlength="120" :aria-describedby="renameCabinetError ? 'rename-cabinet-error' : undefined" required>
        <p v-if="renameCabinetError" id="rename-cabinet-error" class="feedback error" role="alert">{{ renameCabinetError }}</p>
        <div class="archive-dialog-actions"><button type="button" class="archive-new" @click="renamingCabinetId = ''">取消</button><button class="primary-button" :disabled="busy">保存名称</button></div>
      </form>
    </div>
    <div v-if="renamingItem" class="archive-modal" @click.self="renamingItem = null" @keydown.esc="renamingItem = null">
      <form class="archive-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-item-title" @submit.prevent="saveItemRename">
        <div class="archive-dialog-heading">
          <h2 id="rename-item-title">{{ renamingItem.kind === 'book' && renamingItem.book.kind !== 'page' ? '修改笔记本名称' : '修改文件名' }}</h2>
          <button type="button" aria-label="关闭" @click="renamingItem = null">×</button>
        </div>
        <label for="rename-item-name">名称</label>
        <input id="rename-item-name" v-model="renamingItemName" maxlength="120" :aria-describedby="renameItemError ? 'rename-item-error' : undefined" required>
        <p v-if="renameItemError" id="rename-item-error" class="feedback error" role="alert">{{ renameItemError }}</p>
        <div class="archive-dialog-actions">
          <button type="button" class="archive-new" @click="renamingItem = null">取消</button>
          <button class="primary-button" :disabled="busy">保存名称</button>
        </div>
      </form>
    </div>
    <div v-if="creatingBook" class="archive-modal" @click.self="creatingBook = false" @keydown.esc="creatingBook = false">
      <form class="archive-dialog" role="dialog" aria-modal="true" aria-labelledby="new-book-title" @submit.prevent="addBook">
        <div class="archive-dialog-heading"><h2 id="new-book-title">新建笔记</h2><button type="button" aria-label="关闭" @click="creatingBook = false">×</button></div>
        <fieldset class="note-kind"><legend>笔记类型</legend>
          <label><input v-model="newNoteKind" type="radio" value="book"> 笔记本 <small>可收纳多个章节</small></label>
          <label><input v-model="newNoteKind" type="radio" value="page"> 书页 <small>独立文档（可选 MD / TXT）</small></label>
        </fieldset>
        <fieldset v-if="newNoteKind === 'page'" class="note-kind"><legend>文件格式</legend>
          <label><input v-model="newPageFormat" type="radio" value="md"> Markdown (.md) <small>支持图表、表格与排版</small></label>
          <label><input v-model="newPageFormat" type="radio" value="txt"> 纯文本 (.txt) <small>简洁记录，不解析语法</small></label>
        </fieldset>
        <label for="book-name">笔记名称</label>
        <input id="book-name" v-model="bookTitle" maxlength="120" placeholder="例如，Java 学习" required>
        <template v-if="newNoteKind === 'book'">
          <label for="book-description">简介（选填）</label>
          <textarea id="book-description" v-model="bookDescription" maxlength="500" rows="3" placeholder="写一句介绍，以后也可以修改"></textarea>
        </template>
        <label for="book-cabinet">选择书柜</label>
        <select id="book-cabinet" v-model="bookCabinet">
          <option value="">{{ defaultCabinetTitle }}（默认）</option>
          <option v-for="cabinet in catalog.cabinets.value.filter(item => item.id !== 'general')" :key="cabinet.id" :value="cabinet.id">{{ cabinet.title }}</option>
          <option value="@@new@@">＋ 新建书柜</option>
        </select>
        <template v-if="bookCabinet === '@@new@@'">
          <label for="new-book-cabinet-name">新书柜名称</label>
          <input id="new-book-cabinet-name" v-model="newBookCabinetName" maxlength="120" placeholder="例如，工作资料" required>
        </template>
        <div class="archive-dialog-actions"><button type="button" class="archive-new" @click="creatingBook = false">取消</button><button class="primary-button" :disabled="busy">确认创建</button></div>
      </form>
    </div>
    <div v-if="shareModal" class="archive-modal" @click.self="shareModal = null" @keydown.esc="shareModal = null">
      <div class="archive-dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <div class="archive-dialog-heading">
          <div class="share-modal-title-wrap">
            <span class="share-scope-badge">{{ shareModal.summary.scopeLabel }}</span>
            <h2 id="share-modal-title">{{ shareModal.summary.title }}</h2>
          </div>
          <button type="button" aria-label="关闭分享" @click="shareModal = null">×</button>
        </div>
        <p class="share-preview-meta">
          包含：
          <template v-if="shareModal.summary.bookCount">{{ shareModal.summary.bookCount }} 本笔记本</template>
          <template v-if="shareModal.summary.bookCount && (shareModal.summary.chapterCount || shareModal.summary.pageCount)"> · </template>
          <template v-if="shareModal.summary.chapterCount">{{ shareModal.summary.chapterCount }} 篇章节</template>
          <template v-if="shareModal.summary.chapterCount && shareModal.summary.pageCount"> · </template>
          <template v-if="shareModal.summary.pageCount">{{ shareModal.summary.pageCount }} 张书页</template>
          <template v-if="shareModal.summary.imageCount"> · {{ shareModal.summary.imageCount }} 张图片</template>
          <template v-if="!shareModal.summary.bookCount && !shareModal.summary.chapterCount && !shareModal.summary.pageCount">空内容</template>
        </p>
        <div v-if="shareModal.githubLink" class="share-mode-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="shareMode === 'offline'" :class="{ active: shareMode === 'offline' }" @click="shareMode = 'offline'">离线分享链接（无需登录）</button>
          <button type="button" role="tab" :aria-selected="shareMode === 'github'" :class="{ active: shareMode === 'github' }" @click="shareMode = 'github'">GitHub 短链接</button>
        </div>
        <label v-if="shareMode === 'offline' && shareModal.summary.imageCount > 0" class="share-opt-check">
          <input v-model="shareIncludeImages" type="checkbox">
          <span>在分享链接中内嵌图片（{{ shareModal.summary.imageCount }} 张）</span>
        </label>
        <p v-if="shareModal.omittedBinaryCount > 0" class="feedback">提示：已跳过 {{ shareModal.omittedBinaryCount }} 个只读外部文档（PDF/Word/PPT 等），它们需直接发送原文件。</p>
        <p v-if="shareModal.omittedLargeImages > 0 && shareMode === 'offline'" class="feedback">提示：为控制离线分享内存（单图 ≤ 180 KB、总图 ≤ 320 KB），已跳过 {{ shareModal.omittedLargeImages }} 张较大图片；完整传图请切换 GitHub 短链接。</p>
        <p v-if="shareMode === 'offline' && shareModal.offlineBlockedReason" class="feedback error">{{ shareModal.offlineBlockedReason }}</p>
        <p v-else-if="shareMode === 'offline' && (activeShareLink.overMemoryLimit || activeShareLink.tooLarge)" class="feedback error">当前离线包超过内存/字符上限（{{ formatShareKb(activeShareLink.rawBytes) }} / 512 KB），请取消勾选内嵌图片或切换 GitHub 短链接。</p>
        <p v-else-if="shareMode === 'offline' && activeShareLink.rawBytes > 0" class="share-preview-hint">离线包大小：{{ formatShareKb(activeShareLink.rawBytes) }} / 512 KB 上限（压缩后 {{ activeShareLink.charLength }} 字符）</p>
        <textarea
          ref="shareLinkTextarea"
          class="share-link-output"
          readonly
          rows="4"
          :value="activeShareLink.link"
          aria-label="分享链接"
          @focus="($event.target as HTMLTextAreaElement).select()"
        ></textarea>
        <p class="share-preview-hint">将上方链接发给对方，对方在纸间（桌面端 / 网页版 / 安卓端）点「导入」并粘贴即可还原完整内容。</p>
        <div class="archive-dialog-actions">
          <button type="button" class="archive-new" @click="shareModal = null">关闭</button>
          <button type="button" class="primary-button" :disabled="!activeShareLink.link" @click="copyActiveShareLink">{{ shareCopied ? '已复制链接 ✓' : '复制分享链接' }}</button>
        </div>
      </div>
    </div>
    <section v-show="!selectedBook && !selectedChapter" class="intro" aria-labelledby="desk-title">
      <div class="intro-copy">
        <p v-if="!chosenCabinet" class="archive-kicker">LEVEL 01 · ARCHITECTURAL BOOKCASES</p>
        <nav v-if="chosenCabinet && !selectedBook" class="crumbs"><button type="button" @click="openCabinet()">← 返回书柜</button></nav>
        <h1
          id="desk-title"
          :class="{ 'paper-renameable': !!chosenCabinet && !selectedBook }"
          :title="chosenCabinet && !selectedBook ? '双击修改书柜名称' : undefined"
          @dblclick.stop="chosenCabinet && !selectedBook && beginCabinetRename(chosenCabinet.id)"
        >{{ selectedBook?.title || chosenCabinet?.title || '全部书柜' }}</h1>
        <p v-if="!chosenCabinet" class="archive-intro">点击书柜进入书架，双击书柜名称或书本名称可直接修改。</p>
        <p v-if="introSummary" class="intro-text">{{ introSummary }}</p>
        <div class="intro-action-row">
          <button v-if="chosenCabinet && !selectedBook" type="button" class="archive-new share-trigger-btn" :disabled="busy" title="生成整个书柜的分享链接" @click="openShareCabinet(chosenCabinet.id)">分享书柜</button>
          <a href="#connection" class="sync-link" @click="revealConnection">
            <span class="sync-dot" :class="{ online: connected }" aria-hidden="true"></span>
            {{ connected ? (isHosted ? autoStatus : '令牌已设置') : '本机草稿 · 连接 GitHub' }}
          </a>
        </div>
      </div>
    </section>

    <section v-show="creatingBook || (selectedBook?.kind !== 'page' && !selectedChapter)" id="bookshelf" class="library" aria-label="笔记本与章节">
      <div class="tools archive-mobile-tools">
        <label class="search">
          <span class="lens" aria-hidden="true"></span><span class="sr-only">搜索笔记</span>
          <input v-model="query" type="search" placeholder="搜索书柜、笔记本或章节">
        </label>
        <button class="text-button" :disabled="busy" @click="refresh">读取最新目录</button>
        <button class="primary-button" :disabled="busy" :aria-expanded="creatingBook" @click="openNewNote">＋ 新建笔记</button>
      </div>
      <div v-if="query.trim()" class="search-results">
        <p v-if="searching" role="status">正在查找章节…</p>
        <template v-else>
          <p>{{ searchResults.length }} 篇匹配章节</p>
          <button v-for="result in searchResults" :key="result.bookId + '/' + result.id" class="chapter-row" :disabled="busy" @click="openSearchResult(result)">
            <span>{{ books.find(book => book.id === result.bookId)?.title }} ／ {{ result.title }}</span>
            <span class="arrow" aria-hidden="true">↗</span>
          </button>
        </template>
      </div>
      <div v-if="!selectedChapter && error" class="feedback error" role="alert">{{ error }}</div>
      <p v-if="!selectedChapter && notice" class="feedback" role="status">{{ notice }}</p>
      <p v-if="busy" class="feedback" role="status">正在读取或保存笔记…</p>
      <div v-if="!initialRepository && !chosenCabinet && hasLegacyWorkspace" class="legacy-workspace-notice" role="status">
        <span>检测到旧版本地数据，仍保存在此设备。连接原仓库后，可在同步设置中导入或导出。</span>
        <a href="#connection" @click="revealConnection">前往同步设置 →</a>
      </div>
      <div v-else-if="!initialRepository && !chosenCabinet && legacyWorkspaceCheckFailed" class="legacy-workspace-notice" role="alert">
        无法检查旧版本地数据，请检查浏览器存储权限；原有数据不会被自动删除。
      </div>
      <CabinetGallery v-if="!chosenCabinet" :items="visibleCabinets" @select="openCabinet" @create="creatingCabinet = true" @rename="beginCabinetRename" @share="openShareCabinet" />
      <details v-if="!chosenCabinet" class="batch-box delete-manager">
        <summary>管理书柜</summary>
        <p>可以修改书柜名称。默认书柜“{{ defaultCabinetTitle }}”不可删除；删除其他书柜时，里面的笔记本会移到默认书柜。</p>
        <div class="delete-manager-list">
          <div v-for="cabinet in catalog.cabinets.value" :key="cabinet.id" class="cabinet-manage-row">
            <label v-if="cabinet.id !== 'general'">
              <input v-model="deleteCabinetIds" type="checkbox" :value="cabinet.id" :disabled="busy">
              <span>{{ cabinet.title }}</span><small>{{ cabinetItems.find(item => item.id === cabinet.id)?.books.length || 0 }} 册</small>
            </label>
            <div v-else class="cabinet-manage-default"><span>{{ cabinet.title }}</span><small>默认 · {{ cabinetItems.find(item => item.id === cabinet.id)?.books.length || 0 }} 册</small></div>
            <button type="button" class="archive-new" :disabled="busy" :aria-label="`重命名 ${cabinet.title}`" @click="beginCabinetRename(cabinet.id)">重命名</button>
          </div>
        </div>
        <button v-if="catalog.cabinets.value.some(cabinet => cabinet.id !== 'general')" class="delete-button" type="button" :disabled="busy || !deleteCabinetIds.length" @click="deleteSelectedCabinets">删除所选书柜（{{ deleteCabinetIds.length }}）</button>
        <div v-if="Object.keys(catalog.journal.value.removed || {}).length" class="delete-manager-list">
          <p>待同步的删除</p>
          <div v-for="(removed, id) in catalog.journal.value.removed" :key="id" class="removed-cabinet-row">
            <span>{{ typeof removed === 'string' ? removed : removed.title }}</span>
            <button type="button" class="archive-new" :disabled="busy" @click="undoCabinetDeletion(String(id))">撤销删除</button>
          </div>
        </div>
      </details>
      <p v-if="!chosenCabinet && !visibleCabinets.length" class="empty-shelf">没有匹配的书柜。</p>
      <BookShelf v-if="chosenCabinet && !selectedBook && filteredBooks.length" :books="shelfBooks"
        :disabled="busy" @select="openBook" @rename="beginBookRename" />
      <button v-if="chosenCabinet?.id === 'general' && !selectedBook && !hasWelcomeBook" class="text-button" type="button" :disabled="busy" @click="addWelcome">＋ 添加使用说明</button>
      <details v-if="chosenCabinet && !selectedBook && managedBooks.length" class="batch-box delete-manager">
        <summary>管理笔记</summary>
        <p>勾选笔记本或书页后，可以移动到其他书柜或删除。删除已同步的内容会同时从 GitHub 删除。</p>
        <div class="delete-manager-list">
          <label v-for="book in managedBooks" :key="book.id"><input v-model="deleteBookIds" type="checkbox" :value="book.id" :disabled="busy"><span>{{ book.title }}</span><small>{{ book.kind === 'page' ? '书页' : '笔记本' }} · {{ book.sha ? 'GitHub 和本机' : '本机' }}</small></label>
        </div>
        <div class="bulk-move">
          <label for="move-books-target">移动到</label>
          <select id="move-books-target" v-model="moveBooksTarget" :disabled="busy || !deleteBookIds.length">
            <option value="">选择书柜</option>
            <option v-for="cabinet in catalog.cabinets.value.filter(item => item.id !== activeCabinet)" :key="cabinet.id" :value="cabinet.id">{{ cabinet.title }}</option>
          </select>
          <button class="archive-new" type="button" :disabled="busy || !deleteBookIds.length || !moveBooksTarget" @click="moveSelectedBooks">移动所选</button>
        </div>
        <button class="delete-button" type="button" :disabled="busy || !deleteBookIds.length" @click="deleteManaged(managedBooks.filter(book => deleteBookIds.includes(book.id)), [])">删除所选笔记（{{ deleteBookIds.length }}）</button>
      </details>
      <p v-if="chosenCabinet && !selectedBook && !filteredBooks.length" class="empty-shelf">{{ query ? '没有匹配的书名。' : '书柜还是空的。新建一本笔记，或把其他柜里的笔记移到这里。' }}</p>
      <div class="chapter-page-layout" :class="{ 'has-book': selectedBook && selectedBook.kind !== 'page' }">
      <div v-if="selectedBook && selectedBook.kind !== 'page'" class="chapter-panel">
        <aside class="reference-book-card">
          <div class="reference-hero-stage" aria-hidden="true">
            <div class="reference-hero-book">
              <div class="reference-book-spine">
                <span class="reference-book-number">01</span>
                <span class="reference-book-spine-title">{{ selectedBook.title }}</span>
                <span class="reference-book-spine-bottom"><span class="reference-book-rule"></span><span class="reference-book-count">{{ chapters.length }} 章</span></span>
              </div>
              <div class="reference-book-cover">
                <div class="reference-cover-frame"></div>
                <span class="reference-cover-meta">NOTEBOOK</span>
                <span class="reference-cover-copy"><strong class="reference-cover-title">{{ selectedBook.title }}</strong><span v-if="selectedBook.description" class="reference-cover-description">{{ selectedBook.description }}</span></span>
                <span class="reference-cover-rule"></span>
              </div>
              <div class="reference-book-top"></div>
            </div>
          </div>
          <div class="reference-book-details">
            <div class="panel-heading">
              <span>{{ selectedBook.sha ? '已收录笔记本' : '本机笔记本' }}</span>
              <button v-if="!selectedBook.sha || bookDescriptionDrafts[selectedBook.id]" class="text-button" :disabled="busy" @click="syncBook">同步笔记本</button>
            </div>
            <h2 class="paper-renameable" title="双击修改笔记本名称" @dblclick.stop.prevent="beginBookRename(selectedBook)">{{ selectedBook.title }}</h2>
            <div class="book-description">
              <form v-if="editingDescription" @submit.prevent="saveDescription">
                <label for="edit-book-description">笔记本简介</label>
                <textarea id="edit-book-description" v-model="descriptionInput" maxlength="500" rows="3" placeholder="选填"></textarea>
                <div><button class="reference-outline-button" :disabled="busy" type="submit">保存简介</button> <button class="text-button" type="button" @click="editingDescription = false">取消</button></div>
              </form>
              <template v-else>
                <p v-if="selectedBook.description">{{ selectedBook.description }}</p>
                <button class="text-button" type="button" :disabled="busy" @click="startDescriptionEdit">{{ selectedBook.description ? '修改简介' : '添加简介' }}</button>
              </template>
            </div>
            <label class="move-book">所在书柜
              <select :value="activeCabinet" :disabled="busy" @change="moveSelected">
                <option v-for="cabinet in cabinetItems" :key="cabinet.id" :value="cabinet.id">{{ cabinet.title }}</option>
              </select>
            </label>
            <div class="reference-book-bottom">
              <button class="reference-outline-button" type="button" @click="openCabinet(activeCabinet)">← 返回书架</button>
              <button class="reference-outline-button" type="button" :disabled="busy" title="生成整本笔记本的分享链接" @click="openShareBook(selectedBook)">分享整本</button>
              <span>{{ chapters.length }} 篇章节</span>
            </div>
          </div>
        </aside>
        <div class="contents-list">
            <div class="chapter-title reference-chapter-heading">
              <div><small>CHAPTER DIRECTORY</small><h2>章节目录</h2></div>
              <button class="primary-button" :disabled="busy" :aria-expanded="creatingChapter" @click="creatingChapter = !creatingChapter">＋ 新建章节</button>
            </div>
            <form v-if="creatingChapter" class="inline-form" @submit.prevent="addChapter">
              <label for="chapter-name">章节名称</label>
              <input id="chapter-name" v-model="chapterTitle" maxlength="120" required>
              <select v-model="newChapterFormat" class="chapter-format-select" aria-label="文件格式" title="选择新建文件格式">
                <option value="md">Markdown (.md)</option>
                <option value="txt">纯文本 (.txt)</option>
              </select>
              <button class="primary-button" :disabled="busy">创建</button>
              <button type="button" class="text-button" @click="creatingChapter = false">取消</button>
            </form>
            <div class="chapter-directory-scroll" role="region" aria-label="章节列表与管理" tabindex="0"
              @dragover.capture="scrollChapterDrag" @dragleave="leaveChapterDrag"
              @drop.capture="stopChapterDragScroll" @dragend.capture="stopChapterDragScroll">
            <details v-if="!selectedChapter && filteredChapters.length" class="batch-box delete-manager chapter-delete-manager">
              <summary>管理章节<span>批量删除</span></summary>
              <p>已同步章节会从 GitHub 和本机删除，未同步章节仅从本机删除；相关草稿也会删除。</p>
              <div class="delete-manager-list">
                <label v-for="chapter in filteredChapters" :key="chapter.id"><input v-model="deleteChapterIds" type="checkbox" :value="chapter.id" :disabled="busy"><span>{{ chapter.title }}</span><small>{{ chapter.sha ? 'GitHub 和本机' : '本机' }}</small></label>
              </div>
              <button class="delete-button" type="button" :disabled="busy || !deleteChapterIds.length" @click="deleteManaged([], filteredChapters.filter(chapter => deleteChapterIds.includes(chapter.id)))">删除所选章节（{{ deleteChapterIds.length }}）</button>
            </details>
            <ChapterOrderList :chapters="chapters" :filtered="filteredChapters" :selected-id="selectedChapter?.id"
              :disabled="busy || writing" :searching="!!query.trim()" @open="openChapter" @reorder="reorderChapters" @rename="beginChapterRename" />
            <p v-if="!filteredChapters.length" class="empty">{{ query ? '本册没有匹配的章节。' : '还没有章节。点「添加章节」写下第一页。' }}</p>
            </div>
        </div>
      </div>
      <button v-if="catalog.pending.value" class="text-button sync-catalog" :disabled="busy" @click="syncCatalog">同步书柜整理</button>
      <details class="batch-box">
        <summary>批量同步<span>{{ pendingBatchCount }} 项待同步</span></summary>
        <p v-if="!batchGroups.length">目前没有待提交的笔记本或章节。</p>
        <template v-else>
          <p>勾选笔记本、章节或书页，一次提交到 GitHub。选中整本会包括其中全部待同步章节。</p>
          <div class="batch-list">
            <fieldset v-for="group in batchGroups" :key="group.id" class="batch-group">
              <legend class="sr-only">{{ group.title }}</legend>
              <label class="batch-group-heading">
                <input type="checkbox" :checked="isBatchGroupSelected(group)" :disabled="busy" @change="toggleBatchGroup(group, $event)">
                <strong>{{ group.title }}</strong><small>{{ isPageBookId(group.id) ? '书页' : '全选本册' }}</small>
              </label>
              <div class="batch-children">
                <label v-if="group.isNew || group.hasDescription">
                  <input v-model="selectedKeys" type="checkbox" :disabled="busy" :value="`book:${group.id}`">
                  <span>{{ group.isNew ? '笔记本本身（新建）' : '笔记本信息（简介/章节顺序）' }}</span>
                </label>
                <label v-for="item in group.items" :key="item.key">
                  <input v-model="selectedKeys" type="checkbox" :disabled="busy" :value="item.key">
                  <span>{{ item.title }}</span>
                </label>
              </div>
            </fieldset>
          </div>
          <button class="primary-button" :disabled="busy || !selectedKeys.length" @click="syncSelected">
            同步所选（{{ selectedKeys.length }}）
          </button>
          <button class="delete-button" type="button" :disabled="busy || !selectedKeys.length" @click="deletePendingSelected">删除所选本机项目（{{ selectedKeys.length }}）</button>
          <p class="delete-hint">已同步章节在此删除时仅丢弃本机草稿；要从 GitHub 删除，请在书架或章节目录的管理入口操作。</p>
        </template>
      </details>
      </div>
    </section>

    <section v-if="selectedChapter" class="writing" aria-labelledby="writing-title">
      <div class="writing-top">
        <div>
          <div class="writing-nav-links">
            <button class="back-to-chapters" type="button" @click="backToChapters">{{ selectedBook?.kind === 'page' ? '← 返回书架' : '← 返回章节目录' }}</button>
            <button v-if="linkHistory.length" class="back-to-chapters link-history-back" type="button" @click="goBackLinkHistory">↩ 返回上一篇：{{ linkHistory[linkHistory.length - 1].title }}</button>
          </div>
          <p>{{ selectedBook?.title }}</p>
          <div class="writing-title-row">
            <h2 id="writing-title" class="paper-renameable" title="双击修改文件名" @dblclick.stop.prevent="beginChapterRename(selectedChapter)">{{ selectedChapterDisplay?.primaryTitle || selectedChapter.title }}</h2>
            <span v-if="!selectedChapterIsMarkdown" class="paper-ext-pill">{{ formatBadgeLabel(selectedChapter.ext) }}</span>
          </div>
          <p v-if="selectedChapterDisplay?.summaryTitle" class="writing-summary-subtitle">{{ selectedChapterDisplay.summaryTitle }}</p>
          <p>
            {{ !selectedChapter.sha ? '本地文档，尚未同步' : dirty ? '本机有未同步的修改' : 'GitHub 已收录此版本' }}
            <template v-if="selectedChapterEditable"> · {{ currentStats.words }} 词 · 约 {{ currentStats.readingMinutes }} 分钟阅读</template>
          </p>
        </div>
        <div class="writing-controls">
          <button
            v-if="selectedChapterEditable"
            type="button"
            class="export-trigger share-chapter-btn"
            :disabled="busy"
            :title="selectedBook?.kind === 'page' ? '生成当前书页的分享链接' : '生成当前章节的分享链接'"
            @click="openShareChapter(selectedChapter)"
          >{{ selectedBook?.kind === 'page' ? '分享书页' : '分享章节' }}</button>
          <details v-if="selectedChapterEditable" class="export-menu">
            <summary class="export-trigger">导出 ▾</summary>
            <div class="export-dropdown" role="menu">
              <button type="button" role="menuitem" @click="exportCurrentMarkdown">导出为 {{ selectedChapterIsPlainText ? '纯文本 (.txt)' : 'Markdown (.md)' }}</button>
              <button v-if="selectedChapterIsMarkdown" type="button" role="menuitem" @click="exportCurrentHtml">导出为独立 HTML（含图表/公式）</button>
              <button type="button" role="menuitem" @click="printCurrentDocument">打印 / 另存为 PDF</button>
            </div>
          </details>
          <div v-if="selectedChapterEditable && selectedChapterIsMarkdown" class="view-actions">
            <button :class="{ chosen: view === 'read' }" :aria-pressed="view === 'read'" @click="selectEditorMode('read')">阅读</button>
            <button :class="{ chosen: view === 'edit' && editorDisplayMode === 'visual' }" :aria-pressed="view === 'edit' && editorDisplayMode === 'visual'" @click="selectEditorMode('visual')">所见即写</button>
            <button :class="{ chosen: view === 'edit' && editorDisplayMode === 'source' }" :aria-pressed="view === 'edit' && editorDisplayMode === 'source'" @click="selectEditorMode('source')">源代码</button>
            <button :class="{ chosen: view === 'edit' && editorDisplayMode === 'split' }" :aria-pressed="view === 'edit' && editorDisplayMode === 'split'" title="左侧源代码，右侧实时渲染，滚轮同步对齐" @click="selectEditorMode('split')">双栏对照</button>
          </div>
          <div v-else-if="selectedChapterEditable" class="view-actions">
            <button :class="{ chosen: view === 'read' }" :aria-pressed="view === 'read'" @click="view = 'read'">阅读</button>
            <button :class="{ chosen: view === 'edit' }" :aria-pressed="view === 'edit'" @click="view = 'edit'">编辑</button>
          </div>
          <span v-else class="paper-readonly-pill">只读文件 · 不支持编辑</span>
        </div>
      </div>
      <div v-if="unresolvedLocalImageCount > 0" class="missing-images-banner" role="status">
        <span>检测到 {{ unresolvedLocalImageCount }} 处本地图片尚未随文件导入：</span>
        <button type="button" class="archive-new" :disabled="busy" @click="repairImageFolderInput?.click()">选择图片文件夹补齐</button>
        <button v-if="isDesktop" type="button" class="archive-new" :disabled="busy" @click="repairImagesFromOriginalPaths">选择原笔记自动补齐</button>
      </div>
      <p v-if="imageWarning" class="feedback" role="status">{{ imageWarning }}</p>
      <div v-if="view === 'read' || !selectedChapterEditable" ref="readingPaper" class="paper">
        <details v-if="selectedChapterIsMarkdown && readOutline.length" class="read-toc-box">
          <summary>本文目录 <span>{{ readOutline.length }} 个标题</span></summary>
          <nav class="read-toc-list" aria-label="本文目录">
            <button
              v-for="(heading, idx) in readOutline"
              :key="heading.offset + '-' + idx"
              type="button"
              class="read-toc-item"
              :style="{ paddingLeft: `${10 + Math.max(0, heading.level - 1) * 14}px` }"
              @click="jumpReadHeading(heading.title)"
            >{{ heading.title }}</button>
          </nav>
        </details>
        <ChapterMarkdown
          v-if="selectedChapterIsMarkdown"
          ref="chapterMarkdownRef"
          :source="content.replace(/^# [^\r\n]+(?:\r?\n|$)/, '')"
          :editable-tasks="!busy && selectedChapterEditable"
          @navigate-link="handleMarkdownLink"
          @toggle-task="toggleReadTask"
        />
        <pre v-else-if="selectedChapterIsPlainText" class="plain-text-read">{{ content || '（空文本文件）' }}</pre>
        <DocumentViewer
          v-else
          :repository="initialRepository"
          :title="selectedChapter.title"
          :ext="selectedChapterExt"
          :file-path="selectedChapter.filePath"
          :file-size="selectedChapter.fileSize"
          :is-desktop="isDesktop"
        />
      </div>
      <div v-else class="reference-editor-workspace" :class="{ 'is-sidebar-collapsed': !editorSidebarOpen }">
        <CollapsedOutlineRail v-if="!editorSidebarOpen && selectedChapterIsMarkdown" :headings="currentOutline" :source-length="content.length" @jump="goToOutlineHeading" @expand="setEditorSidebar(true)" />
        <button v-else-if="!editorSidebarOpen" id="editor-show-chapters" type="button" class="reference-sidebar-toggle reference-sidebar-reopen" @click="setEditorSidebar(true)">展开</button>
        <aside v-show="editorSidebarOpen" id="editor-chapters" class="reference-editor-sidebar" aria-label="章节目录">
          <div class="reference-sidebar-heading"><strong :title="selectedBook?.title">{{ selectedBook?.title }}</strong><button id="editor-hide-chapters" type="button" class="reference-sidebar-toggle" aria-controls="editor-chapters" :aria-expanded="editorSidebarOpen" @click="setEditorSidebar(false)">收起目录</button></div>
          <div v-if="selectedChapterIsMarkdown" class="reference-sidebar-tabs" role="group" aria-label="侧栏显示内容">
            <button type="button" :aria-pressed="editorSidebarTab === 'chapters'" @click="setEditorSidebarTab('chapters')">章节</button>
            <button type="button" :aria-pressed="editorSidebarTab === 'outline'" @click="setEditorSidebarTab('outline')">目录</button>
          </div>
          <div v-if="!selectedChapterIsMarkdown || editorSidebarTab === 'chapters'" class="reference-sidebar-list">
            <button v-for="chapter in chapters" :key="chapter.id" type="button" class="reference-sidebar-row"
              :class="{ active: selectedChapter.id === chapter.id }" :disabled="busy"
              :aria-label="displayChapterItem(chapter).primaryTitle" :aria-current="selectedChapter.id === chapter.id ? 'page' : undefined" :title="displayChapterItem(chapter).summaryTitle || displayChapterItem(chapter).primaryTitle"
              @click="openChapter(chapter); view = isEditableExt(chapter.ext) ? 'edit' : 'read'">
              {{ displayChapterItem(chapter).primaryTitle }}<template v-if="!isMarkdownExt(chapter.ext)"> [{{ formatBadgeLabel(chapter.ext) }}]</template>
            </button>
          </div>
          <OutlineTree v-else :headings="currentOutline" :source="content" :disabled="busy" @jump="goToOutlineHeading" @change="changeOutline" @error="error = $event" />
        </aside>
        <div class="paper editor">
          <MarkdownEditor v-if="selectedChapterIsMarkdown" ref="markdownEditor" v-model="content" :readonly="busy"
            :show-read-option="true" :display-mode="editorDisplayMode"
            :attachment-context="chapterKey(selectedChapter)" :image-urls="imageUrls" :save-pasted-images="savePastedImages"
            :on-paste-status="reportImagePasteStatus" @update:display-mode="selectEditorMode" @navigate-link="handleMarkdownLink" @toggle-task="toggleReadTask" />
          <PlainTextEditor v-else v-model="content" :readonly="busy" />
          <div class="editor-footer">
            <span>{{ content.length }} 字符<span v-if="isHosted && connected" aria-live="polite"> · {{ autoStatus }}</span></span>
            <button class="primary-button" :disabled="busy || (!dirty && !!selectedChapter.sha)" @click="sync">同步到 GitHub ↗</button>
          </div>
        </div>
      </div>
      <div v-if="error" class="feedback error" role="alert">
        {{ error }}
        <button v-if="error.includes('远程')" class="text-button" :disabled="busy" @click="inspectRemote">查看远程版本</button>
        <a v-if="!connected" href="#connection" @click="revealConnection">连接 GitHub</a>
      </div>
      <p v-if="notice" class="feedback" role="status">{{ notice }}</p>
      <div v-if="remoteVersion" class="remote-box">
        <h3>GitHub 上的版本</h3>
        <p>对照下面的内容编辑草稿，再选择「已完成合并」并同步。</p>
        <pre>{{ remoteVersion.content }}</pre>
        <button class="text-button" @click="useRemoteBase">已完成合并，使用这个版本作为基准</button>
      </div>
      <button
        v-if="showBackToTop"
        type="button"
        class="back-to-top-fab"
        aria-label="回到顶部"
        title="回到文档顶部"
        @click="scrollToTop"
      >↑ 回到顶部</button>
    </section>

    <details id="connection" class="connection-details">
      <summary><span class="connection-label">Git 云同步设置（GitHub / Gitee / GitLab / GitCode）</span><span class="connection-meta" aria-hidden="true">GIT · SYNC</span></summary>
      <div class="connection">
      <div>
        <p>支持连接 <strong>GitHub</strong>、<strong>Gitee（码云）</strong>、<strong>GitLab</strong> 或 <strong>GitCode</strong> 仓库。直接粘贴 HTTPS 仓库地址（如 <code>https://gitee.com/用户名/仓库名</code>）或填写 <code>用户名/仓库名</code>（默认 GitHub）。{{ isHosted ? '连接后可选择自动保存；已有本机草稿需手动选择同步。' : '勾选笔记后点击同步，将本机改动提交到所选仓库。' }}</p>
        <p v-if="repository">当前仓库（{{ parseRepository(repository).providerLabel }}）：<a :href="parseRepository(repository).webUrl" target="_blank" rel="noopener noreferrer">{{ parseRepository(repository).slug }}</a></p>
        <p>公开仓库的内容任何人都可以查看；请按需要选择仓库的可见性。</p>
      </div>
      <div class="connection-form">
        <form v-if="!connected || changingRepository" @submit.prevent="connect">
          <label for="github-repository">Git 仓库地址</label>
          <input id="github-repository" v-model="repositoryInput" class="repository-input" type="text" autocomplete="off" placeholder="https://gitee.com/用户名/仓库名 或 用户名/仓库名" :disabled="tokenLoading || busy" required>
          <label for="github-token">此仓库的访问令牌（Personal Access Token）</label>
          <div class="token-row">
            <input id="github-token" v-model="tokenInput" type="password" autocomplete="off" placeholder="GitHub / Gitee / GitLab 私人令牌" :disabled="tokenLoading" required>
            <button class="primary-button" :disabled="busy || tokenLoading">连接仓库</button>
          </div>
          <button type="button" class="text-button" :disabled="busy || tokenLoading" @click="importLegacyCredential">使用旧版已保存令牌</button>
          <button v-if="connected && changingRepository" type="button" class="text-button" :disabled="busy" @click="changingRepository = false; repositoryInput = repository; tokenInput = ''">取消切换</button>
        </form>
        <template v-else>
          <p class="connected">令牌已设置，写入权限将在同步时验证。</p>
          <label v-if="isHosted" class="auto-setting">
            <input v-model="autoSave" type="checkbox"> 自动保存到 GitHub
          </label>
          <p v-if="isHosted" role="status">{{ autoStatus }}</p>
          <button class="text-button" :disabled="busy" @click="changingRepository = true; repositoryInput = repository; tokenInput = ''">切换仓库</button>
          <button class="text-button" :disabled="busy" @click="disconnect">断开连接</button>
        </template>
        <button v-if="initialRepository && hasLegacyWorkspace" type="button" class="text-button" :disabled="busy" @click="importOlderWorkspace">导入旧版本地数据</button>
        <button v-if="hasLegacyWorkspace" type="button" class="text-button" :disabled="busy" @click="exportOlderWorkspace">导出旧版本地数据</button>
        <button v-if="initialRepository && hasUnboundWorkspace" type="button" class="text-button" :disabled="busy" @click="importUnboundWorkspace">导入未关联的本机笔记</button>
        <button v-if="initialRepository" type="button" class="text-button" :disabled="busy" @click="returnToLocalWorkspace">返回未关联的本机工作区</button>
        <p v-if="isDesktop">令牌使用 Windows 当前账户加密保存在本机；断开连接会清除。</p>
        <p v-else>令牌保存在此浏览器的本地存储中，刷新后会恢复；同一浏览器的扩展或此站点脚本可能读取它，请仅在可信设备上使用。断开连接会清除。</p>
        <a href="./guide.html">查看令牌设置和同步说明 ↗</a>
      </div>
      </div>
    </details>
  </div>
</template>

<style scoped src="./notebook.css"></style>
<style scoped src="./batch.css"></style>
<style scoped src="./reference-chapters.css"></style>
<style scoped>
.writing-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.writing-nav-links { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.link-history-back { color: var(--red, #6e4726) !important; font-weight: 600; }
.writing-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.export-menu { position: relative; }
.export-trigger {
  list-style: none;
  cursor: pointer;
  padding: 7px 12px;
  border: 1px solid var(--line, #111);
  border-radius: 3px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.export-trigger::-webkit-details-marker { display: none; }
.export-trigger:hover { background: var(--ink, #111); color: var(--panel, #fff); }
.export-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  min-width: 220px;
  padding: 6px;
  border: 1.5px solid var(--line, #111);
  border-radius: 8px;
  background: var(--panel, #fff);
  box-shadow: 3px 3px 0 var(--depth-edge, #111);
  display: grid;
  gap: 2px;
}
.export-dropdown button {
  padding: 8px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink, #111);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.export-dropdown button:hover {
  background: var(--theme-soft, #f4f3f0);
}
.plain-text-read {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: 15px/1.85 ui-monospace, Consolas, "Microsoft YaHei", monospace;
  color: var(--ink, #111);
}
.chapter-format-select {
  padding: 7px 10px;
  border: 1.5px solid var(--line, #111);
  border-radius: 6px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
  font-size: 13px;
}
.read-toc-box {
  margin: 0 0 18px;
  border: 1.5px solid var(--line, #111);
  border-radius: 8px;
  background: var(--theme-soft, #f4f3f0);
}
.read-toc-box summary {
  cursor: pointer;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink, #111);
}
.read-toc-box summary span {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted, #555);
}
.read-toc-list {
  display: grid;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
  padding: 6px 8px 10px;
  border-top: 1px solid color-mix(in srgb, var(--line, #111) 25%, transparent);
  background: var(--panel, #fff);
  border-radius: 0 0 7px 7px;
}
.read-toc-item {
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--ink, #111);
  text-align: left;
  font-size: 13px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.read-toc-item:hover {
  border-color: var(--line, #111);
  background: var(--theme-soft, #f4f3f0);
}
.intro-action-row {
  grid-column: 2;
  grid-row: 1 / span 5;
  align-self: end;
  justify-self: end;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.intro-action-row .sync-link {
  grid-column: auto;
  grid-row: auto;
  margin-top: 0;
}
@media (max-width: 720px) {
  .intro-action-row {
    grid-column: 1;
    grid-row: auto;
    justify-self: start;
    margin-top: 8px;
  }
}
.sound-toggle {
  white-space: nowrap;
}
.share-dialog {
  max-width: 560px;
  width: min(92vw, 560px);
}
.share-modal-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.share-modal-title-wrap h2 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-scope-badge {
  flex: none;
  padding: 2px 7px;
  border: 1.5px solid var(--line, #111);
  border-radius: 4px;
  background: var(--theme-soft, #f4f3f0);
  color: var(--ink, #111);
  font: 700 11px/1.2 ui-monospace, Consolas, monospace;
}
.share-mode-tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}
.share-mode-tabs button {
  flex: 1;
  padding: 7px 10px;
  border: 1.5px solid var(--line, #111);
  border-radius: 6px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.share-mode-tabs button.active {
  background: var(--ink, #111);
  color: var(--panel, #fff);
}
.share-opt-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  margin: 4px 0 8px;
  cursor: pointer;
}
.share-link-output {
  width: 100%;
  box-sizing: border-box;
  margin: 6px 0;
  padding: 9px 10px;
  border: 1.5px solid var(--line, #111);
  border-radius: 6px;
  background: var(--theme-soft, #f4f3f0);
  color: var(--ink, #111);
  font: 12px/1.5 ui-monospace, Consolas, monospace;
  word-break: break-all;
  resize: vertical;
}
.share-import-box {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1.5px dashed color-mix(in srgb, var(--line, #111) 45%, transparent);
  display: grid;
  gap: 8px;
}
.share-import-box > label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}
.share-import-box > label small {
  color: var(--muted, #555);
  font-size: 12px;
}
.share-import-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.share-import-row textarea {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1.5px solid var(--line, #111);
  border-radius: 6px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
  font: 12px/1.45 ui-monospace, Consolas, monospace;
  resize: vertical;
}
.share-preview-card {
  padding: 12px;
  border: 1.5px solid var(--line, #111);
  border-radius: 8px;
  background: var(--theme-soft, #f4f3f0);
  display: grid;
  gap: 8px;
}
.share-preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.share-preview-meta {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted, #555);
}
.share-preview-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #555);
}
.share-dest-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.share-dest-select {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.share-dest-select select {
  padding: 5px 8px;
  border: 1.5px solid var(--line, #111);
  border-radius: 5px;
  background: var(--panel, #fff);
  color: var(--ink, #111);
}
</style>
