package com.papernotes.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.util.Base64
import java.util.concurrent.TimeUnit

enum class StoreErrorCode {
    AUTH, NOT_FOUND, CONFLICT, NETWORK, INVALID, GITHUB
}

class NotebookStoreException(
    val code: StoreErrorCode,
    override val message: String,
    val conflictPath: String? = null,
    val remoteSha: String? = null
) : Exception(message)

data class BatchSyncResult(
    val parent: String,
    val head: String,
    val books: List<Notebook>,
    val chapters: List<Chapter>,
    val pages: List<Page>,
    val catalog: CatalogVersion?
)

data class BatchDeleteResult(
    val parent: String,
    val head: String,
    val catalog: CatalogVersion?
)

/**
 * GitHub REST + Git Data API client byte-compatible with docs/.vitepress/theme/notebookStore.ts.
 * Performs optimistic SHA verification before writes and commits Markdown + images atomically with force=false.
 */
class GitHubNotebookClient(
    repository: String,
    private var token: String = "",
    apiBaseUrl: String = "https://api.github.com",
    private val httpClient: OkHttpClient = defaultHttpClient()
) {
    companion object {
        private const val ROOT = "notebooks"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

        private fun encodeSegment(seg: String): String =
            URLEncoder.encode(seg, "UTF-8").replace("+", "%20")
    }

    val canonicalRepository: String = RepositoryIdentity.normalizeRepository(repository)
    private val base = apiBaseUrl.trimEnd('/')
    private val repoPath = canonicalRepository.split('/').joinToString("/") { encodeSegment(it) }
    private val repoApi = "$base/repos/$repoPath"
    private val contentsApi = "$repoApi/contents/docs"
    private val gitApi = "$repoApi/git"

    fun setToken(value: String) {
        token = value.trim()
    }

    fun clearToken() {
        token = ""
    }

    private fun buildHeaders(builder: Request.Builder): Request.Builder {
        builder
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("Cache-Control", "no-store")
        if (token.isNotEmpty()) {
            builder.header("Authorization", "Bearer $token")
        }
        return builder
    }

    private suspend fun executeJson(
        url: String,
        method: String = "GET",
        bodyObj: JsonObject? = null,
        allowMissing: Boolean = false,
        isGitWrite: Boolean = false
    ): JsonElement? = withContext(Dispatchers.IO) {
        val reqBuilder = buildHeaders(Request.Builder().url(url))
        when (method) {
            "GET" -> reqBuilder.get()
            "POST" -> reqBuilder.post((bodyObj?.let { json.encodeToString(it) } ?: "{}").toRequestBody(JSON_MEDIA))
            "PATCH" -> reqBuilder.patch((bodyObj?.let { json.encodeToString(it) } ?: "{}").toRequestBody(JSON_MEDIA))
            else -> throw IllegalArgumentException("Unsupported method $method")
        }
        val response = try {
            httpClient.newCall(reqBuilder.build()).execute()
        } catch (_: IOException) {
            throw NotebookStoreException(
                StoreErrorCode.NETWORK,
                if (isGitWrite) "无法连接 GitHub。提交结果可能未知，请保留草稿并用相同内容重试。"
                else "无法连接 GitHub，请检查网络后重试。"
            )
        }
        response.use { res ->
            if (res.code == 404 && allowMissing) return@withContext null
            if (!res.isSuccessful) {
                when (res.code) {
                    401, 403 -> throw NotebookStoreException(
                        StoreErrorCode.AUTH,
                        "GitHub 拒绝访问。请检查令牌权限或稍后重试。"
                    )
                    404 -> throw NotebookStoreException(
                        StoreErrorCode.NOT_FOUND,
                        if (isGitWrite) "仓库或 main 分支不存在，或无权访问。"
                        else "文件或仓库不存在，或无权访问。"
                    )
                    409, 422 -> if (method == "PATCH") {
                        throw NotebookStoreException(
                            StoreErrorCode.CONFLICT,
                            "同步期间远程分支发生变化，请保留草稿并重新检查后重试。"
                        )
                    } else {
                        throw NotebookStoreException(
                            StoreErrorCode.GITHUB,
                            "GitHub 请求失败（HTTP ${res.code}）。请保留草稿后重试。"
                        )
                    }
                    else -> throw NotebookStoreException(
                        StoreErrorCode.GITHUB,
                        "GitHub 请求失败（HTTP ${res.code}）。请保留草稿后重试。"
                    )
                }
            }
            val text = res.body?.string()
                ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回了空响应。")
            try {
                json.parseToJsonElement(text)
            } catch (_: Exception) {
                throw NotebookStoreException(
                    StoreErrorCode.GITHUB,
                    "GitHub 返回了无法识别的数据；请保留草稿并用相同内容重试。"
                )
            }
        }
    }

    private suspend fun contentsRequest(path: String, allowMissing: Boolean = false): JsonElement? {
        val encoded = path.split('/').joinToString("/") { encodeSegment(it) }
        return executeJson("$contentsApi/$encoded?ref=main", "GET", allowMissing = allowMissing)
    }

    private suspend fun gitRequest(
        path: String,
        method: String = "GET",
        bodyObj: JsonObject? = null
    ): JsonObject {
        val el = executeJson("$gitApi/$path", method, bodyObj, isGitWrite = method != "GET")
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 未返回数据。")
        return el as? JsonObject
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回了无效的 Git 数据。")
    }

    private fun decodeBase64Utf8(fileObj: JsonObject): String {
        val encoding = fileObj["encoding"]?.jsonPrimitive?.content
        val content = fileObj["content"]?.jsonPrimitive?.content
        if (encoding != "base64" || content == null) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "无法读取文件内容（文件可能超过 GitHub 接口的大小限制）。")
        }
        return try {
            val bytes = Base64.getMimeDecoder().decode(content)
            // Strict UTF-8 check
            val decoder = Charsets.UTF_8.newDecoder()
            decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        } catch (_: Exception) {
            throw NotebookStoreException(StoreErrorCode.INVALID, "文件不是有效的 UTF-8 文本。")
        }
    }

    private fun decodeBase64Bytes(fileObj: JsonObject): ByteArray {
        val encoding = fileObj["encoding"]?.jsonPrimitive?.content
        val content = fileObj["content"]?.jsonPrimitive?.content
        if (encoding != "base64" || content == null) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "无法读取图片附件。")
        }
        val cleaned = content.replace(Regex("\\s"), "")
        val maxEncoded = ((AttachmentPolicy.MAX_ATTACHMENT_BYTES + 2) / 3) * 4
        if (cleaned.length > maxEncoded) {
            throw NotebookStoreException(StoreErrorCode.INVALID, "图片超过 20 MiB，无法保存到本机。")
        }
        return try {
            Base64.getDecoder().decode(cleaned)
        } catch (_: Exception) {
            throw NotebookStoreException(StoreErrorCode.INVALID, "图片附件格式无效。")
        }
    }

    private suspend fun readFileContent(fileObj: JsonObject): String {
        val encoding = fileObj["encoding"]?.jsonPrimitive?.content
        val content = fileObj["content"]?.jsonPrimitive?.content
        if (encoding == "base64" && content != null) return decodeBase64Utf8(fileObj)
        val sha = fileObj["sha"]?.jsonPrimitive?.content.orEmpty()
        if (!CompatibilityCodecs.SHA_REGEX.matches(sha)) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的文件版本号无效。")
        }
        return decodeBase64Utf8(gitRequest("blobs/${encodeSegment(sha)}"))
    }

    private suspend fun readFileObject(path: String): JsonObject {
        val el = contentsRequest(path) as? JsonObject
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的文件信息无效。")
        if (el["type"]?.jsonPrimitive?.content != "file" || el["sha"]?.jsonPrimitive?.content == null) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的文件信息无效。")
        }
        return el
    }

    private suspend fun readEntries(path: String, allowMissing: Boolean = false): List<JsonObject> {
        val el = contentsRequest(path, allowMissing) ?: return emptyList()
        val arr = el as? JsonArray
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的目录信息无效。")
        if (arr.size >= 1000) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "目录文件过多，无法完整读取。")
        }
        return arr.map { it.jsonObject }
    }

    // --- Public API ---

    suspend fun verifyRepository() {
        executeJson(repoApi, "GET")
    }

    suspend fun readHead(): String {
        val ref = gitRequest("ref/heads/main")
        val sha = ref["object"]?.jsonObject?.get("sha")?.jsonPrimitive?.content.orEmpty()
        if (!CompatibilityCodecs.SHA_REGEX.matches(sha)) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的分支版本无效。")
        }
        return sha
    }

    suspend fun readCatalog(): CatalogVersion {
        val el = contentsRequest("cabinets.json", allowMissing = true) ?: return CatalogVersion(
            CompatibilityCodecs.defaultCatalog(), ""
        )
        val obj = el as? JsonObject
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的书柜文件信息无效。")
        if (obj["type"]?.jsonPrimitive?.content != "file") {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的书柜文件信息无效。")
        }
        val sha = obj["sha"]?.jsonPrimitive?.content
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的书柜文件信息无效。")
        val raw = readFileContent(obj)
        val parsed = try {
            CompatibilityCodecs.parseCatalog(raw)
        } catch (e: Exception) {
            throw NotebookStoreException(StoreErrorCode.INVALID, e.message ?: "书柜目录格式无效。")
        }
        return CatalogVersion(parsed, sha)
    }

    suspend fun readNotebook(bookId: String): Notebook {
        CompatibilityCodecs.checkId(bookId)
        val data = readFileObject("$ROOT/$bookId/index.md")
        val content = readFileContent(data)
        val sha = data["sha"]!!.jsonPrimitive.content
        return Notebook(
            id = bookId,
            title = CompatibilityCodecs.titleFromMarkdown(content, bookId),
            sha = sha,
            description = CompatibilityCodecs.readNotebookDescription(content),
            indexContent = content,
            chapterOrder = CompatibilityCodecs.readNotebookChapterOrder(content)
        )
    }

    suspend fun listNotebooks(): List<Notebook> {
        val dirs = readEntries(ROOT, allowMissing = true)
            .filter {
                it["type"]?.jsonPrimitive?.content == "dir" &&
                    CompatibilityCodecs.ID_REGEX.matches(it["name"]?.jsonPrimitive?.content.orEmpty())
            }
        val result = mutableListOf<Notebook>()
        for (dir in dirs) {
            val id = dir["name"]!!.jsonPrimitive.content
            val data = try {
                readFileObject("$ROOT/$id/index.md")
            } catch (e: NotebookStoreException) {
                if (e.code != StoreErrorCode.NOT_FOUND) throw e
                // Skip assets-only folders left behind by deleted notebooks
                val remaining = readEntries("$ROOT/$id")
                if (remaining.size != 1 ||
                    remaining[0]["type"]?.jsonPrimitive?.content != "dir" ||
                    remaining[0]["name"]?.jsonPrimitive?.content != "assets"
                ) throw e
                val assets = readEntries("$ROOT/$id/assets")
                val allValidAssets = assets.isNotEmpty() && assets.all { asset ->
                    asset["type"]?.jsonPrimitive?.content == "file" &&
                        AttachmentPolicy.MANAGED_PATH_REGEX.matches("docs/$ROOT/$id/assets/${asset["name"]?.jsonPrimitive?.content.orEmpty()}")
                }
                if (!allValidAssets) throw e
                continue
            }
            val content = readFileContent(data)
            val sha = data["sha"]!!.jsonPrimitive.content
            result.add(
                Notebook(
                    id = id,
                    title = CompatibilityCodecs.titleFromMarkdown(content, id),
                    sha = sha,
                    description = CompatibilityCodecs.readNotebookDescription(content),
                    indexContent = content,
                    chapterOrder = CompatibilityCodecs.readNotebookChapterOrder(content)
                )
            )
        }
        return result
    }

    suspend fun readChapter(bookId: String, chapterId: String): Chapter {
        CompatibilityCodecs.checkId(bookId)
        CompatibilityCodecs.checkChapterId(chapterId)
        val data = readFileObject("$ROOT/$bookId/$chapterId.md")
        val content = readFileContent(data)
        val sha = data["sha"]!!.jsonPrimitive.content
        return Chapter(
            bookId = bookId,
            id = chapterId,
            title = CompatibilityCodecs.titleFromMarkdown(content, CompatibilityCodecs.titleFromEncodedId(chapterId, 'c')),
            content = content,
            sha = sha
        )
    }

    suspend fun listChapters(bookId: String): List<Chapter> {
        CompatibilityCodecs.checkId(bookId)
        val items = readEntries("$ROOT/$bookId")
        val ids = items.filter {
            val name = it["name"]?.jsonPrimitive?.content.orEmpty()
            it["type"]?.jsonPrimitive?.content == "file" &&
                name.endsWith(".md") &&
                !name.equals("index.md", ignoreCase = true) &&
                CompatibilityCodecs.ID_REGEX.matches(name.dropLast(3))
        }.map { it["name"]!!.jsonPrimitive.content.dropLast(3) }
        return ids.map { readChapter(bookId, it) }
    }

    suspend fun readPage(pageId: String): Page {
        CompatibilityCodecs.checkPageId(pageId)
        val data = readFileObject("pages/$pageId.md")
        val content = readFileContent(data)
        val sha = data["sha"]!!.jsonPrimitive.content
        return Page(
            id = pageId,
            title = CompatibilityCodecs.titleFromMarkdown(content, CompatibilityCodecs.titleFromEncodedId(pageId, 'p')),
            content = content,
            sha = sha
        )
    }

    suspend fun listPages(): List<Page> {
        val items = readEntries("pages", allowMissing = true)
        val ids = items.filter {
            val name = it["name"]?.jsonPrimitive?.content.orEmpty()
            it["type"]?.jsonPrimitive?.content == "file" &&
                name.endsWith(".md") &&
                CompatibilityCodecs.ID_REGEX.matches(name.dropLast(3))
        }.map { it["name"]!!.jsonPrimitive.content.dropLast(3) }
        return ids.map { readPage(it) }
    }

    suspend fun readAttachment(path: String): NoteAttachment {
        try {
            AttachmentPolicy.validateAttachmentPath(path)
        } catch (_: Exception) {
            throw NotebookStoreException(StoreErrorCode.INVALID, "图片附件路径无效。")
        }
        val data = readFileObject(path.removePrefix("docs/"))
        val sha = data["sha"]?.jsonPrimitive?.content.orEmpty()
        if (!CompatibilityCodecs.SHA_REGEX.matches(sha)) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的图片版本无效。")
        }
        val sourceObj = if (data["encoding"]?.jsonPrimitive?.content == "base64" && data["content"] != null) {
            data
        } else {
            gitRequest("blobs/${encodeSegment(sha)}")
        }
        val bytes = decodeBase64Bytes(sourceObj)
        val attachment = try {
            AttachmentPolicy.validateAttachment(NoteAttachment(path = path, bytes = bytes, sha = sha))
        } catch (e: Exception) {
            throw NotebookStoreException(StoreErrorCode.INVALID, e.message ?: "图片附件无效。")
        }
        if (CompatibilityCodecs.gitBlobSha1(attachment.bytes) != sha) {
            throw NotebookStoreException(StoreErrorCode.GITHUB, "图片校验失败，请重试。")
        }
        return attachment
    }

    // --- Git Tree Helper ---

    private data class TreeEntry(val path: String, val type: String, val mode: String, val sha: String)

    private inner class TreeNavigator(private val baseTreeSha: String) {
        private val cache = HashMap<String, List<TreeEntry>>()

        suspend fun tree(sha: String): List<TreeEntry> {
            cache[sha]?.let { return it }
            val value = gitRequest("trees/${encodeSegment(sha)}")
            if (value["truncated"]?.jsonPrimitive?.booleanOrNull == true) {
                throw NotebookStoreException(StoreErrorCode.GITHUB, "无法完整读取仓库文件树，请保留草稿。")
            }
            val arr = value["tree"] as? JsonArray
                ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "无法完整读取仓库文件树，请保留草稿。")
            val parsed = arr.map { item ->
                val obj = item.jsonObject
                TreeEntry(
                    path = obj["path"]?.jsonPrimitive?.content.orEmpty(),
                    type = obj["type"]?.jsonPrimitive?.content.orEmpty(),
                    mode = obj["mode"]?.jsonPrimitive?.content.orEmpty(),
                    sha = obj["sha"]?.jsonPrimitive?.content.orEmpty()
                )
            }
            cache[sha] = parsed
            return parsed
        }

        suspend fun findPath(path: String): TreeEntry? {
            val parts = path.split('/')
            var currentSha = baseTreeSha
            for (i in parts.indices) {
                val entry = tree(currentSha).find { it.path == parts[i] } ?: return null
                if (i == parts.lastIndex) return entry
                if (entry.type != "tree" || entry.sha.isEmpty()) {
                    throw NotebookStoreException(StoreErrorCode.CONFLICT, "仓库目录结构已变化，请保留草稿并检查。", path)
                }
                currentSha = entry.sha
            }
            return null
        }

        fun isRegularFile(entry: TreeEntry): Boolean =
            entry.type == "blob" && (entry.mode == "100644" || entry.mode == "100755")
    }

    // --- Atomic Batch Sync (exact port of syncBatch in notebookStore.ts) ---

    suspend fun syncBatch(
        books: List<Notebook>,
        chapters: List<Chapter>,
        catalogChange: CatalogVersion? = null,
        pages: List<Page> = emptyList(),
        attachments: List<NoteAttachment> = emptyList()
    ): BatchSyncResult {
        if (token.isEmpty()) {
            throw NotebookStoreException(StoreErrorCode.AUTH, "请先输入具有仓库内容写入权限的 GitHub 令牌。")
        }
        if (books.isEmpty() && chapters.isEmpty() && pages.isEmpty() && catalogChange == null) {
            throw NotebookStoreException(StoreErrorCode.INVALID, "请至少选择一本新笔记本、一篇章节、书页或书柜目录。")
        }

        data class PlannedChange(
            val path: String,
            val content: String? = null,
            val bytes: ByteArray? = null,
            val baseline: String,
            val desired: String,
            var mode: String = "100644"
        )

        val paths = HashSet<String>()
        val changes = mutableListOf<PlannedChange>()
        var cleanCatalog: CabinetCatalog? = null

        if (catalogChange != null) {
            if (catalogChange.sha.isNotEmpty() && !CompatibilityCodecs.SHA_REGEX.matches(catalogChange.sha)) {
                throw NotebookStoreException(StoreErrorCode.INVALID, "书柜目录版本号无效。")
            }
            val text = try {
                CompatibilityCodecs.serializeCatalog(catalogChange.catalog)
            } catch (e: Exception) {
                throw NotebookStoreException(StoreErrorCode.INVALID, e.message ?: "书柜目录格式无效。")
            }
            cleanCatalog = CompatibilityCodecs.parseCatalog(text)
            paths.add("docs/cabinets.json")
            changes.add(
                PlannedChange(
                    path = "docs/cabinets.json",
                    content = text,
                    baseline = catalogChange.sha,
                    desired = CompatibilityCodecs.gitBlobSha1(text)
                )
            )
        }

        val computedBookContents = HashMap<String, String>()
        for (book in books) {
            CompatibilityCodecs.checkId(book.id)
            val title = CompatibilityCodecs.checkTitle(book.title)
            val path = "docs/$ROOT/${book.id}/index.md"
            if (!paths.add(path)) throw NotebookStoreException(StoreErrorCode.INVALID, "同步列表包含重复的笔记本。")
            if (book.sha.isNotEmpty() && book.indexContent == null) {
                throw NotebookStoreException(StoreErrorCode.INVALID, "缺少笔记本原始内容，请先恢复后再编辑简介。")
            }
            val original = book.indexContent ?: "# $title\n"
            val nextDesc = book.description ?: CompatibilityCodecs.readNotebookDescription(original)
            val content = CompatibilityCodecs.writeNotebookChapterOrder(
                CompatibilityCodecs.writeNotebookDescription(original, nextDesc),
                book.chapterOrder
            )
            CompatibilityCodecs.readNotebookChapterOrder(content)
            computedBookContents[book.id] = content
            changes.add(
                PlannedChange(
                    path = path,
                    content = content,
                    baseline = book.sha,
                    desired = CompatibilityCodecs.gitBlobSha1(content)
                )
            )
        }

        for (chapter in chapters) {
            CompatibilityCodecs.checkId(chapter.bookId)
            CompatibilityCodecs.checkChapterId(chapter.id)
            val path = "docs/$ROOT/${chapter.bookId}/${chapter.id}.md"
            if (!paths.add(path)) throw NotebookStoreException(StoreErrorCode.INVALID, "同步列表包含重复的章节。")
            changes.add(
                PlannedChange(
                    path = path,
                    content = chapter.content,
                    baseline = chapter.sha,
                    desired = CompatibilityCodecs.gitBlobSha1(chapter.content)
                )
            )
        }

        for (page in pages) {
            CompatibilityCodecs.checkPageId(page.id)
            val path = "docs/pages/${page.id}.md"
            if (!paths.add(path)) throw NotebookStoreException(StoreErrorCode.INVALID, "同步列表包含重复的书页。")
            changes.add(
                PlannedChange(
                    path = path,
                    content = page.content,
                    baseline = page.sha,
                    desired = CompatibilityCodecs.gitBlobSha1(page.content)
                )
            )
        }

        val allowedAssetDirs = buildSet {
            chapters.forEach { add("docs/$ROOT/${it.bookId}/assets/") }
            if (pages.isNotEmpty()) add("docs/pages/assets/")
        }
        for (att in attachments) {
            try {
                AttachmentPolicy.validateAttachment(att)
            } catch (e: Exception) {
                throw NotebookStoreException(StoreErrorCode.INVALID, e.message ?: "图片附件无效。")
            }
            if (allowedAssetDirs.none { att.path.startsWith(it) }) {
                throw NotebookStoreException(StoreErrorCode.INVALID, "图片不属于本次同步的笔记。")
            }
            if (!paths.add(att.path)) {
                throw NotebookStoreException(StoreErrorCode.INVALID, "同步列表包含重复的图片附件。")
            }
            changes.add(
                PlannedChange(
                    path = att.path,
                    bytes = att.bytes,
                    baseline = "",
                    desired = CompatibilityCodecs.gitBlobSha1(att.bytes)
                )
            )
        }

        val parent = readHead()
        val commit = gitRequest("commits/${encodeSegment(parent)}")
        val baseTree = commit["tree"]?.jsonObject?.get("sha")?.jsonPrimitive?.content
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "无法读取仓库文件树，请保留草稿。")

        val nav = TreeNavigator(baseTree)
        val newBookPaths = books.map { "docs/$ROOT/${it.id}/index.md" }.toSet()
        for (bookId in chapters.map { it.bookId }.toSet()) {
            val indexPath = "docs/$ROOT/$bookId/index.md"
            if (indexPath !in newBookPaths) {
                val idx = nav.findPath(indexPath)
                if (idx == null || !nav.isRegularFile(idx)) {
                    throw NotebookStoreException(
                        StoreErrorCode.CONFLICT,
                        "笔记本已不存在或目录已变化：$bookId。请保留草稿并检查。",
                        indexPath
                    )
                }
            }
        }

        val pending = mutableListOf<PlannedChange>()
        for (change in changes) {
            val existing = nav.findPath(change.path)
            if (existing != null && !nav.isRegularFile(existing)) {
                throw NotebookStoreException(
                    StoreErrorCode.CONFLICT,
                    "远程路径不是普通文件：${change.path}。请保留草稿并检查。",
                    change.path
                )
            }
            val current = existing?.sha.orEmpty()
            if (current == change.desired) continue // Idempotent match
            if (current != change.baseline) {
                throw NotebookStoreException(
                    StoreErrorCode.CONFLICT,
                    "远程文件已发生变化：${change.path}。请选择如何处理冲突。",
                    conflictPath = change.path,
                    remoteSha = current
                )
            }
            change.mode = existing?.mode ?: "100644"
            pending.add(change)
        }

        var head = parent
        if (pending.isNotEmpty()) {
            val treeEntries = mutableListOf<JsonObject>()
            for (change in pending) {
                if (change.bytes == null) {
                    treeEntries.add(
                        JsonObject(
                            mapOf(
                                "path" to JsonPrimitive(change.path),
                                "mode" to JsonPrimitive(change.mode),
                                "type" to JsonPrimitive("blob"),
                                "content" to JsonPrimitive(change.content.orEmpty())
                            )
                        )
                    )
                } else {
                    val encoded = Base64.getEncoder().encodeToString(change.bytes)
                    val blob = gitRequest(
                        "blobs", "POST",
                        JsonObject(mapOf("content" to JsonPrimitive(encoded), "encoding" to JsonPrimitive("base64")))
                    )
                    val blobSha = blob["sha"]?.jsonPrimitive?.content
                    if (blobSha != change.desired) {
                        throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 返回的图片版本与本地不一致，请保留草稿。")
                    }
                    treeEntries.add(
                        JsonObject(
                            mapOf(
                                "path" to JsonPrimitive(change.path),
                                "mode" to JsonPrimitive(change.mode),
                                "type" to JsonPrimitive("blob"),
                                "sha" to JsonPrimitive(blobSha)
                            )
                        )
                    )
                }
            }

            val createdTree = gitRequest(
                "trees", "POST",
                JsonObject(mapOf("base_tree" to JsonPrimitive(baseTree), "tree" to JsonArray(treeEntries)))
            )
            val newTreeSha = createdTree["sha"]?.jsonPrimitive?.content
                ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 未返回文件树版本，请保留草稿。")

            val summaryParts = listOfNotNull(
                if (books.isNotEmpty()) "${books.size} notebook${if (books.size == 1) "" else "s"}" else null,
                if (chapters.isNotEmpty()) "${chapters.size} note${if (chapters.size == 1) "" else "s"}" else null,
                if (pages.isNotEmpty()) "${pages.size} page${if (pages.size == 1) "" else "s"}" else null,
                if (catalogChange != null) "cabinet catalog" else null
            ).joinToString(", ")

            val createdCommit = gitRequest(
                "commits", "POST",
                JsonObject(
                    mapOf(
                        "message" to JsonPrimitive("Sync $summaryParts"),
                        "tree" to JsonPrimitive(newTreeSha),
                        "parents" to JsonArray(listOf(JsonPrimitive(parent)))
                    )
                )
            )
            val newCommitSha = createdCommit["sha"]?.jsonPrimitive?.content
                ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 未返回提交版本，请保留草稿。")

            gitRequest(
                "refs/heads/main", "PATCH",
                JsonObject(mapOf("sha" to JsonPrimitive(newCommitSha), "force" to JsonPrimitive(false)))
            )
            head = newCommitSha
        }

        val desiredByPath = changes.associate { it.path to it.desired }
        return BatchSyncResult(
            parent = parent,
            head = head,
            books = books.map { b ->
                val idx = computedBookContents[b.id]!!
                b.copy(
                    title = CompatibilityCodecs.checkTitle(b.title),
                    indexContent = idx,
                    description = CompatibilityCodecs.readNotebookDescription(idx),
                    chapterOrder = CompatibilityCodecs.readNotebookChapterOrder(idx),
                    sha = desiredByPath["docs/$ROOT/${b.id}/index.md"]!!
                )
            },
            chapters = chapters.map { c ->
                c.copy(
                    title = CompatibilityCodecs.titleFromMarkdown(
                        c.content,
                        CompatibilityCodecs.titleFromEncodedId(c.id, 'c')
                    ),
                    sha = desiredByPath["docs/$ROOT/${c.bookId}/${c.id}.md"]!!
                )
            },
            pages = pages.map { p ->
                p.copy(
                    title = CompatibilityCodecs.titleFromMarkdown(p.content, p.title.ifEmpty { p.id }),
                    sha = desiredByPath["docs/pages/${p.id}.md"]!!
                )
            },
            catalog = cleanCatalog?.let { CatalogVersion(it, desiredByPath["docs/cabinets.json"]!!) }
        )
    }

    // --- Safe Atomic Deletion (exact port of deleteBatch in notebookStore.ts) ---

    suspend fun deleteBatch(
        books: List<BookDeletion>,
        chapters: List<Chapter>,
        pages: List<Page> = emptyList()
    ): BatchDeleteResult {
        if (token.isEmpty()) {
            throw NotebookStoreException(StoreErrorCode.AUTH, "请先连接有仓库内容写入权限的 GitHub 令牌。")
        }
        if (books.isEmpty() && chapters.isEmpty() && pages.isEmpty()) {
            throw NotebookStoreException(StoreErrorCode.INVALID, "请先选择要删除的笔记本、章节或书页。")
        }

        fun requireSha(sha: String): String {
            if (!CompatibilityCodecs.SHA_REGEX.matches(sha)) {
                throw NotebookStoreException(StoreErrorCode.INVALID, "缺少有效的远端版本号，请刷新后重试。")
            }
            return sha
        }

        val expected = LinkedHashMap<String, String>()
        val selectedBooks = LinkedHashMap<String, Map<String, String>>()

        fun addExpected(path: String, sha: String) {
            if (path in expected) throw NotebookStoreException(StoreErrorCode.INVALID, "删除列表包含重复条目。")
            expected[path] = requireSha(sha)
        }

        for (item in books) {
            val bookId = CompatibilityCodecs.checkId(item.book.id)
            if (bookId in selectedBooks) throw NotebookStoreException(StoreErrorCode.INVALID, "删除列表包含重复笔记本。")
            val files = LinkedHashMap<String, String>()
            files["index.md"] = requireSha(item.book.sha)
            for (ch in item.chapters) {
                if (ch.bookId != bookId) throw NotebookStoreException(StoreErrorCode.INVALID, "章节不属于所选笔记本。")
                val name = "${CompatibilityCodecs.checkChapterId(ch.id)}.md"
                if (name in files) throw NotebookStoreException(StoreErrorCode.INVALID, "删除列表包含重复章节。")
                files[name] = requireSha(ch.sha)
            }
            selectedBooks[bookId] = files
            for ((name, sha) in files) addExpected("docs/$ROOT/$bookId/$name", sha)
        }
        for (ch in chapters) {
            val bookId = CompatibilityCodecs.checkId(ch.bookId)
            val chapId = CompatibilityCodecs.checkChapterId(ch.id)
            if (bookId in selectedBooks) throw NotebookStoreException(StoreErrorCode.INVALID, "整本笔记和其中章节不能重复选择。")
            addExpected("docs/$ROOT/$bookId/$chapId.md", ch.sha)
        }
        for (p in pages) {
            addExpected("docs/pages/${CompatibilityCodecs.checkPageId(p.id)}.md", p.sha)
        }

        val parent = requireSha(readHead())
        val commit = gitRequest("commits/${encodeSegment(parent)}")
        val baseTree = requireSha(commit["tree"]?.jsonObject?.get("sha")?.jsonPrimitive?.content.orEmpty())
        val nav = TreeNavigator(baseTree)

        for ((bookId, files) in selectedBooks) {
            val dir = nav.findPath("docs/$ROOT/$bookId")
            if (dir == null || dir.type != "tree" || dir.sha.isEmpty()) {
                throw NotebookStoreException(StoreErrorCode.CONFLICT, "远端笔记本已发生变化：$bookId。")
            }
            val entries = nav.tree(dir.sha)
            val assetFolder = entries.find { it.path == "assets" }
            if (assetFolder != null) {
                if (assetFolder.type != "tree" || assetFolder.sha.isEmpty()) {
                    throw NotebookStoreException(StoreErrorCode.CONFLICT, "图片目录无效：$bookId。")
                }
                for (asset in nav.tree(assetFolder.sha)) {
                    if (!nav.isRegularFile(asset) ||
                        !AttachmentPolicy.MANAGED_PATH_REGEX.matches("docs/$ROOT/$bookId/assets/${asset.path}")
                    ) {
                        throw NotebookStoreException(StoreErrorCode.CONFLICT, "图片目录含未识别文件：$bookId。")
                    }
                }
            }
            val markdownEntries = entries.filter { it != assetFolder }
            if (markdownEntries.size != files.size ||
                markdownEntries.any { !nav.isRegularFile(it) || files[it.path] != it.sha }
            ) {
                throw NotebookStoreException(
                    StoreErrorCode.CONFLICT,
                    "远端笔记本内容已变化或含有未识别文件：$bookId。请刷新并检查后重试。"
                )
            }
        }

        val treeMutations = mutableListOf<JsonObject>()
        for ((path, sha) in expected) {
            val entry = nav.findPath(path)
            if (entry == null || !nav.isRegularFile(entry) || entry.sha != sha) {
                throw NotebookStoreException(StoreErrorCode.CONFLICT, "远端文件已变化：$path。请刷新并检查后重试。", path)
            }
            treeMutations.add(
                JsonObject(
                    mapOf(
                        "path" to JsonPrimitive(path),
                        "mode" to JsonPrimitive(entry.mode),
                        "type" to JsonPrimitive("blob"),
                        "sha" to JsonNull
                    )
                )
            )
        }

        var updatedCatalog: CatalogVersion? = null
        if (selectedBooks.isNotEmpty() || pages.isNotEmpty()) {
            val catEntry = nav.findPath("docs/cabinets.json")
            if (catEntry != null) {
                if (!nav.isRegularFile(catEntry)) {
                    throw NotebookStoreException(StoreErrorCode.CONFLICT, "远端书柜目录不是普通文件，请检查后重试。")
                }
                val blob = gitRequest("blobs/${encodeSegment(catEntry.sha)}")
                val catalog = CompatibilityCodecs.parseCatalog(decodeBase64Utf8(blob))
                val nextAssignments = catalog.assignments.toMutableMap()
                var changed = false
                for (bookId in selectedBooks.keys) {
                    if (nextAssignments.remove(bookId) != null) changed = true
                }
                for (page in pages) {
                    if (nextAssignments.remove(CompatibilityCodecs.pageBookId(page.id)) != null) changed = true
                }
                if (changed) {
                    val nextCatalog = catalog.copy(assignments = nextAssignments)
                    val content = CompatibilityCodecs.serializeCatalog(nextCatalog)
                    val sha = CompatibilityCodecs.gitBlobSha1(content)
                    updatedCatalog = CatalogVersion(nextCatalog, sha)
                    treeMutations.add(
                        JsonObject(
                            mapOf(
                                "path" to JsonPrimitive("docs/cabinets.json"),
                                "mode" to JsonPrimitive(catEntry.mode),
                                "type" to JsonPrimitive("blob"),
                                "content" to JsonPrimitive(content)
                            )
                        )
                    )
                }
            }
        }

        val createdTree = gitRequest(
            "trees", "POST",
            JsonObject(mapOf("base_tree" to JsonPrimitive(baseTree), "tree" to JsonArray(treeMutations)))
        )
        val newTreeSha = createdTree["sha"]?.jsonPrimitive?.content
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 未返回文件树版本；请保留本地内容。")

        val createdCommit = gitRequest(
            "commits", "POST",
            JsonObject(
                mapOf(
                    "message" to JsonPrimitive("Delete ${books.size} notebook(s), ${chapters.size} chapter(s), ${pages.size} page(s)"),
                    "tree" to JsonPrimitive(newTreeSha),
                    "parents" to JsonArray(listOf(JsonPrimitive(parent)))
                )
            )
        )
        val newCommitSha = createdCommit["sha"]?.jsonPrimitive?.content
            ?: throw NotebookStoreException(StoreErrorCode.GITHUB, "GitHub 未返回提交版本；请保留本地内容。")

        gitRequest(
            "refs/heads/main", "PATCH",
            JsonObject(mapOf("sha" to JsonPrimitive(newCommitSha), "force" to JsonPrimitive(false)))
        )

        return BatchDeleteResult(parent = parent, head = newCommitSha, catalog = updatedCatalog)
    }

    /**
     * Complete atomic restore from GitHub (books, chapters, pages, catalog, and all referenced attachments).
     * Verifies branch head consistency before publishing offline snapshot.
     */
    suspend fun restoreFullSnapshot(
        attachmentStore: AttachmentFileStore
    ): Pair<RemoteSnapshot, Int> {
        val head = readHead()
        val catalog = readCatalog()
        val remoteBooks = listNotebooks()
        val remotePages = listPages()
        val allChapters = LinkedHashMap<String, List<Chapter>>()
        for (book in remoteBooks) {
            allChapters[book.id] = listChapters(book.id)
        }

        val imagePaths = LinkedHashSet<String>()
        for ((bookId, chList) in allChapters) {
            for (ch in chList) {
                for (ref in AttachmentPolicy.extractAttachmentReferences(ch.content, bookId)) {
                    imagePaths.add(ref.path)
                }
            }
        }
        for (page in remotePages) {
            for (ref in AttachmentPolicy.extractAttachmentReferences(page.content, null)) {
                imagePaths.add(ref.path)
            }
        }

        val downloaded = mutableListOf<NoteAttachment>()
        for (path in imagePaths) {
            val remote = readAttachment(path)
            val local = attachmentStore.getAttachment(canonicalRepository, path)
            if (local != null && !local.bytes.contentEquals(remote.bytes)) {
                throw NotebookStoreException(
                    StoreErrorCode.CONFLICT,
                    "本地和 GitHub 的同名图片内容不同；原有本地图片已保留，请先处理冲突。",
                    path
                )
            }
            if (local == null) downloaded.add(remote)
        }

        if (readHead() != head) {
            throw NotebookStoreException(StoreErrorCode.CONFLICT, "恢复期间 GitHub 内容发生变化，请重新恢复。")
        }

        for (img in downloaded) {
            attachmentStore.putAttachment(canonicalRepository, img)
        }
        if (readHead() != head) {
            throw NotebookStoreException(StoreErrorCode.CONFLICT, "恢复期间 GitHub 内容发生变化，请重新恢复。")
        }

        return RemoteSnapshot(
            head = head,
            books = remoteBooks,
            chapters = allChapters,
            pages = remotePages,
            catalog = catalog,
            stale = false
        ) to downloaded.size
    }
}
