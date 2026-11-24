package com.papernotes.android.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.papernotes.android.data.Cabinet
import com.papernotes.android.data.DEFAULT_CABINET_ID
import com.papernotes.android.data.ShelfItem
import com.papernotes.android.data.WorkspaceState
import com.papernotes.android.ui.components.PaperBadge
import com.papernotes.android.ui.components.PaperBrandIcon
import com.papernotes.android.ui.components.PaperButton
import com.papernotes.android.ui.components.PaperCard
import com.papernotes.android.ui.components.ShelfSoundHaptics
import com.papernotes.android.ui.components.paperDashedBorder
import com.papernotes.android.ui.theme.LocalPaperColors

/**
 * Formats notebook and standalone page counts while omitting any type with count 0.
 */
fun formatNonZeroCounts(items: List<ShelfItem>): String {
    val pages = items.count { it.isPage }
    val notebooks = items.size - pages
    return listOfNotNull(
        if (notebooks > 0) "$notebooks 本笔记本" else null,
        if (pages > 0) "$pages 张书页" else null
    ).joinToString(" · ")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CabinetHomeScreen(
    workspace: WorkspaceState,
    assignedCabinetOf: (String) -> String,
    notice: String?,
    error: String?,
    onDismissMessage: () -> Unit,
    onOpenCabinet: (String) -> Unit,
    onCreateCabinet: (String) -> Unit,
    onRenameCabinet: (String, String) -> Unit,
    onDeleteCabinet: (String) -> Unit,
    onUndoDeleteCabinet: (String) -> Unit,
    onCreateNotebook: (title: String, desc: String, cabinetId: String) -> Unit,
    onCreatePage: (title: String, cabinetId: String) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenTheme: () -> Unit,
    onOpenImport: () -> Unit,
    onOpenSync: () -> Unit,
    onOpenSettings: () -> Unit,
    onShareCabinet: (String) -> Unit
) {
    val colors = LocalPaperColors.current
    var showCreateSheet by remember { mutableStateOf(false) }
    var showNewCabinetDialog by remember { mutableStateOf(false) }
    var showNewNoteDialog by remember { mutableStateOf<Boolean?>(null) } // true=notebook, false=page
    var menuCabinet by remember { mutableStateOf<Cabinet?>(null) }
    var renameTarget by remember { mutableStateOf<Cabinet?>(null) }
    var deleteTarget by remember { mutableStateOf<Cabinet?>(null) }

    val itemsByCabinet = remember(workspace.cabinets, workspace.items) {
        workspace.cabinets.associate { cab ->
            cab.id to workspace.items.filter { assignedCabinetOf(it.id) == cab.id }
        }
    }

    val totalSummary = remember(workspace.cabinets, workspace.items) {
        val counts = formatNonZeroCounts(workspace.items)
        listOfNotNull("${workspace.cabinets.size} 个书柜", counts.ifEmpty { null }).joinToString(" · ")
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
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(9.dp)
                    ) {
                        PaperBrandIcon(size = 30.dp)
                        Text(
                            text = "纸间",
                            color = colors.ink,
                            style = TextStyle(
                                fontFamily = FontFamily.Serif,
                                fontWeight = FontWeight.Bold,
                                fontSize = 20.sp,
                                letterSpacing = 1.sp
                            )
                        )
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        IconButton(onClick = onOpenSearch) {
                            Icon(Icons.Outlined.Search, contentDescription = "搜索笔记", tint = colors.ink)
                        }
                        IconButton(onClick = onOpenTheme) {
                            Icon(Icons.Outlined.Palette, contentDescription = "主题与外观", tint = colors.ink)
                        }
                        IconButton(onClick = onOpenImport) {
                            Icon(Icons.Outlined.FileUpload, contentDescription = "导入笔记", tint = colors.ink)
                        }
                        IconButton(onClick = onOpenSettings) {
                            Icon(Icons.Outlined.Settings, contentDescription = "设置", tint = colors.ink)
                        }
                    }
                }
                HorizontalDivider(thickness = 1.8.dp, color = colors.line)
            }
        },
        floatingActionButton = {
            PaperButton(
                onClick = { showCreateSheet = true },
                primary = true,
                shadowOffset = 3.dp,
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 13.dp),
                modifier = Modifier.navigationBarsPadding()
            ) {
                Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("新建", fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }
        }
    ) { innerPadding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            val columns = if (maxWidth >= 620.dp) 2 else 1

            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 96.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                // Header & Sync Entry Banner
                item(span = { GridItemSpan(columns) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.Bottom,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "LEVEL 01 · BOOKCASES",
                                    color = colors.muted,
                                    style = TextStyle(
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 10.sp,
                                        letterSpacing = 1.sp
                                    )
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = "全部书柜",
                                    color = colors.ink,
                                    style = TextStyle(
                                        fontFamily = FontFamily.Serif,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 26.sp
                                    )
                                )
                                Text(
                                    text = totalSummary,
                                    color = colors.muted,
                                    fontSize = 13.sp
                                )
                            }

                            // Sync Status Pill
                            SyncEntryPill(
                                connected = workspace.connected,
                                repository = workspace.repository,
                                pendingCount = workspace.pendingSyncItems.size,
                                onClick = onOpenSync
                            )
                        }

                        if (!error.isNullOrBlank()) {
                            InlineMessageBanner(
                                text = error,
                                isError = true,
                                onDismiss = onDismissMessage
                            )
                        } else if (!notice.isNullOrBlank()) {
                            InlineMessageBanner(
                                text = notice,
                                isError = false,
                                onDismiss = onDismissMessage
                            )
                        }

                        // Undoable remote cabinet deletions
                        if (workspace.removedCabinets.isNotEmpty()) {
                            PaperCard(shadowOffset = 2.dp, backgroundColor = colors.warningBg) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Text(
                                        text = "待同步删除的书柜（笔记已移入默认书柜）",
                                        color = colors.warning,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp
                                    )
                                    workspace.removedCabinets.forEach { (id, removed) ->
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Text(removed.title, color = colors.ink, fontSize = 13.sp)
                                            TextButton(onClick = { onUndoDeleteCabinet(id) }) {
                                                Text("撤销删除", color = colors.spineBrown, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        HorizontalDivider(thickness = 1.5.dp, color = colors.line)
                    }
                }

                // Cabinet cards
                itemsIndexed(workspace.cabinets, key = { _, c -> c.id }) { index, cabinet ->
                    val items = itemsByCabinet[cabinet.id].orEmpty()
                    CabinetCard(
                        index = index,
                        cabinet = cabinet,
                        items = items,
                        onOpen = { onOpenCabinet(cabinet.id) },
                        onMenu = { menuCabinet = cabinet }
                    )
                }

                // Dashed Create Cabinet Card
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(104.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .paperDashedBorder(color = colors.line, cornerRadius = 10.dp)
                            .clickable { showNewCabinetDialog = true }
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .border(1.8.dp, colors.line, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.ink)
                            }
                            Column {
                                Text("新建书柜", color = colors.ink, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text("创建知识分类并收纳笔记本与书页", color = colors.muted, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    // Bottom Sheet: Quick Create
    if (showCreateSheet) {
        ModalBottomSheet(
            onDismissRequest = { showCreateSheet = false },
            containerColor = colors.surface,
            contentColor = colors.ink
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    "新建或导入",
                    color = colors.ink,
                    style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                )
                SheetActionRow(
                    icon = Icons.AutoMirrored.Outlined.MenuBook,
                    title = "新建笔记本",
                    subtitle = "包含多个有序章节与可选简介",
                    onClick = { showCreateSheet = false; showNewNoteDialog = true }
                )
                SheetActionRow(
                    icon = Icons.Outlined.Description,
                    title = "新建独立书页",
                    subtitle = "单篇 Markdown 笔记，直接进入正文",
                    onClick = { showCreateSheet = false; showNewNoteDialog = false }
                )
                SheetActionRow(
                    icon = Icons.Outlined.CreateNewFolder,
                    title = "新建书柜",
                    subtitle = "新建分类书柜整理笔记",
                    onClick = { showCreateSheet = false; showNewCabinetDialog = true }
                )
                SheetActionRow(
                    icon = Icons.Outlined.FileUpload,
                    title = "导入 Markdown / 文件夹",
                    subtitle = "从系统文件选择器导入笔记与图片",
                    onClick = { showCreateSheet = false; onOpenImport() }
                )
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    // Cabinet Options Sheet
    menuCabinet?.let { cab ->
        val isDefault = cab.id == DEFAULT_CABINET_ID
        ModalBottomSheet(
            onDismissRequest = { menuCabinet = null },
            containerColor = colors.surface,
            contentColor = colors.ink
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        cab.title,
                        color = colors.ink,
                        style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp),
                        modifier = Modifier.weight(1f)
                    )
                    if (isDefault) PaperBadge(text = "默认保护", accent = true)
                }
                SheetActionRow(
                    icon = Icons.Outlined.Share,
                    title = "分享书柜",
                    subtitle = "生成书柜分享链接，发给他人点击「导入」还原",
                    onClick = { menuCabinet = null; onShareCabinet(cab.id) }
                )
                SheetActionRow(
                    icon = Icons.Outlined.DriveFileRenameOutline,
                    title = "重命名书柜",
                    subtitle = "修改书柜显示名称",
                    onClick = { menuCabinet = null; renameTarget = cab }
                )
                if (!isDefault) {
                    SheetActionRow(
                        icon = Icons.Outlined.DeleteOutline,
                        title = "删除书柜",
                        subtitle = "其中笔记本与书页将安全移入默认书柜",
                        danger = true,
                        onClick = { menuCabinet = null; deleteTarget = cab }
                    )
                } else {
                    Text(
                        text = "默认书柜受到保护，不可删除，用于收纳未分类或迁出的笔记。",
                        color = colors.muted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                }
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    if (showNewCabinetDialog) {
        SingleTextInputDialog(
            title = "新建书柜",
            label = "书柜名称",
            placeholder = "例如：学习、技术手记、读书摘录",
            confirmText = "创建",
            onDismiss = { showNewCabinetDialog = false },
            onConfirm = { name ->
                showNewCabinetDialog = false
                onCreateCabinet(name)
            }
        )
    }

    renameTarget?.let { cab ->
        SingleTextInputDialog(
            title = "重命名书柜",
            label = "新名称",
            initialValue = cab.title,
            confirmText = "保存",
            onDismiss = { renameTarget = null },
            onConfirm = { name ->
                renameTarget = null
                onRenameCabinet(cab.id, name)
            }
        )
    }

    deleteTarget?.let { cab ->
        val count = itemsByCabinet[cab.id].orEmpty().size
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            containerColor = colors.surface,
            titleContentColor = colors.ink,
            textContentColor = colors.muted,
            title = { Text("确认删除书柜「${cab.title}」？", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    if (count > 0) "该书柜内的 $count 项笔记会安全移入默认书柜，正文不会被删除。"
                    else "删除后可在本机待同步记录中撤销（如已同步至 GitHub）。"
                )
            },
            confirmButton = {
                PaperButton(
                    onClick = { deleteTarget = null; onDeleteCabinet(cab.id) },
                    primary = true,
                    danger = true
                ) { Text("确认删除") }
            },
            dismissButton = {
                PaperButton(onClick = { deleteTarget = null }) { Text("取消") }
            }
        )
    }

    showNewNoteDialog?.let { isNotebook ->
        CreateNoteDialog(
            isNotebook = isNotebook,
            cabinets = workspace.cabinets,
            defaultCabinetId = DEFAULT_CABINET_ID,
            onDismiss = { showNewNoteDialog = null },
            onConfirm = { title, desc, cabId ->
                showNewNoteDialog = null
                if (isNotebook) onCreateNotebook(title, desc, cabId)
                else onCreatePage(title, cabId)
            }
        )
    }
}

@Composable
private fun SyncEntryPill(
    connected: Boolean,
    repository: String,
    pendingCount: Int,
    onClick: () -> Unit
) {
    val colors = LocalPaperColors.current
    PaperCard(
        cornerRadius = 8.dp,
        borderWidth = 1.5.dp,
        shadowOffset = 2.dp,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(
                imageVector = when {
                    !connected -> Icons.Outlined.CloudOff
                    pendingCount > 0 -> Icons.Outlined.CloudSync
                    else -> Icons.Outlined.CloudDone
                },
                contentDescription = "同步状态",
                tint = if (connected) colors.success else colors.muted,
                modifier = Modifier.size(16.dp)
            )
            Column {
                Text(
                    text = if (connected) "同步 / 恢复" else "离线模式",
                    color = colors.ink,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp
                )
                Text(
                    text = when {
                        !connected -> "连接 GitHub"
                        pendingCount > 0 -> "$pendingCount 项待同步"
                        else -> repository.substringAfterLast('/').take(14)
                    },
                    color = colors.muted,
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun CabinetCard(
    index: Int,
    cabinet: Cabinet,
    items: List<ShelfItem>,
    onOpen: () -> Unit,
    onMenu: () -> Unit
) {
    val colors = LocalPaperColors.current
    val countsLabel = formatNonZeroCounts(items)

    PaperCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 10.dp,
        shadowOffset = 4.dp,
        onClick = onOpen
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top
            ) {
                // Left cabinet metadata
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        PaperBadge(text = "CASE ${"%02d".format(index + 1)}")
                        if (cabinet.id == DEFAULT_CABINET_ID) {
                            PaperBadge(text = "默认", accent = true)
                        }
                    }
                    Text(
                        text = cabinet.title,
                        color = colors.ink,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        style = TextStyle(
                            fontFamily = FontFamily.Serif,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            lineHeight = 25.sp
                        )
                    )
                    if (countsLabel.isNotEmpty()) {
                        Text(
                            text = countsLabel,
                            color = colors.muted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    } else {
                        Text(
                            text = "空书柜",
                            color = colors.muted,
                            fontSize = 12.sp
                        )
                    }
                }

                // Right architectural miniature bookcase preview
                CabinetMiniBookcase(
                    items = items,
                    modifier = Modifier
                        .width(138.dp)
                        .height(106.dp)
                )
            }

            HorizontalDivider(thickness = 1.2.dp, color = colors.line)

            // Bottom preview tags + cabinet actions
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (items.isEmpty()) {
                        Text("点击进入添加笔记", color = colors.muted, fontSize = 12.sp)
                    } else {
                        items.take(2).forEach { item ->
                            Box(
                                modifier = Modifier
                                    .border(1.dp, colors.line, RoundedCornerShape(4.dp))
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = item.title,
                                    color = colors.ink,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(end = 1.dp)
                                )
                            }
                        }
                        if (items.size > 2) {
                            Text("+${items.size - 2}", color = colors.muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        }
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "进入 →",
                        color = colors.ink,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )
                    IconButton(onClick = onMenu, modifier = Modifier.size(30.dp)) {
                        Icon(
                            Icons.Outlined.MoreVert,
                            contentDescription = "书柜操作",
                            tint = colors.ink,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CabinetMiniBookcase(
    items: List<ShelfItem>,
    modifier: Modifier = Modifier
) {
    val colors = LocalPaperColors.current
    val context = LocalContext.current
    val view = LocalView.current
    val density = LocalDensity.current
    val miniScroll = rememberScrollState()
    val visibleItems = remember(items) { items.take(32) }

    // Synchronized miniature spine tick sound + subtle micro-vibration while dragging across cabinet preview!
    LaunchedEffect(miniScroll, visibleItems.size) {
        val stepPx = with(density) { 26.dp.toPx() }.coerceAtLeast(18f)
        var lastBucket = (miniScroll.value / stepPx).toInt()
        var atEdge: Int = if (miniScroll.value <= 1) -1 else 0
        snapshotFlow { miniScroll.value to miniScroll.maxValue }.collect { (pos, maxVal) ->
            if (maxVal <= 2) return@collect
            val bucket = (pos / stepPx).toInt()
            if (bucket != lastBucket) {
                lastBucket = bucket
                ShelfSoundHaptics.playMiniTick(context, view)
            }
            if (pos <= 1 && atEdge != -1) {
                atEdge = -1
                ShelfSoundHaptics.playEdgeBump(context, view)
            } else if (pos >= maxVal - 1 && atEdge != 1) {
                atEdge = 1
                ShelfSoundHaptics.playEdgeBump(context, view)
            } else if (pos in 2 until (maxVal - 1)) {
                atEdge = 0
            }
        }
    }

    Box(
        modifier = modifier
            .background(colors.surface)
            .border(1.6.dp, colors.line)
    ) {
        // Horizontally draggable miniature spines standing on bottom plank
        Row(
            modifier = Modifier
                .fillMaxSize()
                .horizontalScroll(miniScroll)
                .padding(start = 6.dp, end = 12.dp, top = 7.dp, bottom = 11.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            visibleItems.forEachIndexed { idx, item ->
                val spineW = if (item.isPage) 19.dp else 25.dp
                Box(
                    modifier = Modifier
                        .width(spineW)
                        .fillMaxHeight()
                        .background(colors.bookFace)
                        .border(1.2.dp, colors.line)
                        .padding(horizontal = 2.dp, vertical = 3.dp)
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = if (item.isPage) "MD" else "%02d".format(idx + 1),
                            color = colors.ink,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 7.sp,
                            maxLines = 1
                        )
                        // Upright vertical truncated title
                        val shortChars = item.title.take(4).map { it.toString() }.joinToString("\n")
                        Text(
                            text = shortChars,
                            color = colors.spineBrown,
                            fontFamily = FontFamily.Serif,
                            fontWeight = FontWeight.Bold,
                            fontSize = 8.5.sp,
                            lineHeight = 9.5.sp,
                            maxLines = 4,
                            overflow = TextOverflow.Clip
                        )
                        Box(
                            modifier = Modifier
                                .width(10.dp)
                                .height(1.dp)
                                .background(colors.line)
                        )
                    }
                }
            }
            if (items.size > visibleItems.size) {
                Box(
                    modifier = Modifier
                        .width(24.dp)
                        .fillMaxHeight()
                        .background(colors.softSurface)
                        .border(1.dp, colors.line),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "+${items.size - visibleItems.size}",
                        color = colors.ink,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 8.sp
                    )
                }
            }
        }

        // Subtle left/right drag cue arrows when more books exist off-screen
        if (miniScroll.value > 2) {
            Text(
                text = "‹",
                color = colors.ink,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .background(colors.surface.copy(alpha = 0.85f))
                    .padding(horizontal = 2.dp)
            )
        }
        if (miniScroll.maxValue > 2 && miniScroll.value < miniScroll.maxValue - 2) {
            Text(
                text = "›",
                color = colors.ink,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .background(colors.surface.copy(alpha = 0.85f))
                    .padding(horizontal = 2.dp)
            )
        }

        // Bottom shelf plank
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(11.dp)
                .align(Alignment.BottomCenter)
        ) {
            drawRect(colors.softSurface, Offset.Zero, size)
            drawLine(colors.line, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 3f)
        }
    }
}

@Composable
fun InlineMessageBanner(
    text: String,
    isError: Boolean,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    val bg = if (isError) colors.errorBg else colors.softSurface
    val fg = if (isError) colors.error else colors.ink
    val border = if (isError) colors.error else colors.line
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.4.dp, border, RoundedCornerShape(8.dp))
            .background(bg, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(text = text, color = fg, fontSize = 12.sp, lineHeight = 17.sp, modifier = Modifier.weight(1f))
        Text(
            text = "关闭",
            color = fg,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.clickable(onClick = onDismiss)
        )
    }
}

@Composable
fun SheetActionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    danger: Boolean = false,
    onClick: () -> Unit
) {
    val colors = LocalPaperColors.current
    val tint = if (danger) colors.error else colors.ink
    PaperCard(
        modifier = Modifier.fillMaxWidth(),
        shadowOffset = 2.dp,
        borderColor = if (danger) colors.error else colors.line,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = tint, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text(subtitle, color = colors.muted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun SingleTextInputDialog(
    title: String,
    label: String,
    initialValue: String = "",
    placeholder: String = "",
    confirmText: String = "确定",
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    val colors = LocalPaperColors.current
    var text by remember(initialValue) { mutableStateOf(initialValue) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        titleContentColor = colors.ink,
        title = {
            Text(
                title,
                style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            )
        },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { if (!it.contains('\n') && it.length <= 120) text = it },
                label = { Text(label) },
                placeholder = if (placeholder.isNotEmpty()) {{ Text(placeholder) }} else null,
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.line,
                    unfocusedBorderColor = colors.subtleLine,
                    focusedTextColor = colors.ink,
                    unfocusedTextColor = colors.ink,
                    cursorColor = colors.ink
                ),
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            PaperButton(
                onClick = { onConfirm(text.trim()) },
                primary = true,
                enabled = text.trim().isNotEmpty()
            ) { Text(confirmText) }
        },
        dismissButton = {
            PaperButton(onClick = onDismiss) { Text("取消") }
        }
    )
}

@Composable
fun CreateNoteDialog(
    isNotebook: Boolean,
    cabinets: List<Cabinet>,
    defaultCabinetId: String,
    onDismiss: () -> Unit,
    onConfirm: (title: String, description: String, cabinetId: String) -> Unit
) {
    val colors = LocalPaperColors.current
    var title by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }
    var chosenCab by remember { mutableStateOf(defaultCabinetId) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        titleContentColor = colors.ink,
        title = {
            Text(
                text = if (isNotebook) "新建笔记本" else "新建独立书页",
                style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { if (!it.contains('\n') && it.length <= 120) title = it },
                    label = { Text(if (isNotebook) "笔记本名称" else "书页标题") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.line,
                        unfocusedBorderColor = colors.subtleLine,
                        focusedTextColor = colors.ink,
                        unfocusedTextColor = colors.ink
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                if (isNotebook) {
                    OutlinedTextField(
                        value = desc,
                        onValueChange = { if (it.length <= 500) desc = it },
                        label = { Text("简介（可选）") },
                        maxLines = 3,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = colors.line,
                            unfocusedBorderColor = colors.subtleLine,
                            focusedTextColor = colors.ink,
                            unfocusedTextColor = colors.ink
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                Text("放入书柜：", color = colors.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    cabinets.forEach { cab ->
                        val selected = cab.id == chosenCab
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(6.dp))
                                .border(1.3.dp, if (selected) colors.line else colors.subtleLine, RoundedCornerShape(6.dp))
                                .background(if (selected) colors.softSurface else colors.surface)
                                .clickable { chosenCab = cab.id }
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(cab.title, color = colors.ink, fontSize = 13.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
                            if (selected) Text("✓", color = colors.spineBrown, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        },
        confirmButton = {
            PaperButton(
                onClick = { onConfirm(title.trim(), desc.trim(), chosenCab) },
                primary = true,
                enabled = title.trim().isNotEmpty()
            ) { Text("创建") }
        },
        dismissButton = {
            PaperButton(onClick = onDismiss) { Text("取消") }
        }
    )
}
