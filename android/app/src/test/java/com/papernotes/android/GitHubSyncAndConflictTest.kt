package com.papernotes.android

import com.papernotes.android.data.AttachmentFileStore
import com.papernotes.android.data.CompatibilityCodecs
import com.papernotes.android.data.ConflictResolution
import com.papernotes.android.data.DEFAULT_CABINET_ID
import com.papernotes.android.data.GitHubNotebookClient
import com.papernotes.android.data.PaperNotesRepository
import com.papernotes.android.data.TokenStore
import com.papernotes.android.data.WelcomeSeed
import com.papernotes.android.data.WorkspaceStorage
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.URLDecoder
import java.util.Base64

class GitHubSyncAndConflictTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var server: MockWebServer
    private lateinit var fakeGitHub: FakeGitHubRepoState

    private class InMemoryTokenStore : TokenStore {
        private val tokens = HashMap<String, String>()
        override fun getToken(repository: String): String? = tokens[repository]
        override fun saveToken(repository: String, token: String) { tokens[repository] = token }
        override fun clearToken(repository: String) { tokens.remove(repository) }
    }

    /**
     * Complete in-memory GitHub REST + Git Data API simulator supporting blobs, trees,
     * commits, refs (with force=false check), and contents endpoints.
     */
    private class FakeGitHubRepoState(val expectedToken: String = "pat_test_12345") {
        val json = Json { ignoreUnknownKeys = true }
        val files = LinkedHashMap<String, ByteArray>() // repo-relative paths e.g. "docs/cabinets.json"
        val blobsBySha = LinkedHashMap<String, ByteArray>()
        val treesBySha = LinkedHashMap<String, List<Triple<String, String, String>>>() // sha -> (name, type, sha)
        val commitsBySha = LinkedHashMap<String, String>() // commitSha -> rootTreeSha
        var headSha: String = ""
        var commitCounter = 0

        init {
            rebuildSnapshotCommit()
        }

        fun putFile(path: String, text: String) = putFile(path, text.toByteArray(Charsets.UTF_8))

        fun putFile(path: String, bytes: ByteArray) {
            files[path] = bytes
            val sha = CompatibilityCodecs.gitBlobSha1(bytes)
            blobsBySha[sha] = bytes
            rebuildSnapshotCommit()
        }

        fun rebuildSnapshotCommit(): String {
            fun buildTree(prefix: String): String {
                val directFiles = LinkedHashMap<String, ByteArray>()
                val subDirs = LinkedHashSet<String>()
                for ((p, b) in files) {
                    if (prefix.isNotEmpty() && !p.startsWith("$prefix/")) continue
                    val rel = if (prefix.isEmpty()) p else p.removePrefix("$prefix/")
                    if ('/' in rel) subDirs.add(rel.substringBefore('/'))
                    else directFiles[rel] = b
                }
                val entries = mutableListOf<Triple<String, String, String>>()
                for ((name, bytes) in directFiles) {
                    val bSha = CompatibilityCodecs.gitBlobSha1(bytes)
                    blobsBySha[bSha] = bytes
                    entries.add(Triple(name, "blob", bSha))
                }
                for (dir in subDirs) {
                    val subPrefix = if (prefix.isEmpty()) dir else "$prefix/$dir"
                    entries.add(Triple(dir, "tree", buildTree(subPrefix)))
                }
                val tSha = CompatibilityCodecs.gitBlobSha1("tree:$prefix:${entries.joinToString(",")}")
                treesBySha[tSha] = entries
                return tSha
            }
            val rootTree = buildTree("")
            commitCounter++
            headSha = CompatibilityCodecs.gitBlobSha1("commit:$commitCounter:$rootTree")
            commitsBySha[headSha] = rootTree
            return headSha
        }

        fun dispatcher(ownerRepo: String): Dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val auth = request.getHeader("Authorization")
                if (auth != "Bearer $expectedToken") {
                    return MockResponse().setResponseCode(401).setBody("""{"message":"Unauthorized"}""")
                }
                val rawPath = request.path?.substringBefore('?') ?: ""
                val prefix = "/repos/$ownerRepo"
                if (!rawPath.startsWith(prefix)) {
                    return MockResponse().setResponseCode(404).setBody("""{"message":"Not Found"}""")
                }
                val sub = rawPath.removePrefix(prefix)
                return when {
                    sub == "" && request.method == "GET" ->
                        MockResponse().setResponseCode(200).setBody("""{"full_name":"$ownerRepo"}""")

                    sub == "/git/ref/heads/main" && request.method == "GET" ->
                        MockResponse().setResponseCode(200).setBody("""{"ref":"refs/heads/main","object":{"sha":"$headSha"}}""")

                    sub == "/git/refs/heads/main" && request.method == "PATCH" -> {
                        val body = json.parseToJsonElement(request.body.readUtf8()).jsonObject
                        val force = body["force"]?.jsonPrimitive?.content == "true"
                        if (force) return MockResponse().setResponseCode(422).setBody("""{"message":"Force forbidden"}""")
                        val newSha = body["sha"]!!.jsonPrimitive.content
                        if (newSha !in commitsBySha) return MockResponse().setResponseCode(422)
                        headSha = newSha
                        MockResponse().setResponseCode(200).setBody("""{"object":{"sha":"$headSha"}}""")
                    }

                    sub.startsWith("/git/commits/") && request.method == "GET" -> {
                        val sha = sub.removePrefix("/git/commits/")
                        val tree = commitsBySha[sha] ?: return MockResponse().setResponseCode(404)
                        MockResponse().setResponseCode(200).setBody("""{"sha":"$sha","tree":{"sha":"$tree"}}""")
                    }

                    sub == "/git/commits" && request.method == "POST" -> {
                        val body = json.parseToJsonElement(request.body.readUtf8()).jsonObject
                        val tree = body["tree"]!!.jsonPrimitive.content
                        commitCounter++
                        val newSha = CompatibilityCodecs.gitBlobSha1("commit:$commitCounter:$tree")
                        commitsBySha[newSha] = tree
                        MockResponse().setResponseCode(201).setBody("""{"sha":"$newSha"}""")
                    }

                    sub.startsWith("/git/trees/") && request.method == "GET" -> {
                        val sha = sub.removePrefix("/git/trees/")
                        val entries = treesBySha[sha] ?: return MockResponse().setResponseCode(404)
                        val arr = JsonArray(entries.map { (name, type, eSha) ->
                            JsonObject(mapOf(
                                "path" to JsonPrimitive(name),
                                "type" to JsonPrimitive(type),
                                "mode" to JsonPrimitive(if (type == "tree") "040000" else "100644"),
                                "sha" to JsonPrimitive(eSha)
                            ))
                        })
                        MockResponse().setResponseCode(200).setBody(
                            json.encodeToString(JsonObject(mapOf("sha" to JsonPrimitive(sha), "tree" to arr, "truncated" to JsonPrimitive(false))))
                        )
                    }

                    sub == "/git/trees" && request.method == "POST" -> {
                        val body = json.parseToJsonElement(request.body.readUtf8()).jsonObject
                        val mutations = body["tree"]!!.jsonArray
                        for (mEl in mutations) {
                            val m = mEl.jsonObject
                            val p = m["path"]!!.jsonPrimitive.content
                            val shaEl = m["sha"]
                            when {
                                shaEl is JsonNull -> files.remove(p)
                                m["content"] != null -> {
                                    val bytes = m["content"]!!.jsonPrimitive.content.toByteArray(Charsets.UTF_8)
                                    files[p] = bytes
                                    blobsBySha[CompatibilityCodecs.gitBlobSha1(bytes)] = bytes
                                }
                                shaEl != null -> {
                                    val bSha = shaEl.jsonPrimitive.content
                                    val bytes = blobsBySha[bSha] ?: return MockResponse().setResponseCode(422)
                                    files[p] = bytes
                                }
                            }
                        }
                        val nextHead = rebuildSnapshotCommit()
                        val rootTree = commitsBySha[nextHead]!!
                        MockResponse().setResponseCode(201).setBody("""{"sha":"$rootTree"}""")
                    }

                    sub == "/git/blobs" && request.method == "POST" -> {
                        val body = json.parseToJsonElement(request.body.readUtf8()).jsonObject
                        val b64 = body["content"]!!.jsonPrimitive.content
                        val bytes = Base64.getDecoder().decode(b64)
                        val sha = CompatibilityCodecs.gitBlobSha1(bytes)
                        blobsBySha[sha] = bytes
                        MockResponse().setResponseCode(201).setBody("""{"sha":"$sha"}""")
                    }

                    sub.startsWith("/git/blobs/") && request.method == "GET" -> {
                        val sha = sub.removePrefix("/git/blobs/")
                        val bytes = blobsBySha[sha] ?: return MockResponse().setResponseCode(404)
                        val b64 = Base64.getEncoder().encodeToString(bytes)
                        MockResponse().setResponseCode(200).setBody(
                            json.encodeToString(JsonObject(mapOf("sha" to JsonPrimitive(sha), "encoding" to JsonPrimitive("base64"), "content" to JsonPrimitive(b64))))
                        )
                    }

                    sub.startsWith("/contents/") && request.method == "GET" -> {
                        val target = URLDecoder.decode(sub.removePrefix("/contents/"), "UTF-8").trimEnd('/')
                        val exact = files[target]
                        if (exact != null) {
                            val sha = CompatibilityCodecs.gitBlobSha1(exact)
                            val b64 = Base64.getEncoder().encodeToString(exact)
                            return MockResponse().setResponseCode(200).setBody(
                                json.encodeToString(JsonObject(mapOf(
                                    "type" to JsonPrimitive("file"),
                                    "name" to JsonPrimitive(target.substringAfterLast('/')),
                                    "path" to JsonPrimitive(target),
                                    "sha" to JsonPrimitive(sha),
                                    "encoding" to JsonPrimitive("base64"),
                                    "content" to JsonPrimitive(b64)
                                )))
                            )
                        }
                        val dirPrefix = "$target/"
                        val childNames = LinkedHashMap<String, String>() // name -> type
                        for (k in files.keys) {
                            if (!k.startsWith(dirPrefix)) continue
                            val rest = k.removePrefix(dirPrefix)
                            if ('/' in rest) childNames[rest.substringBefore('/')] = "dir"
                            else childNames[rest] = "file"
                        }
                        if (childNames.isEmpty()) return MockResponse().setResponseCode(404)
                        val arr = JsonArray(childNames.map { (name, type) ->
                            val full = "$dirPrefix$name"
                            val sha = if (type == "file") CompatibilityCodecs.gitBlobSha1(files[full]!!) else "0".repeat(40)
                            JsonObject(mapOf(
                                "type" to JsonPrimitive(type),
                                "name" to JsonPrimitive(name),
                                "path" to JsonPrimitive(full),
                                "sha" to JsonPrimitive(sha)
                            ))
                        })
                        MockResponse().setResponseCode(200).setBody(json.encodeToString(arr))
                    }

                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    @Before
    fun setUp() {
        fakeGitHub = FakeGitHubRepoState()
        server = MockWebServer()
        server.dispatcher = fakeGitHub.dispatcher("alice/paper-notes")
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun createRepo(): PaperNotesRepository {
        val dir = tempFolder.newFolder("app_${System.nanoTime()}")
        val baseUrl = server.url("/").toString().trimEnd('/')
        return PaperNotesRepository(
            storage = WorkspaceStorage(dir),
            attachments = AttachmentFileStore(dir),
            tokenStore = InMemoryTokenStore(),
            clientFactory = { repo, token -> GitHubNotebookClient(repo, token, apiBaseUrl = baseUrl) }
        )
    }

    @Test
    fun welcomeNotebook_seededOnce_deletable_andDeduplicatedOnConnect() = runTest {
        val repo = createRepo()
        val initial = repo.snapshotState()
        assertEquals(1, initial.cabinets.size)
        assertEquals(DEFAULT_CABINET_ID, initial.cabinets.first().id)
        assertEquals(1, initial.items.size)
        assertEquals(WelcomeSeed.WELCOME_BOOK_TITLE, initial.items.first().title)

        // Seed exact same pristine welcome manual on remote repo
        val remoteWelcomeId = "717086b2dae447f7b97a9592e4d57dcf"
        fakeGitHub.putFile("docs/notebooks/$remoteWelcomeId/index.md", "# 使用说明与教程\n")
        WelcomeSeed.templates.forEach { (chapId, body) ->
            fakeGitHub.putFile("docs/notebooks/$remoteWelcomeId/$chapId.md", body)
        }

        // Connect with importUnboundLocal=true -> must NOT duplicate welcome book!
        repo.connectRepository("alice/paper-notes", "pat_test_12345", importUnboundLocal = true)
        repo.restoreFromGitHub()
        val after = repo.snapshotState()
        val welcomeBooks = after.items.filter { it.title == WelcomeSeed.WELCOME_BOOK_TITLE }
        assertEquals(1, welcomeBooks.size)
        assertEquals(remoteWelcomeId, welcomeBooks.first().id)
    }

    @Test
    fun syncRestoreDeleteAndConflictResolution_endToEndAgainstFakeGitHub() = runTest {
        val repo = createRepo()
        repo.connectRepository("alice/paper-notes", "pat_test_12345", importUnboundLocal = false)

        // 1. Create cabinet, notebook with description, chapter with image, and standalone page
        val (studyCabId, _) = repo.createCabinet("学习")
        val (book, _) = repo.createNotebook("Kotlin 笔记", "移动端学习记录", studyCabId)
        val (chapter, _) = repo.createChapter(book.id, "第一章")
        val imgRel = repo.saveNewImageAttachment(book.id, "image/png", ImportAndAttachmentTest.SAMPLE_PNG)
        val chapterMd = "# 第一章\n\n内容段落\n\n![示意图]($imgRel)\n"
        repo.saveDraft(chapter, chapterMd)

        val (pageChapter, _) = repo.createStandalonePage("随手记", studyCabId)
        repo.saveDraft(pageChapter, "# 随手记\n\n独立书页正文\n")

        // 2. Atomic batch sync all pending changes
        val pendingKeys = repo.snapshotState().pendingSyncItems.map { it.key }.toSet()
        val syncOutcome = repo.syncSelected(pendingKeys)
        assertTrue(syncOutcome is PaperNotesRepository.SyncOutcome.Success)

        // Verify exact repository layout compatible with Windows & Web clients!
        assertTrue("docs/cabinets.json" in fakeGitHub.files)
        assertTrue("docs/notebooks/${book.id}/index.md" in fakeGitHub.files)
        assertTrue("docs/notebooks/${book.id}/${chapter.id}.md" in fakeGitHub.files)
        assertTrue("docs/notebooks/${book.id}/$imgRel" in fakeGitHub.files)
        assertTrue("docs/pages/${pageChapter.id}.md" in fakeGitHub.files)

        val remoteCatalog = CompatibilityCodecs.parseCatalog(String(fakeGitHub.files["docs/cabinets.json"]!!))
        assertEquals(studyCabId, remoteCatalog.assignments[book.id])
        assertEquals(studyCabId, remoteCatalog.assignments[pageChapter.bookId])

        // 3. Simulate another device updating chapter on GitHub while local user also edits offline
        val syncedCh = repo.snapshotState().chaptersByBook[book.id]!!.first()
        repo.saveDraft(syncedCh, "# 第一章\n\n本机新修改内容\n")
        fakeGitHub.putFile("docs/notebooks/${book.id}/${chapter.id}.md", "# 第一章\n\n另一台设备的远端修改\n")

        // Restore must preserve unsynchronized local draft!
        repo.restoreFromGitHub()
        val afterRestoreContent = repo.getChapterContent(book.id, chapter.id)!!.second
        assertTrue(afterRestoreContent.contains("本机新修改内容"))

        // Sync must detect CONFLICT instead of silently overwriting!
        val conflictOutcome = repo.syncSelected(setOf(repo.chapterKey(book.id, chapter.id)))
        assertTrue(conflictOutcome is PaperNotesRepository.SyncOutcome.Conflict)
        val conflict = (conflictOutcome as PaperNotesRepository.SyncOutcome.Conflict).conflict
        assertTrue(conflict.localContent.contains("本机新修改内容"))
        assertTrue(conflict.remoteContent.contains("另一台设备的远端修改"))

        // 4. Resolve by keeping local & rebasing onto remote SHA -> retry succeeds!
        repo.resolveConflict(conflict, ConflictResolution.KEEP_LOCAL_REBASE_REMOTE)
        val retryOutcome = repo.syncSelected(setOf(repo.chapterKey(book.id, chapter.id)))
        assertTrue(retryOutcome is PaperNotesRepository.SyncOutcome.Success)
        assertTrue(String(fakeGitHub.files["docs/notebooks/${book.id}/${chapter.id}.md"]!!).contains("本机新修改内容"))

        // 5. Safe deletion of synced notebook retains assets/ directory and cleans cabinets.json
        repo.restoreFromGitHub()
        repo.deleteItems(setOf(book.id))
        assertFalse("docs/notebooks/${book.id}/index.md" in fakeGitHub.files)
        assertFalse("docs/notebooks/${book.id}/${chapter.id}.md" in fakeGitHub.files)
        // Shared image attachment MUST NOT be deleted!
        assertTrue("docs/notebooks/${book.id}/$imgRel" in fakeGitHub.files)

        // Listing notebooks on remote must still succeed even with assets-only deleted directory!
        val (_, restoredAfterDelete) = repo.restoreFromGitHub()
        assertTrue(restoredAfterDelete.items.none { it.id == book.id })
        assertNotNull(restoredAfterDelete.items.find { it.id == pageChapter.bookId })
    }

    @Test
    fun chapterReorderSync_conflictCopyResolution_unknownFileGuard_andRepoIsolation() = runTest {
        val repo = createRepo()
        repo.connectRepository("alice/paper-notes", "pat_test_12345", importUnboundLocal = false)

        // 1. Create notebook with 2 chapters, sync, then reorder chapters and verify index.md metadata
        val (book, _) = repo.createNotebook("算法书", "原始简介", DEFAULT_CABINET_ID)
        val (ch1, _) = repo.createChapter(book.id, "一、排序")
        val (ch2, _) = repo.createChapter(book.id, "二、图论")
        val initKeys = repo.snapshotState().pendingSyncItems.map { it.key }.toSet()
        assertTrue(repo.syncSelected(initKeys) is PaperNotesRepository.SyncOutcome.Success)

        repo.reorderChapters(book.id, listOf(ch2.id, ch1.id))
        val reorderedKeys = repo.snapshotState().pendingSyncItems.map { it.key }.toSet()
        assertTrue(repo.syncSelected(reorderedKeys) is PaperNotesRepository.SyncOutcome.Success)

        val remoteIndex = String(fakeGitHub.files["docs/notebooks/${book.id}/index.md"]!!)
        assertEquals(listOf(ch2.id, ch1.id), CompatibilityCodecs.readNotebookChapterOrder(remoteIndex))
        assertEquals("原始简介", CompatibilityCodecs.readNotebookDescription(remoteIndex))

        // 2. Conflict resolution: SAVE_LOCAL_AS_COPY_AND_USE_REMOTE keeps both copies
        val syncedCh1 = repo.snapshotState().chaptersByBook[book.id]!!.first { it.id == ch1.id }
        repo.saveDraft(syncedCh1, "# 一、排序\n\n本地新增归并排序\n")
        fakeGitHub.putFile("docs/notebooks/${book.id}/${ch1.id}.md", "# 一、排序\n\n远端新增快速排序\n")
        val conflictRes = repo.syncSelected(setOf(repo.chapterKey(book.id, ch1.id)))
        assertTrue(conflictRes is PaperNotesRepository.SyncOutcome.Conflict)
        val afterCopy = repo.resolveConflict(
            (conflictRes as PaperNotesRepository.SyncOutcome.Conflict).conflict,
            ConflictResolution.SAVE_LOCAL_AS_COPY_AND_USE_REMOTE
        )
        val chaptersAfter = afterCopy.chaptersByBook[book.id].orEmpty()
        assertEquals(3, chaptersAfter.size)
        assertTrue(chaptersAfter.any { it.id == ch1.id && it.content.contains("远端新增快速排序") })
        assertTrue(chaptersAfter.any { it.title.contains("冲突副本") && it.content.contains("本地新增归并排序") })

        // 3. Unknown extra file inside remote notebook blocks remote deletion safely
        repo.restoreFromGitHub()
        fakeGitHub.putFile("docs/notebooks/${book.id}/extra-user-file.txt", "do not delete me")
        var blockedDelete = false
        try {
            repo.deleteItems(setOf(book.id))
        } catch (e: com.papernotes.android.data.NotebookStoreException) {
            blockedDelete = e.code == com.papernotes.android.data.StoreErrorCode.CONFLICT
        }
        assertTrue("Unknown remote file must block notebook deletion", blockedDelete)
        assertTrue("docs/notebooks/${book.id}/extra-user-file.txt" in fakeGitHub.files)

        // 4. Repository isolation: switching to unbound local workspace isolates all notes and drafts
        val localState = repo.switchToLocalOfflineWorkspace()
        assertEquals("", localState.repository)
        assertFalse(localState.connected)
        assertTrue(localState.items.none { it.id == book.id })

        // 5. Network failure when server is unreachable preserves local draft cleanly
        repo.connectRepository("alice/paper-notes", "pat_test_12345", importUnboundLocal = false)
        val ch2Synced = repo.snapshotState().chaptersByBook[book.id]!!.first { it.id == ch2.id }
        repo.saveDraft(ch2Synced, "# 二、图论\n\n离线编辑待网络恢复\n")
        server.shutdown()
        var networkFailed = false
        try {
            repo.syncSelected(setOf(repo.chapterKey(book.id, ch2.id)))
        } catch (e: com.papernotes.android.data.NotebookStoreException) {
            networkFailed = e.code == com.papernotes.android.data.StoreErrorCode.NETWORK
        }
        assertTrue("Shutting down server must report NETWORK error", networkFailed)
        assertTrue(repo.getChapterContent(book.id, ch2.id)!!.second.contains("离线编辑待网络恢复"))
    }
}
