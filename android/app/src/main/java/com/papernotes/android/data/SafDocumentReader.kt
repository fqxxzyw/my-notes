package com.papernotes.android.data

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.documentfile.provider.DocumentFile
import java.io.ByteArrayOutputStream

/**
 * Android SAF (Storage Access Framework) & Clipboard reader requiring zero dangerous
 * external storage permissions. Respects explicit user document/folder selections only.
 */
object SafDocumentReader {

    fun queryDisplayNameAndSize(context: Context, uri: Uri): Pair<String, Long> {
        var name = "unnamed"
        var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0) cursor.getString(nameIdx)?.let { name = it }
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
                }
            }
        return name to size
    }

    fun readBytesBounded(context: Context, uri: Uri, maxBytes: Int): ByteArray {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val read = input.read(buf)
                if (read < 0) break
                total += read
                if (total > maxBytes) {
                    throw IllegalArgumentException("文件超过大小限制（最大 ${maxBytes / (1024 * 1024)} MiB）。")
                }
                out.write(buf, 0, read)
            }
            return out.toByteArray()
        } ?: throw IllegalStateException("无法读取所选文件，可能缺少访问权限或文件已被移除。")
    }

    fun readSingleImageUri(context: Context, uri: Uri): Pair<String, ByteArray> {
        val bytes = readBytesBounded(context, uri, AttachmentPolicy.MAX_ATTACHMENT_BYTES)
        if (bytes.isEmpty()) throw IllegalArgumentException("所选图片为空文件。")
        val detectedMime = AttachmentPolicy.detectMimeFromBytes(bytes)
            ?: throw IllegalArgumentException("仅支持 PNG、JPEG、GIF 或 WebP 图片。")
        return detectedMime to bytes
    }

    fun readClipboardImage(context: Context): Pair<String, ByteArray>? {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
        val clip = clipboard.primaryClip ?: return null
        for (i in 0 until clip.itemCount) {
            val uri = clip.getItemAt(i).uri ?: continue
            val mime = context.contentResolver.getType(uri)
            if (mime != null && mime.startsWith("image/")) {
                return readSingleImageUri(context, uri)
            }
            // Some apps omit MIME type on image URIs; probe magic bytes safely.
            try {
                return readSingleImageUri(context, uri)
            } catch (_: Exception) {
                // Continue checking remaining clip items
            }
        }
        return null
    }

    fun readMarkdownUris(context: Context, uris: List<Uri>): ScanImportResult {
        val entries = uris.map { uri ->
            val (name, size) = queryDisplayNameAndSize(context, uri)
            val safeName = name.ifBlank { "note.md" }
            ImportSourceEntry(
                relativePath = safeName,
                name = safeName,
                sizeBytes = if (size >= 0) size else 0L,
                readBytes = { readBytesBounded(context, uri, AttachmentPolicy.MAX_IMPORT_FILE_BYTES) }
            )
        }
        return ImportEngine.scanEntries(entries)
    }

    fun readDocumentTree(context: Context, treeUri: Uri, maxEntries: Int = 2000, maxDepth: Int = 32): ScanImportResult {
        val root = DocumentFile.fromTreeUri(context, treeUri)
            ?: throw IllegalStateException("无法打开所选文件夹，请重新授予访问权限。")
        if (!root.canRead()) {
            throw SecurityException("没有读取该文件夹的权限，请重新选择文件夹。")
        }
        val rootName = root.name?.trim()?.takeIf { it.isNotEmpty() && '/' !in it && '\\' !in it } ?: "导入笔记"
        val entries = mutableListOf<ImportSourceEntry>()
        var seen = 0

        fun walk(dir: DocumentFile, prefix: String, depth: Int) {
            if (depth > maxDepth || seen >= maxEntries) return
            for (child in dir.listFiles()) {
                if (seen >= maxEntries) return
                seen++
                val name = child.name ?: continue
                if (name.isEmpty() || name == "." || name == ".." || '/' in name || '\\' in name) continue
                val rel = "$prefix/$name"
                if (child.isDirectory) {
                    walk(child, rel, depth + 1)
                } else if (child.isFile) {
                    val uri = child.uri
                    val size = child.length()
                    val limit = if (name.endsWith(".md", ignoreCase = true)) {
                        AttachmentPolicy.MAX_IMPORT_FILE_BYTES
                    } else {
                        AttachmentPolicy.MAX_ATTACHMENT_BYTES
                    }
                    entries.add(
                        ImportSourceEntry(
                            relativePath = rel,
                            name = name,
                            sizeBytes = size,
                            readBytes = { readBytesBounded(context, uri, limit) }
                        )
                    )
                }
            }
        }

        walk(root, rootName, 0)
        return ImportEngine.scanEntries(entries, rootFolderNames = listOf(rootName))
    }
}
