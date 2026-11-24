package com.papernotes.android.data

import kotlinx.serialization.Serializable

@Serializable
data class CabinetMove(
    val from: String,
    val to: String,
    val via: List<String> = emptyList()
)

@Serializable
data class CabinetRename(
    val from: String,
    val to: String,
    val via: List<String> = emptyList()
)

@Serializable
data class RedirectedMove(
    val before: CabinetMove,
    val after: CabinetMove? = null
)

@Serializable
data class CabinetRemoved(
    val title: String,
    val sha: String,
    val redirected: Map<String, RedirectedMove> = emptyMap(),
    val renamedBefore: CabinetRename? = null
)

@Serializable
data class CabinetJournalState(
    val created: Map<String, String> = emptyMap(),
    val moves: Map<String, CabinetMove> = emptyMap(),
    val removed: Map<String, CabinetRemoved> = emptyMap(),
    val renamed: Map<String, CabinetRename> = emptyMap(),
    val saved: CatalogVersion? = null,
    val snapshotSha: String? = null
)

/**
 * Offline-first cabinet journal mirroring docs/.vitepress/theme/useCabinets.ts.
 * Protects DEFAULT_CABINET_ID ('general') from deletion and redirects books on delete.
 */
class CabinetJournal(
    initialBase: CatalogVersion = CatalogVersion(CompatibilityCodecs.defaultCatalog(), ""),
    initialState: CabinetJournalState = CabinetJournalState()
) {
    var base: CatalogVersion = initialBase
        private set
    var state: CabinetJournalState = initialState
        private set

    private data class InFlight(
        val moves: Map<String, CabinetMove>,
        val removed: Map<String, CabinetRemoved>,
        val renamed: Map<String, CabinetRename>,
        val created: Map<String, String>
    )

    private var inFlight: InFlight? = null

    val cabinets: List<Cabinet>
        get() {
            val baseMapped = base.catalog.cabinets.map { c ->
                Cabinet(c.id, state.renamed[c.id]?.to ?: c.title)
            }
            val createdList = state.created.entries
                .filter { (id, _) -> base.catalog.cabinets.none { it.id == id } }
                .map { (id, title) -> Cabinet(id, title) }
            return (baseMapped + createdList).filter { it.id !in state.removed }
        }

    val pendingCount: Int
        get() = state.created.size + state.moves.size + state.removed.size + state.renamed.size

    fun assigned(itemId: String): String {
        val target = state.moves[itemId]?.to ?: base.catalog.assignments[itemId] ?: DEFAULT_CABINET_ID
        return if (target in state.removed) DEFAULT_CABINET_ID else target
    }

    fun setLatestBase(version: CatalogVersion) {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请稍后再读取目录。")
        base = version
    }

    fun create(title: String, idProvider: () -> String = { java.util.UUID.randomUUID().toString() }): String {
        val clean = title.trim()
        if (clean.isEmpty() || clean.length > 120 || title.contains('\r') || title.contains('\n')) {
            throw IllegalArgumentException("请输入 1 至 120 字的单行书柜名称。")
        }
        val id = idProvider()
        state = state.copy(created = state.created + (id to clean))
        return id
    }

    fun rename(id: String, title: String) {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请稍后再修改名称。")
        val clean = title.trim()
        if (clean.isEmpty() || clean.length > 120 || title.contains('\r') || title.contains('\n')) {
            throw IllegalArgumentException("请输入 1 至 120 字的单行书柜名称。")
        }
        if (cabinets.none { it.id == id }) throw IllegalArgumentException("书柜不存在或已经删除。")
        val remote = base.catalog.cabinets.find { it.id == id }
        val nextCreated = state.created.toMutableMap()
        val nextRenamed = state.renamed.toMutableMap()
        if (remote == null) {
            if (id !in nextCreated) throw IllegalArgumentException("书柜不存在，请恢复目录后重试。")
            nextCreated[id] = clean
        } else {
            val old = nextRenamed[id]
            val from = old?.from ?: remote.title
            val via = old?.via.orEmpty()
            if (clean == from && via.isEmpty()) {
                nextRenamed.remove(id)
            } else {
                nextRenamed[id] = CabinetRename(from = from, to = clean, via = via)
            }
        }
        state = state.copy(created = nextCreated, renamed = nextRenamed)
    }

    fun moveMany(itemIds: Collection<String>, toCabinetId: String) {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请稍后再移动。")
        if (cabinets.none { it.id == toCabinetId }) throw IllegalArgumentException("目标书柜不存在。")
        val nextMoves = state.moves.toMutableMap()
        for (itemId in itemIds.distinct()) {
            if (!CompatibilityCodecs.ID_REGEX.matches(itemId)) {
                throw IllegalArgumentException("笔记本标识无效。")
            }
            val old = nextMoves[itemId]
            val from = old?.from ?: base.catalog.assignments[itemId] ?: DEFAULT_CABINET_ID
            val via = old?.via.orEmpty()
            if (toCabinetId == from && via.isEmpty()) {
                nextMoves.remove(itemId)
            } else {
                nextMoves[itemId] = CabinetMove(from = from, to = toCabinetId, via = via)
            }
        }
        state = state.copy(moves = nextMoves)
    }

    fun remove(id: String) {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请稍后再删除。")
        if (id == DEFAULT_CABINET_ID) throw IllegalArgumentException("默认书柜不能删除。")
        if (cabinets.none { it.id == id }) throw IllegalArgumentException("书柜不存在或已经删除。")

        val nextCreated = state.created.toMutableMap()
        val nextMoves = state.moves.toMutableMap()
        val nextRemoved = state.removed.toMutableMap()
        val nextRenamed = state.renamed.toMutableMap()

        val remote = base.catalog.cabinets.find { it.id == id }
        nextCreated.remove(id)
        val renamedBefore = nextRenamed.remove(id)

        val redirected = LinkedHashMap<String, RedirectedMove>()
        for ((bookId, move) in state.moves) {
            if (move.to != id) continue
            val via = move.via
            val after = if (move.from == DEFAULT_CABINET_ID && via.isEmpty()) {
                nextMoves.remove(bookId)
                null
            } else {
                val updated = CabinetMove(from = move.from, to = DEFAULT_CABINET_ID, via = via)
                nextMoves[bookId] = updated
                updated
            }
            redirected[bookId] = RedirectedMove(before = move, after = after)
        }
        if (remote != null) {
            nextRemoved[id] = CabinetRemoved(
                title = remote.title,
                sha = base.sha,
                redirected = redirected,
                renamedBefore = renamedBefore
            )
        }
        state = state.copy(
            created = nextCreated,
            moves = nextMoves,
            removed = nextRemoved,
            renamed = nextRenamed
        )
    }

    fun undoRemove(id: String) {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请稍后再撤销。")
        val record = state.removed[id] ?: throw IllegalArgumentException("没有待撤销的书柜删除。")
        if (base.catalog.cabinets.none { it.id == id }) {
            throw IllegalStateException("远程书柜已不存在，请同步删除状态。")
        }
        val nextRemoved = state.removed.toMutableMap()
        val nextMoves = state.moves.toMutableMap()
        val nextRenamed = state.renamed.toMutableMap()
        if (record.renamedBefore != null && id !in nextRenamed) {
            nextRenamed[id] = record.renamedBefore
        }
        for ((bookId, pair) in record.redirected) {
            if (nextMoves[bookId] == pair.after) {
                nextMoves[bookId] = pair.before
            }
        }
        nextRemoved.remove(id)
        state = state.copy(removed = nextRemoved, moves = nextMoves, renamed = nextRenamed)
    }

    fun discardMoves(itemIds: Collection<String>) {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请稍后再删除。")
        val nextMoves = state.moves.toMutableMap()
        itemIds.forEach { nextMoves.remove(it) }
        state = state.copy(moves = nextMoves)
    }

    fun prepare(itemIds: Collection<String>, cabinetIds: Collection<String>): CatalogVersion? {
        if (inFlight != null) throw IllegalStateException("书柜同步正在进行，请等待完成后重试。")
        val source = base.catalog
        val nextCabinets = source.cabinets.toMutableList()
        val nextAssignments = source.assignments.toMutableMap()
        val needed = (cabinetIds + itemIds.map { assigned(it) }).toSet()
        var changed = false

        val submittedRemoved = LinkedHashMap<String, CabinetRemoved>()
        for (id in cabinetIds) {
            val removal = state.removed[id] ?: continue
            if (id == DEFAULT_CABINET_ID) throw IllegalArgumentException("默认书柜不能删除。")
            val current = source.cabinets.find { it.id == id }
            if (current != null && (current.title != removal.title || base.sha != removal.sha)) {
                throw IllegalStateException("远程书柜内容已变化，请恢复后重新检查。")
            }
            nextCabinets.removeAll { it.id == id }
            nextAssignments.entries.removeAll { it.value == id }
            submittedRemoved[id] = removal
            changed = true
        }

        val submittedCreated = LinkedHashMap<String, String>()
        for (id in needed) {
            val title = state.created[id] ?: continue
            submittedCreated[id] = title
            changed = true
            val existing = nextCabinets.find { it.id == id }
            if (existing == null) nextCabinets.add(Cabinet(id, title))
            else if (existing.title != title) throw IllegalStateException("远程书柜名称发生变化，请读取最新目录。")
        }

        val submittedRenamed = LinkedHashMap<String, CabinetRename>()
        for (id in needed) {
            val rename = state.renamed[id] ?: continue
            val current = source.cabinets.find { it.id == id }
            if (current == null || nextCabinets.none { it.id == id }) {
                throw IllegalStateException("远程书柜已删除，请恢复后重新检查。")
            }
            if (current.title != rename.from && current.title != rename.to && current.title !in rename.via) {
                throw IllegalStateException("远程书柜名称已更改，请恢复后重新检查。")
            }
            val idx = nextCabinets.indexOfFirst { it.id == id }
            if (idx >= 0) nextCabinets[idx] = Cabinet(id, rename.to)
            submittedRenamed[id] = rename
            changed = true
        }

        val submittedMoves = LinkedHashMap<String, CabinetMove>()
        for (id in itemIds) {
            val move = state.moves[id] ?: continue
            val current = source.assignments[id] ?: DEFAULT_CABINET_ID
            if (current != move.from && current != move.to && current !in move.via) {
                throw IllegalStateException("这本笔记的归属已在另一台设备上更改。请读取最新目录，再重新选择目标书柜。")
            }
            if (nextCabinets.none { it.id == move.to }) {
                throw IllegalStateException("目标书柜已变更，请重新选择。")
            }
            nextAssignments[id] = move.to
            submittedMoves[id] = move
            changed = true
        }

        if (!changed) return null

        val nextMoves = state.moves.toMutableMap()
        for ((id, move) in submittedMoves) {
            nextMoves[id] = move.copy(via = (move.via + move.to).distinct())
        }
        val nextRenamed = state.renamed.toMutableMap()
        for ((id, rename) in submittedRenamed) {
            nextRenamed[id] = rename.copy(via = (rename.via + rename.to).distinct())
        }
        state = state.copy(moves = nextMoves, renamed = nextRenamed)
        inFlight = InFlight(submittedMoves, submittedRemoved, submittedRenamed, submittedCreated)
        return CatalogVersion(
            catalog = CabinetCatalog(schemaVersion = 2, cabinets = nextCabinets, assignments = nextAssignments),
            sha = base.sha
        )
    }

    fun acknowledge(version: CatalogVersion) {
        val currentFlight = inFlight ?: throw IllegalStateException("没有正在进行的书柜同步。")
        base = version

        val nextCreated = state.created.toMutableMap()
        for (c in version.catalog.cabinets) {
            if (nextCreated[c.id] == c.title ||
                (currentFlight.created[c.id] != null && nextCreated[c.id] == currentFlight.created[c.id])
            ) {
                nextCreated.remove(c.id)
            }
        }

        val nextRemoved = state.removed.toMutableMap()
        for ((id, removal) in currentFlight.removed) {
            val pending = nextRemoved[id]
            if (pending == removal && version.catalog.cabinets.none { it.id == id }) {
                nextRemoved.remove(id)
            }
        }

        val nextRenamed = state.renamed.toMutableMap()
        for ((id, rename) in state.renamed) {
            val current = version.catalog.cabinets.find { it.id == id }?.title
            when {
                current == rename.to -> nextRenamed.remove(id)
                currentFlight.renamed[id] != null && current == currentFlight.renamed[id]!!.to ->
                    nextRenamed[id] = CabinetRename(from = current, to = rename.to)
            }
        }

        val nextMoves = state.moves.toMutableMap()
        for ((id, move) in state.moves) {
            val current = version.catalog.assignments[id] ?: DEFAULT_CABINET_ID
            when {
                current == move.to -> nextMoves.remove(id)
                currentFlight.moves[id] != null && current == currentFlight.moves[id]!!.to ->
                    nextMoves[id] = CabinetMove(from = current, to = move.to)
            }
        }

        state = state.copy(
            created = nextCreated,
            removed = nextRemoved,
            renamed = nextRenamed,
            moves = nextMoves,
            saved = version
        )
        inFlight = null
    }

    fun fail() {
        inFlight = null
    }
}
