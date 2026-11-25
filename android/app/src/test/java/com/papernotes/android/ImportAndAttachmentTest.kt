package com.papernotes.android

import com.papernotes.android.data.AttachmentFileStore
import com.papernotes.android.data.AttachmentPolicy
import com.papernotes.android.data.ImportEngine
import com.papernotes.android.data.ImportSourceEntry
import com.papernotes.android.data.NoteAttachment
import com.papernotes.android.data.SkipReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ImportAndAttachmentTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    companion object {
        val SAMPLE_PNG = byteArrayOf(
            0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52
        )
        val SAMPLE_PNG_2 = SAMPLE_PNG + byteArrayOf(1, 2, 3, 4)
        val SAMPLE_JPG = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10)
    }

    @Test
    fun attachmentReferences_ignoresCodeBlocksAndParsesTyporaImgTags() {
        val hex1 = "a".repeat(32)
        val hex2 = "b".repeat(32)
        val hex3 = "c".repeat(32)
        val md = """
            # 图片测试
            ![图1](assets/$hex1.png)
            <img src="assets/$hex2.jpg" alt="缩放图" style="zoom:50%;" />
            ```md
            ![代码块内不计入](assets/$hex3.png)
            ```
            `![行内代码不计入](assets/$hex3.png)`
            <!-- <img src="assets/$hex3.png"> -->
        """.trimIndent()

        val refs = AttachmentPolicy.extractAttachmentReferences(md, "book42")
        assertEquals(2, refs.size)
        assertTrue(refs.any { it.path == "docs/notebooks/book42/assets/$hex1.png" })
        assertTrue(refs.any { it.path == "docs/notebooks/book42/assets/$hex2.jpg" })
    }

    @Test
    fun folderImport_handlesTyporaAssetsPreservesZoomAndBlocksPathTraversal() {
        val mdContent = """
            # 学习笔记
            ![常规图](note.assets/pic%201.png)
            <img src="./note.assets/shot.jpg" style="zoom:67%" width="320" />
            ![越界图](../../secret.png)
            ![缺失图](note.assets/missing.png)
        """.trimIndent()

        val entries = listOf(
            ImportSourceEntry("MyNotes/note.md", "note.md", mdContent.toByteArray().size.toLong()) { mdContent.toByteArray() },
            ImportSourceEntry("MyNotes/note.assets/pic 1.png", "pic 1.png", SAMPLE_PNG.size.toLong()) { SAMPLE_PNG },
            ImportSourceEntry("MyNotes/note.assets/shot.jpg", "shot.jpg", SAMPLE_JPG.size.toLong()) { SAMPLE_JPG },
            ImportSourceEntry("MyNotes/note.assets/bad.png", "bad.png", 4L) { "fake".toByteArray() }
        )

        val scan = ImportEngine.scanEntries(entries, listOf("MyNotes", "MyNotes/note.assets"))
        assertEquals(1, scan.files.size)
        assertEquals(2, scan.images.size)
        assertEquals(2, scan.unresolvedResources.size) // traversal + missing

        val planned = ImportEngine.planImport(scan, targetNotebookId = null)
        // Pure .assets folder must NOT become an empty notebook
        assertEquals(1, planned.addedBooks.size)
        assertEquals("MyNotes", planned.addedBooks.first().title)
        assertEquals(1, planned.addedChapters.size)
        assertEquals(2, planned.attachments.size)
        assertEquals(2, planned.unresolvedCount)

        val rewritten = planned.addedChapters.first().content
        assertTrue(rewritten.contains("style=\"zoom:67%\""))
        assertTrue(rewritten.contains("width=\"320\""))
        assertTrue(Regex("!\\[常规图\\]\\(assets/[a-f0-9]{32}\\.png\\)").containsMatchIn(rewritten))
        assertTrue(Regex("<img src=\"assets/[a-f0-9]{32}\\.jpg\"").containsMatchIn(rewritten))
        // Path traversal must remain unresolved and never read outside folder
        assertNull(AttachmentPolicy.resolveDroppedImagePath("MyNotes/note.md", "../../secret.png"))
        assertNull(AttachmentPolicy.resolveDroppedImagePath("MyNotes/note.md", "%2e%2e%2fsecret.png"))
    }

    @Test
    fun imageRepair_fillsMissingImagesWhilePreservingUserEdits() {
        val originalFileMd = "# 旧笔记\n\n![老图](old.assets/diagram.png)\n"
        val userEditedMd = "# 旧笔记\n\n这是用户后来新写的段落！\n\n![老图](old.assets/diagram.png)\n"

        val entries = listOf(
            ImportSourceEntry("OrigFolder/old.md", "old.md", originalFileMd.toByteArray().size.toLong()) { originalFileMd.toByteArray() },
            ImportSourceEntry("OrigFolder/old.assets/diagram.png", "diagram.png", SAMPLE_PNG.size.toLong()) { SAMPLE_PNG }
        )
        val scan = ImportEngine.scanEntries(entries, listOf("OrigFolder"))
        val repaired = ImportEngine.planImageRepair(
            scan = scan,
            currentTitle = "旧笔记",
            currentContent = userEditedMd,
            assetBookId = "book99"
        )

        assertEquals(1, repaired.attachments.size)
        assertTrue(repaired.repairedContent.contains("这是用户后来新写的段落！"))
        assertTrue(Regex("!\\[老图\\]\\(assets/[a-f0-9]{32}\\.png\\)").containsMatchIn(repaired.repairedContent))
    }

    @Test
    fun attachmentStore_enforcesImmutabilityAndRejectsCorruptImages() {
        val store = AttachmentFileStore(tempFolder.newFolder("files"))
        val path = AttachmentPolicy.newAttachmentPath("book1", "image/png")

        store.putAttachment("owner/repo", NoteAttachment(path, SAMPLE_PNG))
        // Re-putting identical bytes is idempotent
        store.putAttachment("owner/repo", NoteAttachment(path, SAMPLE_PNG))

        // Overwriting same path with different bytes must throw
        assertThrows(IllegalStateException::class.java) {
            store.putAttachment("owner/repo", NoteAttachment(path, SAMPLE_PNG_2))
        }

        // Spoofed magic bytes rejected
        assertThrows(IllegalArgumentException::class.java) {
            store.putAttachment("owner/repo", NoteAttachment(path, "not a png".toByteArray()))
        }

        // Oversized image skipped during import scan
        val hugeEntry = ImportSourceEntry(
            "Folder/note.assets/huge.png",
            "huge.png",
            AttachmentPolicy.MAX_ATTACHMENT_BYTES.toLong() + 1L
        ) { SAMPLE_PNG }
        val md = "![big](note.assets/huge.png)"
        val scan = ImportEngine.scanEntries(
            listOf(
                ImportSourceEntry("Folder/note.md", "note.md", md.toByteArray().size.toLong()) { md.toByteArray() },
                hugeEntry
            ),
            listOf("Folder")
        )
        assertTrue(scan.skipped.any { it.reason == SkipReason.TOO_LARGE })
    }

    @Test
    fun nestedFolderImport_sortsHierarchicallyCleansTitlesAndPersistsChapterOrder() {
        val entries = listOf(
            ImportSourceEntry("前置知识/6-A2A协议/12_multi_intent.py.md", "12_multi_intent.py.md", 64L) { "# `12_multi_intent.py` 精讲".toByteArray() },
            ImportSourceEntry("前置知识/2-Function Call/01-基本调用.py.md", "01-基本调用.py.md", 64L) { "# `01-基本调用.py` 精讲".toByteArray() },
            ImportSourceEntry("前置知识/1-uv环境管理工具/requirements.txt.md", "requirements.txt.md", 64L) { "# `requirements.txt` 依赖".toByteArray() },
            ImportSourceEntry("前置知识/1-uv环境管理工具/README.md", "README.md", 64L) { "# 模块总览：`1-uv环境管理工具`".toByteArray() },
            ImportSourceEntry("前置知识/6-A2A协议/02_a2a_executor.py.md", "02_a2a_executor.py.md", 64L) { "# `02_a2a_executor.py` 精讲".toByteArray() }
        )
        val scan = ImportEngine.scanEntries(entries, listOf("前置知识"))
        val planned = ImportEngine.planImport(scan, targetNotebookId = null)
        assertEquals(1, planned.addedBooks.size)
        val book = planned.addedBooks.single()
        assertEquals(
            listOf(
                "模块总览：1-uv环境管理工具",
                "requirements.txt 依赖",
                "01-基本调用.py 精讲",
                "02_a2a_executor.py 精讲",
                "12_multi_intent.py 精讲"
            ),
            planned.addedChapters.map { it.title }
        )
        assertEquals(planned.addedChapters.map { it.id }, book.chapterOrder)
    }
}
