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
import java.text.Collator
import java.util.Base64
import java.util.Locale
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

    private val ENCODED_CHAPTER_ID_REGEX = Regex("^c_[a-f0-9]{32}_([A-Za-z0-9_-]+)$")
    private val OVERVIEW_NAME_REGEX = Regex("^(?:readme|index)$", RegexOption.IGNORE_CASE)
    private val NUMERIC_PREFIX_REGEX = Regex("^\\d+")
    private val IMPORTED_EXT_REGEX = Regex("\\.(?:md|txt|pdf|docx?|pptx?|xlsx?|csv|rtf)$", RegexOption.IGNORE_CASE)
    private val NATURAL_RUN_REGEX = Regex("\\d+|\\D+")
    private val SIMPLE_INLINE_HTML_TAG = Regex(
        "</?(?:u|kbd|sup|sub|mark|strong|b|em|i|code|s|del|span)(?:\\s[^<>]*)?>",
        RegexOption.IGNORE_CASE
    )
    private val MD_IMAGE_REGEX = Regex("!\\[([^\\]]*)\\]\\([^)]*\\)")
    private val MD_LINK_REGEX = Regex("\\[([^\\]]+)\\]\\([^)]*\\)")
    private val MD_REF_LINK_REGEX = Regex("\\[([^\\]]+)\\]\\[[^\\]]*\\]")
    private val MD_MARK_REGEX = Regex("==([^=\\r\\n]+)==")
    private val MD_STRIKE_REGEX = Regex("~~([^~\\r\\n]+)~~")
    private val MD_BOLD_STAR_REGEX = Regex("\\*\\*([^*\\r\\n]+)\\*\\*")
    private val MD_BOLD_UNDERSCORE_REGEX = Regex(
        "(^|[\\s(\\[{\"\\'（【「『《：:、，。！？；—-])__([^_\\r\\n]+)__(?=$|[\\s)\\]}\"\\'）】」』》：:、，。！？；—-])"
    )
    private val MD_ITALIC_STAR_REGEX = Regex("\\*([^*\\s][^*\\r\\n]*?)\\*")
    private val MD_ITALIC_UNDERSCORE_REGEX = Regex(
        "(^|[\\s(\\[{\"\\'（【「『《：:、，。！？；—-])_([^_\\s][^_\\r\\n]*?)_(?=$|[\\s)\\]}\"\\'）】」』》：:、，。！？；—-])"
    )
    private val MD_ESCAPE_REGEX = Regex("\\\\([\\\\`*_{}\\[\\]()#+\\-.!~=|])")
    private val ATX_CLOSING_HASHES_REGEX = Regex("[ \\t]+#+[ \\t]*$")

    private val zhCollator: ThreadLocal<Collator> = ThreadLocal.withInitial {
        Collator.getInstance(Locale.SIMPLIFIED_CHINESE).apply {
            strength = Collator.PRIMARY
        }
    }

    /** Decode the original relative path embedded in an imported chapter ID (`c_<uuid>_<base64url>`). */
    fun decodedEncodedChapterPath(id: String): String? {
        val match = ENCODED_CHAPTER_ID_REGEX.matchEntire(id) ?: return null
        return try {
            val bytes = Base64.getUrlDecoder().decode(match.groupValues[1])
            val decoded = String(bytes, Charsets.UTF_8).replace('\\', '/').trim()
            if (decoded.isNotEmpty() && !decoded.contains('\r') && !decoded.contains('\n')) decoded else null
        } catch (_: Exception) {
            null
        }
    }

    /** Return the nested subfolder label (e.g. `3-异步编程`) for chapters imported from subfolders, or empty string for flat chapters. */
    fun chapterFolderPath(id: String): String {
        val decoded = decodedEncodedChapterPath(id) ?: return ""
        val slash = decoded.lastIndexOf('/')
        return if (slash > 0) decoded.substring(0, slash) else ""
    }

    data class ChapterDisplayInfo(
        val isImported: Boolean,
        val groupName: String,
        val nestedSubpath: String,
        val primaryTitle: String,
        val summaryTitle: String
    )

    data class ChapterDirectoryGroup<T>(
        val key: String,
        val groupName: String,
        val ordinal: Int,
        val items: List<T>
    )

    /**
     * Exact Android port of `chapterDisplayInfo`:
     * - 1st subfolder inside notebook -> collapsible group (`groupName`, 章)
     * - Deeper subfolders (4+ levels) -> flattened as `子文件夹/文档名`
     * - Imported files prioritize filename as `primaryTitle` and show cleaned H1 as `summaryTitle`.
     */
    fun chapterDisplayInfo(id: String, title: String): ChapterDisplayInfo {
        val cleaned = cleanMarkdownTitle(title).ifEmpty { title.trim() }.ifEmpty { title }
        val decoded = decodedEncodedChapterPath(id) ?: return ChapterDisplayInfo(
            isImported = false,
            groupName = "",
            nestedSubpath = "",
            primaryTitle = cleaned,
            summaryTitle = ""
        )
        val parts = decoded.split('/').filter { it.isNotEmpty() }
        val rawFile = parts.lastOrNull() ?: decoded
        val fileStem = IMPORTED_EXT_REGEX.replace(rawFile, "").trim().ifEmpty { rawFile }
        val groupName = if (parts.size >= 2) parts[0] else ""
        val nestedSubpath = if (parts.size >= 3) parts.subList(1, parts.size - 1).joinToString("/") else ""
        val primaryTitle = if (nestedSubpath.isNotEmpty()) "$nestedSubpath/$fileStem" else fileStem
        val normPrimary = fileStem.lowercase(Locale.ROOT).replace(Regex("\\s+"), "")
        val normHeading = cleaned.lowercase(Locale.ROOT).replace(Regex("\\s+"), "")
        val summaryTitle = if (cleaned.isNotEmpty() && normHeading != normPrimary) cleaned else ""
        return ChapterDisplayInfo(
            isImported = true,
            groupName = groupName,
            nestedSubpath = nestedSubpath,
            primaryTitle = primaryTitle,
            summaryTitle = summaryTitle
        )
    }

    fun <T> groupChaptersForDirectory(chapters: List<T>, idOf: (T) -> String): List<ChapterDirectoryGroup<T>> {
        val result = mutableListOf<Pair<String, MutableList<T>>>()
        val groupNames = mutableMapOf<String, String>()
        for (item in chapters) {
            val id = idOf(item)
            val decoded = decodedEncodedChapterPath(id)
            val parts = decoded?.split('/')?.filter { it.isNotEmpty() }.orEmpty()
            val gName = if (parts.size >= 2) parts[0] else ""
            val key = if (gName.isNotEmpty()) "dir:$gName" else "flat:$id"
            val prev = result.lastOrNull()
            if (gName.isNotEmpty() && prev != null && prev.first == key) {
                prev.second.add(item)
            } else {
                result.add(key to mutableListOf(item))
                groupNames[key] = gName
            }
        }
        var ord = 0
        return result.map { (key, list) ->
            val gName = groupNames[key].orEmpty()
            val groupOrd = if (gName.isNotEmpty()) ++ord else 0
            ChapterDirectoryGroup(key = key, groupName = gName, ordinal = groupOrd, items = list)
        }
    }

    private fun compareTextRun(a: String, b: String): Int {
        if (a == b) return 0
        val cmp = zhCollator.get()?.compare(a, b) ?: a.lowercase(Locale.ROOT).compareTo(b.lowercase(Locale.ROOT))
        if (cmp != 0) return cmp
        return a.compareTo(b)
    }

    private fun compareDigitRun(a: String, b: String): Int {
        val normA = a.trimStart('0').ifEmpty { "0" }
        val normB = b.trimStart('0').ifEmpty { "0" }
        if (normA.length != normB.length) return normA.length.compareTo(normB.length)
        if (normA != normB) return normA.compareTo(normB)
        return a.length.compareTo(b.length)
    }

    /** Natural alphanumeric + zh-CN comparator (1 < 2 < 10, deterministic strict weak ordering). */
    fun compareNatural(a: String, b: String): Int {
        if (a == b) return 0
        val partsA = NATURAL_RUN_REGEX.findAll(a).map { it.value }.toList()
        val partsB = NATURAL_RUN_REGEX.findAll(b).map { it.value }.toList()
        val limit = minOf(partsA.size, partsB.size)
        for (i in 0 until limit) {
            val segA = partsA[i]
            val segB = partsB[i]
            if (segA == segB) continue
            val numA = segA[0] in '0'..'9'
            val numB = segB[0] in '0'..'9'
            if (numA && numB) {
                val cmp = compareDigitRun(segA, segB)
                if (cmp != 0) return cmp
            } else if (numA != numB) {
                return if (numA) -1 else 1
            } else {
                val cmp = compareTextRun(segA, segB)
                if (cmp != 0) return cmp
            }
        }
        if (partsA.size != partsB.size) return partsA.size.compareTo(partsB.size)
        return a.compareTo(b)
    }

    private fun segmentBucket(stem: String, isDir: Boolean): Int {
        if (!isDir && OVERVIEW_NAME_REGEX.matches(stem)) return 0
        if (NUMERIC_PREFIX_REGEX.containsMatchIn(stem)) return 1
        return if (isDir) 3 else 2
    }

    /**
     * Strictly transitive hierarchical path comparator for flattened nested folders.
     * Exact mirror of docs/.vitepress/theme/notebookChapterOrder.ts::compareImportedPaths.
     */
    fun compareImportedPaths(pathA: String, pathB: String): Int {
        val normA = pathA.replace('\\', '/').trim('/')
        val normB = pathB.replace('\\', '/').trim('/')
        if (normA == normB) return 0
        val segsA = if (normA.isEmpty()) emptyList() else normA.split('/')
        val segsB = if (normB.isEmpty()) emptyList() else normB.split('/')
        val limit = minOf(segsA.size, segsB.size)
        for (i in 0 until limit) {
            val rawA = segsA[i]
            val rawB = segsB[i]
            val isDirA = i < segsA.lastIndex
            val isDirB = i < segsB.lastIndex
            val stemA = if (isDirA) rawA else rawA.replace(IMPORTED_EXT_REGEX, "")
            val stemB = if (isDirB) rawB else rawB.replace(IMPORTED_EXT_REGEX, "")
            if (stemA == stemB && isDirA == isDirB && rawA == rawB) continue

            val bucketA = segmentBucket(stemA, isDirA)
            val bucketB = segmentBucket(stemB, isDirB)
            if (bucketA != bucketB) return bucketA.compareTo(bucketB)

            val cmpStem = compareNatural(stemA, stemB)
            if (cmpStem != 0) return cmpStem

            if (isDirA != isDirB) return if (isDirA) 1 else -1

            val cmpRaw = compareNatural(rawA, rawB)
            if (cmpRaw != 0) return cmpRaw
        }
        if (segsA.size != segsB.size) return segsA.size.compareTo(segsB.size)
        return normA.compareTo(normB)
    }

    private class ChapterSortEntry<T>(
        val value: T,
        val index: Int,
        val explicitRank: Int?,
        val encodedPath: String?
    )

    fun <T> sortChapters(chapters: List<T>, idSelector: (T) -> String, order: List<String>?): List<T> {
        val rank = if (order.isNullOrEmpty()) null else order.withIndex().associate { it.value to it.index }
        val items = chapters.mapIndexed { idx, ch ->
            val id = idSelector(ch)
            val r = rank?.get(id)
            val encoded = if (r == null) decodedEncodedChapterPath(id) else null
            ChapterSortEntry(ch, idx, r, encoded)
        }
        if (rank == null && items.none { it.encodedPath != null }) {
            return chapters.toList()
        }
        return items.sortedWith { a, b ->
            val rA = a.explicitRank ?: Int.MAX_VALUE
            val rB = b.explicitRank ?: Int.MAX_VALUE
            if (rA != rB) return@sortedWith rA.compareTo(rB)
            if (a.encodedPath != null && b.encodedPath != null) {
                val cmp = compareImportedPaths(a.encodedPath, b.encodedPath)
                if (cmp != 0) return@sortedWith cmp
            } else if (a.encodedPath != null || b.encodedPath != null) {
                return@sortedWith if (a.encodedPath != null) -1 else 1
            }
            a.index.compareTo(b.index)
        }.map { it.value }
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

    private fun truncateUtf8ForId(input: String, maxBytes: Int = 150): String {
        val bytes = input.toByteArray(Charsets.UTF_8)
        if (bytes.size <= maxBytes) return input
        val sb = StringBuilder()
        var count = 0
        for (ch in input) {
            val cb = ch.toString().toByteArray(Charsets.UTF_8).size
            if (count + cb > maxBytes) break
            sb.append(ch)
            count += cb
        }
        return sb.toString().trim().ifEmpty { "note" }
    }

    private fun encodedIdFromTitle(prefix: Char, title: String): String {
        val clean = truncateUtf8ForId(checkTitle(title), 150)
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(clean.toByteArray(Charsets.UTF_8))
        return "${prefix}_${newRandomId()}_$encoded"
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

    private fun stripInlineMarkdownText(segment: String): String {
        var out = segment
        out = MD_IMAGE_REGEX.replace(out, "$1")
        out = MD_LINK_REGEX.replace(out, "$1")
        out = MD_REF_LINK_REGEX.replace(out, "$1")
        out = SIMPLE_INLINE_HTML_TAG.replace(out, "")
        out = MD_MARK_REGEX.replace(out, "$1")
        out = MD_STRIKE_REGEX.replace(out, "$1")
        out = MD_BOLD_STAR_REGEX.replace(out, "$1")
        out = MD_BOLD_UNDERSCORE_REGEX.replace(out, "$1$2")
        out = MD_ITALIC_STAR_REGEX.replace(out, "$1")
        out = MD_ITALIC_UNDERSCORE_REGEX.replace(out, "$1$2")
        out = MD_ESCAPE_REGEX.replace(out, "$1")
        return out
    }

    /**
     * Render inline Markdown syntax in headings/titles into clean plain text while preserving
     * inline-code contents verbatim (e.g. underscores in `05-asyncio_gather.py`).
     * Exact mirror of docs/.vitepress/theme/notebookTitle.ts::cleanMarkdownTitle.
     */
    fun cleanMarkdownTitle(raw: String): String {
        val trimmed = raw.replace(Regex("[\\r\\n]+"), " ").trim()
        if (trimmed.isEmpty()) return ""
        val withoutClosing = ATX_CLOSING_HASHES_REGEX.replace(trimmed, "").trim()
        if (withoutClosing.isEmpty()) return trimmed

        val result = StringBuilder(withoutClosing.length)
        val n = withoutClosing.length
        var i = 0
        var plainStart = 0

        fun flushPlain(end: Int) {
            if (end > plainStart) {
                result.append(stripInlineMarkdownText(withoutClosing.substring(plainStart, end)))
            }
        }

        while (i < n) {
            if (withoutClosing[i] == '\\' && i + 1 < n) {
                i += 2
                continue
            }
            if (withoutClosing[i] == '`') {
                var tickEnd = i
                while (tickEnd < n && withoutClosing[tickEnd] == '`') tickEnd++
                val tickCount = tickEnd - i
                var search = tickEnd
                var closeStart = -1
                while (search < n) {
                    val idx = withoutClosing.indexOf('`', search)
                    if (idx < 0) break
                    var runEnd = idx
                    while (runEnd < n && withoutClosing[runEnd] == '`') runEnd++
                    if (runEnd - idx == tickCount) {
                        closeStart = idx
                        break
                    }
                    search = runEnd
                }
                if (closeStart >= 0) {
                    flushPlain(i)
                    var code = withoutClosing.substring(tickEnd, closeStart)
                    if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.any { it != ' ' }) {
                        code = code.substring(1, code.length - 1)
                    }
                    result.append(code)
                    i = closeStart + tickCount
                    plainStart = i
                    continue
                }
                i = tickEnd
                continue
            }
            i++
        }
        flushPlain(n)

        val cleaned = result.toString().replace(Regex("\\s+"), " ").trim()
        return cleaned.ifEmpty { withoutClosing }
    }

    fun titleFromMarkdown(content: String, fallback: String): String {
        val stripped = content.removePrefix("\uFEFF")
        val raw = H1_REGEX.find(stripped)?.groupValues?.get(1)?.trim()
        if (!raw.isNullOrEmpty()) {
            val cleaned = cleanMarkdownTitle(raw)
            if (cleaned.isNotEmpty()) return cleaned
        }
        return cleanMarkdownTitle(fallback).ifEmpty { fallback }
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
