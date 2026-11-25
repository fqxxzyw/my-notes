package com.papernotes.android

import com.papernotes.android.data.Cabinet
import com.papernotes.android.data.CabinetCatalog
import com.papernotes.android.data.CabinetJournal
import com.papernotes.android.data.CompatibilityCodecs
import com.papernotes.android.data.DEFAULT_CABINET_ID
import com.papernotes.android.data.MarkdownOutlineParser
import com.papernotes.android.data.RepositoryIdentity
import com.papernotes.android.data.ShelfItem
import com.papernotes.android.ui.screens.formatNonZeroCounts
import com.papernotes.android.ui.theme.ResolvedTheme
import com.papernotes.android.ui.theme.ThemePreference
import com.papernotes.android.ui.theme.resolvePaperColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CompatibilityCodecsTest {

    @Test
    fun normalizeRepository_acceptsOwnerRepoAndHttpsUrl_rejectsUnsafe() {
        assertEquals("octocat/my-notes", RepositoryIdentity.normalizeRepository("OctoCat/My-Notes"))
        assertEquals("octocat/my-notes", RepositoryIdentity.normalizeRepository("https://github.com/OctoCat/My-Notes.git"))
        assertEquals("octocat/my-notes", RepositoryIdentity.normalizeRepository("https://github.com/octocat/my-notes/"))

        assertThrows(IllegalArgumentException::class.java) {
            RepositoryIdentity.normalizeRepository("http://github.com/octocat/my-notes")
        }
        assertThrows(IllegalArgumentException::class.java) {
            RepositoryIdentity.normalizeRepository("https://evil.example/octocat/my-notes")
        }
        assertThrows(IllegalArgumentException::class.java) {
            RepositoryIdentity.normalizeRepository("https://user:pass@github.com/octocat/my-notes")
        }
        assertThrows(IllegalArgumentException::class.java) {
            RepositoryIdentity.normalizeRepository("octocat/my-notes?foo=1")
        }
        assertNotEquals(
            RepositoryIdentity.workspaceScope("alice/notes"),
            RepositoryIdentity.workspaceScope("bob/notes")
        )
        assertEquals("local", RepositoryIdentity.workspaceScope(""))
    }

    @Test
    fun cabinetCatalog_roundTripPreservesPageAssignmentsAndDefaultCabinet() {
        val raw = """
            {
              "schemaVersion": 2,
              "cabinets": [
                { "id": "general", "title": "默认书柜" },
                { "id": "study-1", "title": "学习" }
              ],
              "assignments": {
                "book123": "study-1",
                "page_p_abc": "study-1"
              }
            }
        """.trimIndent()
        val parsed = CompatibilityCodecs.parseCatalog(raw)
        assertEquals(2, parsed.schemaVersion)
        assertEquals(2, parsed.cabinets.size)
        assertEquals("study-1", parsed.assignments["page_p_abc"])

        val serialized = CompatibilityCodecs.serializeCatalog(parsed)
        assertTrue(serialized.endsWith("\n"))
        assertEquals(parsed, CompatibilityCodecs.parseCatalog(serialized))

        // Missing default cabinet rejected
        assertThrows(IllegalArgumentException::class.java) {
            CompatibilityCodecs.validateCatalog(
                CabinetCatalog(2, listOf(Cabinet("other", "其他")), emptyMap())
            )
        }
    }

    @Test
    fun cabinetJournal_protectsDefaultCabinetAndRedirectsOnDelete() {
        val journal = CabinetJournal()
        val studyId = journal.create("学习")
        journal.moveMany(listOf("bookA", "page_p1"), studyId)
        assertEquals(studyId, journal.assigned("bookA"))
        assertEquals(studyId, journal.assigned("page_p1"))

        // Default cabinet protected
        assertThrows(IllegalArgumentException::class.java) {
            journal.remove(DEFAULT_CABINET_ID)
        }

        // Deleting normal cabinet moves contents to general
        journal.remove(studyId)
        assertEquals(DEFAULT_CABINET_ID, journal.assigned("bookA"))
        assertEquals(DEFAULT_CABINET_ID, journal.assigned("page_p1"))
        assertTrue(journal.cabinets.none { it.id == studyId })
    }

    @Test
    fun indexMetadata_preservesUserTextEscapesHyphensAndKeepsDescriptionLast() {
        val original = "# Java 学习\n\n用户自定义的说明文字\n<!-- user-comment -->\n"
        val withDesc = CompatibilityCodecs.writeNotebookDescription(original, "包含 --> 符号的简介")
        assertTrue(withDesc.contains("\\u002d\\u002d>"))
        assertEquals("包含 --> 符号的简介", CompatibilityCodecs.readNotebookDescription(withDesc))

        val withOrder = CompatibilityCodecs.writeNotebookChapterOrder(withDesc, listOf("ch2", "ch1"))
        // Description must still be the final line for compatibility with older clients
        assertTrue(withOrder.trimEnd().endsWith("-->"))
        assertTrue(withOrder.substringAfter("paper-notes-chapter-order:").contains("paper-notes-description:"))
        assertEquals(listOf("ch2", "ch1"), CompatibilityCodecs.readNotebookChapterOrder(withOrder))
        assertEquals("包含 --> 符号的简介", CompatibilityCodecs.readNotebookDescription(withOrder))
        assertTrue(withOrder.contains("用户自定义的说明文字"))
        assertTrue(withOrder.contains("<!-- user-comment -->"))
    }

    @Test
    fun encodedIdsAndGitBlobSha1_matchSpecification() {
        val pId = CompatibilityCodecs.pageIdFromTitle("读书笔记 · 第一章")
        assertEquals("读书笔记 · 第一章", CompatibilityCodecs.titleFromEncodedId(pId, 'p'))
        val cId = CompatibilityCodecs.chapterIdFromTitle("Kotlin 协程")
        assertEquals("Kotlin 协程", CompatibilityCodecs.titleFromEncodedId(cId, 'c'))

        // Exact git hash-object for "hello\n" is ce013625030ba8dba906f756967f9e9ca394464a
        assertEquals("ce013625030ba8dba906f756967f9e9ca394464a", CompatibilityCodecs.gitBlobSha1("hello\n"))
    }

    @Test
    fun outlineParser_masksFrontmatterAndCodeBlocksAndSupportsFolding() {
        val md = """
            ---
            title: Frontmatter
            ---
            # 第一章
            ```md
            # 代码块中的伪标题
            ```
            ## 第一节
            ### 小节 A
            ## 第二节
        """.trimIndent()
        val headings = MarkdownOutlineParser.parse(md)
        assertEquals(4, headings.size)
        assertEquals(listOf("第一章", "第一节", "小节 A", "第二节"), headings.map { it.title })
        assertTrue(headings[0].hasChildren)
        assertTrue(headings[1].hasChildren)

        val folded = MarkdownOutlineParser.visibleHeadings(headings, setOf(1))
        assertEquals(listOf("第一章", "第一节", "第二节"), folded.map { it.title })
    }

    @Test
    fun nonZeroCountFormatting_andThemes_workCorrectly() {
        val bookOnly = listOf(ShelfItem("b1", "Book", "", isPage = false))
        val pageOnly = listOf(ShelfItem("page_p1", "Page", "", isPage = true, pageId = "p1"))
        val both = bookOnly + pageOnly
        assertEquals("1 本笔记本", formatNonZeroCounts(bookOnly))
        assertEquals("1 张书页", formatNonZeroCounts(pageOnly))
        assertEquals("1 本笔记本 · 1 张书页", formatNonZeroCounts(both))
        assertEquals("", formatNonZeroCounts(emptyList()))

        assertEquals(ResolvedTheme.DAY, resolvePaperColors(ThemePreference.DAY, systemDark = true).resolved)
        assertEquals(ResolvedTheme.NIGHT, resolvePaperColors(ThemePreference.NIGHT, systemDark = false).resolved)
        assertEquals(ResolvedTheme.GREEN, resolvePaperColors(ThemePreference.GREEN, systemDark = true).resolved)
        assertEquals(ResolvedTheme.YELLOW, resolvePaperColors(ThemePreference.YELLOW, systemDark = true).resolved)
        assertEquals(ResolvedTheme.NIGHT, resolvePaperColors(ThemePreference.SYSTEM, systemDark = true).resolved)
        assertEquals(ResolvedTheme.DAY, resolvePaperColors(ThemePreference.SYSTEM, systemDark = false).resolved)
    }

    @Test
    fun cleanMarkdownTitle_stripsInlineFormattingWhilePreservingSnakeCase() {
        assertEquals(
            "05-asyncio_gather.py 代码精讲：多协程并发汇聚（asyncio.gather）与耗时压缩原理",
            CompatibilityCodecs.cleanMarkdownTitle(
                "`05-asyncio_gather.py` 代码精讲：多协程并发汇聚（`asyncio.gather`）与耗时压缩原理"
            )
        )
        assertEquals(
            "模块总览：1-uv环境管理工具 —— 现代 Python 极速包管理",
            CompatibilityCodecs.cleanMarkdownTitle("模块总览：`1-uv环境管理工具` —— **现代** ==Python== 极速包管理 ###")
        )
        assertEquals(
            "utils/__init__.py 与 chat_service_core.py",
            CompatibilityCodecs.cleanMarkdownTitle("`utils/__init__.py` 与 chat_service_core.py")
        )
        assertEquals(
            "07-mcp-streamable-server.py 深度精讲",
            CompatibilityCodecs.titleFromMarkdown("# `07-mcp-streamable-server.py` 深度精讲\n\n正文", "fallback")
        )
        val headings = MarkdownOutlineParser.parse("# `05-asyncio_gather.py` 原理\n## `a2a_server` 架构\n")
        assertEquals(listOf("05-asyncio_gather.py 原理", "a2a_server 架构"), headings.map { it.title })
    }

    @Test
    fun nestedChapterSorting_isStrictlyTransitiveAndRecoversEncodedFolderOrder() {
        val samples = listOf(
            "README.md",
            "index.md",
            "00-导读.md",
            "01-基础.md",
            "01-基础/README.md",
            "01-基础/01-安装.md",
            "01-基础/2-配置.md",
            "01-基础/10-排错.md",
            "1-uv环境管理工具/README.md",
            "1-uv环境管理工具/requirements.txt.md",
            "2-Function Call/01-基本调用.py.md",
            "10-进阶/01-实战.md",
            "附录.md",
            "压力测试/stress_test.py.md"
        )
        for (a in samples) {
            assertEquals(0, CompatibilityCodecs.compareImportedPaths(a, a))
            for (b in samples) {
                val ab = CompatibilityCodecs.compareImportedPaths(a, b).coerceIn(-1, 1)
                val ba = CompatibilityCodecs.compareImportedPaths(b, a).coerceIn(-1, 1)
                assertEquals(ab, -ba)
                for (c in samples) {
                    val bc = CompatibilityCodecs.compareImportedPaths(b, c).coerceIn(-1, 1)
                    val ac = CompatibilityCodecs.compareImportedPaths(a, c).coerceIn(-1, 1)
                    if (ab < 0 && bc < 0) assertEquals(-1, ac)
                }
            }
        }

        val rels = listOf(
            "6-A2A协议/12_multi_intent.py",
            "3-异步编程/05-asyncio_gather.py",
            "1-uv环境管理工具/requirements.txt",
            "1-uv环境管理工具/README",
            "2-Function Call/01-基本调用.py",
            "3-异步编程/01-async_basic.py",
            "6-A2A协议/01_agent_card.py"
        )
        val encoded = rels.map { rel -> CompatibilityCodecs.chapterIdFromTitle(rel) to rel }
        val sorted = CompatibilityCodecs.sortChapters(encoded, { it.first }, null)
        assertEquals(
            listOf(
                "1-uv环境管理工具/README",
                "1-uv环境管理工具/requirements.txt",
                "2-Function Call/01-基本调用.py",
                "3-异步编程/01-async_basic.py",
                "3-异步编程/05-asyncio_gather.py",
                "6-A2A协议/01_agent_card.py",
                "6-A2A协议/12_multi_intent.py"
            ),
            sorted.map { it.second }
        )
        assertEquals("3-异步编程", CompatibilityCodecs.chapterFolderPath(sorted[3].first))
    }
}
