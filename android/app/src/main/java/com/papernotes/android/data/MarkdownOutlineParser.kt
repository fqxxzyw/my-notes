package com.papernotes.android.data

data class OutlineHeading(
    val index: Int,
    val level: Int,
    val title: String,
    val offset: Int,
    val hasChildren: Boolean = false
)

/**
 * Parses Markdown ATX headings for the collapsible document outline sheet while
 * masking YAML frontmatter and fenced code blocks, preserving exact UTF-16 offsets.
 */
object MarkdownOutlineParser {

    fun parse(source: String): List<OutlineHeading> {
        val masked = maskFrontmatter(source)
        val raw = mutableListOf<Triple<Int, String, Int>>()
        var pos = 0
        val n = masked.length
        var fenceChar = '\u0000'
        var fenceLen = 0

        while (pos < n) {
            val lineStart = pos
            var lineEnd = masked.indexOf('\n', pos)
            if (lineEnd < 0) lineEnd = n
            val line = masked.substring(lineStart, lineEnd).removeSuffix("\r")
            val nextPos = if (lineEnd < n) lineEnd + 1 else n

            if (fenceChar == '\u0000') {
                val open = Regex("^ {0,3}(`{3,}|~{3,})(.*)$").matchEntire(line)
                if (open != null && !(open.groupValues[1][0] == '`' && open.groupValues[2].contains('`'))) {
                    fenceChar = open.groupValues[1][0]
                    fenceLen = open.groupValues[1].length
                    pos = nextPos
                    continue
                }
                val heading = Regex("^ {0,3}(#{1,6})(?:[ \\t]+(.*?))?[ \\t]*#*[ \\t]*$").matchEntire(line)
                if (heading != null) {
                    val level = heading.groupValues[1].length
                    val title = cleanInlineTitle(heading.groupValues[2]).ifEmpty { "未命名标题" }
                    raw.add(Triple(level, title, lineStart))
                }
            } else {
                val close = Regex("^ {0,3}(`{3,}|~{3,})[ \\t]*$").matchEntire(line)
                if (close != null && close.groupValues[1][0] == fenceChar && close.groupValues[1].length >= fenceLen) {
                    fenceChar = '\u0000'
                    fenceLen = 0
                }
            }
            pos = nextPos
        }

        return raw.mapIndexed { idx, (level, title, offset) ->
            val hasChild = idx + 1 < raw.size && raw[idx + 1].first > level
            OutlineHeading(
                index = idx,
                level = level,
                title = title,
                offset = offset,
                hasChildren = hasChild
            )
        }
    }

    /** Compute visible outline headings given a set of collapsed heading indices. */
    fun visibleHeadings(all: List<OutlineHeading>, collapsed: Set<Int>): List<OutlineHeading> {
        val out = mutableListOf<OutlineHeading>()
        var hideBelowLevel: Int? = null
        for (h in all) {
            if (hideBelowLevel != null) {
                if (h.level > hideBelowLevel) continue
                hideBelowLevel = null
            }
            out.add(h)
            if (h.index in collapsed && h.hasChildren) {
                hideBelowLevel = h.level
            }
        }
        return out
    }

    private fun maskFrontmatter(source: String): String {
        val open = Regex("^\\uFEFF?---[ \\t]*(?:\\r\\n|\\r|\\n)").find(source) ?: return source
        val rest = source.substring(open.range.last + 1)
        val close = Regex("^(?:---|\\.\\.\\.)[ \\t]*(?:\\r\\n|\\r|\\n|$)", RegexOption.MULTILINE).find(rest)
            ?: return source
        val end = open.range.last + 1 + close.range.last + 1
        val sb = StringBuilder(source.length)
        for (i in 0 until end) {
            val c = source[i]
            sb.append(if (c == '\r' || c == '\n') c else ' ')
        }
        sb.append(source, end, source.length)
        return sb.toString()
    }

    private fun cleanInlineTitle(raw: String): String = raw
        .replace(Regex("!\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("`([^`]*)`"), "$1")
        .replace(Regex("[*_~]+"), "")
        .trim()
}
