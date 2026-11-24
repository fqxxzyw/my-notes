package com.papernotes.android.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/**
 * Byte-compatible codecs matching docs/.vitepress/theme/{cabinetStore,notebookDescription,notebookChapterOrder,notebookStore}.ts.
 */
object CompatibilityCodecs {
    val ID_REGEX = Regex("^[a-zA-Z0-9_-]+$")
    val SHA_REGEX = Regex("^[a-f0-9]{40}$")

    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
    private val prettyJson = Json {
        prettyPrint = true
        prettyPrintIndent = "  "
        encodeDefaults = false
    }

    private val compactJson = Json {
        encodeDefaults = false
        ignoreUnknownKeys = true
    }

    // --- Cabinet Catalog (docs/cabinets.json) ---

    fun defaultCatalog(): CabinetCatalog = CabinetCatalog(
        schemaVersion = 2,
        cabinets = listOf(Cabinet(DEFAULT_CABINET_ID, DEFAULT_CABINET_TITLE)),
        assignments = emptyMap()
    )

    fun validateCatalog(catalog: CabinetCatalog): CabinetCatalog {
        if (catalog.schemaVersion != null && catalog.schemaVersion != 2) {
            throw IllegalArgumentException("不支持的书柜目录版本。")
        }
        val seen = LinkedHashSet<String>()
        val cleanCabinets = catalog.cabinets.map { entry ->
            if (!ID_REGEX.matches(entry.id) || !seen.add(entry.id)) {
                throw IllegalArgumentException("书柜标识无效或重复。")
            }
            val title = entry.title.trim()
            if (title.isEmpty() || entry.title.length > 120 || entry.title.contains('\r') || entry.title.contains('\n')) {
                throw IllegalArgumentException("书柜名称无效。")
            }
            Cabinet(entry.id, title)
        }
        if (DEFAULT_CABINET_ID !in seen) {
            throw IllegalArgumentException("书柜目录缺少默认书柜。")
        }
        val cleanAssignments = LinkedHashMap<String, String>()
        for ((bookId, cabinetId) in catalog.assignments) {
            if (!ID_REGEX.matches(bookId) || cabinetId !in seen) {
                throw IllegalArgumentException("笔记本的书柜归属无效。")
            }
            cleanAssignments[bookId] = cabinetId
        }
        return CabinetCatalog(
            schemaVersion = if (catalog.schemaVersion == 2) 2 else null,
            cabinets = cleanCabinets,
            assignments = cleanAssignments
        )
    }

    fun parseCatalog(raw: String): CabinetCatalog {
        val elem = try {
            compactJson.parseToJsonElement(raw)
        } catch (_: Exception) {
            throw IllegalArgumentException("书柜目录不是有效的 JSON。")
        }
        if (elem !is JsonObject) throw IllegalArgumentException("书柜目录格式无效。")
        val rawCabinets = elem["cabinets"] as? JsonArray ?: throw IllegalArgumentException("书柜目录格式无效。")
        val rawAssignments = elem["assignments"] as? JsonObject ?: throw IllegalArgumentException("书柜目录格式无效。")
        val schemaEl = elem["schemaVersion"]
        val schemaVersion = when {
            schemaEl == null -> null
            schemaEl is JsonPrimitive && schemaEl.intOrNull == 2 -> 2
            else -> throw IllegalArgumentException("不支持的书柜目录版本。")
        }
        val cabinets = rawCabinets.map { item ->
            if (item !is JsonObject) throw IllegalArgumentException("书柜信息格式无效。")
            val id = (item["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw IllegalArgumentException("书柜标识无效。")
            val title = (item["title"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw IllegalArgumentException("书柜名称无效。")
            Cabinet(id, title)
        }
        val assignments = LinkedHashMap<String, String>()
        for ((k, v) in rawAssignments) {
            val target = (v as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw IllegalArgumentException("笔记本的书柜归属无效。")
            assignments[k] = target
        }
        return validateCatalog(CabinetCatalog(schemaVersion, cabinets, assignments))
    }

    fun serializeCatalog(catalog: CabinetCatalog): String {
        val clean = validateCatalog(catalog)
        val obj = buildMap<String, JsonElement> {
            if (clean.schemaVersion == 2) put("schemaVersion", JsonPrimitive(2))
            put("cabinets", JsonArray(clean.cabinets.map {
                JsonObject(mapOf("id" to JsonPrimitive(it.id), "title" to JsonPrimitive(it.title)))
            }))
            put("assignments", JsonObject(clean.assignments.mapValues { JsonPrimitive(it.value) }))
        }
        return prettyJson.encodeToString(JsonObject(obj)) + "\n"
    }

    // --- Notebook index.md Description & Chapter Order ---
    // Exact port of notebookDescription.ts & notebookChapterOrder.ts

    private val DESCRIPTION_MARKER = Regex("""(?:^|\n)(<!-- paper-notes-description:(.*?) -->)(\r?\n)?$""")
    private const val ORDER_KEY = "<!-- paper-notes-chapter-order:"
    private val ORDER_MARKER = Regex("""^<!-- paper-notes-chapter-order:(.*?) -->$""")

    fun readNotebookDescription(content: String): String {
        val match = DESCRIPTION_MARKER.find(content) ?: return ""
        return try {
            val parsed = compactJson.parseToJsonElement(match.groupValues[2])
            if (parsed is JsonPrimitive && parsed.isString && parsed.content.length <= 500) {
                parsed.content
            } else ""
        } catch (_: Exception) {
            ""
        }
    }

    fun writeNotebookDescription(content: String, description: String): String {
        if (description.length > 500) throw IllegalArgumentException("简介不能超过 500 个字符。")
        val match = DESCRIPTION_MARKER.find(content)
        if (match == null && description.isEmpty()) return content
        val encoded = compactJson.encodeToString(JsonPrimitive(description)).replace("-", "\\u002d")
        val line = "<!-- paper-notes-description:$encoded -->"
        if (match != null) {
            val parsed = try {
                compactJson.parseToJsonElement(match.groupValues[2])
            } catch (_: Exception) {
                throw IllegalArgumentException("笔记本简介标记格式无效，请先检查原文件。")
            }
            if (parsed !is JsonPrimitive || !parsed.isString) {
                throw IllegalArgumentException("笔记本简介标记格式无效，请先检查原文件。")
            }
            val start = match.range.first + if (match.value.startsWith("\n")) 1 else 0
            val trailing = match.groupValues[3]
            return content.substring(0, start) + line + trailing
        }
        val prefix = if (content.endsWith("\n")) content else "$content\n"
        return "$prefix$line\n"
    }

    fun validateChapterOrder(order: List<String>): List<String> {
        if (order.size > 999) throw IllegalArgumentException("章节顺序数据无效，请检查笔记本索引。")
        val seen = HashSet<String>()
        return order.map { id ->
            if (id.length > 251 || !ID_REGEX.matches(id) || id.equals("index", ignoreCase = true) || !seen.add(id)) {
                throw IllegalArgumentException("章节顺序数据无效，请检查笔记本索引。")
            }
            id
        }
    }

    private fun splitDescription(content: String): Pair<String, String> {
        val match = DESCRIPTION_MARKER.find(content) ?: return content to ""
        val start = match.range.first + if (match.value.startsWith("\n")) 1 else 0
        return content.substring(0, start) to content.substring(start)
    }

    private data class OrderSplit(val before: String, val after: String, val order: List<String>?)

    private fun splitOrder(content: String): OrderSplit {
        val (prefix, description) = splitDescription(content)
        val end = if (prefix.endsWith("\n")) prefix.length - 1 else prefix.length
        val start = if (end == 0) 0 else prefix.lastIndexOf('\n', end - 1) + 1
        val tail = prefix.substring(start, end).removeSuffix("\r")
        if (!tail.startsWith(ORDER_KEY)) return OrderSplit(prefix, description, null)
        val marker = ORDER_MARKER.matchEntire(tail)
            ?: throw IllegalArgumentException("章节顺序标记损坏，请先检查笔记本索引。")
        val parsed = try {
            compactJson.parseToJsonElement(marker.groupValues[1])
        } catch (_: Exception) {
            throw IllegalArgumentException("章节顺序标记损坏，请先检查笔记本索引。")
        }
        if (parsed !is JsonArray) throw IllegalArgumentException("章节顺序标记损坏，请先检查笔记本索引。")
        val ids = parsed.map { el ->
            (el as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw IllegalArgumentException("章节顺序标记损坏，请先检查笔记本索引。")
        }
        val order = validateChapterOrder(ids)
        val before = prefix.substring(0, start)
        val prior = before.replace(Regex("\r?\n$"), "").substringAfterLast('\n', before.replace(Regex("\r?\n$"), ""))
        if (prior.startsWith(ORDER_KEY)) {
            throw IllegalArgumentException("章节顺序标记重复，请先检查笔记本索引。")
        }
        return OrderSplit(before, description, order)
    }

    fun readNotebookChapterOrder(content: String): List<String>? = splitOrder(content).order

    fun writeNotebookChapterOrder(content: String, value: List<String>?): String {
        if (value == null) return content
        val order = validateChapterOrder(value)
        val split = splitOrder(content)
        if (split.order != null && split.order == order) return content
        val newline = if (content.contains("\r\n")) "\r\n" else "\n"
        val separator = if (split.before.isNotEmpty() && !split.before.endsWith("\n")) newline else ""
        val jsonArray = compactJson.encodeToString(JsonArray(order.map { JsonPrimitive(it) })).replace("-", "\\u002d")
        val marker = "$ORDER_KEY$jsonArray -->"
        return split.before + separator + marker + newline + split.after
    }

    fun <T> sortChapters(chapters: List<T>, idSelector: (T) -> String, order: List<String>?): List<T> {
        if (order.isNullOrEmpty()) return chapters.toList()
        val rank = order.withIndex().associate { it.value to it.index }
        return chapters.withIndex()
            .sortedWith(compareBy<IndexedValue<T>> { rank[idSelector(it.value)] ?: Int.MAX_VALUE }.thenBy { it.index })
            .map { it.value }
    }

    // --- IDs, Titles, Page keys, Git Blob SHA-1 ---

    fun newRandomId(): String = UUID.randomUUID().toString().replace("-", "")

    fun checkId(value: String): String {
        if (!ID_REGEX.matches(value)) throw IllegalArgumentException("笔记本或章节标识无效。")
        return value
    }

    fun checkChapterId(value: String): String {
        checkId(value)
        if (value.equals("index", ignoreCase = true)) throw IllegalArgumentException("章节标识不能是 index。")
        return value
    }

    fun checkPageId(value: String): String {
        checkId(value)
        if (value.length > 251) throw IllegalArgumentException("书页文件名过长。")
        return value
    }

    fun checkTitle(title: String): String {
        val value = title.trim()
        if (value.isEmpty() || value.contains('\r') || value.contains('\n') || value.length > 120) {
            throw IllegalArgumentException("标题不能为空、包含换行或超过 120 个字符。")
        }
        return value
    }

    fun safeImportedTitle(name: String): String {
        val base = name.replace(Regex("\\.md$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("[\\r\\n]"), " ")
            .trim()
            .ifEmpty { "未命名" }
        val sb = StringBuilder()
        var byteLen = 0
        for (ch in base) {
            val charBytes = ch.toString().toByteArray(Charsets.UTF_8).size
            if (byteLen + charBytes > 128) break
            sb.append(ch)
            byteLen += charBytes
        }
        return sb.toString().ifEmpty { "未命名" }
    }

    private fun encodedIdFromTitle(prefix: Char, title: String): String {
        val clean = checkTitle(title)
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(clean.toByteArray(Charsets.UTF_8))
        val id = "${prefix}_${newRandomId()}_$encoded"
        if (id.length > 251) throw IllegalArgumentException("文件名过长，请缩短后重试。")
        return id
    }

    fun pageIdFromTitle(title: String): String = encodedIdFromTitle('p', title)
    fun chapterIdFromTitle(title: String): String = encodedIdFromTitle('c', title)

    fun titleFromEncodedId(id: String, prefix: Char): String {
        val regex = Regex("^${prefix}_[a-f0-9]{32}_([A-Za-z0-9_-]+)$")
        val match = regex.matchEntire(id) ?: return id
        return try {
            val bytes = Base64.getUrlDecoder().decode(match.groupValues[1])
            val decoded = String(bytes, Charsets.UTF_8)
            checkTitle(decoded)
        } catch (_: Exception) {
            id
        }
    }

    private val H1_REGEX = Regex("^#\\s+(.+?)\\s*$", RegexOption.MULTILINE)

    fun titleFromMarkdown(content: String, fallback: String): String {
        val stripped = content.removePrefix("\uFEFF")
        return H1_REGEX.find(stripped)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() } ?: fallback
    }

    fun pageBookId(pageId: String): String = "page_$pageId"
    fun extractPageId(bookId: String): String = bookId.removePrefix("page_")

    fun gitBlobSha1(content: String): String = gitBlobSha1(content.toByteArray(Charsets.UTF_8))

    fun gitBlobSha1(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-1")
        md.update("blob ${bytes.size}\u0000".toByteArray(Charsets.UTF_8))
        md.update(bytes)
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun pageExcerpt(markdown: String, maxChars: Int = 115): String {
        return markdown
            .replace(Regex("```[\\s\\S]*?```"), " ")
            .replace(Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
            .replace(Regex("<img\\b[^>]*>", RegexOption.IGNORE_CASE), "[图片]")
            .replace(Regex("^[#>\\-*+\\d.\\s]+", RegexOption.MULTILINE), "")
            .replace(Regex("[`*_~]"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(maxChars)
    }
}
