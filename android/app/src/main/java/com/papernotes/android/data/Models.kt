package com.papernotes.android.data

import kotlinx.serialization.Serializable

const val DEFAULT_CABINET_ID = "general"
const val DEFAULT_CABINET_TITLE = "默认书柜"

@Serializable
data class Cabinet(
    val id: String,
    val title: String
)

@Serializable
data class CabinetCatalog(
    val schemaVersion: Int? = 2,
    val cabinets: List<Cabinet>,
    val assignments: Map<String, String>
)

@Serializable
data class CatalogVersion(
    val catalog: CabinetCatalog,
    val sha: String
)

@Serializable
data class Notebook(
    val id: String,
    val title: String,
    val sha: String = "",
    val description: String? = null,
    val indexContent: String? = null,
    val chapterOrder: List<String>? = null
)

@Serializable
data class Chapter(
    val bookId: String,
    val id: String,
    val title: String,
    val content: String,
    val sha: String = ""
)

/** Standalone Markdown file stored in docs/pages/<id>.md. */
@Serializable
data class Page(
    val id: String,
    val title: String,
    val content: String,
    val sha: String = ""
)

@Serializable
data class ChapterDraft(
    val base: Chapter,
    val content: String
)

@Serializable
data class BookMetadataDraft(
    val base: Notebook,
    val description: String,
    val chapterOrder: List<String>? = null
)

@Serializable
data class RemoteSnapshot(
    val head: String,
    val books: List<Notebook>,
    val chapters: Map<String, List<Chapter>>,
    val pages: List<Page> = emptyList(),
    val catalog: CatalogVersion,
    val stale: Boolean = false
)

@Serializable
data class LocalCollection(
    val books: List<Notebook> = emptyList(),
    val pageIds: Set<String> = emptySet(),
    val chapters: List<Chapter> = emptyList(),
    val bookMetadataDrafts: Map<String, BookMetadataDraft> = emptyMap(),
    val welcomeInitialized: Boolean = false,
    val welcomeBookId: String = ""
)

data class NoteAttachment(
    val path: String,
    val bytes: ByteArray,
    val sha: String? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is NoteAttachment) return false
        return path == other.path && bytes.contentEquals(other.bytes) && sha == other.sha
    }

    override fun hashCode(): Int {
        var result = path.hashCode()
        result = 31 * result + bytes.contentHashCode()
        result = 31 * result + (sha?.hashCode() ?: 0)
        return result
    }
}

/** UI presentation model unifying Notebooks and Standalone Pages on a shelf. */
data class ShelfItem(
    val id: String, // book.id or "page_${page.id}"
    val title: String,
    val sha: String,
    val isPage: Boolean,
    val pageId: String? = null,
    val description: String = "",
    val chapterCount: Int = 0,
    val previewText: String = "",
    val chapterOrder: List<String>? = null,
    val indexContent: String? = null,
    val hasPendingChanges: Boolean = false
)

data class BookDeletion(
    val book: Notebook,
    val chapters: List<Chapter>
)

data class PendingSyncItem(
    val key: String, // "book:<id>" or "<bookId>/<chapterId>" or "catalog"
    val kind: PendingKind,
    val bookId: String?,
    val chapterId: String?,
    val title: String,
    val subtitle: String,
    val isPage: Boolean = false
)

enum class PendingKind {
    NEW_BOOK,
    BOOK_METADATA,
    CHAPTER,
    PAGE,
    CATALOG
}

data class SyncConflict(
    val kind: ConflictKind,
    val path: String,
    val title: String,
    val bookId: String?,
    val chapterId: String?,
    val isPage: Boolean,
    val localContent: String,
    val remoteContent: String,
    val remoteSha: String,
    val remoteTitle: String,
    val detail: String
)

enum class ConflictKind {
    CHAPTER_OR_PAGE,
    NOTEBOOK_INDEX,
    CATALOG,
    OTHER
}

enum class ConflictResolution {
    KEEP_LOCAL_REBASE_REMOTE,
    USE_REMOTE_DISCARD_LOCAL,
    SAVE_LOCAL_AS_COPY_AND_USE_REMOTE
}
