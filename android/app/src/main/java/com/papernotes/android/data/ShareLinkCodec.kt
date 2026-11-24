package com.papernotes.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.zip.Deflater
import java.util.zip.Inflater

@Serializable
data class SharedAttachment(
    val relPath: String,
    val mime: String,
    val base64: String
)

@Serializable
data class SharedChapter(
    val title: String,
    val content: String,
    val ext: String? = null
)

@Serializable
data class SharedBook(
    val title: String,
    val description: String? = null,
    val chapters: List<SharedChapter> = emptyList(),
    val attachments: List<SharedAttachment>? = null
)

@Serializable
data class SharedPage(
    val title: String,
    val content: String,
    val ext: String? = null,
    val attachments: List<SharedAttachment>? = null
)

@Serializable
data class SharedCabinetData(
    val title: String,
    val books: List<SharedBook> = emptyList(),
    val pages: List<SharedPage> = emptyList()
)

@Serializable
data class SharedChapterData(
    val title: String,
    val bookTitle: String? = null,
    val content: String,
    val ext: String? = null,
    val attachments: List<SharedAttachment>? = null
)

@Serializable
data class PaperSharePayloadV1(
    val v: Int = 1,
    val scope: String, // "cabinet" | "book" | "chapter" | "page"
    val createdAt: String? = null,
    val cabinet: SharedCabinetData? = null,
    val book: SharedBook? = null,
    val chapter: SharedChapterData? = null,
    val page: SharedPage? = null
)

data class GitHubShareRef(
    val repo: String,
    val scope: String,
    val id: String,
    val chapterId: String? = null,
    val title: String? = null
)

sealed interface ParsedShareInput {
    data class Offline(val payload: PaperSharePayloadV1) : ParsedShareInput
    data class GitHub(val ref: GitHubShareRef) : ParsedShareInput
}

data class EncodedShareResult(
    val uri: String,
    val rawBytes: Int,
    val charLength: Int,
    val tooLarge: Boolean,
    val overMemoryLimit: Boolean
)

data class ShareSummary(
    val scope: String,
    val scopeLabel: String,
    val title: String,
    val bookCount: Int,
    val chapterCount: Int,
    val pageCount: Int,
    val imageCount: Int
)

/**
 * 100% wire-compatible share link codec matching Desktop `docs/.vitepress/theme/shareLink.ts`.
 * Uses RFC 1950 zlib + URL-safe Base64 without padding, enforcing strict offline memory caps.
 */
object ShareLinkCodec {
    const val SHARE_URI_PREFIX = "paper-share://v1/"
    const val SHARE_GH_PREFIX = "paper-share://gh/v1?"
    const val MAX_OFFLINE_RAW_BYTES = 512 * 1024
    const val MAX_OFFLINE_SINGLE_IMAGE_BYTES = 180 * 1024
    const val MAX_OFFLINE_TOTAL_IMAGE_BYTES = 320 * 1024
    const val MAX_SHARE_LINK_CHARS = 120_000
    const val MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024

    private val VALID_SCOPES = setOf("cabinet", "book", "chapter", "page")
    private val VALID_MIMES = setOf("image/png", "image/jpeg", "image/gif", "image/webp")
    private val REL_ASSET_REGEX = Regex("^assets/[a-f0-9]{32}\\.(?:png|jpg|gif|webp)$")
    private val OFFLINE_URI_REGEX = Regex("paper-share://v1/([A-Za-z0-9_-]+)")
    private val OFFLINE_HASH_REGEX = Regex("#paper-share=v1:([A-Za-z0-9_-]+)")
    private val GH_URI_REGEX = Regex("paper-share://gh/v1\\?([^\\s]+)")
    private val GH_HASH_REGEX = Regex("#paper-share=gh:([^\\s]+)")
    private val GH_WEB_REGEX = Regex(
        "https?://github\\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/(?:blob|tree)/[^/]+/docs/([^\\s?#]+)",
        RegexOption.IGNORE_CASE
    )

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private fun sanitizeAttachments(list: List<SharedAttachment>?): List<SharedAttachment>? {
        if (list.isNullOrEmpty()) return null
        val cleaned = list.mapNotNull { att ->
            val rel = att.relPath.trim()
            val mime = att.mime.trim().lowercase()
            val b64 = att.base64.trim()
            if (!REL_ASSET_REGEX.matches(rel) || mime !in VALID_MIMES || b64.isEmpty()) null
            else SharedAttachment(relPath = rel, mime = mime, base64 = b64)
        }
        return cleaned.ifEmpty { null }
    }

    fun validatePayload(payload: PaperSharePayloadV1): PaperSharePayloadV1 {
        if (payload.v != 1) throw IllegalArgumentException("不支持的分享链接版本。")
        if (payload.scope !in VALID_SCOPES) throw IllegalArgumentException("分享链接缺少有效的层级标识。")
        return when (payload.scope) {
            "cabinet" -> {
                val cab = payload.cabinet ?: throw IllegalArgumentException("书柜分享内容不完整。")
                val title = cab.title.trim().take(80)
                if (title.isEmpty()) throw IllegalArgumentException("书柜名称为空。")
                payload.copy(
                    cabinet = SharedCabinetData(
                        title = title,
                        books = cab.books.mapNotNull { b ->
                            val bt = b.title.trim().take(120)
                            if (bt.isEmpty()) null else b.copy(
                                title = bt,
                                description = b.description?.trim()?.take(500)?.ifEmpty { null },
                                chapters = b.chapters.filter { it.title.trim().isNotEmpty() },
                                attachments = sanitizeAttachments(b.attachments)
                            )
                        },
                        pages = cab.pages.mapNotNull { p ->
                            val pt = p.title.trim().take(120)
                            if (pt.isEmpty()) null else p.copy(
                                title = pt,
                                attachments = sanitizeAttachments(p.attachments)
                            )
                        }
                    )
                )
            }
            "book" -> {
                val b = payload.book ?: throw IllegalArgumentException("笔记本分享内容不完整。")
                val bt = b.title.trim().take(120)
                if (bt.isEmpty()) throw IllegalArgumentException("笔记本名称为空。")
                payload.copy(
                    book = b.copy(
                        title = bt,
                        description = b.description?.trim()?.take(500)?.ifEmpty { null },
                        chapters = b.chapters.filter { it.title.trim().isNotEmpty() },
                        attachments = sanitizeAttachments(b.attachments)
                    )
                )
            }
            "chapter" -> {
                val ch = payload.chapter ?: throw IllegalArgumentException("章节分享内容不完整。")
                val ct = ch.title.trim().take(120)
                if (ct.isEmpty()) throw IllegalArgumentException("章节名称为空。")
                payload.copy(
                    chapter = ch.copy(
                        title = ct,
                        bookTitle = ch.bookTitle?.trim()?.take(120)?.ifEmpty { null },
                        attachments = sanitizeAttachments(ch.attachments)
                    )
                )
            }
            else -> {
                val p = payload.page ?: throw IllegalArgumentException("书页分享内容不完整。")
                val pt = p.title.trim().take(120)
                if (pt.isEmpty()) throw IllegalArgumentException("书页名称为空。")
                payload.copy(
                    page = p.copy(
                        title = pt,
                        attachments = sanitizeAttachments(p.attachments)
                    )
                )
            }
        }
    }

    fun encodeShareLink(payload: PaperSharePayloadV1): EncodedShareResult {
        val valid = validatePayload(payload)
        val rawBytes = json.encodeToString(valid).toByteArray(StandardCharsets.UTF_8)
        if (rawBytes.size > MAX_OFFLINE_RAW_BYTES) {
            return EncodedShareResult(
                uri = "",
                rawBytes = rawBytes.size,
                charLength = 0,
                tooLarge = true,
                overMemoryLimit = true
            )
        }
        val compressed = zlibCompress(rawBytes)
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(compressed)
        val uri = "$SHARE_URI_PREFIX$token"
        return EncodedShareResult(
            uri = uri,
            rawBytes = rawBytes.size,
            charLength = uri.length,
            tooLarge = uri.length > MAX_SHARE_LINK_CHARS,
            overMemoryLimit = false
        )
    }

    fun encodeGitHubShareLink(ref: GitHubShareRef): String {
        val normalizedRepo = RepositoryIdentity.normalizeRepository(ref.repo)
        val enc = { s: String -> URLEncoder.encode(s, "UTF-8") }
        val parts = mutableListOf(
            "repo=${enc(normalizedRepo)}",
            "scope=${enc(ref.scope)}",
            "id=${enc(ref.id)}"
        )
        if (!ref.chapterId.isNullOrBlank()) parts.add("chapter=${enc(ref.chapterId)}")
        if (!ref.title.isNullOrBlank()) parts.add("title=${enc(ref.title.take(80))}")
        return "$SHARE_GH_PREFIX${parts.joinToString("&")}"
    }

    fun decodeShareInput(rawInput: String): ParsedShareInput {
        val trimmed = rawInput.trim()
        if (trimmed.isEmpty()) throw IllegalArgumentException("请先粘贴分享链接。")

        val offlineMatch = OFFLINE_URI_REGEX.find(trimmed) ?: OFFLINE_HASH_REGEX.find(trimmed)
        if (offlineMatch != null) {
            val token = offlineMatch.groupValues[1]
            val inflated = try {
                val compressed = Base64.getUrlDecoder().decode(token)
                zlibDecompress(compressed, MAX_DECOMPRESSED_BYTES)
            } catch (e: IllegalArgumentException) {
                throw e
            } catch (_: Throwable) {
                throw IllegalArgumentException("分享链接不完整或已损坏，请确认已完整复制。")
            }
            val parsed = try {
                json.decodeFromString<PaperSharePayloadV1>(String(inflated, StandardCharsets.UTF_8))
            } catch (_: Throwable) {
                throw IllegalArgumentException("分享链接数据损坏，无法解析。")
            }
            return ParsedShareInput.Offline(validatePayload(parsed))
        }

        val ghMatch = GH_URI_REGEX.find(trimmed) ?: GH_HASH_REGEX.find(trimmed)
        if (ghMatch != null) {
            val params = parseQueryParams(ghMatch.groupValues[1])
            val rawRepo = params["repo"].orEmpty()
            val scope = params["scope"].orEmpty()
            val id = params["id"].orEmpty().trim()
            val chapterId = params["chapter"]?.trim()?.ifEmpty { null }
            val title = params["title"]?.trim()?.ifEmpty { null }
            if (rawRepo.isEmpty() || scope !in VALID_SCOPES || id.isEmpty()) {
                throw IllegalArgumentException("GitHub 分享链接缺少必要参数。")
            }
            return ParsedShareInput.GitHub(
                GitHubShareRef(
                    repo = RepositoryIdentity.normalizeRepository(rawRepo),
                    scope = scope,
                    id = id,
                    chapterId = chapterId,
                    title = title
                )
            )
        }

        val webMatch = GH_WEB_REGEX.find(trimmed)
        if (webMatch != null) {
            val repo = RepositoryIdentity.normalizeRepository(webMatch.groupValues[1])
            val subPath = URLDecoder.decode(webMatch.groupValues[2], "UTF-8").trimEnd('/')
            val parts = subPath.split('/')
            if (parts.size >= 2 && parts[0] == "pages") {
                val id = parts[1].replace(Regex("\\.(?:md|txt)$", RegexOption.IGNORE_CASE), "")
                return ParsedShareInput.GitHub(GitHubShareRef(repo = repo, scope = "page", id = id))
            }
            if (parts.size >= 2 && parts[0] == "notebooks") {
                val bookId = parts[1]
                if (parts.size >= 3 && !parts[2].equals("index.md", ignoreCase = true)) {
                    val chId = parts[2].replace(Regex("\\.(?:md|txt)$", RegexOption.IGNORE_CASE), "")
                    return ParsedShareInput.GitHub(GitHubShareRef(repo = repo, scope = "chapter", id = bookId, chapterId = chId))
                }
                return ParsedShareInput.GitHub(GitHubShareRef(repo = repo, scope = "book", id = bookId))
            }
        }

        throw IllegalArgumentException("未识别的分享链接格式。请粘贴 paper-share:// 分享链接或 GitHub 笔记链接。")
    }

    fun summarize(payload: PaperSharePayloadV1): ShareSummary = when (payload.scope) {
        "cabinet" -> {
            val cab = payload.cabinet!!
            ShareSummary(
                scope = "cabinet",
                scopeLabel = "书柜分享",
                title = cab.title,
                bookCount = cab.books.size,
                chapterCount = cab.books.sumOf { it.chapters.size },
                pageCount = cab.pages.size,
                imageCount = cab.books.sumOf { it.attachments?.size ?: 0 } + cab.pages.sumOf { it.attachments?.size ?: 0 }
            )
        }
        "book" -> {
            val b = payload.book!!
            ShareSummary(
                scope = "book",
                scopeLabel = "笔记本分享",
                title = b.title,
                bookCount = 1,
                chapterCount = b.chapters.size,
                pageCount = 0,
                imageCount = b.attachments?.size ?: 0
            )
        }
        "chapter" -> {
            val ch = payload.chapter!!
            ShareSummary(
                scope = "chapter",
                scopeLabel = "章节分享",
                title = ch.title,
                bookCount = 0,
                chapterCount = 1,
                pageCount = 0,
                imageCount = ch.attachments?.size ?: 0
            )
        }
        else -> {
            val p = payload.page!!
            ShareSummary(
                scope = "page",
                scopeLabel = "独立书页分享",
                title = p.title,
                bookCount = 0,
                chapterCount = 0,
                pageCount = 1,
                imageCount = p.attachments?.size ?: 0
            )
        }
    }

    fun stripAttachments(payload: PaperSharePayloadV1): PaperSharePayloadV1 = when (payload.scope) {
        "cabinet" -> payload.copy(
            cabinet = payload.cabinet?.copy(
                books = payload.cabinet.books.map { it.copy(attachments = null) },
                pages = payload.cabinet.pages.map { it.copy(attachments = null) }
            )
        )
        "book" -> payload.copy(book = payload.book?.copy(attachments = null))
        "chapter" -> payload.copy(chapter = payload.chapter?.copy(attachments = null))
        else -> payload.copy(page = payload.page?.copy(attachments = null))
    }

    private fun parseQueryParams(query: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        for (pair in query.split('&')) {
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            val k = URLDecoder.decode(pair.substring(0, eq), "UTF-8")
            val v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
            map[k] = v
        }
        return map
    }

    private fun zlibCompress(input: ByteArray): ByteArray {
        val deflater = Deflater(Deflater.BEST_COMPRESSION)
        try {
            deflater.setInput(input)
            deflater.finish()
            val out = ByteArrayOutputStream(input.size)
            val buffer = ByteArray(4096)
            while (!deflater.finished()) {
                val count = deflater.deflate(buffer)
                if (count > 0) out.write(buffer, 0, count)
            }
            return out.toByteArray()
        } finally {
            deflater.end()
        }
    }

    private fun zlibDecompress(input: ByteArray, maxBytes: Int): ByteArray {
        val inflater = Inflater()
        try {
            inflater.setInput(input)
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            var total = 0
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0) {
                    if (inflater.needsInput() || inflater.needsDictionary()) break
                } else {
                    total += count
                    if (total > maxBytes) throw IllegalArgumentException("分享链接数据超出安全大小上限（4 MiB）。")
                    out.write(buffer, 0, count)
                }
            }
            return out.toByteArray()
        } finally {
            inflater.end()
        }
    }
}
