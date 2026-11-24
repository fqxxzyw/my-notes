package com.papernotes.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
data class AppSettings(
    val configuredRepository: String = "",
    val themePreference: String = "day",
    val reducedMotionOverride: Boolean = false,
    val onboardingCompleted: Boolean = false
)

/**
 * Atomic, repository-isolated JSON file storage for local collections, drafts,
 * cabinet journals, and restored remote snapshots.
 */
class WorkspaceStorage(private val rootDir: File) {
    private val json = Json {
        prettyPrint = false
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private fun atomicWrite(file: File, text: String) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(text, Charsets.UTF_8)
            tmp.delete()
        }
    }

    // --- App-level settings ---

    private fun settingsFile(): File = File(rootDir, "app_settings.json")

    fun loadSettings(): AppSettings {
        val f = settingsFile()
        if (!f.isFile) return AppSettings()
        return try {
            json.decodeFromString<AppSettings>(f.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            AppSettings()
        }
    }

    fun saveSettings(settings: AppSettings) {
        atomicWrite(settingsFile(), json.encodeToString(settings))
    }

    // --- Workspace-scoped files ---

    private fun workspaceDir(repository: String?): File =
        File(File(rootDir, "workspaces"), RepositoryIdentity.workspaceScope(repository))

    private fun localCollectionFile(repository: String?): File =
        File(workspaceDir(repository), "local_collection.json")

    private fun draftsFile(repository: String?): File =
        File(workspaceDir(repository), "drafts.json")

    private fun cabinetJournalFile(repository: String?): File =
        File(workspaceDir(repository), "cabinet_journal.json")

    private fun remoteSnapshotFile(repository: String?): File =
        File(workspaceDir(repository), "remote_snapshot.json")

    fun loadLocalCollection(repository: String?): Pair<LocalCollection, Boolean> {
        val f = localCollectionFile(repository)
        if (!f.isFile) return LocalCollection() to false
        return try {
            json.decodeFromString<LocalCollection>(f.readText(Charsets.UTF_8)) to false
        } catch (_: Exception) {
            // Preserve damaged raw file untouched; signal caller to block destructive writes.
            LocalCollection() to true
        }
    }

    fun saveLocalCollection(repository: String?, collection: LocalCollection) {
        atomicWrite(localCollectionFile(repository), json.encodeToString(collection))
    }

    fun loadDrafts(repository: String?): Map<String, ChapterDraft> {
        val f = draftsFile(repository)
        if (!f.isFile) return emptyMap()
        return try {
            json.decodeFromString<Map<String, ChapterDraft>>(f.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun saveDrafts(repository: String?, drafts: Map<String, ChapterDraft>) {
        atomicWrite(draftsFile(repository), json.encodeToString(drafts))
    }

    fun loadCabinetJournal(repository: String?): CabinetJournalState {
        val f = cabinetJournalFile(repository)
        if (!f.isFile) return CabinetJournalState()
        return try {
            json.decodeFromString<CabinetJournalState>(f.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            CabinetJournalState()
        }
    }

    fun saveCabinetJournal(repository: String?, state: CabinetJournalState) {
        atomicWrite(cabinetJournalFile(repository), json.encodeToString(state))
    }

    fun loadRemoteSnapshot(repository: String?): RemoteSnapshot? {
        val f = remoteSnapshotFile(repository)
        if (!f.isFile) return null
        return try {
            json.decodeFromString<RemoteSnapshot>(f.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            null
        }
    }

    fun saveRemoteSnapshot(repository: String?, snapshot: RemoteSnapshot) {
        atomicWrite(remoteSnapshotFile(repository), json.encodeToString(snapshot))
    }

    fun clearRemoteSnapshot(repository: String?) {
        remoteSnapshotFile(repository).delete()
    }

    fun hasUserData(repository: String?): Boolean {
        val (local, damaged) = loadLocalCollection(repository)
        if (damaged) return true
        val drafts = loadDrafts(repository)
        val journal = loadCabinetJournal(repository)
        val nonWelcomeBooks = local.books.filter { it.id != local.welcomeBookId }
        return nonWelcomeBooks.isNotEmpty() ||
            drafts.isNotEmpty() ||
            journal.created.isNotEmpty() ||
            journal.moves.isNotEmpty() ||
            journal.renamed.isNotEmpty() ||
            journal.removed.isNotEmpty()
    }
}
