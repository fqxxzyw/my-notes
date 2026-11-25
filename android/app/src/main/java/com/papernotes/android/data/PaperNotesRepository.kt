package com.papernotes.android.data

import com.papernotes.android.ui.theme.ThemePreference

data class WorkspaceState(
    val repository: String = "",
    val connected: Boolean = false,
    val settings: AppSettings = AppSettings(),
    val localMetadataDamaged: Boolean = false,
    val cabinets: List<Cabinet> = listOf(Cabinet(DEFAULT_CABINET_ID, DEFAULT_CABINET_TITLE)),
    val cabinetPendingCount: Int = 0,
    val removedCabinets: Map<String, CabinetRemoved> = emptyMap(),
    val items: List<ShelfItem> = emptyList(),
    val chaptersByBook: Map<String, List<Chapter>> = emptyMap(),
    val drafts: Map<String, ChapterDraft> = emptyMap(),
    val pendingSyncItems: List<PendingSyncItem> = emptyList(),
    val remoteSnapshotHead: String? = null,
    val remoteSnapshotStale: Boolean = false,
    val hasUnboundLocalNotes: Boolean = false
)

/**
 * Unified repository coordinating local storage, cabinet journal, drafts, attachments,
 * welcome deduplication, import/repair, and GitHub sync/restore/delete/conflict resolution.
 * Completely independent of Android UI so every flow is verifiable by unit tests.
 */
class PaperNotesRepository(
    private val storage: WorkspaceStorage,
    val attachments: AttachmentFileStore,
    private val tokenStore: TokenStore,
    private val clientFactory: (repository: String, token: String) -> GitHubNotebookClient = { repo, token ->
        GitHubNotebookClient(repo, token)
    }
) {
    private var settings: AppSettings = storage.loadSettings()
    private var repository: String = settings.configuredRepository
    private var local: LocalCollection = LocalCollection()
    private var localDamaged: Boolean = false
    private var drafts: MutableMap<String, ChapterDraft> = LinkedHashMap()
    private var journal: CabinetJournal = CabinetJournal()
    private var remoteSnapshot: RemoteSnapshot? = null
    private var client: GitHubNotebookClient? = null
    private var connected: Boolean = false

    init {
        loadActiveWorkspace()
    }

    private fun loadActiveWorkspace() {
        val (loadedLocal, damaged) = storage.loadLocalCollection(repository)
        localDamaged = damaged
        local = if (!damaged && repository.isEmpty() && !loadedLocal.welcomeInitialized) {
            WelcomeSeed.seedIfNeeded(loadedLocal, repository).also {
                storage.saveLocalCollection(repository, it)
            }
        } else {
            loadedLocal
        }
        drafts = storage.loadDrafts(repository).toMutableMap()
        remoteSnapshot = storage.loadRemoteSnapshot(repository)
        val journalState = storage.loadCabinetJournal(repository)
        val baseCatalog = remoteSnapshot?.catalog
            ?: journalState.saved
            ?: CatalogVersion(CompatibilityCodecs.defaultCatalog(), "")
        journal = CabinetJournal(initialBase = baseCatalog, initialState = journalState)

        client = null
        connected = false
        if (repository.isNotBlank()) {
            val token = tokenStore.getToken(repository)
            if (!token.isNullOrBlank()) {
                client = clientFactory(repository, token)
                connected = true
            }
        }
    }

    private fun assertWritable() {
        if (localDamaged) {
            throw IllegalStateException("本地笔记本信息损坏，已保留原始数据并暂停写入；请先备份数据或恢复。")
        }
    }

    fun currentRepository(): String = repository

    fun isConnected(): Boolean = connected

    fun getSettings(): AppSettings = settings

    fun updateTheme(preference: ThemePreference): WorkspaceState {
        settings = settings.copy(themePreference = preference.key)
        storage.saveSettings(settings)
        return snapshotState()
    }

    fun setReducedMotion(enabled: Boolean): WorkspaceState {
        settings = settings.copy(reducedMotionOverride = enabled)
        storage.saveSettings(settings)
        return snapshotState()
    }

    fun completeOnboarding(): WorkspaceState {
        settings = settings.copy(onboardingCompleted = true)
        storage.saveSettings(settings)
        return snapshotState()
    }

    fun chapterKey(bookId: String, chapterId: String): String = "$bookId/$chapterId"

    fun assignedCabinet(itemId: String): String = journal.assigned(itemId)

    fun isPageItem(bookId: String): Boolean {
        if (bookId in local.pageIds) return true
        val snap = remoteSnapshot
        if (snap != null && snap.pages.any { CompatibilityCodecs.pageBookId(it.id) == bookId }) return true
        return false
    }

    fun snapshotState(): WorkspaceState {
        val snap = remoteSnapshot
        val remoteBooks = snap?.books.orEmpty()
        val remotePages = snap?.pages.orEmpty()

        val allBooks = LinkedHashMap<String, Notebook>()
        val pageBookIds = HashSet<String>(local.pageIds)

        for (b in remoteBooks) allBooks[b.id] = b
        for (p in remotePages) {
            val pbId = CompatibilityCodecs.pageBookId(p.id)
            pageBookIds.add(pbId)
            allBooks[pbId] = Notebook(id = pbId, title = p.title, sha = p.sha)
        }
        for (b in local.books) {
            if (b.id !in allBooks) allBooks[b.id] = b
        }
        for (draft in local.bookMetadataDrafts.values) {
            if (draft.base.id !in allBooks) allBooks[draft.base.id] = draft.base
        }
        for (d in drafts.values) {
            if (d.base.bookId !in allBooks) {
                allBooks[d.base.bookId] = Notebook(
                    id = d.base.bookId,
                    title = "本地草稿 · ${d.base.bookId.take(8)}",
                    sha = ""
                )
            }
        }

        val chaptersByBook = LinkedHashMap<String, List<Chapter>>()
        val shelfItems = mutableListOf<ShelfItem>()

        for ((id, rawBook) in allBooks) {
            val isPage = id in pageBookIds
            val metaDraft = local.bookMetadataDrafts[id]
            val effectiveDesc = metaDraft?.description ?: rawBook.description.orEmpty()
            val effectiveOrder = metaDraft?.chapterOrder ?: rawBook.chapterOrder

            if (isPage) {
                val pId = CompatibilityCodecs.extractPageId(id)
                val remoteP = remotePages.find { it.id == pId }
                val localCh = local.chapters.find { it.bookId == id }
                val baseChapter = when {
                    remoteP != null -> Chapter(id, remoteP.id, remoteP.title, remoteP.content, remoteP.sha)
                    localCh != null -> localCh
                    else -> drafts.values.find { it.base.bookId == id }?.base
                }
                val key = baseChapter?.let { chapterKey(it.bookId, it.id) }
                val activeDraft = key?.let { drafts[it] }
                val content = activeDraft?.content ?: baseChapter?.content.orEmpty()
                val title = CompatibilityCodecs.titleFromMarkdown(content, rawBook.title)
                val resolvedChapter = baseChapter?.copy(title = title)
                chaptersByBook[id] = listOfNotNull(resolvedChapter)
                val pending = (baseChapter != null && baseChapter.sha.isEmpty()) || activeDraft != null
                shelfItems.add(
                    ShelfItem(
                        id = id,
                        title = title,
                        sha = rawBook.sha,
                        isPage = true,
                        pageId = pId,
                        previewText = CompatibilityCodecs.pageExcerpt(content),
                        hasPendingChanges = pending
                    )
                )
            } else {
                val chMap = LinkedHashMap<String, Chapter>()
                snap?.chapters?.get(id)?.forEach { chMap[it.id] = it }
                local.chapters.filter { it.bookId == id && it.sha.isEmpty() }.forEach {
                    if (it.id !in chMap) chMap[it.id] = it
                }
                drafts.values.filter { it.base.bookId == id }.forEach { d ->
                    if (d.base.id !in chMap) chMap[d.base.id] = d.base
                }
                val sorted = CompatibilityCodecs.sortChapters(
                    chMap.values.toList(),
                    { it.id },
                    effectiveOrder
                ).map { ch ->
                    val d = drafts[chapterKey(ch.bookId, ch.id)]
                    if (d != null) {
                        ch.copy(title = CompatibilityCodecs.titleFromMarkdown(d.content, ch.title))
                    } else {
                        val cleaned = CompatibilityCodecs.cleanMarkdownTitle(ch.title)
                        if (cleaned.isNotEmpty() && cleaned != ch.title) ch.copy(title = cleaned) else ch
                    }
                }
                chaptersByBook[id] = sorted
                val pending = rawBook.sha.isEmpty() ||
                    metaDraft != null ||
                    sorted.any { it.sha.isEmpty() || chapterKey(it.bookId, it.id) in drafts }
                shelfItems.add(
                    ShelfItem(
                        id = id,
                        title = CompatibilityCodecs.cleanMarkdownTitle(rawBook.title).ifEmpty { rawBook.title },
                        sha = rawBook.sha,
                        isPage = false,
                        description = effectiveDesc,
                        chapterCount = sorted.size,
                        chapterOrder = effectiveOrder,
                        indexContent = rawBook.indexContent,
                        hasPendingChanges = pending
                    )
                )
            }
        }

        val pendingItems = buildPendingSyncItems(shelfItems)
        return WorkspaceState(
            repository = repository,
            connected = connected,
            settings = settings,
            localMetadataDamaged = localDamaged,
            cabinets = journal.cabinets,
            cabinetPendingCount = journal.pendingCount,
            removedCabinets = journal.state.removed,
            items = shelfItems,
            chaptersByBook = chaptersByBook,
            drafts = drafts.toMap(),
            pendingSyncItems = pendingItems,
            remoteSnapshotHead = snap?.head,
            remoteSnapshotStale = snap?.stale == true,
            hasUnboundLocalNotes = repository.isNotBlank() && storage.hasUserData("")
        )
    }

    private fun buildPendingSyncItems(items: List<ShelfItem>): List<PendingSyncItem> {
        val list = mutableListOf<PendingSyncItem>()
        val titleById = items.associate { it.id to it.title }
        if (journal.pendingCount > 0) {
            list.add(
                PendingSyncItem(
                    key = "catalog",
                    kind = PendingKind.CATALOG,
                    bookId = null,
                    chapterId = null,
                    title = "书柜整理与归属",
                    subtitle = "${journal.pendingCount} 项待同步书柜变更"
                )
            )
        }
        for (book in local.books) {
            if (book.sha.isEmpty() && book.id !in local.pageIds) {
                list.add(
                    PendingSyncItem(
                        key = "book:${book.id}",
                        kind = PendingKind.NEW_BOOK,
                        bookId = book.id,
                        chapterId = null,
                        title = book.title,
                        subtitle = "新建笔记本"
                    )
                )
            }
        }
        for ((bookId, meta) in local.bookMetadataDrafts) {
            list.add(
                PendingSyncItem(
                    key = "book:$bookId",
                    kind = PendingKind.BOOK_METADATA,
                    bookId = bookId,
                    chapterId = null,
                    title = meta.base.title,
                    subtitle = "笔记本简介 / 章节顺序变更"
                )
            )
        }
        val chapterByKey = LinkedHashMap<String, Chapter>()
        for (ch in local.chapters) {
            if (ch.sha.isEmpty()) chapterByKey[chapterKey(ch.bookId, ch.id)] = ch
        }
        for ((key, d) in drafts) {
            chapterByKey[key] = d.base.copy(content = d.content)
        }
        for ((key, ch) in chapterByKey) {
            val isPage = isPageItem(ch.bookId)
            val title = CompatibilityCodecs.titleFromMarkdown(ch.content, ch.title)
            list.add(
                PendingSyncItem(
                    key = key,
                    kind = if (isPage) PendingKind.PAGE else PendingKind.CHAPTER,
                    bookId = ch.bookId,
                    chapterId = ch.id,
                    title = title,
                    subtitle = if (isPage) {
                        if (ch.sha.isEmpty()) "新建独立书页" else "已修改书页草稿"
                    } else {
                        val bTitle = titleById[ch.bookId] ?: ch.bookId
                        if (ch.sha.isEmpty()) "$bTitle · 新建章节" else "$bTitle · 已修改草稿"
                    },
                    isPage = isPage
                )
            )
        }
        return list
    }

    // --- Cabinet Operations ---

    fun createCabinet(title: String): Pair<String, WorkspaceState> {
        val id = journal.create(title)
        storage.saveCabinetJournal(repository, journal.state)
        return id to snapshotState()
    }

    fun renameCabinet(cabinetId: String, newTitle: String): WorkspaceState {
        journal.rename(cabinetId, newTitle)
        storage.saveCabinetJournal(repository, journal.state)
        return snapshotState()
    }

    fun deleteCabinet(cabinetId: String): WorkspaceState {
        journal.remove(cabinetId)
        storage.saveCabinetJournal(repository, journal.state)
        return snapshotState()
    }

    fun undoDeleteCabinet(cabinetId: String): WorkspaceState {
        journal.undoRemove(cabinetId)
        storage.saveCabinetJournal(repository, journal.state)
        return snapshotState()
    }

    fun moveItemsToCabinet(itemIds: Collection<String>, targetCabinetId: String): WorkspaceState {
        journal.moveMany(itemIds, targetCabinetId)
        storage.saveCabinetJournal(repository, journal.state)
        return snapshotState()
    }

    // --- Notebook, Page, and Chapter Operations ---

    fun createNotebook(title: String, description: String, cabinetId: String): Pair<Notebook, WorkspaceState> {
        assertWritable()
        val cleanTitle = CompatibilityCodecs.checkTitle(title)
        val cleanDesc = description.trim()
        require(cleanDesc.length <= 500) { "简介不能超过 500 个字符。" }
        val target = cabinetId.ifBlank { DEFAULT_CABINET_ID }
        require(journal.cabinets.any { it.id == target }) { "目标书柜不存在。" }
        val book = Notebook(
            id = CompatibilityCodecs.newRandomId(),
            title = cleanTitle,
            sha = "",
            description = cleanDesc
        )
        local = local.copy(books = local.books + book)
        storage.saveLocalCollection(repository, local)
        journal.moveMany(listOf(book.id), target)
        storage.saveCabinetJournal(repository, journal.state)
        return book to snapshotState()
    }

    fun createStandalonePage(title: String, cabinetId: String): Pair<Chapter, WorkspaceState> {
        assertWritable()
        val cleanTitle = CompatibilityCodecs.checkTitle(title)
        val target = cabinetId.ifBlank { DEFAULT_CABINET_ID }
        require(journal.cabinets.any { it.id == target }) { "目标书柜不存在。" }
        val pageId = CompatibilityCodecs.pageIdFromTitle(cleanTitle)
        val bookId = CompatibilityCodecs.pageBookId(pageId)
        val book = Notebook(id = bookId, title = cleanTitle, sha = "")
        val chapter = Chapter(bookId = bookId, id = pageId, title = cleanTitle, content = "# $cleanTitle\n\n", sha = "")
        local = local.copy(
            books = local.books + book,
            pageIds = local.pageIds + bookId,
            chapters = local.chapters + chapter
        )
        storage.saveLocalCollection(repository, local)
        journal.moveMany(listOf(bookId), target)
        storage.saveCabinetJournal(repository, journal.state)
        return chapter to snapshotState()
    }

    fun createChapter(bookId: String, title: String): Pair<Chapter, WorkspaceState> {
        assertWritable()
        val cleanTitle = CompatibilityCodecs.checkTitle(title)
        val chapter = Chapter(
            bookId = bookId,
            id = CompatibilityCodecs.newRandomId(),
            title = cleanTitle,
            content = "# $cleanTitle\n\n",
            sha = ""
        )
        local = local.copy(chapters = local.chapters + chapter)
        storage.saveLocalCollection(repository, local)
        return chapter to snapshotState()
    }

    fun addWelcomeNotebookExplicit(): WorkspaceState {
        assertWritable()
        local = WelcomeSeed.seedIfNeeded(local, repository, explicit = true)
        storage.saveLocalCollection(repository, local)
        return snapshotState()
    }

    fun updateNotebookDescription(bookId: String, description: String): WorkspaceState {
        assertWritable()
        val cleanDesc = description.trim()
        require(cleanDesc.length <= 500) { "简介不能超过 500 个字符。" }
        val state = snapshotState()
        val item = state.items.find { it.id == bookId && !it.isPage }
            ?: throw IllegalArgumentException("笔记本不存在。")
        if (item.sha.isEmpty()) {
            local = local.copy(books = local.books.map { if (it.id == bookId) it.copy(description = cleanDesc) else it })
        } else {
            val baseBook = remoteSnapshot?.books?.find { it.id == bookId }
                ?: local.bookMetadataDrafts[bookId]?.base
                ?: throw IllegalStateException("本机缺少原始笔记本内容，请先恢复后再修改简介。")
            if (baseBook.indexContent == null) {
                throw IllegalStateException("本机缺少原始笔记本内容，请先恢复后再修改简介。")
            }
            val currentDraft = local.bookMetadataDrafts[bookId]
            val order = currentDraft?.chapterOrder
            val nextDrafts = local.bookMetadataDrafts.toMutableMap()
            if (cleanDesc == baseBook.description.orEmpty() && (order == null || order == baseBook.chapterOrder)) {
                nextDrafts.remove(bookId)
            } else {
                nextDrafts[bookId] = BookMetadataDraft(base = baseBook, description = cleanDesc, chapterOrder = order)
            }
            local = local.copy(bookMetadataDrafts = nextDrafts)
        }
        storage.saveLocalCollection(repository, local)
        return snapshotState()
    }

    fun reorderChapters(bookId: String, orderedIds: List<String>): WorkspaceState {
        assertWritable()
        val state = snapshotState()
        val item = state.items.find { it.id == bookId && !it.isPage }
            ?: throw IllegalArgumentException("笔记本不存在。")
        val currentChapters = state.chaptersByBook[bookId].orEmpty()
        if (orderedIds.size != currentChapters.size || orderedIds.toSet() != currentChapters.map { it.id }.toSet()) {
            throw IllegalArgumentException("章节列表已发生变化，请重新排序。")
        }
        val prevOrder = item.chapterOrder.orEmpty()
        val fullOrder = CompatibilityCodecs.validateChapterOrder(
            orderedIds + prevOrder.filter { it !in orderedIds }
        )
        if (item.sha.isEmpty()) {
            local = local.copy(books = local.books.map { if (it.id == bookId) it.copy(chapterOrder = fullOrder) else it })
        } else {
            val baseBook = remoteSnapshot?.books?.find { it.id == bookId }
                ?: local.bookMetadataDrafts[bookId]?.base
                ?: throw IllegalStateException("本机缺少原始笔记本内容，请先恢复后再调整顺序。")
            if (baseBook.indexContent == null) {
                throw IllegalStateException("本机缺少原始笔记本内容，请先恢复后再调整顺序。")
            }
            val currentDraft = local.bookMetadataDrafts[bookId]
            val desc = currentDraft?.description ?: baseBook.description.orEmpty()
            val nextDrafts = local.bookMetadataDrafts.toMutableMap()
            if (fullOrder == baseBook.chapterOrder && desc == baseBook.description.orEmpty()) {
                nextDrafts.remove(bookId)
            } else {
                nextDrafts[bookId] = BookMetadataDraft(base = baseBook, description = desc, chapterOrder = fullOrder)
            }
            local = local.copy(bookMetadataDrafts = nextDrafts)
        }
        storage.saveLocalCollection(repository, local)
        return snapshotState()
    }

    // --- Drafts & Editor Content ---

    fun getChapterContent(bookId: String, chapterId: String): Pair<Chapter, String>? {
        val key = chapterKey(bookId, chapterId)
        val draft = drafts[key]
        if (draft != null) return draft.base to draft.content
        val state = snapshotState()
        val ch = state.chaptersByBook[bookId]?.find { it.id == chapterId } ?: return null
        return ch to ch.content
    }

    fun saveDraft(baseChapter: Chapter, content: String): WorkspaceState {
        val key = chapterKey(baseChapter.bookId, baseChapter.id)
        if (baseChapter.sha.isEmpty()) {
            // Update unsynced local chapter content directly and clear separate draft if identical
            val updatedTitle = CompatibilityCodecs.titleFromMarkdown(content, baseChapter.title)
            local = local.copy(
                chapters = local.chapters.map {
                    if (it.bookId == baseChapter.bookId && it.id == baseChapter.id) {
                        it.copy(content = content, title = updatedTitle)
                    } else it
                },
                books = if (baseChapter.bookId in local.pageIds) {
                    local.books.map { if (it.id == baseChapter.bookId) it.copy(title = updatedTitle) else it }
                } else local.books
            )
            storage.saveLocalCollection(repository, local)
            if (drafts.remove(key) != null) storage.saveDrafts(repository, drafts)
        } else {
            if (content == baseChapter.content) {
                if (drafts.remove(key) != null) storage.saveDrafts(repository, drafts)
            } else {
                drafts[key] = ChapterDraft(base = baseChapter, content = content)
                storage.saveDrafts(repository, drafts)
            }
        }
        return snapshotState()
    }

    fun saveNewImageAttachment(bookId: String?, mime: String, bytes: ByteArray): String {
        val path = AttachmentPolicy.newAttachmentPath(bookId, mime)
        attachments.putAttachment(repository, NoteAttachment(path = path, bytes = bytes))
        return "assets/${path.substringAfterLast('/')}"
    }

    // --- Import & Repair ---

    fun applyImport(scan: ScanImportResult, targetCabinetId: String, targetNotebookId: String?): Pair<PlannedImportOutput, WorkspaceState> {
        assertWritable()
        val planned = ImportEngine.planImport(scan, targetNotebookId)
        for (att in planned.attachments) {
            attachments.putAttachment(repository, att)
        }
        local = local.copy(
            books = local.books + planned.addedBooks,
            pageIds = local.pageIds + planned.addedPageIds,
            chapters = local.chapters + planned.addedChapters
        )
        storage.saveLocalCollection(repository, local)
        if (planned.addedBooks.isNotEmpty()) {
            val target = targetCabinetId.ifBlank { DEFAULT_CABINET_ID }
            journal.moveMany(planned.addedBooks.map { it.id }, target)
            storage.saveCabinetJournal(repository, journal.state)
        }
        return planned to snapshotState()
    }

    fun applyImageRepair(
        baseChapter: Chapter,
        currentContent: String,
        scan: ScanImportResult
    ): Pair<PlannedImageRepair, WorkspaceState> {
        val assetBookId = if (isPageItem(baseChapter.bookId)) null else baseChapter.bookId
        val planned = ImportEngine.planImageRepair(
            scan = scan,
            currentTitle = baseChapter.title,
            currentContent = currentContent,
            assetBookId = assetBookId
        )
        for (att in planned.attachments) {
            attachments.putAttachment(repository, att)
        }
        val state = saveDraft(baseChapter, planned.repairedContent)
        return planned to state
    }

    // --- Deletion (Local-only vs Remote Atomic Deletion) ---

    suspend fun deleteItems(itemIds: Collection<String>): WorkspaceState {
        assertWritable()
        val state = snapshotState()
        val targets = state.items.filter { it.id in itemIds }
        if (targets.isEmpty()) return state

        val remoteBooksToDelete = mutableListOf<BookDeletion>()
        val remotePagesToDelete = mutableListOf<Page>()
        for (item in targets) {
            if (item.sha.isEmpty()) continue
            if (item.isPage) {
                val p = remoteSnapshot?.pages?.find { it.id == item.pageId }
                    ?: throw IllegalStateException("缺少远端书页版本，请先恢复后再删除。")
                remotePagesToDelete.add(p)
            } else {
                val b = remoteSnapshot?.books?.find { it.id == item.id }
                    ?: throw IllegalStateException("缺少远端笔记本版本，请先恢复后再删除。")
                val remoteChs = remoteSnapshot?.chapters?.get(item.id).orEmpty()
                remoteBooksToDelete.add(BookDeletion(b, remoteChs))
            }
        }

        if (remoteBooksToDelete.isNotEmpty() || remotePagesToDelete.isNotEmpty()) {
            val activeClient = client ?: throw NotebookStoreException(
                StoreErrorCode.AUTH,
                "删除已同步的笔记需要先连接 GitHub。"
            )
            val result = activeClient.deleteBatch(
                books = remoteBooksToDelete,
                chapters = emptyList(),
                pages = remotePagesToDelete
            )
            updateSnapshotAfterCommit(
                parent = result.parent,
                head = result.head,
                deletedBookIds = remoteBooksToDelete.map { it.book.id }.toSet(),
                deletedPageIds = remotePagesToDelete.map { it.id }.toSet(),
                catalog = result.catalog
            )
            if (result.catalog != null) journal.setLatestBase(result.catalog)
        }

        val removeSet = itemIds.toSet()
        local = local.copy(
            books = local.books.filterNot { it.id in removeSet },
            pageIds = local.pageIds - removeSet,
            chapters = local.chapters.filterNot { it.bookId in removeSet },
            bookMetadataDrafts = local.bookMetadataDrafts.filterKeys { it !in removeSet }
        )
        drafts.entries.removeAll { it.value.base.bookId in removeSet }
        journal.discardMoves(removeSet)
        storage.saveLocalCollection(repository, local)
        storage.saveDrafts(repository, drafts)
        storage.saveCabinetJournal(repository, journal.state)
        return snapshotState()
    }

    suspend fun deleteChapters(bookId: String, chapterIds: Collection<String>): WorkspaceState {
        assertWritable()
        val state = snapshotState()
        val targets = state.chaptersByBook[bookId].orEmpty().filter { it.id in chapterIds }
        if (targets.isEmpty()) return state

        val remoteTargets = targets.filter { it.sha.isNotEmpty() }
        if (remoteTargets.isNotEmpty()) {
            val activeClient = client ?: throw NotebookStoreException(
                StoreErrorCode.AUTH,
                "删除已同步章节需要先连接 GitHub。"
            )
            val result = activeClient.deleteBatch(
                books = emptyList(),
                chapters = remoteTargets,
                pages = emptyList()
            )
            updateSnapshotAfterCommit(
                parent = result.parent,
                head = result.head,
                deletedChapters = remoteTargets
            )
        }

        val keys = targets.map { chapterKey(it.bookId, it.id) }.toSet()
        local = local.copy(chapters = local.chapters.filterNot { chapterKey(it.bookId, it.id) in keys })
        keys.forEach { drafts.remove(it) }
        storage.saveLocalCollection(repository, local)
        storage.saveDrafts(repository, drafts)
        return snapshotState()
    }

    // --- GitHub Connection, Restore, Sync & Conflict Resolution ---

    suspend fun connectRepository(
        rawRepo: String,
        rawToken: String,
        importUnboundLocal: Boolean = false
    ): WorkspaceState {
        val canonical = RepositoryIdentity.normalizeRepository(rawRepo)
        val cleanToken = rawToken.trim()
        if (cleanToken.isEmpty()) throw IllegalArgumentException("请输入 GitHub 令牌。")

        val candidate = clientFactory(canonical, cleanToken)
        candidate.verifyRepository()
        candidate.readHead()

        if (importUnboundLocal && repository.isEmpty() && storage.hasUserData("")) {
            copyUnboundWorkspaceToRepo(canonical, candidate)
        }

        tokenStore.saveToken(canonical, cleanToken)
        repository = canonical
        settings = settings.copy(configuredRepository = canonical)
        storage.saveSettings(settings)
        loadActiveWorkspace()
        return snapshotState()
    }

    private suspend fun copyUnboundWorkspaceToRepo(targetRepo: String, candidate: GitHubNotebookClient) {
        val (unboundLocal, damaged) = storage.loadLocalCollection("")
        if (damaged) throw IllegalStateException("未关联工作区数据损坏，无法复制。")
        val unboundDrafts = storage.loadDrafts("")
        val unboundJournal = storage.loadCabinetJournal("")

        // Pristine welcome deduplication against remote repo!
        val remoteBooks = try { candidate.listNotebooks() } catch (_: Exception) { null }
        val remoteChaps = if (remoteBooks != null) {
            try {
                remoteBooks.associate { it.id to candidate.listChapters(it.id) }
            } catch (_: Exception) { null }
        } else null

        val duplicate = if (remoteBooks != null && remoteChaps != null) {
            WelcomeSeed.findPristineDuplicate(unboundLocal, unboundDrafts, unboundJournal, remoteBooks, remoteChaps)
        } else null

        val cleanedLocal = if (duplicate != null) {
            unboundLocal.copy(
                books = unboundLocal.books.filterNot { it.id == duplicate.first },
                chapters = unboundLocal.chapters.filterNot { it.bookId == duplicate.first },
                welcomeBookId = duplicate.second
            )
        } else unboundLocal

        // Copy all referenced attachments before copying Markdown
        val paths = LinkedHashSet<String>()
        for (ch in cleanedLocal.chapters) {
            val bId = if (ch.bookId in cleanedLocal.pageIds) null else ch.bookId
            AttachmentPolicy.extractAttachmentReferences(ch.content, bId).forEach { paths.add(it.path) }
        }
        for (d in unboundDrafts.values) {
            val bId = if (d.base.bookId in cleanedLocal.pageIds) null else d.base.bookId
            AttachmentPolicy.extractAttachmentReferences(d.content, bId).forEach { paths.add(it.path) }
        }
        for (path in paths) {
            val orig = attachments.getAttachment("", path)
                ?: throw IllegalStateException("本机有图片附件缺失，未复制笔记。")
            attachments.putAttachment(targetRepo, orig)
        }

        val (existingTarget, _) = storage.loadLocalCollection(targetRepo)
        val mergedBooks = (existingTarget.books + cleanedLocal.books).distinctBy { it.id }
        val mergedChapters = (existingTarget.chapters + cleanedLocal.chapters).distinctBy { chapterKey(it.bookId, it.id) }
        storage.saveLocalCollection(
            targetRepo,
            existingTarget.copy(
                books = mergedBooks,
                pageIds = existingTarget.pageIds + cleanedLocal.pageIds,
                chapters = mergedChapters,
                welcomeInitialized = existingTarget.welcomeInitialized || cleanedLocal.welcomeInitialized,
                welcomeBookId = existingTarget.welcomeBookId.ifEmpty { cleanedLocal.welcomeBookId }
            )
        )
        val mergedDrafts = storage.loadDrafts(targetRepo) + unboundDrafts
        storage.saveDrafts(targetRepo, mergedDrafts)
    }

    fun disconnectRepository(): WorkspaceState {
        if (repository.isNotBlank()) {
            tokenStore.clearToken(repository)
        }
        client?.clearToken()
        client = null
        connected = false
        return snapshotState()
    }

    fun switchToLocalOfflineWorkspace(): WorkspaceState {
        repository = ""
        settings = settings.copy(configuredRepository = "")
        storage.saveSettings(settings)
        loadActiveWorkspace()
        return snapshotState()
    }

    /**
     * Restore: download complete remote revision (cabinets, books, chapters, pages, attachments)
     * as offline local copy while preserving ALL unsynchronized local drafts & cabinet journal edits!
     */
    suspend fun restoreFromGitHub(): Pair<Int, WorkspaceState> {
        val activeClient = client ?: throw NotebookStoreException(
            StoreErrorCode.AUTH,
            "请先连接 GitHub 仓库，再恢复笔记。"
        )
        val (snap, downloadedImages) = activeClient.restoreFullSnapshot(attachments)
        storage.saveRemoteSnapshot(repository, snap)
        remoteSnapshot = snap
        journal.setLatestBase(snap.catalog)
        storage.saveCabinetJournal(repository, journal.state)
        return downloadedImages to snapshotState()
    }

    /**
     * Sync selected pending keys atomically to GitHub.
     * On SHA mismatch conflict, fetches remote content and returns SyncConflict for user decision.
     */
    sealed class SyncOutcome {
        data class Success(val syncedCount: Int, val state: WorkspaceState) : SyncOutcome()
        data class Conflict(val conflict: SyncConflict) : SyncOutcome()
    }

    suspend fun syncSelected(selectedKeys: Set<String>): SyncOutcome {
        assertWritable()
        val activeClient = client ?: throw NotebookStoreException(
            StoreErrorCode.AUTH,
            "请先连接 GitHub 仓库，再提交本机改动。"
        )
        if (selectedKeys.isEmpty()) {
            throw IllegalArgumentException("请先勾选要同步的项目。")
        }

        val includeCatalog = "catalog" in selectedKeys
        val requestedBookIds = selectedKeys.filter { it.startsWith("book:") }.map { it.removePrefix("book:") }.toSet()
        val chapterKeys = selectedKeys.filter { '/' in it }.toSet()

        // Collect selected chapters & pages
        val selectedChapters = mutableListOf<Chapter>()
        val selectedPages = mutableListOf<Page>()
        val touchedBookIds = LinkedHashSet<String>(requestedBookIds)

        val candidateChapters = LinkedHashMap<String, Chapter>()
        for (ch in local.chapters) {
            if (ch.sha.isEmpty()) candidateChapters[chapterKey(ch.bookId, ch.id)] = ch
        }
        for ((k, d) in drafts) {
            candidateChapters[k] = d.base.copy(content = d.content)
        }

        for (key in chapterKeys) {
            val ch = candidateChapters[key] ?: continue
            touchedBookIds.add(ch.bookId)
            if (isPageItem(ch.bookId)) {
                selectedPages.add(
                    Page(
                        id = CompatibilityCodecs.extractPageId(ch.bookId),
                        title = CompatibilityCodecs.titleFromMarkdown(ch.content, ch.title),
                        content = ch.content,
                        sha = ch.sha
                    )
                )
            } else {
                selectedChapters.add(ch)
            }
        }

        // Include any new unsynced parent notebooks required by selected chapters
        val newBooks = local.books.filter { b ->
            b.sha.isEmpty() && b.id !in local.pageIds && b.id in touchedBookIds
        }
        val metaBooks = requestedBookIds.mapNotNull { id ->
            val d = local.bookMetadataDrafts[id] ?: return@mapNotNull null
            d.base.copy(description = d.description, chapterOrder = d.chapterOrder)
        }

        val cabinetIds = if (includeCatalog) {
            (journal.state.created.keys + journal.state.removed.keys + journal.state.renamed.keys).toSet()
        } else emptySet()
        val moveBookIds = if (includeCatalog) {
            (journal.state.moves.keys + touchedBookIds).toSet()
        } else touchedBookIds

        val catalogChange = journal.prepare(moveBookIds, cabinetIds)
        storage.saveCabinetJournal(repository, journal.state)

        // Collect all referenced attachments for chapters & pages being synced
        val imagePaths = LinkedHashSet<String>()
        for (ch in selectedChapters) {
            AttachmentPolicy.extractAttachmentReferences(ch.content, ch.bookId).forEach { imagePaths.add(it.path) }
        }
        for (p in selectedPages) {
            AttachmentPolicy.extractAttachmentReferences(p.content, null).forEach { imagePaths.add(it.path) }
        }
        val imagesToUpload = mutableListOf<NoteAttachment>()
        for (path in imagePaths) {
            val localImg = attachments.getAttachment(repository, path)
                ?: try {
                    activeClient.readAttachment(path).also { attachments.putAttachment(repository, it) }
                } catch (_: Exception) {
                    null
                }
                ?: throw IllegalStateException("笔记引用的图片附件缺失（$path），未提交；请先补图或恢复图片。")
            imagesToUpload.add(localImg)
        }

        return try {
            val result = activeClient.syncBatch(
                books = newBooks + metaBooks,
                chapters = selectedChapters,
                catalogChange = catalogChange,
                pages = selectedPages,
                attachments = imagesToUpload
            )

            if (result.catalog != null) {
                journal.acknowledge(result.catalog)
                storage.saveCabinetJournal(repository, journal.state)
            } else if (catalogChange != null) {
                journal.fail()
            }

            // Update local records & drafts atomically
            val syncedBooksById = result.books.associateBy { it.id }
            val syncedPageBookIds = result.pages.map { CompatibilityCodecs.pageBookId(it.id) }.toSet()
            val nextMetaDrafts = local.bookMetadataDrafts.toMutableMap()
            for (b in result.books) nextMetaDrafts.remove(b.id)

            val syncedChapterKeys = (result.chapters.map { chapterKey(it.bookId, it.id) } +
                result.pages.map { chapterKey(CompatibilityCodecs.pageBookId(it.id), it.id) }).toSet()

            local = local.copy(
                books = local.books.filterNot { it.id in syncedBooksById || it.id in syncedPageBookIds },
                pageIds = local.pageIds - syncedPageBookIds,
                chapters = local.chapters.filterNot { chapterKey(it.bookId, it.id) in syncedChapterKeys },
                bookMetadataDrafts = nextMetaDrafts
            )
            syncedChapterKeys.forEach { drafts.remove(it) }

            updateSnapshotAfterCommit(
                parent = result.parent,
                head = result.head,
                books = result.books,
                chapters = result.chapters,
                pages = result.pages,
                catalog = result.catalog
            )
            storage.saveLocalCollection(repository, local)
            storage.saveDrafts(repository, drafts)

            val count = result.books.size + result.chapters.size + result.pages.size + if (result.catalog != null) 1 else 0
            SyncOutcome.Success(count, snapshotState())
        } catch (e: NotebookStoreException) {
            journal.fail()
            if (e.code == StoreErrorCode.CONFLICT) {
                val conflict = buildConflictDetails(activeClient, e, selectedChapters, selectedPages, metaBooks + newBooks)
                return SyncOutcome.Conflict(conflict)
            }
            throw e
        } catch (e: Exception) {
            journal.fail()
            throw e
        }
    }

    private suspend fun buildConflictDetails(
        activeClient: GitHubNotebookClient,
        error: NotebookStoreException,
        chapters: List<Chapter>,
        pages: List<Page>,
        books: List<Notebook>
    ): SyncConflict {
        val path = error.conflictPath.orEmpty()
        val chapMatch = Regex("^docs/notebooks/([^/]+)/([^/]+)\\.md$").matchEntire(path)
        if (chapMatch != null) {
            val bookId = chapMatch.groupValues[1]
            val chapId = chapMatch.groupValues[2]
            if (chapId == "index") {
                val localBook = books.find { it.id == bookId }
                val remoteBook = try { activeClient.readNotebook(bookId) } catch (_: Exception) { null }
                return SyncConflict(
                    kind = ConflictKind.NOTEBOOK_INDEX,
                    path = path,
                    title = localBook?.title ?: remoteBook?.title ?: bookId,
                    bookId = bookId,
                    chapterId = null,
                    isPage = false,
                    localContent = localBook?.let {
                        val orig = it.indexContent ?: "# ${it.title}\n"
                        CompatibilityCodecs.writeNotebookChapterOrder(
                            CompatibilityCodecs.writeNotebookDescription(orig, it.description.orEmpty()),
                            it.chapterOrder
                        )
                    }.orEmpty(),
                    remoteContent = remoteBook?.indexContent.orEmpty(),
                    remoteSha = remoteBook?.sha ?: error.remoteSha.orEmpty(),
                    remoteTitle = remoteBook?.title ?: bookId,
                    detail = error.message
                )
            } else {
                val localCh = chapters.find { it.bookId == bookId && it.id == chapId }
                val remoteCh = try { activeClient.readChapter(bookId, chapId) } catch (_: Exception) { null }
                return SyncConflict(
                    kind = ConflictKind.CHAPTER_OR_PAGE,
                    path = path,
                    title = localCh?.title ?: remoteCh?.title ?: chapId,
                    bookId = bookId,
                    chapterId = chapId,
                    isPage = false,
                    localContent = localCh?.content.orEmpty(),
                    remoteContent = remoteCh?.content.orEmpty(),
                    remoteSha = remoteCh?.sha ?: error.remoteSha.orEmpty(),
                    remoteTitle = remoteCh?.title ?: chapId,
                    detail = error.message
                )
            }
        }
        val pageMatch = Regex("^docs/pages/([^/]+)\\.md$").matchEntire(path)
        if (pageMatch != null) {
            val pId = pageMatch.groupValues[1]
            val localP = pages.find { it.id == pId }
            val remoteP = try { activeClient.readPage(pId) } catch (_: Exception) { null }
            return SyncConflict(
                kind = ConflictKind.CHAPTER_OR_PAGE,
                path = path,
                title = localP?.title ?: remoteP?.title ?: pId,
                bookId = CompatibilityCodecs.pageBookId(pId),
                chapterId = pId,
                isPage = true,
                localContent = localP?.content.orEmpty(),
                remoteContent = remoteP?.content.orEmpty(),
                remoteSha = remoteP?.sha ?: error.remoteSha.orEmpty(),
                remoteTitle = remoteP?.title ?: pId,
                detail = error.message
            )
        }
        if (path == "docs/cabinets.json") {
            val remoteCat = try { activeClient.readCatalog() } catch (_: Exception) { null }
            return SyncConflict(
                kind = ConflictKind.CATALOG,
                path = path,
                title = "书柜目录 (docs/cabinets.json)",
                bookId = null,
                chapterId = null,
                isPage = false,
                localContent = CompatibilityCodecs.serializeCatalog(
                    CabinetCatalog(2, journal.cabinets, journal.base.catalog.assignments)
                ),
                remoteContent = remoteCat?.let { CompatibilityCodecs.serializeCatalog(it.catalog) }.orEmpty(),
                remoteSha = remoteCat?.sha ?: error.remoteSha.orEmpty(),
                remoteTitle = "书柜目录",
                detail = error.message
            )
        }
        return SyncConflict(
            kind = ConflictKind.OTHER,
            path = path,
            title = path.ifEmpty { "同步冲突" },
            bookId = null,
            chapterId = null,
            isPage = false,
            localContent = "",
            remoteContent = "",
            remoteSha = error.remoteSha.orEmpty(),
            remoteTitle = "",
            detail = error.message
        )
    }

    /**
     * Resolve a detected conflict explicitly according to the user's choice.
     */
    suspend fun resolveConflict(conflict: SyncConflict, resolution: ConflictResolution): WorkspaceState {
        when (conflict.kind) {
            ConflictKind.CHAPTER_OR_PAGE -> {
                val bookId = conflict.bookId ?: return snapshotState()
                val chapterId = conflict.chapterId ?: return snapshotState()
                val key = chapterKey(bookId, chapterId)
                val remoteChapter = Chapter(
                    bookId = bookId,
                    id = chapterId,
                    title = conflict.remoteTitle.ifEmpty { conflict.title },
                    content = conflict.remoteContent,
                    sha = conflict.remoteSha
                )
                when (resolution) {
                    ConflictResolution.KEEP_LOCAL_REBASE_REMOTE -> {
                        // Adopt remote SHA as new base while keeping local edited content intact
                        drafts[key] = ChapterDraft(base = remoteChapter, content = conflict.localContent)
                        storage.saveDrafts(repository, drafts)
                    }
                    ConflictResolution.USE_REMOTE_DISCARD_LOCAL -> {
                        drafts.remove(key)
                        local = local.copy(chapters = local.chapters.filterNot { chapterKey(it.bookId, it.id) == key })
                        storage.saveDrafts(repository, drafts)
                        storage.saveLocalCollection(repository, local)
                        applyRemoteChapterToSnapshot(remoteChapter, conflict.isPage)
                    }
                    ConflictResolution.SAVE_LOCAL_AS_COPY_AND_USE_REMOTE -> {
                        // Save local copy as a brand-new chapter or standalone page, then adopt remote
                        val copyTitle = "${conflict.title}（冲突副本）"
                        if (conflict.isPage) {
                            val newPageId = CompatibilityCodecs.pageIdFromTitle(copyTitle)
                            val newBookId = CompatibilityCodecs.pageBookId(newPageId)
                            local = local.copy(
                                books = local.books + Notebook(id = newBookId, title = copyTitle, sha = ""),
                                pageIds = local.pageIds + newBookId,
                                chapters = local.chapters + Chapter(newBookId, newPageId, copyTitle, conflict.localContent, "")
                            )
                        } else {
                            val newChapterId = CompatibilityCodecs.newRandomId()
                            local = local.copy(
                                chapters = local.chapters + Chapter(bookId, newChapterId, copyTitle, conflict.localContent, "")
                            )
                        }
                        drafts.remove(key)
                        storage.saveLocalCollection(repository, local)
                        storage.saveDrafts(repository, drafts)
                        applyRemoteChapterToSnapshot(remoteChapter, conflict.isPage)
                    }
                }
            }
            ConflictKind.NOTEBOOK_INDEX, ConflictKind.CATALOG, ConflictKind.OTHER -> {
                if (resolution == ConflictResolution.USE_REMOTE_DISCARD_LOCAL) {
                    if (conflict.bookId != null) {
                        local = local.copy(bookMetadataDrafts = local.bookMetadataDrafts - conflict.bookId)
                        storage.saveLocalCollection(repository, local)
                    }
                    restoreFromGitHub()
                } else {
                    // Refresh remote base (head/catalog/index) so user can re-apply or re-submit safely
                    restoreFromGitHub()
                }
            }
        }
        return snapshotState()
    }

    private fun applyRemoteChapterToSnapshot(remoteChapter: Chapter, isPage: Boolean) {
        val snap = remoteSnapshot ?: return
        val next = if (isPage) {
            val p = Page(
                id = CompatibilityCodecs.extractPageId(remoteChapter.bookId),
                title = remoteChapter.title,
                content = remoteChapter.content,
                sha = remoteChapter.sha
            )
            val pages = snap.pages.filterNot { it.id == p.id } + p
            snap.copy(pages = pages, stale = true)
        } else {
            val map = snap.chapters.toMutableMap()
            val list = map[remoteChapter.bookId].orEmpty().filterNot { it.id == remoteChapter.id } + remoteChapter
            map[remoteChapter.bookId] = list
            snap.copy(chapters = map, stale = true)
        }
        remoteSnapshot = next
        storage.saveRemoteSnapshot(repository, next)
    }

    private fun updateSnapshotAfterCommit(
        parent: String,
        head: String,
        books: List<Notebook> = emptyList(),
        chapters: List<Chapter> = emptyList(),
        pages: List<Page> = emptyList(),
        deletedBookIds: Set<String> = emptySet(),
        deletedPageIds: Set<String> = emptySet(),
        deletedChapters: List<Chapter> = emptyList(),
        catalog: CatalogVersion? = null
    ) {
        val prev = remoteSnapshot ?: RemoteSnapshot(
            head = head,
            books = emptyList(),
            chapters = emptyMap(),
            pages = emptyList(),
            catalog = catalog ?: journal.base,
            stale = true
        )
        val sameRev = prev.head == parent && !prev.stale
        val removedChapKeys = deletedChapters.map { chapterKey(it.bookId, it.id) }.toSet()

        val nextBooks = prev.books.filterNot { it.id in deletedBookIds }.toMutableList()
        val nextChapters = prev.chapters
            .filterKeys { it !in deletedBookIds }
            .mapValues { (_, list) -> list.filterNot { chapterKey(it.bookId, it.id) in removedChapKeys }.toMutableList() }
            .toMutableMap()

        for (b in books) {
            val idx = nextBooks.indexOfFirst { it.id == b.id }
            if (idx < 0) {
                nextBooks.add(b)
                nextChapters.putIfAbsent(b.id, mutableListOf())
            } else {
                nextBooks[idx] = b
            }
        }
        var complete = sameRev
        for (ch in chapters) {
            val list = nextChapters[ch.bookId]
            if (list == null) {
                nextChapters[ch.bookId] = mutableListOf(ch)
                complete = false
            } else {
                val idx = list.indexOfFirst { it.id == ch.id }
                if (idx < 0) list.add(ch) else list[idx] = ch
            }
        }
        val nextPages = prev.pages.filterNot { it.id in deletedPageIds }.toMutableList()
        for (p in pages) {
            val idx = nextPages.indexOfFirst { it.id == p.id }
            if (idx < 0) nextPages.add(p) else nextPages[idx] = p
        }

        val updated = RemoteSnapshot(
            head = if (complete) head else prev.head,
            books = nextBooks,
            chapters = nextChapters,
            pages = nextPages,
            catalog = catalog ?: prev.catalog,
            stale = !complete
        )
        remoteSnapshot = updated
        storage.saveRemoteSnapshot(repository, updated)
    }

    /** Download a single remote attachment on demand if connected and missing locally. */
    suspend fun ensureAttachmentLocal(managedPath: String): NoteAttachment? {
        attachments.getAttachment(repository, managedPath)?.let { return it }
        val activeClient = client ?: return null
        return try {
            val remote = activeClient.readAttachment(managedPath)
            attachments.putAttachment(repository, remote)
            remote
        } catch (_: Exception) {
            null
        }
    }
}
