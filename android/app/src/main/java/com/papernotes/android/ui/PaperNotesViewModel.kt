package com.papernotes.android.ui

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.papernotes.android.data.AttachmentPolicy
import com.papernotes.android.data.Chapter
import com.papernotes.android.data.ConflictResolution
import com.papernotes.android.data.DEFAULT_CABINET_ID
import com.papernotes.android.data.GitHubNotebookClient
import com.papernotes.android.data.GitHubShareRef
import com.papernotes.android.data.PaperNotesRepository
import com.papernotes.android.data.PaperSharePayloadV1
import com.papernotes.android.data.ParsedShareInput
import com.papernotes.android.data.SafDocumentReader
import com.papernotes.android.data.ShareLinkCodec
import com.papernotes.android.data.ShareSummary
import com.papernotes.android.data.SharedAttachment
import com.papernotes.android.data.SharedBook
import com.papernotes.android.data.SharedCabinetData
import com.papernotes.android.data.SharedChapter
import com.papernotes.android.data.SharedChapterData
import com.papernotes.android.data.SharedPage
import com.papernotes.android.data.SyncConflict
import com.papernotes.android.data.WorkspaceState
import com.papernotes.android.ui.editor.EditorViewMode
import com.papernotes.android.ui.theme.ThemePreference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface AppScreen {
    data object Splash : AppScreen
    data object Onboarding : AppScreen
    data object Home : AppScreen
    data class Bookshelf(val cabinetId: String) : AppScreen
    data class NotebookDetail(val cabinetId: String, val bookId: String) : AppScreen
    data class Editor(
        val cabinetId: String,
        val bookId: String,
        val chapterId: String,
        val isPage: Boolean
    ) : AppScreen
}

data class ActiveEditorDoc(
    val baseChapter: Chapter,
    val content: String,
    val isPage: Boolean,
    val docKey: String,
    val imageBaseUrl: String,
    val mode: EditorViewMode = EditorViewMode.VISUAL,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
    val hasSelection: Boolean = false,
    val localSavedNotice: String = "自动保存本机草稿"
)

data class ShareModalState(
    val payload: PaperSharePayloadV1,
    val summary: ShareSummary,
    val githubLink: String?,
    val omittedLargeImages: Int = 0,
    val offlineBlockedReason: String = ""
)

data class PendingShareImport(
    val payload: PaperSharePayloadV1,
    val summary: ShareSummary,
    val sourceLabel: String
)

data class UiState(
    val workspace: WorkspaceState = WorkspaceState(),
    val screen: AppScreen = AppScreen.Splash,
    val activeEditor: ActiveEditorDoc? = null,
    val busy: Boolean = false,
    val busyLabel: String = "",
    val notice: String? = null,
    val error: String? = null,
    val activeConflict: SyncConflict? = null,
    val activeShare: ShareModalState? = null,
    val pendingShareImport: PendingShareImport? = null,
    val shareImportError: String? = null,
    val pendingImageSnippet: String? = null,
    val imageRefreshNonce: Int = 0,
    val showThemeSheet: Boolean = false,
    val showSyncSheet: Boolean = false,
    val showImportSheet: Boolean = false,
    val showSearchSheet: Boolean = false,
    val showSettingsSheet: Boolean = false
)

class PaperNotesViewModel(val repo: PaperNotesRepository) : ViewModel() {

    private val _ui = MutableStateFlow(UiState(workspace = repo.snapshotState()))
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    val themePreference: ThemePreference
        get() = ThemePreference.fromKey(_ui.value.workspace.settings.themePreference)

    fun finishSplash() {
        val onboarded = _ui.value.workspace.settings.onboardingCompleted
        _ui.update { it.copy(screen = if (onboarded) AppScreen.Home else AppScreen.Onboarding) }
    }

    fun finishOnboarding() {
        val next = repo.completeOnboarding()
        _ui.update { it.copy(workspace = next, screen = AppScreen.Home) }
    }

    fun reopenOnboarding() {
        _ui.update { it.copy(showSettingsSheet = false, screen = AppScreen.Onboarding) }
    }

    fun clearMessages() {
        _ui.update { it.copy(notice = null, error = null) }
    }

    fun setTheme(pref: ThemePreference) {
        val next = repo.updateTheme(pref)
        _ui.update { it.copy(workspace = next) }
    }

    fun setReducedMotion(enabled: Boolean) {
        val next = repo.setReducedMotion(enabled)
        _ui.update { it.copy(workspace = next) }
    }

    fun toggleThemeSheet(show: Boolean) = _ui.update { it.copy(showThemeSheet = show) }
    fun toggleSyncSheet(show: Boolean) = _ui.update { it.copy(showSyncSheet = show) }
    fun toggleImportSheet(show: Boolean) = _ui.update { it.copy(showImportSheet = show) }
    fun toggleSearchSheet(show: Boolean) = _ui.update { it.copy(showSearchSheet = show) }
    fun toggleSettingsSheet(show: Boolean) = _ui.update { it.copy(showSettingsSheet = show) }

    // --- Navigation ---

    fun openCabinet(cabinetId: String) {
        flushActiveEditorDraft()
        _ui.update { it.copy(screen = AppScreen.Bookshelf(cabinetId), activeEditor = null, error = null, notice = null) }
    }

    fun openShelfItem(cabinetId: String, itemId: String) {
        flushActiveEditorDraft()
        val state = _ui.value.workspace
        val item = state.items.find { it.id == itemId } ?: return
        if (item.isPage) {
            val ch = state.chaptersByBook[item.id]?.firstOrNull() ?: return
            openEditor(cabinetId, item.id, ch.id, isPage = true)
        } else {
            _ui.update {
                it.copy(
                    screen = AppScreen.NotebookDetail(cabinetId, item.id),
                    activeEditor = null,
                    error = null,
                    notice = null
                )
            }
        }
    }

    fun openEditor(cabinetId: String, bookId: String, chapterId: String, isPage: Boolean) {
        flushActiveEditorDraft()
        val pair = repo.getChapterContent(bookId, chapterId) ?: return
        val (base, content) = pair
        val dirPath = if (isPage) "docs/pages/" else "docs/notebooks/$bookId/"
        val imageBaseUrl = "https://appassets.androidplatform.net/attachments/$dirPath"
        val docKey = "${repo.currentRepository()}::$bookId::$chapterId::${base.sha}"
        _ui.update {
            it.copy(
                screen = AppScreen.Editor(cabinetId, bookId, chapterId, isPage),
                activeEditor = ActiveEditorDoc(
                    baseChapter = base,
                    content = content,
                    isPage = isPage,
                    docKey = docKey,
                    imageBaseUrl = imageBaseUrl,
                    mode = it.activeEditor?.mode ?: EditorViewMode.VISUAL,
                    localSavedNotice = if (base.sha.isEmpty() || content != base.content) "本机草稿已保存（待同步）" else "已与版本一致"
                ),
                error = null,
                notice = null
            )
        }
    }

    fun navigateBack(): Boolean {
        val current = _ui.value
        if (current.showSearchSheet) { toggleSearchSheet(false); return true }
        if (current.showImportSheet) { toggleImportSheet(false); return true }
        if (current.showSyncSheet) { toggleSyncSheet(false); return true }
        if (current.showThemeSheet) { toggleThemeSheet(false); return true }
        if (current.showSettingsSheet) { toggleSettingsSheet(false); return true }
        if (current.activeConflict != null) { dismissConflict(); return true }

        return when (val s = current.screen) {
            AppScreen.Splash, AppScreen.Home -> false
            AppScreen.Onboarding -> { finishOnboarding(); true }
            is AppScreen.Bookshelf -> {
                _ui.update { it.copy(screen = AppScreen.Home) }
                true
            }
            is AppScreen.NotebookDetail -> {
                _ui.update { it.copy(screen = AppScreen.Bookshelf(s.cabinetId)) }
                true
            }
            is AppScreen.Editor -> {
                flushActiveEditorDraft()
                val dest = if (s.isPage) AppScreen.Bookshelf(s.cabinetId)
                else AppScreen.NotebookDetail(s.cabinetId, s.bookId)
                _ui.update { it.copy(screen = dest, activeEditor = null) }
                true
            }
        }
    }

    // --- Editor State ---

    fun setEditorMode(mode: EditorViewMode) {
        _ui.update { state ->
            state.copy(activeEditor = state.activeEditor?.copy(mode = mode))
        }
    }

    fun onEditorContentChanged(content: String, canUndo: Boolean, canRedo: Boolean) {
        val doc = _ui.value.activeEditor ?: return
        if (content == doc.content && canUndo == doc.canUndo && canRedo == doc.canRedo) return
        val nextWs = if (content != doc.content) {
            try {
                repo.saveDraft(doc.baseChapter, content)
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.message ?: "草稿保存失败") }
                _ui.value.workspace
            }
        } else _ui.value.workspace

        val saveLabel = if (doc.baseChapter.sha.isEmpty() || content != doc.baseChapter.content) {
            "本机草稿已自动保存"
        } else {
            "内容与已同步版本一致"
        }
        _ui.update {
            it.copy(
                workspace = nextWs,
                activeEditor = doc.copy(
                    content = content,
                    canUndo = canUndo,
                    canRedo = canRedo,
                    localSavedNotice = saveLabel
                )
            )
        }
    }

    fun onEditorSelectionChanged(hasSelection: Boolean) {
        _ui.update { state ->
            val doc = state.activeEditor ?: return@update state
            if (doc.hasSelection == hasSelection) state
            else state.copy(activeEditor = doc.copy(hasSelection = hasSelection))
        }
    }

    fun onEditorFormatError(message: String) {
        _ui.update { it.copy(error = message) }
    }

    fun consumePendingImageSnippet() {
        _ui.update { it.copy(pendingImageSnippet = null) }
    }

    private fun flushActiveEditorDraft() {
        val doc = _ui.value.activeEditor ?: return
        try {
            val next = repo.saveDraft(doc.baseChapter, doc.content)
            _ui.update { it.copy(workspace = next) }
        } catch (_: Exception) {
            // Keep existing draft state safe
        }
    }

    // --- Cabinet Actions ---

    fun createCabinet(title: String) {
        runLocalAction("书柜已创建并保存在本机。") {
            repo.createCabinet(title).second
        }
    }

    fun renameCabinet(cabinetId: String, title: String) {
        runLocalAction("书柜名称已更新。") {
            repo.renameCabinet(cabinetId, title)
        }
    }

    fun deleteCabinet(cabinetId: String) {
        runLocalAction("已删除书柜，其中笔记已移入默认书柜。") {
            val ws = repo.deleteCabinet(cabinetId)
            val s = _ui.value.screen
            if (s is AppScreen.Bookshelf && s.cabinetId == cabinetId) {
                _ui.update { it.copy(screen = AppScreen.Home) }
            }
            ws
        }
    }

    fun undoDeleteCabinet(cabinetId: String) {
        runLocalAction("已撤销书柜删除。") {
            repo.undoDeleteCabinet(cabinetId)
        }
    }

    fun moveItemsToCabinet(itemIds: Collection<String>, targetCabinetId: String) {
        runLocalAction("已移动到目标书柜。") {
            repo.moveItemsToCabinet(itemIds, targetCabinetId)
        }
    }

    // --- Notebook, Page & Chapter Actions ---

    fun createNotebook(title: String, description: String, cabinetId: String, openAfter: Boolean = true) {
        try {
            val (book, ws) = repo.createNotebook(title, description, cabinetId)
            val cab = cabinetId.ifBlank { DEFAULT_CABINET_ID }
            _ui.update {
                it.copy(
                    workspace = ws,
                    notice = "本地笔记本已创建，添加章节后可一并同步。",
                    error = null,
                    screen = if (openAfter) AppScreen.NotebookDetail(cab, book.id) else it.screen
                )
            }
        } catch (e: Exception) {
            _ui.update { it.copy(error = e.message ?: "无法创建笔记本。") }
        }
    }

    fun createStandalonePage(title: String, cabinetId: String) {
        try {
            val (ch, ws) = repo.createStandalonePage(title, cabinetId)
            val cab = cabinetId.ifBlank { DEFAULT_CABINET_ID }
            _ui.update { it.copy(workspace = ws, notice = "独立书页已创建。", error = null) }
            openEditor(cab, ch.bookId, ch.id, isPage = true)
        } catch (e: Exception) {
            _ui.update { it.copy(error = e.message ?: "无法创建书页。") }
        }
    }

    fun createChapter(cabinetId: String, bookId: String, title: String) {
        try {
            val (ch, ws) = repo.createChapter(bookId, title)
            _ui.update { it.copy(workspace = ws, notice = "新章节已创建。", error = null) }
            openEditor(cabinetId, bookId, ch.id, isPage = false)
        } catch (e: Exception) {
            _ui.update { it.copy(error = e.message ?: "无法创建章节。") }
        }
    }

    fun updateNotebookDescription(bookId: String, description: String) {
        runLocalAction("笔记本简介已保存。") {
            repo.updateNotebookDescription(bookId, description)
        }
    }

    fun reorderChapters(bookId: String, orderedIds: List<String>) {
        runLocalAction("章节顺序已更新。") {
            repo.reorderChapters(bookId, orderedIds)
        }
    }

    fun restoreWelcomeGuide() {
        runLocalAction("已添加「使用说明与教程」到默认书柜。") {
            repo.addWelcomeNotebookExplicit()
        }
    }

    fun deleteItems(itemIds: Collection<String>) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在删除所选笔记…", error = null, notice = null) }
            try {
                val ws = withContext(Dispatchers.IO) { repo.deleteItems(itemIds) }
                _ui.update {
                    val cur = it.screen
                    val nextScreen = when {
                        cur is AppScreen.NotebookDetail && cur.bookId in itemIds -> AppScreen.Bookshelf(cur.cabinetId)
                        cur is AppScreen.Editor && cur.bookId in itemIds -> AppScreen.Bookshelf(cur.cabinetId)
                        else -> cur
                    }
                    it.copy(
                        workspace = ws,
                        screen = nextScreen,
                        activeEditor = if (nextScreen !is AppScreen.Editor) null else it.activeEditor,
                        busy = false,
                        busyLabel = "",
                        notice = "已删除 ${itemIds.size} 项笔记。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "删除失败。") }
            }
        }
    }

    fun deleteChapters(bookId: String, chapterIds: Collection<String>) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在删除所选章节…", error = null, notice = null) }
            try {
                val ws = withContext(Dispatchers.IO) { repo.deleteChapters(bookId, chapterIds) }
                _ui.update {
                    it.copy(
                        workspace = ws,
                        busy = false,
                        busyLabel = "",
                        notice = "已删除 ${chapterIds.size} 篇章节。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "删除章节失败。") }
            }
        }
    }

    // --- Images, SAF Import & Repair ---

    fun insertImageFromUri(context: Context, uri: Uri) {
        val doc = _ui.value.activeEditor ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在保存图片附件…", error = null) }
            try {
                val relPath = withContext(Dispatchers.IO) {
                    val (mime, bytes) = SafDocumentReader.readSingleImageUri(context, uri)
                    val assetBookId = if (doc.isPage) null else doc.baseChapter.bookId
                    repo.saveNewImageAttachment(assetBookId, mime, bytes)
                }
                _ui.update {
                    it.copy(
                        busy = false,
                        busyLabel = "",
                        pendingImageSnippet = "![图片]($relPath)",
                        imageRefreshNonce = it.imageRefreshNonce + 1,
                        notice = "图片已作为独立附件保存。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = "图片未插入：${e.message ?: "无法读取图片"}") }
            }
        }
    }

    fun insertImageFromClipboard(context: Context) {
        val doc = _ui.value.activeEditor ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在读取剪贴板图片…", error = null) }
            try {
                val relPath = withContext(Dispatchers.IO) {
                    val img = SafDocumentReader.readClipboardImage(context)
                        ?: throw IllegalArgumentException("剪贴板中没有可读取的图片。")
                    val assetBookId = if (doc.isPage) null else doc.baseChapter.bookId
                    repo.saveNewImageAttachment(assetBookId, img.first, img.second)
                }
                _ui.update {
                    it.copy(
                        busy = false,
                        busyLabel = "",
                        pendingImageSnippet = "![图片]($relPath)",
                        imageRefreshNonce = it.imageRefreshNonce + 1,
                        notice = "已粘贴剪贴板图片。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "无法粘贴剪贴板图片。") }
            }
        }
    }

    fun insertWebPastedImage(mime: String, base64Data: String) {
        val doc = _ui.value.activeEditor ?: return
        viewModelScope.launch {
            try {
                val relPath = withContext(Dispatchers.IO) {
                    val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                    if (bytes.isEmpty() || bytes.size > AttachmentPolicy.MAX_ATTACHMENT_BYTES) {
                        throw IllegalArgumentException("单张图片不能超过 20 MiB。")
                    }
                    val actualMime = AttachmentPolicy.detectMimeFromBytes(bytes)
                        ?: throw IllegalArgumentException("仅支持 PNG、JPEG、GIF 或 WebP 图片。")
                    val assetBookId = if (doc.isPage) null else doc.baseChapter.bookId
                    repo.saveNewImageAttachment(assetBookId, actualMime, bytes)
                }
                _ui.update {
                    it.copy(
                        pendingImageSnippet = "![图片]($relPath)",
                        imageRefreshNonce = it.imageRefreshNonce + 1,
                        notice = "图片已保存并插入。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(error = "粘贴图片失败：${e.message ?: "格式无效"}") }
            }
        }
    }

    fun importMarkdownFiles(context: Context, uris: List<Uri>) {
        if (uris.isEmpty()) return
        val s = _ui.value.screen
        val targetCabinet = when (s) {
            is AppScreen.Bookshelf -> s.cabinetId
            is AppScreen.NotebookDetail -> s.cabinetId
            is AppScreen.Editor -> s.cabinetId
            else -> DEFAULT_CABINET_ID
        }
        val targetNotebook = when (s) {
            is AppScreen.NotebookDetail -> s.bookId
            is AppScreen.Editor -> if (s.isPage) null else s.bookId
            else -> null
        }
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在导入 Markdown 文件…", error = null, notice = null) }
            try {
                val (planned, ws) = withContext(Dispatchers.IO) {
                    val scan = SafDocumentReader.readMarkdownUris(context, uris)
                    repo.applyImport(scan, targetCabinet, targetNotebook)
                }
                val warnings = buildImportSummaryWarnings(planned.skipped.size, planned.unresolvedCount)
                _ui.update {
                    it.copy(
                        workspace = ws,
                        busy = false,
                        busyLabel = "",
                        showImportSheet = false,
                        notice = "已导入 ${planned.addedBooks.size} 项书本/书页、${planned.addedChapters.size} 篇内容、${planned.attachments.size} 张图片。$warnings"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "导入文件失败。") }
            }
        }
    }

    fun importMarkdownFolder(context: Context, treeUri: Uri) {
        val s = _ui.value.screen
        val targetCabinet = when (s) {
            is AppScreen.Bookshelf -> s.cabinetId
            is AppScreen.NotebookDetail -> s.cabinetId
            is AppScreen.Editor -> s.cabinetId
            else -> DEFAULT_CABINET_ID
        }
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在扫描并导入文件夹…", error = null, notice = null) }
            try {
                val (planned, ws) = withContext(Dispatchers.IO) {
                    val scan = SafDocumentReader.readDocumentTree(context, treeUri)
                    repo.applyImport(scan, targetCabinet, targetNotebookId = null)
                }
                val warnings = buildImportSummaryWarnings(planned.skipped.size, planned.unresolvedCount)
                _ui.update {
                    it.copy(
                        workspace = ws,
                        busy = false,
                        busyLabel = "",
                        showImportSheet = false,
                        notice = "已导入 ${planned.addedBooks.size} 项笔记本/书页、${planned.addedChapters.size} 篇章节、${planned.attachments.size} 张图片。$warnings"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "导入文件夹失败。") }
            }
        }
    }

    fun repairCurrentNoteImages(context: Context, treeUri: Uri) {
        val doc = _ui.value.activeEditor ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在从原文件夹补齐图片…", error = null, notice = null) }
            try {
                val (planned, ws) = withContext(Dispatchers.IO) {
                    val scan = SafDocumentReader.readDocumentTree(context, treeUri)
                    repo.applyImageRepair(doc.baseChapter, doc.content, scan)
                }
                _ui.update {
                    val refreshedKey = "${doc.docKey}::repaired::${it.imageRefreshNonce + 1}"
                    it.copy(
                        workspace = ws,
                        activeEditor = doc.copy(
                            content = planned.repairedContent,
                            docKey = refreshedKey,
                            localSavedNotice = "已补齐图片并保存草稿"
                        ),
                        imageRefreshNonce = it.imageRefreshNonce + 1,
                        busy = false,
                        busyLabel = "",
                        showImportSheet = false,
                        notice = "已补齐 ${planned.attachments.size} 张图片并保留已有编辑。${
                            if (planned.remainingUnresolved > 0) "仍有 ${planned.remainingUnresolved} 处图片未能匹配，请检查。" else ""
                        }"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "补齐图片失败。") }
            }
        }
    }

    private fun buildImportSummaryWarnings(skippedCount: Int, unresolvedCount: Int): String {
        val parts = mutableListOf<String>()
        if (skippedCount > 0) parts.add("跳过 $skippedCount 项非 Markdown/超限/无效文件")
        if (unresolvedCount > 0) parts.add("$unresolvedCount 处相对图片未随文件导入（可稍后补图）")
        return if (parts.isEmpty()) "" else "（${parts.joinToString("；")}）"
    }

    // --- GitHub Sync, Restore & Conflicts ---

    fun connectGitHub(rawRepo: String, token: String, importLocal: Boolean) {
        flushActiveEditorDraft()
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在验证 GitHub 仓库…", error = null, notice = null) }
            try {
                val ws = withContext(Dispatchers.IO) {
                    repo.connectRepository(rawRepo, token, importLocal)
                }
                _ui.update {
                    it.copy(
                        workspace = ws,
                        screen = AppScreen.Home,
                        activeEditor = null,
                        busy = false,
                        busyLabel = "",
                        notice = "已连接 ${ws.repository}。可点击「恢复」下载远端笔记，或勾选本机改动进行「同步」。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "连接失败。") }
            }
        }
    }

    fun disconnectGitHub() {
        flushActiveEditorDraft()
        val ws = repo.disconnectRepository()
        _ui.update {
            it.copy(
                workspace = ws,
                notice = "已断开连接并清除安全存储中的令牌；本机草稿与离线副本仍保留。",
                error = null
            )
        }
    }

    fun switchToOfflineLocal() {
        flushActiveEditorDraft()
        val ws = repo.switchToLocalOfflineWorkspace()
        _ui.update {
            it.copy(
                workspace = ws,
                screen = AppScreen.Home,
                activeEditor = null,
                showSyncSheet = false,
                notice = "已切换回未绑定仓库的本机离线工作区。",
                error = null
            )
        }
    }

    fun restoreFromGitHub() {
        flushActiveEditorDraft()
        viewModelScope.launch {
            _ui.update { it.copy(showSyncSheet = false, busy = true, busyLabel = "正在从远端恢复完整离线副本…", error = null, notice = null) }
            try {
                val (imgCount, ws) = withContext(Dispatchers.IO) { repo.restoreFromGitHub() }
                _ui.update {
                    it.copy(
                        workspace = ws,
                        busy = false,
                        busyLabel = "",
                        imageRefreshNonce = it.imageRefreshNonce + 1,
                        notice = "恢复完成（下载 $imgCount 张新图片），现可完全离线阅读；未同步草稿已保留。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "恢复失败。") }
            }
        }
    }

    fun syncSelected(keys: Set<String>) {
        flushActiveEditorDraft()
        viewModelScope.launch {
            _ui.update { it.copy(showSyncSheet = false, busy = true, busyLabel = "正在同步改动到远端仓库…", error = null, notice = null) }
            try {
                val outcome = withContext(Dispatchers.IO) { repo.syncSelected(keys) }
                when (outcome) {
                    is PaperNotesRepository.SyncOutcome.Success -> {
                        val updatedEditor = _ui.value.activeEditor?.let { doc ->
                            val latest = repo.getChapterContent(doc.baseChapter.bookId, doc.baseChapter.id)
                            if (latest != null) doc.copy(
                                baseChapter = latest.first,
                                content = latest.second,
                                localSavedNotice = "已同步到 GitHub"
                            ) else doc
                        }
                        _ui.update {
                            it.copy(
                                workspace = outcome.state,
                                activeEditor = updatedEditor,
                                busy = false,
                                busyLabel = "",
                                notice = "已成功同步 ${outcome.syncedCount} 项改动到 GitHub。"
                            )
                        }
                    }
                    is PaperNotesRepository.SyncOutcome.Conflict -> {
                        _ui.update {
                            it.copy(
                                busy = false,
                                busyLabel = "",
                                activeConflict = outcome.conflict,
                                error = "检测到远端版本冲突，请选择处理方式。"
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "同步失败。") }
            }
        }
    }

    fun syncCurrentEditorNote() {
        val doc = _ui.value.activeEditor ?: return
        val key = repo.chapterKey(doc.baseChapter.bookId, doc.baseChapter.id)
        syncSelected(setOf(key))
    }

    fun syncNotebookAll(bookId: String) {
        val keys = _ui.value.workspace.pendingSyncItems
            .filter { it.bookId == bookId }
            .map { it.key }
            .toSet()
        if (keys.isEmpty()) {
            _ui.update { it.copy(notice = "当前笔记本没有待同步的本机改动。") }
            return
        }
        syncSelected(keys)
    }

    fun resolveConflict(resolution: ConflictResolution) {
        val conflict = _ui.value.activeConflict ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在处理冲突…", error = null) }
            try {
                val ws = withContext(Dispatchers.IO) { repo.resolveConflict(conflict, resolution) }
                val updatedEditor = _ui.value.activeEditor?.let { doc ->
                    val latest = repo.getChapterContent(doc.baseChapter.bookId, doc.baseChapter.id)
                    if (latest != null) doc.copy(
                        baseChapter = latest.first,
                        content = latest.second,
                        docKey = "${doc.docKey}::resolved::${System.currentTimeMillis()}"
                    ) else doc
                }
                val msg = when (resolution) {
                    ConflictResolution.KEEP_LOCAL_REBASE_REMOTE -> "已采用远端版本作为新基准并保留本机草稿，确认后可重新点击同步。"
                    ConflictResolution.USE_REMOTE_DISCARD_LOCAL -> "已采用远端版本并更新本机内容。"
                    ConflictResolution.SAVE_LOCAL_AS_COPY_AND_USE_REMOTE -> "已将本机改动另存为冲突副本，并采用远端版本。"
                }
                _ui.update {
                    it.copy(
                        workspace = ws,
                        activeEditor = updatedEditor,
                        activeConflict = null,
                        busy = false,
                        busyLabel = "",
                        notice = msg
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "冲突处理失败。") }
            }
        }
    }

    fun dismissConflict() {
        _ui.update { it.copy(activeConflict = null) }
    }

    // --- Full-Hierarchy Sharing & Share Link Import (Compatible with Desktop & Web) ---

    fun dismissShare() {
        _ui.update { it.copy(activeShare = null) }
    }

    fun clearPendingShareImport() {
        _ui.update { it.copy(pendingShareImport = null, shareImportError = null) }
    }

    private data class ShareBudget(var textBytes: Int = 0, var imageBytes: Int = 0, var exceeded: Boolean = false)

    private suspend fun collectAttachmentsForShare(
        bookId: String?,
        markdowns: List<String>,
        budget: ShareBudget
    ): Pair<List<SharedAttachment>, Int> {
        val seen = mutableSetOf<String>()
        val out = mutableListOf<SharedAttachment>()
        var omitted = 0
        for (md in markdowns) {
            if (md.isEmpty()) continue
            for (ref in AttachmentPolicy.extractAttachmentReferences(md, bookId)) {
                if (!seen.add(ref.src)) continue
                if (budget.imageBytes >= ShareLinkCodec.MAX_OFFLINE_TOTAL_IMAGE_BYTES ||
                    budget.textBytes + ((budget.imageBytes * 137) / 100) >= ShareLinkCodec.MAX_OFFLINE_RAW_BYTES
                ) {
                    omitted++
                    continue
                }
                val att = try { repo.ensureAttachmentLocal(ref.path) } catch (_: Throwable) { null } ?: continue
                if (att.bytes.size > ShareLinkCodec.MAX_OFFLINE_SINGLE_IMAGE_BYTES ||
                    budget.imageBytes + att.bytes.size > ShareLinkCodec.MAX_OFFLINE_TOTAL_IMAGE_BYTES ||
                    budget.textBytes + (((budget.imageBytes + att.bytes.size) * 137) / 100) > ShareLinkCodec.MAX_OFFLINE_RAW_BYTES
                ) {
                    omitted++
                    continue
                }
                val mime = AttachmentPolicy.attachmentMime(ref.path)
                budget.imageBytes += att.bytes.size
                out.add(
                    SharedAttachment(
                        relPath = ref.src,
                        mime = mime,
                        base64 = java.util.Base64.getEncoder().encodeToString(att.bytes)
                    )
                )
            }
        }
        return out to omitted
    }

    fun shareCabinet(cabinetId: String) {
        flushActiveEditorDraft()
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在打包书柜分享链接…", error = null) }
            try {
                val modal = withContext(Dispatchers.IO) {
                    val ws = repo.snapshotState()
                    val cab = ws.cabinets.find { it.id == cabinetId } ?: throw IllegalArgumentException("书柜不存在。")
                    val cabItems = ws.items.filter { repo.assignedCabinet(it.id) == cabinetId }
                    val books = mutableListOf<SharedBook>()
                    val pages = mutableListOf<SharedPage>()
                    val budget = ShareBudget()
                    var omitted = 0

                    for (item in cabItems) {
                        if (budget.exceeded) break
                        if (item.isPage) {
                            val ch = ws.chaptersByBook[item.id]?.firstOrNull()
                            val text = ch?.let { ws.drafts[repo.chapterKey(item.id, it.id)]?.content ?: it.content }.orEmpty()
                            budget.textBytes += text.toByteArray(Charsets.UTF_8).size + item.title.toByteArray(Charsets.UTF_8).size + 64
                            if (budget.textBytes > ShareLinkCodec.MAX_OFFLINE_RAW_BYTES) { budget.exceeded = true; break }
                            val (atts, skip) = collectAttachmentsForShare(null, listOf(text), budget)
                            omitted += skip
                            pages.add(SharedPage(title = item.title, content = text, attachments = atts.ifEmpty { null }))
                        } else {
                            val chList = ws.chaptersByBook[item.id].orEmpty()
                            val sharedChs = mutableListOf<SharedChapter>()
                            val mdBodies = mutableListOf<String>()
                            for (ch in chList) {
                                val text = ws.drafts[repo.chapterKey(item.id, ch.id)]?.content ?: ch.content
                                budget.textBytes += text.toByteArray(Charsets.UTF_8).size + ch.title.toByteArray(Charsets.UTF_8).size + 64
                                if (budget.textBytes > ShareLinkCodec.MAX_OFFLINE_RAW_BYTES) { budget.exceeded = true; break }
                                sharedChs.add(SharedChapter(title = ch.title, content = text))
                                mdBodies.add(text)
                            }
                            if (budget.exceeded) break
                            val (atts, skip) = collectAttachmentsForShare(item.id, mdBodies, budget)
                            omitted += skip
                            books.add(
                                SharedBook(
                                    title = item.title,
                                    description = item.description.ifBlank { null },
                                    chapters = sharedChs,
                                    attachments = atts.ifEmpty { null }
                                )
                            )
                        }
                    }
                    val blocked = if (budget.exceeded) "该书柜内容超过离线分享内存上限（512 KB），请改用 GitHub 短链接或分享单本/单章。" else ""
                    val payload = PaperSharePayloadV1(
                        v = 1,
                        scope = "cabinet",
                        cabinet = SharedCabinetData(
                            title = cab.title,
                            books = if (blocked.isNotEmpty()) emptyList() else books,
                            pages = if (blocked.isNotEmpty()) emptyList() else pages
                        )
                    )
                    val gh = if (ws.connected && ws.repository.isNotBlank()) {
                        ShareLinkCodec.encodeGitHubShareLink(GitHubShareRef(ws.repository, "cabinet", cab.id, title = cab.title))
                    } else null
                    ShareModalState(payload, ShareLinkCodec.summarize(payload), gh, omitted, blocked)
                }
                _ui.update { it.copy(busy = false, busyLabel = "", activeShare = modal) }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "无法生成书柜分享链接。") }
            }
        }
    }

    fun shareNotebook(bookId: String) {
        flushActiveEditorDraft()
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在打包笔记本分享链接…", error = null) }
            try {
                val modal = withContext(Dispatchers.IO) {
                    val ws = repo.snapshotState()
                    val item = ws.items.find { it.id == bookId } ?: throw IllegalArgumentException("笔记本不存在。")
                    val chList = ws.chaptersByBook[bookId].orEmpty()
                    val sharedChs = mutableListOf<SharedChapter>()
                    val mdBodies = mutableListOf<String>()
                    val budget = ShareBudget()
                    for (ch in chList) {
                        val text = ws.drafts[repo.chapterKey(bookId, ch.id)]?.content ?: ch.content
                        budget.textBytes += text.toByteArray(Charsets.UTF_8).size + ch.title.toByteArray(Charsets.UTF_8).size + 64
                        if (budget.textBytes > ShareLinkCodec.MAX_OFFLINE_RAW_BYTES) { budget.exceeded = true; break }
                        sharedChs.add(SharedChapter(title = ch.title, content = text))
                        mdBodies.add(text)
                    }
                    val (atts, omitted) = if (budget.exceeded) emptyList<SharedAttachment>() to 0
                    else collectAttachmentsForShare(bookId, mdBodies, budget)
                    val blocked = if (budget.exceeded) "该笔记本内容超过离线分享内存上限（512 KB），请改用 GitHub 短链接或单章分享。" else ""
                    val payload = PaperSharePayloadV1(
                        v = 1,
                        scope = "book",
                        book = SharedBook(
                            title = item.title,
                            description = item.description.ifBlank { null },
                            chapters = if (blocked.isNotEmpty()) emptyList() else sharedChs,
                            attachments = atts.ifEmpty { null }
                        )
                    )
                    val gh = if (ws.connected && ws.repository.isNotBlank() && item.sha.isNotBlank()) {
                        ShareLinkCodec.encodeGitHubShareLink(GitHubShareRef(ws.repository, "book", bookId, title = item.title))
                    } else null
                    ShareModalState(payload, ShareLinkCodec.summarize(payload), gh, omitted, blocked)
                }
                _ui.update { it.copy(busy = false, busyLabel = "", activeShare = modal) }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "无法生成笔记本分享链接。") }
            }
        }
    }

    fun shareCurrentEditorNote() {
        flushActiveEditorDraft()
        val doc = _ui.value.activeEditor ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在生成分享链接…", error = null) }
            try {
                val modal = withContext(Dispatchers.IO) {
                    val ws = repo.snapshotState()
                    val text = doc.content
                    val budget = ShareBudget(textBytes = text.toByteArray(Charsets.UTF_8).size + doc.baseChapter.title.toByteArray(Charsets.UTF_8).size + 64)
                    if (budget.textBytes > ShareLinkCodec.MAX_OFFLINE_RAW_BYTES) budget.exceeded = true
                    val assetBookId = if (doc.isPage) null else doc.baseChapter.bookId
                    val (atts, omitted) = if (budget.exceeded) emptyList<SharedAttachment>() to 0
                    else collectAttachmentsForShare(assetBookId, listOf(text), budget)
                    val blocked = if (budget.exceeded) "当前正文超过离线分享内存上限（512 KB），请改用 GitHub 短链接分享。" else ""
                    val payload = if (doc.isPage) {
                        PaperSharePayloadV1(
                            v = 1,
                            scope = "page",
                            page = SharedPage(
                                title = doc.baseChapter.title,
                                content = if (blocked.isNotEmpty()) "" else text,
                                attachments = atts.ifEmpty { null }
                            )
                        )
                    } else {
                        val bookTitle = ws.items.find { it.id == doc.baseChapter.bookId }?.title
                        PaperSharePayloadV1(
                            v = 1,
                            scope = "chapter",
                            chapter = SharedChapterData(
                                title = doc.baseChapter.title,
                                bookTitle = bookTitle,
                                content = if (blocked.isNotEmpty()) "" else text,
                                attachments = atts.ifEmpty { null }
                            )
                        )
                    }
                    val gh = if (ws.connected && ws.repository.isNotBlank() && doc.baseChapter.sha.isNotBlank()) {
                        ShareLinkCodec.encodeGitHubShareLink(
                            GitHubShareRef(
                                repo = ws.repository,
                                scope = if (doc.isPage) "page" else "chapter",
                                id = if (doc.isPage) doc.baseChapter.id else doc.baseChapter.bookId,
                                chapterId = if (doc.isPage) null else doc.baseChapter.id,
                                title = doc.baseChapter.title
                            )
                        )
                    } else null
                    ShareModalState(payload, ShareLinkCodec.summarize(payload), gh, omitted, blocked)
                }
                _ui.update { it.copy(busy = false, busyLabel = "", activeShare = modal) }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", error = e.message ?: "无法生成分享链接。") }
            }
        }
    }

    fun parseShareLink(rawInput: String) {
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在解析分享链接…", shareImportError = null, pendingShareImport = null) }
            try {
                val pending = withContext(Dispatchers.IO) {
                    when (val parsed = ShareLinkCodec.decodeShareInput(rawInput)) {
                        is ParsedShareInput.Offline -> {
                            PendingShareImport(parsed.payload, ShareLinkCodec.summarize(parsed.payload), "离线便携链接")
                        }
                        is ParsedShareInput.GitHub -> {
                            val ref = parsed.ref
                            val client = GitHubNotebookClient(ref.repo, token = "")
                            val payload = fetchGitHubShare(client, ref)
                            PendingShareImport(payload, ShareLinkCodec.summarize(payload), "GitHub：${ref.repo}")
                        }
                    }
                }
                _ui.update { it.copy(busy = false, busyLabel = "", pendingShareImport = pending, shareImportError = null) }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", shareImportError = e.message ?: "解析分享链接失败。") }
            }
        }
    }

    private suspend fun fetchGitHubShare(client: GitHubNotebookClient, ref: GitHubShareRef): PaperSharePayloadV1 {
        suspend fun fetchImages(bookId: String?, bodies: List<String>): List<SharedAttachment>? {
            val seen = mutableSetOf<String>()
            val out = mutableListOf<SharedAttachment>()
            for (md in bodies) {
                for (r in AttachmentPolicy.extractAttachmentReferences(md, bookId)) {
                    if (!seen.add(r.src)) continue
                    try {
                        val bytes = client.fetchRawBytes(r.path)
                        if (bytes.isNotEmpty()) {
                            out.add(
                                SharedAttachment(
                                    relPath = r.src,
                                    mime = AttachmentPolicy.attachmentMime(r.path),
                                    base64 = java.util.Base64.getEncoder().encodeToString(bytes)
                                )
                            )
                        }
                    } catch (_: Throwable) { /* skip unreadable remote image */ }
                }
            }
            return out.ifEmpty { null }
        }

        // Fast path: 1 Git Trees API call + raw.githubusercontent.com (avoids 60/hr unauthenticated rate limit)
        suspend fun readBookViaRaw(bookId: String, allPaths: List<String>, fallbackTitle: String?): SharedBook {
            val prefix = "docs/notebooks/$bookId/"
            val indexPath = "${prefix}index.md"
            val indexMd = if (indexPath in allPaths) client.fetchRawText(indexPath) else ""
            val title = if (indexMd.isNotEmpty()) {
                com.papernotes.android.data.CompatibilityCodecs.titleFromMarkdown(indexMd, fallbackTitle ?: bookId)
            } else (fallbackTitle ?: bookId)
            val desc = if (indexMd.isNotEmpty()) com.papernotes.android.data.CompatibilityCodecs.readNotebookDescription(indexMd) else ""
            val order = if (indexMd.isNotEmpty()) com.papernotes.android.data.CompatibilityCodecs.readNotebookChapterOrder(indexMd) else emptyList()
            val chPaths = allPaths.filter {
                it.startsWith(prefix) && it != indexPath && !it.startsWith("${prefix}assets/") && it.endsWith(".md")
            }
            val rawChapters = chPaths.map { p ->
                val cid = p.removePrefix(prefix).removeSuffix(".md")
                val body = client.fetchRawText(p)
                val cTitle = com.papernotes.android.data.CompatibilityCodecs.titleFromMarkdown(
                    body,
                    com.papernotes.android.data.CompatibilityCodecs.titleFromEncodedId(cid, 'c')
                )
                Triple(cid, cTitle, body)
            }
            val sorted = com.papernotes.android.data.CompatibilityCodecs.sortChapters(
                rawChapters.map { (cid, cTitle, body) ->
                    Chapter(id = cid, bookId = bookId, title = cTitle, sha = "", content = body)
                },
                { it.id },
                order
            )
            return SharedBook(
                title = title,
                description = desc.ifBlank { null },
                chapters = sorted.map { SharedChapter(it.title, it.content) },
                attachments = fetchImages(bookId, sorted.map { it.content })
            )
        }

        return when (ref.scope) {
            "page" -> {
                val md = client.fetchRawText("docs/pages/${ref.id}.md")
                val title = com.papernotes.android.data.CompatibilityCodecs.titleFromMarkdown(
                    md,
                    com.papernotes.android.data.CompatibilityCodecs.titleFromEncodedId(ref.id, 'p')
                )
                PaperSharePayloadV1(
                    v = 1,
                    scope = "page",
                    page = SharedPage(title = title, content = md, attachments = fetchImages(null, listOf(md)))
                )
            }
            "chapter" -> {
                val cid = ref.chapterId ?: throw IllegalArgumentException("GitHub 章节链接缺少章节 ID。")
                val md = client.fetchRawText("docs/notebooks/${ref.id}/$cid.md")
                val title = com.papernotes.android.data.CompatibilityCodecs.titleFromMarkdown(
                    md,
                    com.papernotes.android.data.CompatibilityCodecs.titleFromEncodedId(cid, 'c')
                )
                PaperSharePayloadV1(
                    v = 1,
                    scope = "chapter",
                    chapter = SharedChapterData(title = title, content = md, attachments = fetchImages(ref.id, listOf(md)))
                )
            }
            "book" -> {
                val allPaths = client.listPublicDocsTreePaths()
                PaperSharePayloadV1(
                    v = 1,
                    scope = "book",
                    book = readBookViaRaw(ref.id, allPaths, ref.title)
                )
            }
            else -> {
                val allPaths = client.listPublicDocsTreePaths()
                val catalog = if ("docs/cabinets.json" in allPaths) {
                    com.papernotes.android.data.CompatibilityCodecs.parseCatalog(client.fetchRawText("docs/cabinets.json"))
                } else com.papernotes.android.data.CompatibilityCodecs.defaultCatalog()
                val cabTitle = catalog.cabinets.find { it.id == ref.id }?.title ?: ref.title ?: "分享书柜"
                fun assigned(id: String): String {
                    val t = catalog.assignments[id]
                    return if (t != null && catalog.cabinets.any { it.id == t }) t else DEFAULT_CABINET_ID
                }
                val bookIds = allPaths.mapNotNull { p ->
                    val m = Regex("^docs/notebooks/([^/]+)/index\\.md$").matchEntire(p)
                    m?.groupValues?.get(1)
                }.distinct().filter { assigned(it) == ref.id }
                val books = bookIds.map { bid -> readBookViaRaw(bid, allPaths, null) }
                val pageIds = allPaths.mapNotNull { p ->
                    val m = Regex("^docs/pages/([^/]+)\\.md$").matchEntire(p)
                    m?.groupValues?.get(1)
                }.distinct().filter { assigned("page_$it") == ref.id }
                val pages = pageIds.map { pid ->
                    val md = client.fetchRawText("docs/pages/$pid.md")
                    val title = com.papernotes.android.data.CompatibilityCodecs.titleFromMarkdown(
                        md,
                        com.papernotes.android.data.CompatibilityCodecs.titleFromEncodedId(pid, 'p')
                    )
                    SharedPage(title = title, content = md, attachments = fetchImages(null, listOf(md)))
                }
                PaperSharePayloadV1(v = 1, scope = "cabinet", cabinet = SharedCabinetData(cabTitle, books, pages))
            }
        }
    }

    fun confirmImportShare(targetCabinetId: String = DEFAULT_CABINET_ID) {
        val pending = _ui.value.pendingShareImport ?: return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, busyLabel = "正在导入分享内容…", shareImportError = null) }
            try {
                val resultTriple = withContext(Dispatchers.IO) {
                    val payload = pending.payload
                    var latestWs = repo.snapshotState()
                    var destCab = targetCabinetId
                    var navScreen: AppScreen? = null

                    fun rewriteImgs(md: String, bookId: String?, atts: List<SharedAttachment>?): String {
                        if (atts.isNullOrEmpty()) return md
                        var next = md
                        for (att in atts) {
                            try {
                                val bytes = java.util.Base64.getDecoder().decode(att.base64)
                                val newRel = repo.saveNewImageAttachment(bookId, att.mime, bytes)
                                if (newRel != att.relPath) next = next.replace(att.relPath, newRel)
                            } catch (_: Throwable) { /* skip invalid image safely */ }
                        }
                        return next
                    }

                    fun importBook(sb: SharedBook, cabId: String): String {
                        val (nb, ws1) = repo.createNotebook(sb.title, sb.description.orEmpty(), cabId)
                        latestWs = ws1
                        val imgMap = mutableMapOf<String, String>()
                        sb.attachments?.forEach { att ->
                            try {
                                val bytes = java.util.Base64.getDecoder().decode(att.base64)
                                imgMap[att.relPath] = repo.saveNewImageAttachment(nb.id, att.mime, bytes)
                            } catch (_: Throwable) {}
                        }
                        for (sc in sb.chapters) {
                            val (ch, ws2) = repo.createChapter(nb.id, sc.title)
                            var body = sc.content
                            for ((oldRel, newRel) in imgMap) body = body.replace(oldRel, newRel)
                            latestWs = repo.saveDraft(ch, body)
                            if (ws2.items.isNotEmpty()) latestWs = repo.snapshotState()
                        }
                        return nb.id
                    }

                    fun importPage(sp: SharedPage, cabId: String): Chapter {
                        val (ch, ws1) = repo.createStandalonePage(sp.title, cabId)
                        val body = rewriteImgs(sp.content, null, sp.attachments)
                        latestWs = repo.saveDraft(ch, body)
                        return ch
                    }

                    when (payload.scope) {
                        "cabinet" -> {
                            val cab = payload.cabinet!!
                            val exists = latestWs.cabinets.any { it.title.equals(cab.title, ignoreCase = true) }
                            val title = if (exists) "${cab.title}（分享）" else cab.title
                            val (newCabId, wsCab) = repo.createCabinet(title)
                            latestWs = wsCab
                            destCab = newCabId
                            for (sb in cab.books) importBook(sb, newCabId)
                            for (sp in cab.pages) importPage(sp, newCabId)
                            navScreen = AppScreen.Bookshelf(newCabId)
                        }
                        "book" -> {
                            val bid = importBook(payload.book!!, destCab)
                            navScreen = AppScreen.NotebookDetail(destCab, bid)
                        }
                        "page" -> {
                            importPage(payload.page!!, destCab)
                            navScreen = AppScreen.Bookshelf(destCab)
                        }
                        "chapter" -> {
                            val sc = payload.chapter!!
                            val currentBookId = when (val s = _ui.value.screen) {
                                is AppScreen.NotebookDetail -> s.bookId
                                is AppScreen.Editor -> if (!s.isPage) s.bookId else null
                                else -> null
                            }
                            if (currentBookId != null) {
                                val (ch, _) = repo.createChapter(currentBookId, sc.title)
                                val body = rewriteImgs(sc.content, currentBookId, sc.attachments)
                                latestWs = repo.saveDraft(ch, body)
                            } else {
                                importPage(SharedPage(sc.title, sc.content, sc.ext, sc.attachments), destCab)
                            }
                        }
                    }
                    Triple(latestWs, navScreen, pending.summary.title)
                }
                _ui.update {
                    it.copy(
                        workspace = resultTriple.first,
                        screen = resultTriple.second ?: it.screen,
                        busy = false,
                        busyLabel = "",
                        showImportSheet = false,
                        pendingShareImport = null,
                        shareImportError = null,
                        notice = "已导入分享内容「${resultTriple.third}」。"
                    )
                }
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, busyLabel = "", shareImportError = e.message ?: "导入分享内容失败。") }
            }
        }
    }

    private fun runLocalAction(successNotice: String, action: () -> WorkspaceState) {
        try {
            val ws = action()
            _ui.update { it.copy(workspace = ws, notice = successNotice, error = null) }
        } catch (e: Exception) {
            _ui.update { it.copy(error = e.message ?: "操作未能完成。") }
        }
    }

    companion object {
        fun factory(repo: PaperNotesRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = PaperNotesViewModel(repo) as T
            }
    }
}
