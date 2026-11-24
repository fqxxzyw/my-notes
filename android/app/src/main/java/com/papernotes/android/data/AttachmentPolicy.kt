package com.papernotes.android.data

import java.net.URLDecoder

data class AttachmentReference(val src: String, val path: String)
data class HtmlImageRef(val src: String, val from: Int, val to: Int)
data class MarkdownImageOccurrence(
    val fullFrom: Int,
    val fullTo: Int,
    val urlFrom: Int,
    val urlTo: Int,
    val src: String,
    val isHtml: Boolean,
    val isReference: Boolean = false,
    val alt: String = "",
    val title: String? = null
)

/**
 * Attachment policy, reference extraction, and safe Typora HTML <img> handling,
 * matching docs/.vitepress/theme/{attachmentStore,attachmentReferences,htmlImageRefs,rewriteImportedImages,readDroppedMarkdown}.ts.
 */
object AttachmentPolicy {
    const val MAX_ATTACHMENT_BYTES: Int = 20 * 1024 * 1024
    const val MAX_IMPORT_TOTAL_IMAGE_BYTES: Long = 100L * 1024 * 1024
    const val MAX_IMPORT_FILE_BYTES: Int = 5 * 1024 * 1024
    const val MAX_IMPORT_TOTAL_MD_BYTES: Long = 30L * 1024 * 1024
    const val MAX_IMPORT_FILES: Int = 300
    const val MAX_IMPORT_IMAGES: Int = 300

    val MANAGED_PATH_REGEX =
        Regex("^docs/(?:notebooks/[A-Za-z0-9_-]+|pages)/assets/[a-f0-9]{32}\\.(?:png|jpg|gif|webp)$")
    val MANAGED_SRC_REGEX =
        Regex("^(?:\\./)?assets/[a-f0-9]{32}\\.(?:png|jpg|gif|webp)$")

    private val MIME_TO_EXT = mapOf(
        "image/png" to "png",
        "image/jpeg" to "jpg",
        "image/jpg" to "jpg",
        "image/gif" to "gif",
        "image/webp" to "webp"
    )

    fun validateAttachmentPath(path: String): String {
        if (!MANAGED_PATH_REGEX.matches(path)) {
            throw IllegalArgumentException("图片附件路径无效。")
        }
        return path
    }

    fun extensionForMime(mime: String?): String? = MIME_TO_EXT[mime?.lowercase()?.trim()]

    fun mimeForFilename(name: String): String? = when (name.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        else -> null
    }

    fun detectMimeFromBytes(bytes: ByteArray): String? {
        if (isPng(bytes)) return "image/png"
        if (isJpeg(bytes)) return "image/jpeg"
        if (isGif(bytes)) return "image/gif"
        if (isWebp(bytes)) return "image/webp"
        return null
    }

    fun newAttachmentPath(bookId: String?, mime: String): String {
        val ext = extensionForMime(mime)
            ?: throw IllegalArgumentException("仅支持 PNG、JPEG、GIF 或 WebP 图片。")
        if (bookId != null && !CompatibilityCodecs.ID_REGEX.matches(bookId)) {
            throw IllegalArgumentException("笔记本标识无效。")
        }
        val base = if (bookId == null) "docs/pages" else "docs/notebooks/$bookId"
        return validateAttachmentPath("$base/assets/${CompatibilityCodecs.newRandomId()}.$ext")
    }

    fun attachmentMime(path: String): String {
        validateAttachmentPath(path)
        return when (path.substringAfterLast('.')) {
            "jpg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            else -> throw IllegalArgumentException("不支持的图片格式。")
        }
    }

    fun isPng(b: ByteArray): Boolean =
        b.size >= 8 &&
            b[0] == 0x89.toByte() && b[1] == 0x50.toByte() && b[2] == 0x4E.toByte() && b[3] == 0x47.toByte() &&
            b[4] == 0x0D.toByte() && b[5] == 0x0A.toByte() && b[6] == 0x1A.toByte() && b[7] == 0x0A.toByte()

    fun isJpeg(b: ByteArray): Boolean =
        b.size >= 3 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() && b[2] == 0xFF.toByte()

    fun isGif(b: ByteArray): Boolean {
        if (b.size < 6) return false
        val header = String(b, 0, 6, Charsets.US_ASCII)
        return header == "GIF87a" || header == "GIF89a"
    }

    fun isWebp(b: ByteArray): Boolean {
        if (b.size < 12) return false
        return String(b, 0, 4, Charsets.US_ASCII) == "RIFF" &&
            String(b, 8, 4, Charsets.US_ASCII) == "WEBP"
    }

    fun isValidImageBytesForExtension(filename: String, bytes: ByteArray): Boolean {
        if (bytes.isEmpty() || bytes.size > MAX_ATTACHMENT_BYTES) return false
        return when (filename.substringAfterLast('.', "").lowercase()) {
            "png" -> isPng(bytes)
            "jpg", "jpeg" -> isJpeg(bytes)
            "gif" -> isGif(bytes)
            "webp" -> isWebp(bytes)
            else -> false
        }
    }

    fun validateAttachment(attachment: NoteAttachment): NoteAttachment {
        validateAttachmentPath(attachment.path)
        if (attachment.bytes.isEmpty() || attachment.bytes.size > MAX_ATTACHMENT_BYTES) {
            throw IllegalArgumentException("图片为空或超过 20 MiB，请缩小后重试。")
        }
        if (!isValidImageBytesForExtension(attachment.path, attachment.bytes)) {
            throw IllegalArgumentException("图片内容与文件格式不匹配。")
        }
        if (attachment.sha != null && !CompatibilityCodecs.SHA_REGEX.matches(attachment.sha)) {
            throw IllegalArgumentException("图片版本号无效。")
        }
        return attachment
    }

    // --- Safe relative path resolution (matching readDroppedMarkdown.ts) ---

    fun isValidInputPath(path: String): Boolean {
        if (path.isEmpty() || path.startsWith('/') || path.contains('\\') || path.contains('\u0000')) return false
        return path.split('/').all { part -> part.isNotEmpty() && part != "." && part != ".." }
    }

    fun resolveDroppedImagePath(markdownPath: String, target: String): String? {
        if (!isValidInputPath(markdownPath) || target.isEmpty()) return null
        if (Regex("^[a-z][a-z\\d+.-]*:", RegexOption.IGNORE_CASE).containsMatchIn(target)) return null
        if (target.startsWith('/') || target.startsWith('\\')) return null
        val withoutQuery = target.substringBefore('?').substringBefore('#')
        val result = markdownPath.split('/').dropLast(1).toMutableList()
        val rootDepth = if ('/' in markdownPath) 1 else 0
        try {
            for (encoded in withoutQuery.split('/')) {
                val part = decodeUriSegment(encoded)
                if (part.isEmpty() || part == ".") continue
                if ('/' in part || '\\' in part || '\u0000' in part) return null
                if (part == "..") {
                    if (result.size <= rootDepth) return null
                    result.removeAt(result.lastIndex)
                } else {
                    result.add(part)
                }
            }
        } catch (_: Exception) {
            return null
        }
        val joined = result.joinToString("/")
        return if (result.size > rootDepth && isValidInputPath(joined)) joined else null
    }

    private fun decodeUriSegment(segment: String): String {
        // URLDecoder turns '+' into space, whereas URI path segments keep '+' literal.
        val preserved = segment.replace("+", "%2B")
        return URLDecoder.decode(preserved, "UTF-8")
    }

    // --- Masking code fences, inline code, comments, raw HTML blocks ---

    private fun computeIgnoredRanges(source: String): List<IntRange> {
        val ignored = mutableListOf<IntRange>()
        var i = 0
        val n = source.length
        var inFenceChar = '\u0000'
        var fenceLen = 0

        // 1. Scan line by line for fenced code blocks
        while (i < n) {
            val lineStart = i
            var lineEnd = source.indexOf('\n', i)
            if (lineEnd < 0) lineEnd = n
            val rawLine = source.substring(lineStart, lineEnd).removeSuffix("\r")
            val nextI = if (lineEnd < n) lineEnd + 1 else n

            if (inFenceChar == '\u0000') {
                val openMatch = Regex("^ {0,3}(`{3,}|~{3,})(.*)$").matchEntire(rawLine)
                if (openMatch != null) {
                    val marker = openMatch.groupValues[1]
                    val info = openMatch.groupValues[2]
                    if (!(marker[0] == '`' && info.contains('`'))) {
                        inFenceChar = marker[0]
                        fenceLen = marker.length
                        ignored.add(lineStart until nextI)
                        i = nextI
                        continue
                    }
                }
            } else {
                ignored.add(lineStart until nextI)
                val closeMatch = Regex("^ {0,3}(`{3,}|~{3,})[ \\t]*$").matchEntire(rawLine)
                if (closeMatch != null &&
                    closeMatch.groupValues[1][0] == inFenceChar &&
                    closeMatch.groupValues[1].length >= fenceLen
                ) {
                    inFenceChar = '\u0000'
                    fenceLen = 0
                }
                i = nextI
                continue
            }
            i = nextI
        }

        // 2. Scan outside fenced blocks for inline code spans (`...`)
        val codeSpans = mutableListOf<IntRange>()
        var pos = 0
        while (pos < n) {
            if (ignored.any { pos in it }) {
                pos++
                continue
            }
            if (source[pos] == '\\' && pos + 1 < n) {
                pos += 2
                continue
            }
            if (source[pos] == '`') {
                val start = pos
                var count = 0
                while (pos < n && source[pos] == '`') {
                    count++
                    pos++
                }
                // Find matching run of exact `count` backticks
                var search = pos
                var foundEnd = -1
                while (search < n) {
                    if (ignored.any { search in it }) break
                    if (source[search] == '`') {
                        var run = 0
                        while (search + run < n && source[search + run] == '`') run++
                        if (run == count) {
                            foundEnd = search + run
                            break
                        }
                        search += run
                    } else {
                        search++
                    }
                }
                if (foundEnd > 0) {
                    codeSpans.add(start until foundEnd)
                    pos = foundEnd
                }
            } else {
                pos++
            }
        }
        return (ignored + codeSpans).sortedBy { it.first }
    }

    private fun isIgnored(index: Int, ignored: List<IntRange>): Boolean =
        ignored.any { index in it }

    // --- Reference definitions [label]: url "title" ---

    private data class RefDef(val url: String, val title: String?)

    private fun parseReferenceDefinitions(source: String, ignored: List<IntRange>): Map<String, RefDef> {
        val defs = LinkedHashMap<String, RefDef>()
        var pos = 0
        val regex = Regex("^ {0,3}\\[([^\\]]+)\\]:[ \\t]*(?:<([^>\\r\\n]+)>|(\\S+))(?:[ \\t]+(?:\"([^\"]*)\"|'([^']*)'|\\(([^)]*)\\)))?[ \\t]*$")
        while (pos < source.length) {
            val lineEnd = source.indexOf('\n', pos).let { if (it < 0) source.length else it }
            if (!isIgnored(pos, ignored)) {
                val line = source.substring(pos, lineEnd).removeSuffix("\r")
                val m = regex.matchEntire(line)
                if (m != null) {
                    val label = m.groupValues[1].trim().lowercase().replace(Regex("\\s+"), " ")
                    val url = m.groupValues[2].ifEmpty { m.groupValues[3] }.trim()
                    val title = m.groupValues[4].ifEmpty { m.groupValues[5].ifEmpty { m.groupValues[6] } }.ifEmpty { null }
                    defs.putIfAbsent(label, RefDef(url, title))
                }
            }
            pos = if (lineEnd < source.length) lineEnd + 1 else source.length
        }
        return defs
    }

    // --- HTML <img> scanner (exact port of htmlImageRefs.ts) ---

    private fun findTagEnd(text: String, start: Int): Int {
        var quote = '\u0000'
        for (i in (start + 1) until text.length) {
            val ch = text[i]
            if (quote != '\u0000') {
                if (ch == quote) quote = '\u0000'
                continue
            }
            if (ch == '"' || ch == '\'') quote = ch
            else if (ch == '>') return i + 1
        }
        return -1
    }

    private fun parseImgTagSource(tag: String, offset: Int): HtmlImageRef? {
        val header = Regex("^<img(?=[\\s/>])", RegexOption.IGNORE_CASE).find(tag) ?: return null
        var i = header.value.length
        var foundRange: IntRange? = null
        while (i < tag.length) {
            while (i < tag.length && tag[i].isWhitespace()) i++
            if (i >= tag.length || tag[i] == '>' || (tag[i] == '/' && i + 1 < tag.length && tag[i + 1] == '>')) break
            val begin = i
            while (i < tag.length && tag[i] !in charArrayOf(' ', '\t', '\r', '\n', '"', '\'', '<', '>', '/', '=')) i++
            if (i == begin) return null
            val key = tag.substring(begin, i).lowercase()
            while (i < tag.length && tag[i].isWhitespace()) i++
            if (i >= tag.length || tag[i] != '=') {
                if (key == "src") return null
                continue
            }
            i++
            while (i < tag.length && tag[i].isWhitespace()) i++
            if (i >= tag.length) return null
            val valueStart: Int
            val valueEnd: Int
            if (tag[i] == '"' || tag[i] == '\'') {
                val q = tag[i++]
                valueStart = i
                while (i < tag.length && tag[i] != q) i++
                if (i >= tag.length) return null
                valueEnd = i++
            } else {
                valueStart = i
                while (i < tag.length && tag[i] !in charArrayOf(' ', '\t', '\r', '\n', '"', '\'', '=', '<', '>', '`')) i++
                valueEnd = i
                if (valueStart == valueEnd) return null
            }
            if (key == "src") {
                if (foundRange != null) return null // duplicate src is ambiguous
                foundRange = valueStart until valueEnd
            }
        }
        val range = foundRange ?: return null
        val raw = tag.substring(range.first, range.last + 1).trim()
        val unescaped = unescapeHtmlEntities(raw)
        if (unescaped.isEmpty()) return null
        return HtmlImageRef(
            src = unescaped,
            from = offset + range.first,
            to = offset + range.last + 1
        )
    }

    private fun unescapeHtmlEntities(input: String): String = input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")

    fun extractAllImageOccurrences(source: String): List<MarkdownImageOccurrence> {
        val ignored = computeIgnoredRanges(source)
        val defs = parseReferenceDefinitions(source, ignored)
        val results = mutableListOf<MarkdownImageOccurrence>()
        val n = source.length
        var i = 0

        // Pass 1: HTML <img> tags outside code fences/spans, comments, and raw-text tags
        while (i < n) {
            if (isIgnored(i, ignored)) {
                i++
                continue
            }
            if (source[i] == '<') {
                if (source.startsWith("<!--", i)) {
                    val end = source.indexOf("-->", i + 4)
                    if (end < 0) break
                    i = end + 3
                    continue
                }
                val end = findTagEnd(source, i)
                if (end > i) {
                    val tag = source.substring(i, end)
                    val img = parseImgTagSource(tag, i)
                    if (img != null) {
                        results.add(
                            MarkdownImageOccurrence(
                                fullFrom = i,
                                fullTo = end,
                                urlFrom = img.from,
                                urlTo = img.to,
                                src = img.src,
                                isHtml = true
                            )
                        )
                    }
                    val rawTag = Regex("^<(script|style|textarea|title)(?=[\\s/>])", RegexOption.IGNORE_CASE).find(tag)
                    if (rawTag != null && !Regex("/\\s*>$").containsMatchIn(tag)) {
                        val closeRe = Regex("</${rawTag.groupValues[1]}\\s*>", RegexOption.IGNORE_CASE)
                        val closeMatch = closeRe.find(source, end)
                        i = closeMatch?.range?.last?.plus(1) ?: n
                        continue
                    }
                    i = end
                    continue
                }
            }
            i++
        }

        // Pass 2: Standard Markdown images ![alt](dest) and ![alt][ref]
        i = 0
        while (i < n - 1) {
            if (isIgnored(i, ignored)) {
                i++
                continue
            }
            if (source[i] == '\\' && i + 1 < n) {
                i += 2
                continue
            }
            if (source[i] == '!' && source[i + 1] == '[') {
                val start = i
                var j = i + 2
                var bracketDepth = 1
                while (j < n && bracketDepth > 0) {
                    if (source[j] == '\\' && j + 1 < n) {
                        j += 2
                        continue
                    }
                    if (source[j] == '[') bracketDepth++
                    else if (source[j] == ']') bracketDepth--
                    if (bracketDepth > 0) j++
                }
                if (bracketDepth == 0 && j < n) {
                    val alt = source.substring(start + 2, j)
                    val afterBracket = j + 1
                    if (afterBracket < n && source[afterBracket] == '(') {
                        var k = afterBracket + 1
                        while (k < n && source[k].isWhitespace()) k++
                        val urlStart = k
                        var urlEnd = k
                        var dest = ""
                        var valid = false
                        if (k < n && source[k] == '<') {
                            val closeAngle = source.indexOf('>', k + 1)
                            if (closeAngle > k && !source.substring(k + 1, closeAngle).contains('\n')) {
                                urlEnd = closeAngle + 1
                                dest = source.substring(k + 1, closeAngle).trim()
                                k = closeAngle + 1
                                valid = true
                            }
                        } else {
                            var parenDepth = 0
                            while (k < n) {
                                val ch = source[k]
                                if (ch == '\\' && k + 1 < n) {
                                    k += 2
                                    continue
                                }
                                if (ch.isWhitespace()) break
                                if (ch == '(') parenDepth++
                                else if (ch == ')') {
                                    if (parenDepth == 0) break
                                    parenDepth--
                                }
                                k++
                            }
                            urlEnd = k
                            dest = source.substring(urlStart, urlEnd).replace(Regex("\\\\([!\"#$%&'()*+,\\-./:;<=>?@\\[\\\\\\]^_`{|}~])"), "$1")
                            valid = dest.isNotEmpty()
                        }
                        if (valid) {
                            while (k < n && source[k].isWhitespace()) k++
                            // Optional title
                            if (k < n && (source[k] == '"' || source[k] == '\'' || source[k] == '(')) {
                                val closeCh = if (source[k] == '(') ')' else source[k]
                                k++
                                while (k < n && source[k] != closeCh) {
                                    if (source[k] == '\\' && k + 1 < n) k += 2 else k++
                                }
                                if (k < n) k++
                                while (k < n && source[k].isWhitespace()) k++
                            }
                            if (k < n && source[k] == ')') {
                                results.add(
                                    MarkdownImageOccurrence(
                                        fullFrom = start,
                                        fullTo = k + 1,
                                        urlFrom = urlStart,
                                        urlTo = urlEnd,
                                        src = dest,
                                        isHtml = false,
                                        alt = alt
                                    )
                                )
                                i = k + 1
                                continue
                            }
                        }
                    } else if (afterBracket < n && source[afterBracket] == '[') {
                        val refClose = source.indexOf(']', afterBracket + 1)
                        if (refClose > afterBracket) {
                            val rawLabel = source.substring(afterBracket + 1, refClose).ifEmpty { alt }
                            val key = rawLabel.trim().lowercase().replace(Regex("\\s+"), " ")
                            val def = defs[key]
                            if (def != null) {
                                results.add(
                                    MarkdownImageOccurrence(
                                        fullFrom = start,
                                        fullTo = refClose + 1,
                                        urlFrom = start,
                                        urlTo = refClose + 1,
                                        src = def.url,
                                        isHtml = false,
                                        isReference = true,
                                        alt = alt,
                                        title = def.title
                                    )
                                )
                                i = refClose + 1
                                continue
                            }
                        }
                    }
                }
            }
            i++
        }

        return results.sortedBy { it.fullFrom }
    }

    /** Extract all app-managed attachment paths referenced by Markdown or HTML <img>. */
    fun extractAttachmentReferences(source: String, bookId: String?): List<AttachmentReference> {
        val found = LinkedHashMap<String, String>()
        val base = if (bookId == null) "docs/pages" else "docs/notebooks/$bookId"
        for (occ in extractAllImageOccurrences(source)) {
            val src = occ.src.trim()
            if (!MANAGED_SRC_REGEX.matches(src)) continue
            val normalized = src.removePrefix("./")
            try {
                found[src] = validateAttachmentPath("$base/$normalized")
            } catch (_: Exception) {
                // Ignore non-managed paths
            }
        }
        return found.map { (src, path) -> AttachmentReference(src, path) }
    }

    /** Extract relative (non-http, non-data, non-absolute) image targets for folder import & repair. */
    fun extractRelativeImageTargets(source: String): List<String> {
        val targets = LinkedHashSet<String>()
        for (occ in extractAllImageOccurrences(source)) {
            val value = occ.src.trim()
            if (value.isEmpty() || value.startsWith('#') || value.startsWith('/') || value.startsWith('\\')) continue
            if (Regex("^[a-z][a-z\\d+.-]*:", RegexOption.IGNORE_CASE).containsMatchIn(value)) continue
            targets.add(value)
        }
        return targets.toList()
    }

    /**
     * Rewrite only matched image destinations to `assets/<32hex>.<ext>`,
     * preserving Typora <img> style="zoom:..." / width / height and untouched Markdown bytes.
     */
    fun rewriteImportedImages(
        source: String,
        destinations: Map<String, String>
    ): Pair<String, Set<String>> {
        if (destinations.isEmpty()) return source to emptySet()
        data class Edit(val from: Int, val to: Int, val text: String, val target: String)
        val edits = mutableListOf<Edit>()

        for (occ in extractAllImageOccurrences(source)) {
            val dest = destinations[occ.src] ?: continue
            if (!Regex("^assets/[a-f0-9]{32}\\.(?:png|jpg|gif|webp)$").matches(dest)) continue
            when {
                occ.isHtml -> {
                    edits.add(Edit(occ.urlFrom, occ.urlTo, dest, occ.src))
                }
                occ.isReference -> {
                    val titlePart = occ.title?.let { " \"${it.replace("\"", "\\\"")}\"" }.orEmpty()
                    edits.add(Edit(occ.fullFrom, occ.fullTo, "![${occ.alt}]($dest$titlePart)", occ.src))
                }
                else -> {
                    val original = source.substring(occ.urlFrom, occ.urlTo)
                    val replacement = if (original.startsWith('<') && original.endsWith('>')) "<$dest>" else dest
                    edits.add(Edit(occ.urlFrom, occ.urlTo, replacement, occ.src))
                }
            }
        }
        if (edits.isEmpty()) return source to emptySet()

        var result = source
        for (edit in edits.sortedByDescending { it.from }) {
            result = result.substring(0, edit.from) + edit.text + result.substring(edit.to)
        }
        return result to edits.map { it.target }.toSet()
    }
}
