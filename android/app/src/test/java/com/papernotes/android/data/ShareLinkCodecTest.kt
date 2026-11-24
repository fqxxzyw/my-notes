package com.papernotes.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class ShareLinkCodecTest {
    private val sampleRel = "assets/0123456789abcdef0123456789abcdef.png"
    private val tinyPngBase64 = Base64.getEncoder().encodeToString(
        byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13)
    )

    @Test
    fun roundtripsCabinetBookChapterPageOfflineLinks() {
        val cabinetPayload = PaperSharePayloadV1(
            v = 1,
            scope = "cabinet",
            cabinet = SharedCabinetData(
                title = "A2A 研究",
                books = listOf(
                    SharedBook(
                        title = "核心架构",
                        description = "测试简介",
                        chapters = listOf(SharedChapter("第一章", "# 正文\n![图]($sampleRel)")),
                        attachments = listOf(SharedAttachment(sampleRel, "image/png", tinyPngBase64))
                    )
                ),
                pages = listOf(SharedPage("独立页", "# 快速说明"))
            )
        )
        val enc = ShareLinkCodec.encodeShareLink(cabinetPayload)
        assertTrue(enc.uri.startsWith("paper-share://v1/"))
        assertEquals(false, enc.overMemoryLimit)

        val decoded = ShareLinkCodec.decodeShareInput("这是书柜分享：${enc.uri}") as ParsedShareInput.Offline
        assertEquals("cabinet", decoded.payload.scope)
        assertEquals("A2A 研究", decoded.payload.cabinet?.title)
        assertEquals(1, decoded.payload.cabinet?.books?.size)
        assertEquals(1, decoded.payload.cabinet?.pages?.size)
        assertEquals(sampleRel, decoded.payload.cabinet?.books?.first()?.attachments?.first()?.relPath)

        val summary = ShareLinkCodec.summarize(decoded.payload)
        assertEquals("书柜分享", summary.scopeLabel)
        assertEquals(1, summary.imageCount)
    }

    @Test
    fun enforcesOffline512KbMemoryCapAndParsesGitHubLinks() {
        val huge = PaperSharePayloadV1(
            v = 1,
            scope = "page",
            page = SharedPage("超大文档", "X".repeat(ShareLinkCodec.MAX_OFFLINE_RAW_BYTES + 2048))
        )
        val enc = ShareLinkCodec.encodeShareLink(huge)
        assertTrue(enc.overMemoryLimit)
        assertEquals("", enc.uri)

        val ghLink = ShareLinkCodec.encodeGitHubShareLink(
            GitHubShareRef(repo = "alice/my-notes", scope = "book", id = "bk01", title = "手册")
        )
        val parsed = ShareLinkCodec.decodeShareInput(ghLink) as ParsedShareInput.GitHub
        assertEquals("alice/my-notes", parsed.ref.repo)
        assertEquals("book", parsed.ref.scope)
        assertEquals("bk01", parsed.ref.id)

        val web = ShareLinkCodec.decodeShareInput("https://github.com/alice/my-notes/blob/main/docs/pages/intro.md") as ParsedShareInput.GitHub
        assertEquals("page", web.ref.scope)
        assertEquals("intro", web.ref.id)
    }
}
