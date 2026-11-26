package com.papernotes.android.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DragIndicator
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.papernotes.android.data.Chapter
import com.papernotes.android.data.CompatibilityCodecs
import com.papernotes.android.data.WorkspaceState
import com.papernotes.android.ui.components.PaperBadge
import com.papernotes.android.ui.components.PaperButton
import com.papernotes.android.ui.components.PaperCard
import com.papernotes.android.ui.components.paperHardShadow
import com.papernotes.android.ui.theme.LocalPaperColors
import com.papernotes.android.ui.theme.LocalReducedMotion

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NotebookDetailScreen(
    cabinetId: String,
    bookId: String,
    workspace: WorkspaceState,
    notice: String?,
    error: String?,
    onDismissMessage: () -> Unit,
    onBack: () -> Unit,
    onOpenChapter: (Chapter) -> Unit,
    onCreateChapter: (String) -> Unit,
    onUpdateDescription: (String) -> Unit,
    onReorderChapters: (List<String>) -> Unit,
    onDeleteChapters: (Set<String>) -> Unit,
    onMoveToCabinet: (String) -> Unit,
    onSyncNotebook: () -> Unit,
    onOpenSync: () -> Unit,
    onOpenImport: () -> Unit,
    onShareNotebook: () -> Unit
) {
    val colors = LocalPaperColors.current
    val reducedMotion = LocalReducedMotion.current
    val haptic = LocalHapticFeedback.current

    val book = workspace.items.find { it.id == bookId }
    val chapters = workspace.chaptersByBook[bookId].orEmpty()
    val cabinetTitle = workspace.cabinets.find { it.id == cabinetId }?.title ?: "默认书柜"

    // Local mutable order for live drag-following-finger feedback
    var liveChapters by remember(chapters) { mutableStateOf(chapters) }
    LaunchedEffect(chapters) { liveChapters = chapters }

    var draggingId by remember { mutableStateOf<String?>(null) }
    var dragOffsetY by remember { mutableFloatStateOf(0f) }
    var rowHeightPx by remember { mutableFloatStateOf(160f) }

    var manageMode by remember { mutableStateOf(false) }
    var selectedIds by remember { mutableStateOf(emptySet<String>()) }
    var showNewChapterDialog by remember { mutableStateOf(false) }
    var showEditDescDialog by remember { mutableStateOf(false) }
    var showMoveCabinetDialog by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    fun moveIndex(from: Int, to: Int) {
        if (from == to || from !in liveChapters.indices || to !in liveChapters.indices) return
        val next = liveChapters.toMutableList()
        val moved = next.removeAt(from)
        next.add(to, moved)
        liveChapters = next
        onReorderChapters(next.map { it.id })
    }

    Scaffold(
        containerColor = colors.background,
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surface)
                    .statusBarsPadding()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = {
                        if (manageMode) {
                            manageMode = false
                            selectedIds = emptySet()
                        } else onBack()
                    }) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回书架", tint = colors.ink)
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (manageMode) "已选 ${selectedIds.size} 篇章节" else (book?.title ?: "笔记本"),
                            color = colors.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        )
                        if (!manageMode) {
                            Text(
                                text = "$cabinetTitle · ${liveChapters.size} 章",
                                color = colors.muted,
                                fontSize = 11.sp
                            )
                        }
                    }
                    if (liveChapters.isNotEmpty()) {
                        TextButton(onClick = {
                            manageMode = !manageMode
                            selectedIds = emptySet()
                        }) {
                            Text(if (manageMode) "完成" else "管理", color = colors.ink, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (!manageMode) {
                        IconButton(onClick = onShareNotebook) {
                            Icon(Icons.Outlined.Share, contentDescription = "分享笔记本", tint = colors.ink)
                        }
                        IconButton(onClick = onOpenImport) {
                            Icon(Icons.Outlined.FileUpload, contentDescription = "导入章节", tint = colors.ink)
                        }
                    }
                }
                HorizontalDivider(thickness = 1.8.dp, color = colors.line)
            }
        },
        floatingActionButton = {
            if (!manageMode) {
                PaperButton(
                    onClick = { showNewChapterDialog = true },
                    primary = true,
                    shadowOffset = 3.dp,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    modifier = Modifier.navigationBarsPadding()
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text("新建章节", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
        },
        bottomBar = {
            if (manageMode) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface)
                        .navigationBarsPadding()
                ) {
                    HorizontalDivider(thickness = 1.8.dp, color = colors.line)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        PaperButton(
                            onClick = {
                                selectedIds = if (selectedIds.size == liveChapters.size) emptySet()
                                else liveChapters.map { it.id }.toSet()
                            }
                        ) {
                            Text(if (selectedIds.size == liveChapters.size) "取消全选" else "全选", fontSize = 12.sp)
                        }
                        Spacer(Modifier.weight(1f))
                        PaperButton(
                            onClick = { showDeleteConfirm = true },
                            enabled = selectedIds.isNotEmpty(),
                            primary = true,
                            danger = true
                        ) {
                            Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text("删除章节", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    ) { innerPadding ->
        val directoryGroups = remember(liveChapters) {
            CompatibilityCodecs.groupChaptersForDirectory(liveChapters) { it.id }
        }
        val namedGroups = remember(directoryGroups) { directoryGroups.filter { it.groupName.isNotEmpty() } }
        val hasNamedGroups = namedGroups.isNotEmpty()
        val collapsedGroups = remember(bookId) { mutableStateMapOf<String, Boolean>() }
        val allCollapsed = hasNamedGroups && namedGroups.all { collapsedGroups[it.key] == true }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Notices / Errors
            if (!error.isNullOrBlank()) {
                item { InlineMessageBanner(error, isError = true, onDismiss = onDismissMessage) }
            } else if (!notice.isNullOrBlank()) {
                item { InlineMessageBanner(notice, isError = false, onDismiss = onDismissMessage) }
            }

            // Notebook Cover & Description Hero Card
            if (book != null) {
                item {
                    PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 4.dp) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(15.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                                verticalAlignment = Alignment.Top
                            ) {
                                // Mini drawn notebook cover
                                Box(
                                    modifier = Modifier
                                        .width(56.dp)
                                        .height(78.dp)
                                        .paperHardShadow(2.dp, 2.dp, 4.dp, colors.depthEdge)
                                        .background(colors.bookFace, RoundedCornerShape(4.dp))
                                        .border(1.6.dp, colors.line, RoundedCornerShape(4.dp))
                                        .padding(6.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .width(4.dp)
                                            .height(64.dp)
                                            .background(colors.spineBrown)
                                    )
                                    Column(
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .padding(start = 8.dp),
                                        verticalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text("NOTE", color = colors.muted, fontFamily = FontFamily.Monospace, fontSize = 7.sp, fontWeight = FontWeight.Bold)
                                        Text(
                                            book.title,
                                            color = colors.ink,
                                            fontFamily = FontFamily.Serif,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 10.sp,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text("${liveChapters.size} CH", color = colors.ink, fontFamily = FontFamily.Monospace, fontSize = 7.sp)
                                    }
                                }

                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Text(
                                        text = book.title,
                                        color = colors.ink,
                                        style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                                    )
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        PaperBadge(
                                            text = cabinetTitle,
                                            modifier = Modifier.clickable { showMoveCabinetDialog = true }
                                        )
                                        PaperBadge(
                                            text = if (book.hasPendingChanges) "有待同步改动" else if (workspace.connected) "已同步" else "本机离线",
                                            accent = book.hasPendingChanges
                                        )
                                    }
                                }
                            }

                            // Optional description block
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(6.dp))
                                    .border(1.2.dp, colors.subtleLine, RoundedCornerShape(6.dp))
                                    .background(colors.softSurface)
                                    .clickable { showEditDescDialog = true }
                                    .padding(horizontal = 11.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.Top,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = book.description.ifBlank { "点击添加笔记本简介（可选，最多 500 字）…" },
                                    color = if (book.description.isBlank()) colors.muted else colors.ink,
                                    fontSize = 13.sp,
                                    lineHeight = 19.sp,
                                    modifier = Modifier.weight(1f)
                                )
                                Icon(Icons.Outlined.Edit, contentDescription = "编辑简介", tint = colors.muted, modifier = Modifier.size(16.dp))
                            }

                            if (book.hasPendingChanges) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.End
                                ) {
                                    PaperButton(
                                        onClick = if (workspace.connected) onSyncNotebook else onOpenSync,
                                        primary = workspace.connected
                                    ) {
                                        Icon(Icons.Outlined.CloudSync, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Text(
                                            text = if (workspace.connected) "同步此笔记本" else "连接 GitHub 同步",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Section Heading + Collapse-all / Drag hint
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "章节列表 (${liveChapters.size})",
                        color = colors.ink,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    if (hasNamedGroups) {
                        PaperBadge(
                            text = if (allCollapsed) "展开全部章 ▾" else "收起全部章 ▴",
                            modifier = Modifier.clickable {
                                val next = !allCollapsed
                                namedGroups.forEach { collapsedGroups[it.key] = next }
                            }
                        )
                    } else if (liveChapters.size > 1) {
                        Text(
                            text = if (manageMode) "可点 ↑↓ 调整顺序或勾选删除" else "拖动左侧 ⠿ 排序 · 长按管理",
                            color = colors.muted,
                            fontSize = 11.sp
                        )
                    }
                }
            }

            if (liveChapters.isEmpty()) {
                item {
                    PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 2.dp) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 32.dp, horizontal = 20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text("还没有章节", color = colors.ink, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                            Text("点击下方「新建章节」开始写作，或右上角导入 Markdown 文件。", color = colors.muted, fontSize = 13.sp)
                        }
                    }
                }
            } else {
                directoryGroups.forEach { group ->
                    val isGroupCollapsed = group.groupName.isNotEmpty() && collapsedGroups[group.key] == true
                    if (group.groupName.isNotEmpty()) {
                        item(key = "grp_${group.key}") {
                            PaperCard(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { collapsedGroups[group.key] = !isGroupCollapsed },
                                cornerRadius = 9.dp,
                                shadowOffset = 2.dp,
                                backgroundColor = colors.softSurface
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 12.dp, vertical = 11.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = if (isGroupCollapsed) "▸" else "▾",
                                        color = colors.muted,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Box(
                                        modifier = Modifier
                                            .background(colors.surface, RoundedCornerShape(4.dp))
                                            .border(1.1.dp, colors.line, RoundedCornerShape(4.dp))
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = "第 %02d 章".format(group.ordinal),
                                            color = colors.ink,
                                            fontFamily = FontFamily.Monospace,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 11.sp
                                        )
                                    }
                                    Text(
                                        text = group.groupName,
                                        color = colors.ink,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 14.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Text(
                                        text = "${group.items.size} 话",
                                        color = colors.muted,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }
                    }

                    if (!isGroupCollapsed) {
                        itemsIndexed(group.items, key = { _, ch -> ch.id }) { itemIdx, chapter ->
                            val index = liveChapters.indexOfFirst { it.id == chapter.id }.coerceAtLeast(0)
                            val isDragging = draggingId == chapter.id
                            val isSelected = chapter.id in selectedIds
                            val isDirty = chapter.sha.isEmpty() || "${chapter.bookId}/${chapter.id}" in workspace.drafts
                            val displayInfo = remember(chapter.id, chapter.title) {
                                CompatibilityCodecs.chapterDisplayInfo(chapter.id, chapter.title)
                            }
                            val badgeText = if (group.groupName.isNotEmpty()) "%02d 话".format(itemIdx + 1) else "%02d".format(index + 1)

                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(start = if (group.groupName.isNotEmpty()) 12.dp else 0.dp)
                                    .zIndex(if (isDragging) 20f else 1f)
                                    .onSizeChanged { if (it.height > 0) rowHeightPx = it.height.toFloat() }
                                    .graphicsLayer {
                                        if (isDragging) {
                                            translationY = dragOffsetY
                                            if (!reducedMotion) {
                                                scaleX = 1.02f
                                                scaleY = 1.02f
                                            }
                                        }
                                    }
                            ) {
                                PaperCard(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .combinedClickable(
                                            onClick = {
                                                if (manageMode) {
                                                    selectedIds = if (isSelected) selectedIds - chapter.id else selectedIds + chapter.id
                                                } else {
                                                    onOpenChapter(chapter)
                                                }
                                            },
                                            onLongClick = {
                                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                manageMode = true
                                                selectedIds = selectedIds + chapter.id
                                            }
                                        ),
                                    cornerRadius = 9.dp,
                                    shadowOffset = if (isDragging) 6.dp else 2.dp,
                                    borderColor = if (isDragging || isSelected) colors.spineBrown else colors.line,
                                    backgroundColor = if (isSelected) colors.softSurface else colors.surface
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 8.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        if (manageMode) {
                                            Icon(
                                                imageVector = if (isSelected) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                                                contentDescription = "选择章节",
                                                tint = colors.ink,
                                                modifier = Modifier
                                                    .size(24.dp)
                                                    .clickable {
                                                        selectedIds = if (isSelected) selectedIds - chapter.id else selectedIds + chapter.id
                                                    }
                                            )
                                        } else if (liveChapters.size > 1) {
                                            Box(
                                                modifier = Modifier
                                                    .size(32.dp)
                                                    .pointerInput(chapter.id, liveChapters.size) {
                                                        detectDragGestures(
                                                            onDragStart = {
                                                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                                draggingId = chapter.id
                                                                dragOffsetY = 0f
                                                            },
                                                            onDrag = { change, dragAmount ->
                                                                change.consume()
                                                                dragOffsetY += dragAmount.y
                                                                val curIdx = liveChapters.indexOfFirst { it.id == chapter.id }
                                                                val threshold = (rowHeightPx + 10f) * 0.55f
                                                                if (curIdx >= 0) {
                                                                    if (dragOffsetY > threshold && curIdx < liveChapters.lastIndex) {
                                                                        val next = liveChapters.toMutableList()
                                                                        next.add(curIdx + 1, next.removeAt(curIdx))
                                                                        liveChapters = next
                                                                        dragOffsetY -= rowHeightPx
                                                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                                    } else if (dragOffsetY < -threshold && curIdx > 0) {
                                                                        val next = liveChapters.toMutableList()
                                                                        next.add(curIdx - 1, next.removeAt(curIdx))
                                                                        liveChapters = next
                                                                        dragOffsetY += rowHeightPx
                                                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                                    }
                                                                }
                                                            },
                                                            onDragEnd = {
                                                                draggingId = null
                                                                dragOffsetY = 0f
                                                                onReorderChapters(liveChapters.map { it.id })
                                                            },
                                                            onDragCancel = {
                                                                draggingId = null
                                                                dragOffsetY = 0f
                                                                liveChapters = chapters
                                                            }
                                                        )
                                                    },
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(
                                                    Icons.Outlined.DragIndicator,
                                                    contentDescription = "拖动调整章节顺序",
                                                    tint = if (isDragging) colors.spineBrown else colors.muted,
                                                    modifier = Modifier.size(22.dp)
                                                )
                                            }
                                        }

                                        Box(
                                            modifier = Modifier
                                                .border(1.2.dp, colors.line, RoundedCornerShape(4.dp))
                                                .padding(horizontal = 6.dp, vertical = 3.dp)
                                        ) {
                                            Text(
                                                text = badgeText,
                                                color = colors.ink,
                                                fontFamily = FontFamily.Monospace,
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 11.sp
                                            )
                                        }

                                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text(
                                                text = displayInfo.primaryTitle,
                                                color = colors.ink,
                                                fontWeight = FontWeight.SemiBold,
                                                fontSize = 14.5.sp,
                                                maxLines = 2,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            if (displayInfo.summaryTitle.isNotEmpty()) {
                                                Text(
                                                    text = displayInfo.summaryTitle,
                                                    color = colors.muted,
                                                    fontSize = 12.sp,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                            }
                                            if (isDirty) {
                                                Text("草稿待同步", color = colors.spineBrown, fontSize = 10.sp, fontWeight = FontWeight.Medium)
                                            }
                                        }

                                        if (manageMode && liveChapters.size > 1) {
                                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                                IconButton(
                                                    onClick = { moveIndex(index, index - 1) },
                                                    enabled = index > 0,
                                                    modifier = Modifier.size(32.dp)
                                                ) {
                                                    Icon(
                                                        Icons.Outlined.ArrowUpward,
                                                        contentDescription = "上移章节",
                                                        tint = if (index > 0) colors.ink else colors.subtleLine,
                                                        modifier = Modifier.size(18.dp)
                                                    )
                                                }
                                                IconButton(
                                                    onClick = { moveIndex(index, index + 1) },
                                                    enabled = index < liveChapters.lastIndex,
                                                    modifier = Modifier.size(32.dp)
                                                ) {
                                                    Icon(
                                                        Icons.Outlined.ArrowDownward,
                                                        contentDescription = "下移章节",
                                                        tint = if (index < liveChapters.lastIndex) colors.ink else colors.subtleLine,
                                                        modifier = Modifier.size(18.dp)
                                                    )
                                                }
                                            }
                                        } else if (!manageMode) {
                                            Text("↗", color = colors.muted, fontSize = 15.sp, modifier = Modifier.padding(end = 6.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showNewChapterDialog) {
        SingleTextInputDialog(
            title = "新建章节",
            label = "章节标题",
            placeholder = "输入新章节名称",
            confirmText = "创建并编辑",
            onDismiss = { showNewChapterDialog = false },
            onConfirm = { name ->
                showNewChapterDialog = false
                onCreateChapter(name)
            }
        )
    }

    if (showEditDescDialog && book != null) {
        var descText by remember(book.description) { mutableStateOf(book.description) }
        AlertDialog(
            onDismissRequest = { showEditDescDialog = false },
            containerColor = colors.surface,
            titleContentColor = colors.ink,
            title = { Text("编辑笔记本简介", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = descText,
                    onValueChange = { if (it.length <= 500) descText = it },
                    label = { Text("简介（${descText.length}/500）") },
                    minLines = 3,
                    maxLines = 6,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.line,
                        unfocusedBorderColor = colors.subtleLine,
                        focusedTextColor = colors.ink,
                        unfocusedTextColor = colors.ink
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                PaperButton(
                    onClick = { showEditDescDialog = false; onUpdateDescription(descText) },
                    primary = true
                ) { Text("保存") }
            },
            dismissButton = {
                PaperButton(onClick = { showEditDescDialog = false }) { Text("取消") }
            }
        )
    }

    if (showMoveCabinetDialog) {
        MoveCabinetDialog(
            cabinets = workspace.cabinets,
            currentCabinetId = cabinetId,
            count = 1,
            onDismiss = { showMoveCabinetDialog = false },
            onSelect = { target ->
                showMoveCabinetDialog = false
                onMoveToCabinet(target)
            }
        )
    }

    if (showDeleteConfirm && selectedIds.isNotEmpty()) {
        val targets = liveChapters.filter { it.id in selectedIds }
        val hasSynced = targets.any { it.sha.isNotEmpty() }
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            containerColor = colors.surface,
            titleContentColor = colors.ink,
            textContentColor = colors.muted,
            title = { Text("确认删除这 ${targets.size} 篇章节？", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    if (hasSynced) "包含已同步到 GitHub 的章节：确认后将从仓库与本机同时删除。"
                    else "所选章节均为本机草稿，删除后将从本机移除。"
                )
            },
            confirmButton = {
                PaperButton(
                    onClick = {
                        val ids = selectedIds
                        showDeleteConfirm = false
                        manageMode = false
                        selectedIds = emptySet()
                        onDeleteChapters(ids)
                    },
                    primary = true,
                    danger = true
                ) { Text("确认删除") }
            },
            dismissButton = { PaperButton(onClick = { showDeleteConfirm = false }) { Text("取消") } }
        )
    }
}
