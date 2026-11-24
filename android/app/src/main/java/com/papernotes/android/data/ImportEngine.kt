package com.papernotes.android.data

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

enum class SkipReason(val label: String) {
    NOT_MARKDOWN("非 Markdown 文件"),
    TOO_LARGE("文件超过大小限制"),
    TOO_MANY("文件数量超过上限"),
    INVALID_UTF8("不是有效的 UTF-8 文本"),
    READ_ERROR("读取失败"),
    UNSUPPORTED("不支持的项目类型"),
    INVALID_PATH("路径非法或越界"),
    INVALID_IMAGE("图片格式不支持或内容损坏"),
    AMBIGUOUS("存在同名歧义文件")
}

data class ImportSourceEntry(
    val relativePath: String,
    val name: String,
    val sizeBytes: Long,
    val readBytes: () -> ByteArray
)

data class ImportedMarkdownDoc(
    val path: String,
    val name: String,
    val content: String
)

data class ImportedSkip(
    val path: String,
    val reason: SkipReason
)

data class LocalResourceRef(
    val markdownPath: String,
    val target: String
)

data class ResolvedImageAsset(
    val path: String,
    val bytes: ByteArray,
    val references: List<LocalResourceRef>
)

data class ScanImportResult(
    val files: List<ImportedMarkdownDoc>,
    val folders: List<String>,
    val skipped: List<ImportedSkip>,
    val unresolvedResources: List<LocalResourceRef>,
    val images: List<ResolvedImageAsset>
)

data class PlannedImportOutput(
    val addedBooks: List<Notebook>,
    val addedPageIds: Set<String>,
    val addedChapters: List<Chapter>,
    val attachments: List<NoteAttachment>,
    val skipped: List<ImportedSkip>,
    val unresolvedCount: Int
)

data class PlannedImageRepair(
    val sourceMarkdownPath: String,
    val repairedContent: String,
    val attachments: List<NoteAttachment>,
    val remainingUnresolved: Int,
    val skipped: List<ImportedSkip>
)

/**
 * Pure, framework-independent Markdown & folder import / image repair engine.
 * Mirrors docs/.vitepress/theme/{readDroppedMarkdown,rewriteImportedImages}.ts and NotebookDesk.vue.
 */
object ImportEngine {

    fun scanEntries(
        entries: List<ImportSourceEntry>,
        rootFolderNames: List<String> = emptyList()
    ): ScanImportResult {
        val docs = mutableListOf<ImportedMarkdownDoc>()
        val folders = LinkedHashSet<String>()
        val skipped = mutableListOf<ImportedSkip>()
        val imageHandles = LinkedHashMap<String, ImportSourceEntry?>()
        val imageRefs = mutableListOf<LocalResourceRef>()
        val allLocalRefs = mutableListOf<LocalResourceRef>()

        fun addFolder(name: String) {
            if (AttachmentPolicy.isValidInputPath(name) && '/' !in name) folders.add(name)
        }
        rootFolderNames.forEach(::addFolder)

        var totalMdBytes = 0L
        for (entry in entries) {
            val path = entry.relativePath
            if (!AttachmentPolicy.isValidInputPath(path)) {
                skipped.add(ImportedSkip(path, SkipReason.INVALID_PATH))
                continue
            }
            if ('/' in path) addFolder(path.substringBefore('/'))

            if (Regex("\\.(?:png|jpe?g|gif|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(entry.name)) {
                imageHandles[path] = if (path in imageHandles) null else entry
                continue
            }
            if (!entry.name.endsWith(".md", ignoreCase = true)) {
                skipped.add(ImportedSkip(path, SkipReason.NOT_MARKDOWN))
                continue
            }
            if (docs.size >= AttachmentPolicy.MAX_IMPORT_FILES) {
                skipped.add(ImportedSkip(path, SkipReason.TOO_MANY))
                continue
            }
            if (entry.sizeBytes > AttachmentPolicy.MAX_IMPORT_FILE_BYTES ||
                totalMdBytes + entry.sizeBytes > AttachmentPolicy.MAX_IMPORT_TOTAL_MD_BYTES
            ) {
                skipped.add(ImportedSkip(path, SkipReason.TOO_LARGE))
                continue
            }
            totalMdBytes += entry.sizeBytes.coerceAtLeast(0L)

            val rawBytes = try {
                entry.readBytes()
            } catch (_: Exception) {
                skipped.add(ImportedSkip(path, SkipReason.READ_ERROR))
                continue
            }
            if (rawBytes.size > AttachmentPolicy.MAX_IMPORT_FILE_BYTES) {
                skipped.add(ImportedSkip(path, SkipReason.TOO_LARGE))
                continue
            }
            val text = try {
                val decoder = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                decoder.decode(ByteBuffer.wrap(rawBytes)).toString().removePrefix("\uFEFF")
            } catch (_: Exception) {
                skipped.add(ImportedSkip(path, SkipReason.INVALID_UTF8))
                continue
            }
            docs.add(ImportedMarkdownDoc(path = path, name = entry.name, content = text))
            for (target in AttachmentPolicy.extractRelativeImageTargets(text)) {
                val ref = LocalResourceRef(path, target)
                imageRefs.add(ref)
                allLocalRefs.add(ref)
            }
        }

        // Resolve referenced images strictly inside the selected root
        val refsByImagePath = LinkedHashMap<String, MutableList<LocalResourceRef>>()
        for (ref in imageRefs) {
            val resolved = AttachmentPolicy.resolveDroppedImagePath(ref.markdownPath, ref.target)
            if (resolved != null && resolved in imageHandles) {
                refsByImagePath.getOrPut(resolved) { mutableListOf() }.add(ref)
            }
        }

        val resolvedImages = mutableListOf<ResolvedImageAsset>()
        val fulfilled = HashSet<Pair<String, String>>()
        var totalImageBytes = 0L

        for ((imgPath, handle) in imageHandles) {
            val refs = refsByImagePath[imgPath]
            if (refs.isNullOrEmpty()) {
                // Unreferenced image file; keep quiet as skipped non-markdown
                skipped.add(ImportedSkip(imgPath, SkipReason.NOT_MARKDOWN))
                continue
            }
            if (handle == null) {
                skipped.add(ImportedSkip(imgPath, SkipReason.AMBIGUOUS))
                continue
            }
            if (resolvedImages.size >= AttachmentPolicy.MAX_IMPORT_IMAGES) {
                skipped.add(ImportedSkip(imgPath, SkipReason.TOO_MANY))
                continue
            }
            if (handle.sizeBytes <= 0 ||
                handle.sizeBytes > AttachmentPolicy.MAX_ATTACHMENT_BYTES ||
                totalImageBytes + handle.sizeBytes > AttachmentPolicy.MAX_IMPORT_TOTAL_IMAGE_BYTES
            ) {
                skipped.add(ImportedSkip(imgPath, SkipReason.TOO_LARGE))
                continue
            }
            val bytes = try {
                handle.readBytes()
            } catch (_: Exception) {
                skipped.add(ImportedSkip(imgPath, SkipReason.READ_ERROR))
                continue
            }
            if (bytes.isEmpty() ||
                bytes.size > AttachmentPolicy.MAX_ATTACHMENT_BYTES ||
                totalImageBytes + bytes.size > AttachmentPolicy.MAX_IMPORT_TOTAL_IMAGE_BYTES
            ) {
                skipped.add(ImportedSkip(imgPath, SkipReason.TOO_LARGE))
                continue
            }
            if (!AttachmentPolicy.isValidImageBytesForExtension(imgPath, bytes)) {
                skipped.add(ImportedSkip(imgPath, SkipReason.INVALID_IMAGE))
                continue
            }
            totalImageBytes += bytes.size
            resolvedImages.add(ResolvedImageAsset(path = imgPath, bytes = bytes, references = refs))
            refs.forEach { fulfilled.add(it.markdownPath to it.target) }
        }

        val unresolved = allLocalRefs.filter { (it.markdownPath to it.target) !in fulfilled }
        return ScanImportResult(
            files = docs,
            folders = folders.toList(),
            skipped = skipped,
            unresolvedResources = unresolved,
            images = resolvedImages
        )
    }

    private fun rewriteFileImages(
        markdownPath: String,
        content: String,
        assetBookId: String?,
        images: List<ResolvedImageAsset>,
        staged: MutableMap<String, NoteAttachment>,
        knownPaths: MutableMap<String, String>
    ): Pair<String, Int> {
        val targetToAssetRel = LinkedHashMap<String, String>()
        val targetToOriginalPath = LinkedHashMap<String, String>()

        for (img in images) {
            for (ref in img.references) {
                if (ref.markdownPath != markdownPath) continue
                val prev = targetToOriginalPath[ref.target]
                if (prev != null && prev != img.path) {
                    throw IllegalStateException("图片路径存在歧义，未导入笔记；请检查原始文件夹。")
                }
                targetToOriginalPath[ref.target] = img.path
                val key = "${assetBookId.orEmpty()}\u0000${img.path}"
                val managed = knownPaths.getOrPut(key) {
                    val mime = AttachmentPolicy.mimeForFilename(img.path)
                        ?: throw IllegalArgumentException("不支持的图片格式：${img.path}")
                    AttachmentPolicy.newAttachmentPath(assetBookId, mime)
                }
                targetToAssetRel[ref.target] = "assets/${managed.substringAfterLast('/')}"
            }
        }

        val (rewritten, replacedTargets) = AttachmentPolicy.rewriteImportedImages(content, targetToAssetRel)
        for (target in replacedTargets) {
            val origPath = targetToOriginalPath[target] ?: continue
            val img = images.firstOrNull { it.path == origPath } ?: continue
            val managed = knownPaths["${assetBookId.orEmpty()}\u0000$origPath"] ?: continue
            staged[managed] = NoteAttachment(path = managed, bytes = img.bytes)
        }
        val unmatched = targetToAssetRel.size - replacedTargets.size
        return rewritten to unmatched
    }

    /**
     * Plan importing Markdown files / folders into either a target notebook (as chapters)
     * or the cabinet (folders become notebooks; standalone files become pages).
     */
    fun planImport(
        scan: ScanImportResult,
        targetNotebookId: String?
    ): PlannedImportOutput {
        val addedBooks = mutableListOf<Notebook>()
        val addedPageIds = LinkedHashSet<String>()
        val addedChapters = mutableListOf<Chapter>()
        val staged = LinkedHashMap<String, NoteAttachment>()
        val known = LinkedHashMap<String, String>()

        // Ignore pure Typora .assets folders so they never become empty notebooks
        val importFolders = scan.folders.filter { folder ->
            if (scan.files.any { it.path.startsWith("$folder/") }) return@filter true
            val isResourceFolder = folder.endsWith(".assets", ignoreCase = true) ||
                scan.images.any { it.path.startsWith("$folder/") } ||
                scan.skipped.any {
                    it.path.startsWith("$folder/") &&
                        Regex("\\.(?:png|jpe?g|gif|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(it.path)
                }
            !isResourceFolder
        }

        var unmatched = 0
        for (folder in importFolders) {
            val book = Notebook(
                id = CompatibilityCodecs.newRandomId(),
                title = CompatibilityCodecs.safeImportedTitle(folder),
                sha = ""
            )
            addedBooks.add(book)
            for (file in scan.files.filter { it.path.startsWith("$folder/") }) {
                val rel = file.path.removePrefix("$folder/")
                val title = CompatibilityCodecs.safeImportedTitle(rel)
                val (rewritten, miss) = rewriteFileImages(file.path, file.content, book.id, scan.images, staged, known)
                unmatched += miss
                addedChapters.add(
                    Chapter(
                        bookId = book.id,
                        id = CompatibilityCodecs.chapterIdFromTitle(title),
                        title = CompatibilityCodecs.titleFromMarkdown(rewritten, title),
                        content = rewritten,
                        sha = ""
                    )
                )
            }
        }

        val looseFiles = scan.files.filter { file -> importFolders.none { folder -> file.path.startsWith("$folder/") } }
        for (file in looseFiles) {
            val title = CompatibilityCodecs.safeImportedTitle(file.name)
            if (targetNotebookId != null) {
                val (rewritten, miss) = rewriteFileImages(file.path, file.content, targetNotebookId, scan.images, staged, known)
                unmatched += miss
                addedChapters.add(
                    Chapter(
                        bookId = targetNotebookId,
                        id = CompatibilityCodecs.chapterIdFromTitle(title),
                        title = CompatibilityCodecs.titleFromMarkdown(rewritten, title),
                        content = rewritten,
                        sha = ""
                    )
                )
            } else {
                val pId = CompatibilityCodecs.pageIdFromTitle(title)
                val bookId = CompatibilityCodecs.pageBookId(pId)
                val (rewritten, miss) = rewriteFileImages(file.path, file.content, null, scan.images, staged, known)
                unmatched += miss
                val resolvedTitle = CompatibilityCodecs.titleFromMarkdown(rewritten, title)
                addedBooks.add(Notebook(id = bookId, title = resolvedTitle, sha = ""))
                addedPageIds.add(bookId)
                addedChapters.add(
                    Chapter(
                        bookId = bookId,
                        id = pId,
                        title = resolvedTitle,
                        content = rewritten,
                        sha = ""
                    )
                )
            }
        }

        if (addedBooks.isEmpty() && addedChapters.isEmpty()) {
            throw IllegalArgumentException("没有可导入的 Markdown 文件或文件夹。")
        }

        return PlannedImportOutput(
            addedBooks = addedBooks,
            addedPageIds = addedPageIds,
            addedChapters = addedChapters,
            attachments = staged.values.toList(),
            skipped = scan.skipped,
            unresolvedCount = scan.unresolvedResources.size + unmatched
        )
    }

    /**
     * Plan repairing missing images for an already-imported note while preserving all existing edits.
     * Matches NotebookDesk.vue::repairCurrentImages.
     */
    fun planImageRepair(
        scan: ScanImportResult,
        currentTitle: String,
        currentContent: String,
        assetBookId: String?
    ): PlannedImageRepair {
        var matches = scan.files.filter { file ->
            val root = scan.folders.firstOrNull { folder -> file.path.startsWith("$folder/") }
            val candidateTitle = CompatibilityCodecs.safeImportedTitle(
                if (root != null) file.path.removePrefix("$root/") else file.name
            )
            candidateTitle == currentTitle
        }
        if (matches.isEmpty()) {
            val probeDest = "assets/${"0".repeat(32)}.png"
            matches = scan.files.filter { file ->
                val targets = LinkedHashMap<String, String>()
                for (img in scan.images) {
                    for (ref in img.references) {
                        if (ref.markdownPath == file.path) targets[ref.target] = probeDest
                    }
                }
                AttachmentPolicy.rewriteImportedImages(currentContent, targets).second.isNotEmpty()
            }
        }
        if (matches.isEmpty()) {
            throw IllegalArgumentException("原文件夹中未找到与当前笔记匹配的 Markdown 文件，请选择导入时使用的原始文件夹。")
        }
        if (matches.size > 1) {
            throw IllegalArgumentException("原文件夹中有多个同名或候选文件，无法安全确定图片来源。")
        }

        val matched = matches.single()
        val staged = LinkedHashMap<String, NoteAttachment>()
        val (repaired, unmatched) = rewriteFileImages(
            markdownPath = matched.path,
            content = currentContent,
            assetBookId = assetBookId,
            images = scan.images,
            staged = staged,
            knownPaths = LinkedHashMap()
        )
        if (staged.isEmpty() || repaired == currentContent) {
            throw IllegalArgumentException("没有找到可补齐的图片；请检查当前笔记的图片路径和所选原文件夹。")
        }
        val remaining = scan.unresolvedResources.count { it.markdownPath == matched.path } + unmatched
        return PlannedImageRepair(
            sourceMarkdownPath = matched.path,
            repairedContent = repaired,
            attachments = staged.values.toList(),
            remainingUnresolved = remaining,
            skipped = scan.skipped
        )
    }
}
