package com.papernotes.android.ui.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.automirrored.outlined.VolumeOff
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.papernotes.android.data.Cabinet
import com.papernotes.android.data.ShelfItem
import com.papernotes.android.data.WorkspaceState
import com.papernotes.android.ui.components.PaperBadge
import com.papernotes.android.ui.components.PaperButton
import com.papernotes.android.ui.components.PaperCard
import com.papernotes.android.ui.components.ShelfSoundHaptics
import com.papernotes.android.ui.theme.LocalPaperColors
import com.papernotes.android.ui.theme.LocalReducedMotion
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookshelfScreen(
    cabinetId: String,
    workspace: WorkspaceState,
    assignedCabinetOf: (String) -> String,
    notice: String?,
    error: String?,
    onDismissMessage: () -> Unit,
    onBack: () -> Unit,
    onOpenItem: (ShelfItem) -> Unit,
    onCreateNotebook: (title: String, desc: String, cabId: String) -> Unit,
    onCreatePage: (title: String, cabId: String) -> Unit,
    onMoveItems: (Set<String>, String) -> Unit,
    onDeleteItems: (Set<String>) -> Unit,
    onOpenImport: () -> Unit,
    onShareCabinet: () -> Unit
) {
    val colors = LocalPaperColors.current
    val haptic = LocalHapticFeedback.current
    val context = LocalContext.current
    val view = LocalView.current
    val density = LocalDensity.current
    val soundOn by ShelfSoundHaptics.soundEnabled.collectAsState()
    LaunchedEffect(context) { ShelfSoundHaptics.init(context) }
    val cabinet = workspace.cabinets.find { it.id == cabinetId }
    val items = remember(workspace.items, cabinetId) {
        workspace.items.filter { assignedCabinetOf(it.id) == cabinetId }
    }

    var focusedId by remember(cabinetId, items.map { it.id }) {
        mutableStateOf(items.firstOrNull()?.id)
    }
    LaunchedEffect(items) {
        if (focusedId == null || items.none { it.id == focusedId }) {
            focusedId = items.firstOrNull()?.id
        }
    }
    val focusedItem = items.find { it.id == focusedId } ?: items.firstOrNull()

    var manageMode by remember { mutableStateOf(false) }
    var selectedIds by remember { mutableStateOf(emptySet<String>()) }
    var showAddSheet by remember { mutableStateOf(false) }
    var newNoteIsBook by remember { mutableStateOf<Boolean?>(null) }
    var showMoveDialog by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    val countsLabel = formatNonZeroCounts(items)

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
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回", tint = colors.ink)
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (manageMode) "已选 ${selectedIds.size} 项" else (cabinet?.title ?: "书柜"),
                            color = colors.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                        )
                        if (!manageMode && countsLabel.isNotEmpty()) {
                            Text(countsLabel, color = colors.muted, fontSize = 11.sp)
                        }
                    }
                    if (items.isNotEmpty()) {
                        TextButton(onClick = {
                            manageMode = !manageMode
                            selectedIds = emptySet()
                        }) {
                            Text(
                                text = if (manageMode) "完成" else "管理",
                                color = colors.ink,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                    if (!manageMode) {
                        IconButton(onClick = { ShelfSoundHaptics.toggleSound(context, view) }) {
                            Icon(
                                if (soundOn) Icons.AutoMirrored.Outlined.VolumeUp else Icons.AutoMirrored.Outlined.VolumeOff,
                                contentDescription = if (soundOn) "关闭滑动音效" else "开启滑动音效",
                                tint = colors.ink
                            )
                        }
                        IconButton(onClick = onShareCabinet) {
                            Icon(Icons.Outlined.Share, contentDescription = "分享书柜", tint = colors.ink)
                        }
                        IconButton(onClick = { showAddSheet = true }) {
                            Icon(Icons.Outlined.Add, contentDescription = "新建或导入", tint = colors.ink)
                        }
                    }
                }
                HorizontalDivider(thickness = 1.8.dp, color = colors.line)
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
                                selectedIds = if (selectedIds.size == items.size) emptySet()
                                else items.map { it.id }.toSet()
                            }
                        ) {
                            Text(if (selectedIds.size == items.size) "取消全选" else "全选", fontSize = 12.sp)
                        }
                        Spacer(Modifier.weight(1f))
                        PaperButton(
                            onClick = { showMoveDialog = true },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.AutoMirrored.Outlined.DriveFileMove, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text("移动", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        PaperButton(
                            onClick = { showDeleteConfirm = true },
                            enabled = selectedIds.isNotEmpty(),
                            primary = true,
                            danger = true
                        ) {
                            Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text("删除", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (!error.isNullOrBlank()) {
                InlineMessageBanner(error, isError = true, onDismiss = onDismissMessage)
            } else if (!notice.isNullOrBlank()) {
                InlineMessageBanner(notice, isError = false, onDismiss = onDismissMessage)
            }

            // 3D Side-Angled Horizontal Bookshelf Stage
            PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 4.dp) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "3D BOOKSHELF · 左右滑动浏览",
                            color = colors.ink,
                            style = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 0.7.sp)
                        )
                        Text(
                            text = if (manageMode) "点选管理" else "点击聚焦 · 再点打开",
                            color = colors.muted,
                            fontSize = 11.sp
                        )
                    }
                    HorizontalDivider(thickness = 1.4.dp, color = colors.line)

                    if (items.isEmpty()) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 46.dp, horizontal = 20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Text("这个书柜还是空的", color = colors.ink, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                            Text("新建笔记本、独立书页，或从系统文件导入 Markdown。", color = colors.muted, fontSize = 13.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                PaperButton(onClick = { newNoteIsBook = true }, primary = true) {
                                    Text("新建笔记本", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                }
                                PaperButton(onClick = { newNoteIsBook = false }) {
                                    Text("新建书页", fontSize = 13.sp)
                                }
                            }
                        }
                    } else {
                        val hScroll = rememberScrollState()
                        val itemCenters = remember(items.map { it.id }) { mutableStateMapOf<String, Float>() }
                        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                            val viewportWidthPx = with(density) { maxWidth.toPx() }
                            val sidePad = ((maxWidth - 96.dp) / 2f).coerceAtLeast(24.dp)

                            // Auto-select the book closest to the horizontal center while scrolling + tactile ticks.
                            LaunchedEffect(hScroll, items.size, viewportWidthPx) {
                                val stepPx = with(density) { 64.dp.toPx() }.coerceAtLeast(32f)
                                var lastBucket = (hScroll.value / stepPx).toInt()
                                var atEdge = if (hScroll.value <= 2) -1 else 0
                                snapshotFlow { Triple(hScroll.value, hScroll.maxValue, hScroll.isScrollInProgress) }
                                    .collect { (pos, maxVal, _) ->
                                        val bucket = (pos / stepPx).toInt()
                                        if (bucket != lastBucket) {
                                            lastBucket = bucket
                                            ShelfSoundHaptics.playShelfTick(context, view)
                                        }
                                        if (items.isNotEmpty() && itemCenters.isNotEmpty()) {
                                            val centerX = pos + viewportWidthPx / 2f
                                            val nearest = items.minByOrNull { item ->
                                                kotlin.math.abs((itemCenters[item.id] ?: Float.MAX_VALUE) - centerX)
                                            }
                                            if (nearest != null && nearest.id != focusedId) {
                                                focusedId = nearest.id
                                            }
                                        }
                                        if (maxVal > 2) {
                                            if (pos <= 2 && atEdge != -1) {
                                                atEdge = -1
                                                ShelfSoundHaptics.playEdgeBump(context, view)
                                            } else if (pos >= maxVal - 2 && atEdge != 1) {
                                                atEdge = 1
                                                ShelfSoundHaptics.playEdgeBump(context, view)
                                            } else if (pos in 3 until (maxVal - 2)) {
                                                atEdge = 0
                                            }
                                        }
                                    }
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(hScroll)
                                    .padding(start = sidePad, end = sidePad, top = 20.dp, bottom = 0.dp),
                                verticalAlignment = Alignment.Bottom
                            ) {
                                items.forEachIndexed { idx, item ->
                                    val isFocused = item.id == focusedId
                                    val isSelected = item.id in selectedIds
                                    val nextIsPage = items.getOrNull(idx + 1)?.isPage == true

                                    Box(
                                        modifier = Modifier.onGloballyPositioned { coords ->
                                            itemCenters[item.id] = coords.positionInParent().x + coords.size.width / 2f
                                        }
                                    ) {
                                        ShelfVolume3D(
                                            index = idx,
                                            item = item,
                                            isFocused = isFocused,
                                            manageMode = manageMode,
                                            isSelected = isSelected,
                                            touchesPage = item.isPage || nextIsPage,
                                            onTap = {
                                                ShelfSoundHaptics.playShelfTick(context, view)
                                                if (manageMode) {
                                                    selectedIds = if (isSelected) selectedIds - item.id else selectedIds + item.id
                                                } else if (isFocused) {
                                                    onOpenItem(item)
                                                } else {
                                                    focusedId = item.id
                                                }
                                            },
                                            onLongPress = {
                                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                if (!manageMode) {
                                                    manageMode = true
                                                    selectedIds = setOf(item.id)
                                                } else {
                                                    selectedIds = if (isSelected) selectedIds - item.id else selectedIds + item.id
                                                }
                                            }
                                        )
                                    }
                                }
                            }
                        }

                        // Sleek paper-wireframe scroll position track (shows 0%-100% reach clearly)
                        if (hScroll.maxValue > 4) {
                            val progress = (hScroll.value.toFloat() / hScroll.maxValue.toFloat()).coerceIn(0f, 1f)
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 14.dp, vertical = 6.dp)
                                    .height(7.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(colors.softSurface)
                                    .border(1.dp, colors.line, RoundedCornerShape(4.dp))
                            ) {
                                Canvas(modifier = Modifier.fillMaxSize()) {
                                    val thumbW = (size.width * 0.24f).coerceAtLeast(28f)
                                    val left = (size.width - thumbW) * progress
                                    drawRect(
                                        color = colors.ink,
                                        topLeft = Offset(left, 0f),
                                        size = androidx.compose.ui.geometry.Size(thumbW, size.height)
                                    )
                                }
                            }
                        }
                    }

                    // Architectural shelf plank
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(20.dp)
                            .background(colors.surface)
                            .border(1.6.dp, colors.line)
                            .padding(horizontal = 14.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Box(Modifier.width(20.dp).height(2.dp).background(colors.line))
                            Text(
                                text = "UNIFORM EDITION · PAPER ARCHIVE",
                                color = colors.ink,
                                style = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 8.5.sp, letterSpacing = 1.sp)
                            )
                            Box(Modifier.width(20.dp).height(2.dp).background(colors.line))
                        }
                    }
                }
            }

            // Focused Item Thumb-Reachable Action Card
            if (focusedItem != null && !manageMode) {
                PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 3.dp) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            PaperBadge(text = if (focusedItem.isPage) "独立书页 · MD" else "笔记本 · ${focusedItem.chapterCount} 章")
                            if (focusedItem.hasPendingChanges) {
                                PaperBadge(text = "待同步", accent = true)
                            }
                        }
                        Text(
                            text = focusedItem.title,
                            color = colors.ink,
                            style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                        )
                        val bodyPreview = if (focusedItem.isPage) {
                            focusedItem.previewText.ifBlank { "空白书页，点击直接进入正文写作。" }
                        } else {
                            focusedItem.description.ifBlank { "暂无简介，可在笔记本详情中补充简介与调整章节顺序。" }
                        }
                        Text(
                            text = bodyPreview,
                            color = colors.muted,
                            fontSize = 13.sp,
                            lineHeight = 19.sp,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            PaperButton(
                                onClick = { onOpenItem(focusedItem) },
                                primary = true,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = if (focusedItem.isPage) "进入书页正文 →" else "打开章节目录 →",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.sp
                                )
                            }
                            PaperButton(
                                onClick = {
                                    selectedIds = setOf(focusedItem.id)
                                    showMoveDialog = true
                                }
                            ) {
                                Icon(Icons.AutoMirrored.Outlined.DriveFileMove, contentDescription = "移动书柜", modifier = Modifier.size(17.dp))
                            }
                            PaperButton(
                                onClick = {
                                    selectedIds = setOf(focusedItem.id)
                                    showDeleteConfirm = true
                                },
                                danger = true
                            ) {
                                Icon(Icons.Outlined.DeleteOutline, contentDescription = "删除", modifier = Modifier.size(17.dp))
                            }
                        }
                    }
                }
            }

            // In Manage Mode, also show a clean compact checklist for effortless multi-select of many books
            if (manageMode && items.isNotEmpty()) {
                PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 2.dp) {
                    Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("列表快速勾选", color = colors.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        items.forEach { item ->
                            val checked = item.id in selectedIds
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (checked) colors.softSurface else colors.surface)
                                    .clickable {
                                        selectedIds = if (checked) selectedIds - item.id else selectedIds + item.id
                                    }
                                    .padding(horizontal = 8.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    if (checked) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                                    contentDescription = null,
                                    tint = colors.ink,
                                    modifier = Modifier.size(20.dp)
                                )
                                Text(item.title, color = colors.ink, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                PaperBadge(text = if (item.isPage) "书页" else "${item.chapterCount} 章")
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (showAddSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAddSheet = false },
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
                Text("添加到「${cabinet?.title ?: "当前书柜"}」", color = colors.ink, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                SheetActionRow(Icons.AutoMirrored.Outlined.MenuBook, "新建笔记本", "含多章节与简介", onClick = { showAddSheet = false; newNoteIsBook = true })
                SheetActionRow(Icons.Outlined.Description, "新建独立书页", "单篇笔记直接写作", onClick = { showAddSheet = false; newNoteIsBook = false })
                SheetActionRow(Icons.Outlined.FileUpload, "导入 Markdown / 文件夹", "导入到此书柜", onClick = { showAddSheet = false; onOpenImport() })
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    newNoteIsBook?.let { isBook ->
        CreateNoteDialog(
            isNotebook = isBook,
            cabinets = workspace.cabinets,
            defaultCabinetId = cabinetId,
            onDismiss = { newNoteIsBook = null },
            onConfirm = { title, desc, cab ->
                newNoteIsBook = null
                if (isBook) onCreateNotebook(title, desc, cab) else onCreatePage(title, cab)
            }
        )
    }

    if (showMoveDialog && selectedIds.isNotEmpty()) {
        MoveCabinetDialog(
            cabinets = workspace.cabinets,
            currentCabinetId = cabinetId,
            count = selectedIds.size,
            onDismiss = { showMoveDialog = false },
            onSelect = { targetCab ->
                val moving = selectedIds
                showMoveDialog = false
                manageMode = false
                selectedIds = emptySet()
                onMoveItems(moving, targetCab)
            }
        )
    }

    if (showDeleteConfirm && selectedIds.isNotEmpty()) {
        val targets = items.filter { it.id in selectedIds }
        val hasSynced = targets.any { it.sha.isNotEmpty() }
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            containerColor = colors.surface,
            titleContentColor = colors.ink,
            textContentColor = colors.muted,
            title = { Text("确认删除这 ${targets.size} 项笔记？", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    buildString {
                        append(targets.take(4).joinToString("、") { "「${it.title}」" })
                        if (targets.size > 4) append("等 ${targets.size} 项")
                        append("\n\n")
                        if (hasSynced) {
                            append("包含已同步至 GitHub 的内容：确认后将在同一次提交中从仓库及本机移除，已有共享图片目录不会误删。")
                        } else {
                            append("均为本机未同步笔记，删除后将从本机移除。")
                        }
                    }
                )
            },
            confirmButton = {
                PaperButton(
                    onClick = {
                        val removing = selectedIds
                        showDeleteConfirm = false
                        manageMode = false
                        selectedIds = emptySet()
                        onDeleteItems(removing)
                    },
                    primary = true,
                    danger = true
                ) { Text("确认删除") }
            },
            dismissButton = {
                PaperButton(onClick = { showDeleteConfirm = false }) { Text("取消") }
            }
        )
    }
}

/**
 * Geometric side-angled 3D Notebook / Thin Folio Page rendered without Z-buffer clipping.
 * Uses BookShelf.vue's exact trigonometric projection spacing so neighbor avoidance never overlaps.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShelfVolume3D(
    index: Int,
    item: ShelfItem,
    isFocused: Boolean,
    manageMode: Boolean,
    isSelected: Boolean,
    touchesPage: Boolean,
    onTap: () -> Unit,
    onLongPress: () -> Unit
) {
    val colors = LocalPaperColors.current
    val reducedMotion = LocalReducedMotion.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()

    val targetFactor = when {
        pressed -> 1f
        isFocused -> 0.85f
        else -> 0f
    }

    val f by animateFloatAsState(
        targetValue = targetFactor,
        animationSpec = if (reducedMotion) snap() else spring(dampingRatio = 0.72f, stiffness = 340f),
        label = "bookFocus"
    )

    // Uniform heights and sleeker, thinner spine proportions on mobile
    val baseH = 200f
    val maxH = 220f
    val heightDp = (baseH + (maxH - baseH) * f).dp

    val spineW = if (item.isPage) {
        (16f + 3f * f).dp
    } else {
        (30f + 6f * f).dp
    }

    val tiltDeg = 22f + 16f * f
    val rad = tiltDeg * PI / 180.0
    val coverDepth = if (item.isPage) 108f else 88f
    val projectedCoverW = (coverDepth * sin(rad)).toFloat().dp
    val topSlopeY = (12f + 3f * f).dp

    val liftY: Dp by animateDpAsState(
        targetValue = if (reducedMotion) 0.dp else (-10f * f).dp,
        animationSpec = if (reducedMotion) snap() else spring(dampingRatio = 0.72f, stiffness = 340f),
        label = "bookLift"
    )

    // Reserve exact horizontal clearance for slanted cover so neighbor books smoothly move aside without clipping
    val restGap = if (touchesPage) max(14f, (coverDepth * sin(24.0 * PI / 180.0)).toFloat() * 0.45f) else 10f
    val dynamicRightMargin = (restGap + (projectedCoverW.value - restGap).coerceAtLeast(0f) * f + 6f).dp
    val totalVisualWidth = spineW + projectedCoverW

    Box(
        modifier = Modifier
            .zIndex(if (isFocused || pressed) 20f else (10 - index.coerceAtMost(9)).toFloat())
            .padding(end = (dynamicRightMargin - projectedCoverW).coerceAtLeast(6.dp))
            .width(totalVisualWidth)
            .height(heightDp + topSlopeY + 12.dp)
            .offset(y = liftY)
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                onClick = onTap,
                onLongClick = onLongPress
            ),
        contentAlignment = Alignment.BottomStart
    ) {
        // 3D Geometry Canvas: floor shadow, top page edge, slanted right cover / dog-ear folio face
        Canvas(
            modifier = Modifier
                .width(totalVisualWidth)
                .height(heightDp + topSlopeY)
        ) {
            val sW = spineW.toPx()
            val bH = heightDp.toPx()
            val cW = projectedCoverW.toPx()
            val slope = topSlopeY.toPx()
            val topY = slope
            val bottomY = topY + bH
            val stroke = Stroke(width = if (item.isPage) 3.2f else 3.8f)
            val hairline = Stroke(width = 1.8f)

            // Floor shadow
            drawRect(
                color = colors.depthEdge.copy(alpha = 0.16f),
                topLeft = Offset(4f, bottomY - 2f),
                size = androidx.compose.ui.geometry.Size(sW + cW * 0.75f, 6f)
            )

            // Top face (angled parallelogram)
            val topFace = Path().apply {
                moveTo(0f, topY)
                lineTo(cW, 0f)
                lineTo(sW + cW, 0f)
                lineTo(sW, topY)
                close()
            }
            drawPath(topFace, colors.softSurface)
            drawPath(topFace, colors.line, style = hairline)

            // Slanted right cover (Notebook rectangular vs Standalone Page dog-ear folded corner)
            if (item.isPage) {
                val dogEar = (cW * 0.24f).coerceAtMost(24f)
                val face = Path().apply {
                    moveTo(sW, topY)
                    lineTo(sW + cW - dogEar, topY - slope + dogEar * 0.15f)
                    lineTo(sW + cW, topY - slope + dogEar + 8f)
                    lineTo(sW + cW, bottomY - slope)
                    lineTo(sW, bottomY)
                    close()
                }
                drawPath(face, colors.bookFace)
                drawPath(face, colors.line, style = stroke)

                // Folded dog-ear triangle
                val fold = Path().apply {
                    moveTo(sW + cW - dogEar, topY - slope + dogEar * 0.15f)
                    lineTo(sW + cW - dogEar, topY - slope + dogEar + 8f)
                    lineTo(sW + cW, topY - slope + dogEar + 8f)
                    close()
                }
                drawPath(fold, colors.softSurface)
                drawPath(fold, colors.line, style = hairline)

                // Ruled manuscript lines on folio face
                val linesTop = topY + bH * 0.34f
                for (ln in 0..5) {
                    val y = linesTop + ln * 18f
                    if (y < bottomY - 26f) {
                        val x1 = sW + 7f
                        val x2 = sW + cW - 7f
                        val y2 = y - slope * ((x2 - sW) / cW.coerceAtLeast(1f))
                        drawLine(colors.subtleLine, Offset(x1, y), Offset(x2, y2), strokeWidth = 1.6f)
                    }
                }
            } else {
                val cover = Path().apply {
                    moveTo(sW, topY)
                    lineTo(sW + cW, 0f)
                    lineTo(sW + cW, bottomY - slope)
                    lineTo(sW, bottomY)
                    close()
                }
                drawPath(cover, colors.bookFace)
                drawPath(cover, colors.line, style = stroke)

                // Inner architectural cover frame
                val pad = 7f
                val inner = Path().apply {
                    moveTo(sW + pad, topY + pad)
                    lineTo(sW + cW - pad, pad + slope * 0.08f)
                    lineTo(sW + cW - pad, bottomY - slope - pad)
                    lineTo(sW + pad, bottomY - pad)
                    close()
                }
                drawPath(inner, colors.line, style = hairline)

                // Decorative editorial cover strokes (tilted parallel to top edge)
                val barYs = listOf(0.56f, 0.62f, 0.68f)
                val barFracs = listOf(0.72f, 0.52f, 0.34f)
                barYs.forEachIndexed { i, fracY ->
                    val yLeft = topY + bH * fracY
                    val xLeft = sW + pad + 6f
                    val span = (cW - pad * 2 - 12f) * barFracs[i]
                    if (span > 4f) {
                        val yRight = yLeft - slope * (span / cW.coerceAtLeast(1f))
                        drawLine(colors.line, Offset(xLeft, yLeft), Offset(xLeft + span, yRight), strokeWidth = 2f)
                    }
                }
            }
        }

        // Front Spine Face (crisp text that never clips or overflows)
        Box(
            modifier = Modifier
                .width(spineW)
                .height(heightDp)
                .background(if (isSelected) colors.softSurface else colors.bookFace)
                .border(
                    width = if (isFocused || isSelected) 2.2.dp else 1.7.dp,
                    color = if (isSelected) colors.spineBrown else colors.line
                )
                .padding(horizontal = if (item.isPage) 2.dp else 4.dp, vertical = 9.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Top Spine Badge
                if (item.isPage) {
                    Box(
                        modifier = Modifier
                            .background(colors.ink, RoundedCornerShape(2.dp))
                            .padding(horizontal = 3.dp, vertical = 1.dp)
                    ) {
                        Text(
                            text = "MD",
                            color = colors.surface,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 7.sp
                        )
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .border(1.dp, colors.line)
                            .padding(horizontal = 4.dp, vertical = 1.dp)
                    ) {
                        Text(
                            text = "%02d".format(index + 1),
                            color = colors.ink,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 9.sp
                        )
                    }
                }

                // Vertical upright title — strictly bounded so long titles NEVER overflow
                val maxVerticalChars = if (item.isPage) 7 else 6
                val displayVertical = remember(item.title, maxVerticalChars) {
                    val trimmed = item.title.trim()
                    val shown = if (trimmed.length > maxVerticalChars) {
                        trimmed.take(maxVerticalChars - 1) + "…"
                    } else trimmed
                    shown.map { it.toString() }.joinToString("\n")
                }
                Text(
                    text = displayVertical,
                    color = colors.spineBrown,
                    style = TextStyle(
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = if (item.isPage) 10.sp else 12.5.sp,
                        lineHeight = if (item.isPage) 13.sp else 16.sp
                    ),
                    maxLines = maxVerticalChars,
                    overflow = TextOverflow.Clip
                )

                // Footer: tailband + chapter count for notebooks, diamond for standalone pages
                if (item.isPage) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .border(1.3.dp, colors.line)
                    )
                } else {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Box(Modifier.width(16.dp).height(1.8.dp).background(colors.line))
                        Text(
                            text = "${item.chapterCount}章",
                            color = colors.ink,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 8.sp,
                            maxLines = 1
                        )
                    }
                }
            }

            // Selection check badge or pending sync dot
            if (manageMode) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 6.dp, y = (-8).dp)
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(if (isSelected) colors.primaryBg else colors.surface)
                        .border(1.5.dp, colors.line, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    if (isSelected) {
                        Text("✓", color = colors.primaryInk, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            } else if (item.hasPendingChanges) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 3.dp, y = (-6).dp)
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(colors.spineBrown)
                        .border(1.dp, colors.surface, CircleShape)
                )
            }
        }
    }
}

@Composable
fun MoveCabinetDialog(
    cabinets: List<Cabinet>,
    currentCabinetId: String,
    count: Int,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit
) {
    val colors = LocalPaperColors.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        titleContentColor = colors.ink,
        title = { Text("移动 $count 项笔记到其他书柜", fontWeight = FontWeight.Bold, fontSize = 17.sp) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                cabinets.forEach { cab ->
                    val isCurrent = cab.id == currentCabinetId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(7.dp))
                            .border(1.4.dp, if (isCurrent) colors.subtleLine else colors.line, RoundedCornerShape(7.dp))
                            .background(if (isCurrent) colors.softSurface else colors.surface)
                            .clickable(enabled = !isCurrent) { onSelect(cab.id) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(cab.title, color = if (isCurrent) colors.muted else colors.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        if (isCurrent) Text("当前书柜", color = colors.muted, fontSize = 11.sp)
                        else Text("移入 →", color = colors.spineBrown, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { PaperButton(onClick = onDismiss) { Text("取消") } }
    )
}
