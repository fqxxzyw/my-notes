package com.papernotes.android.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Redo
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.TextFormat
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.papernotes.android.data.Chapter
import com.papernotes.android.data.MarkdownOutlineParser
import com.papernotes.android.data.PaperNotesRepository
import com.papernotes.android.data.WorkspaceState
import com.papernotes.android.ui.ActiveEditorDoc
import com.papernotes.android.ui.components.PaperBadge
import com.papernotes.android.ui.editor.EditorController
import com.papernotes.android.ui.editor.EditorViewMode
import com.papernotes.android.ui.editor.MarkdownWebEditor
import com.papernotes.android.ui.theme.LocalPaperColors
import kotlinx.coroutines.launch

private data class FormatTool(
    val action: String,
    val label: String,
    val desc: String,
    val italic: Boolean = false,
    val strike: Boolean = false
)

private val MOBILE_FORMAT_TOOLS = listOf(
    FormatTool("h1", "H1", "一级标题"),
    FormatTool("h2", "H2", "二级标题"),
    FormatTool("h3", "H3", "三级标题"),
    FormatTool("bold", "B", "粗体"),
    FormatTool("italic", "I", "斜体", italic = true),
    FormatTool("strike", "S", "删除线", strike = true),
    FormatTool("inline-code", "</>", "行内代码"),
    FormatTool("code-block", "{ }", "代码块"),
    FormatTool("unordered", "•≡", "无序列表"),
    FormatTool("ordered", "1.", "有序列表"),
    FormatTool("task", "☑", "任务清单"),
    FormatTool("quote", "❝", "引用"),
    FormatTool("table", "▦", "表格"),
    FormatTool("link", "↗", "链接")
)

@Composable
fun MarkdownEditorScreen(
    cabinetId: String,
    bookId: String,
    doc: ActiveEditorDoc,
    workspace: WorkspaceState,
    repository: PaperNotesRepository,
    busy: Boolean,
    notice: String?,
    error: String?,
    pendingImageSnippet: String?,
    imageRefreshNonce: Int,
    onConsumeImageSnippet: () -> Unit,
    onDismissMessage: () -> Unit,
    onBack: () -> Unit,
    onModeChange: (EditorViewMode) -> Unit,
    onContentChanged: (String, Boolean, Boolean) -> Unit,
    onSelectionChanged: (Boolean) -> Unit,
    onFormatError: (String) -> Unit,
    onSwitchChapter: (Chapter) -> Unit,
    onCreateChapter: (String) -> Unit,
    onPickGalleryImage: () -> Unit,
    onPickFileImage: () -> Unit,
    onPasteClipboardImage: () -> Unit,
    onWebImagePaste: (String, String) -> Unit,
    onRepairImages: () -> Unit,
    onSyncCurrent: () -> Unit,
    onOpenSync: () -> Unit,
    onOpenTheme: () -> Unit,
    onShareCurrent: () -> Unit
) {
    val colors = LocalPaperColors.current
    val scope = rememberCoroutineScope()
    val controller = remember { EditorController() }
    val drawerState = rememberDrawerState(DrawerValue.Closed)

    var sidebarTab by remember(doc.isPage) { mutableStateOf(if (doc.isPage) "outline" else "outline") }
    var wideSidebarOpen by remember { mutableStateOf(true) }
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showNewChapterDialog by remember { mutableStateOf(false) }
    var manualToolbarPinned by remember { mutableStateOf(false) }
    var collapsedHeadings by remember(doc.docKey) { mutableStateOf(emptySet<Int>()) }

    val allHeadings = remember(doc.content) { MarkdownOutlineParser.parse(doc.content) }
    val visibleHeadings = remember(allHeadings, collapsedHeadings) {
        MarkdownOutlineParser.visibleHeadings(allHeadings, collapsedHeadings)
    }
    val siblingChapters = workspace.chaptersByBook[bookId].orEmpty()

    LaunchedEffect(pendingImageSnippet) {
        if (!pendingImageSnippet.isNullOrEmpty()) {
            controller.insertText(pendingImageSnippet)
            onConsumeImageSnippet()
        }
    }

    LaunchedEffect(imageRefreshNonce) {
        if (imageRefreshNonce > 0) controller.refreshImages()
    }

    val isDirty = doc.baseChapter.sha.isEmpty() || doc.content != doc.baseChapter.content

    BackHandler(enabled = drawerState.isOpen) {
        scope.launch { drawerState.close() }
    }

    val drawerPanel: @Composable () -> Unit = {
        EditorSidebarPanel(
            isPage = doc.isPage,
            activeTab = sidebarTab,
            onTabChange = { sidebarTab = it },
            chapters = siblingChapters,
            currentChapterId = doc.baseChapter.id,
            headings = visibleHeadings,
            collapsedHeadings = collapsedHeadings,
            onToggleHeadingCollapse = { idx ->
                collapsedHeadings = if (idx in collapsedHeadings) collapsedHeadings - idx else collapsedHeadings + idx
            },
            onJumpHeading = { offset ->
                controller.focusHeading(offset)
                scope.launch { drawerState.close() }
            },
            onSelectChapter = { ch ->
                onSwitchChapter(ch)
                scope.launch { drawerState.close() }
            },
            onNewChapter = {
                scope.launch { drawerState.close() }
                showNewChapterDialog = true
            }
        )
    }

    val editorMainBody: @Composable (isWide: Boolean) -> Unit = { isWide ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.background)
                .statusBarsPadding()
                .imePadding()
                .navigationBarsPadding()
        ) {
            // Top Editor App Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surface)
                    .padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack, modifier = Modifier.size(38.dp)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回", tint = colors.ink)
                }
                IconButton(
                    onClick = {
                        if (isWide) wideSidebarOpen = !wideSidebarOpen
                        else scope.launch {
                            if (drawerState.isOpen) drawerState.close() else drawerState.open()
                        }
                    },
                    modifier = Modifier.size(38.dp)
                ) {
                    Icon(Icons.Outlined.Menu, contentDescription = "章节与目录", tint = colors.ink)
                }

                // Compact Mode Segmented Control
                Row(
                    modifier = Modifier
                        .border(1.4.dp, colors.line, RoundedCornerShape(7.dp))
                        .clip(RoundedCornerShape(7.dp))
                        .background(colors.surface)
                ) {
                    EditorViewMode.entries.forEach { m ->
                        val active = doc.mode == m
                        Box(
                            modifier = Modifier
                                .background(if (active) colors.primaryBg else colors.surface)
                                .clickable { onModeChange(m) }
                                .padding(horizontal = 9.dp, vertical = 5.dp)
                        ) {
                            Text(
                                text = m.label,
                                color = if (active) colors.primaryInk else colors.ink,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                // Undo / Redo
                IconButton(
                    onClick = { controller.undo() },
                    enabled = doc.canUndo && !busy,
                    modifier = Modifier.size(34.dp)
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.Undo,
                        contentDescription = "撤销",
                        tint = if (doc.canUndo) colors.ink else colors.subtleLine,
                        modifier = Modifier.size(20.dp)
                    )
                }
                IconButton(
                    onClick = { controller.redo() },
                    enabled = doc.canRedo && !busy,
                    modifier = Modifier.size(34.dp)
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.Redo,
                        contentDescription = "重做",
                        tint = if (doc.canRedo) colors.ink else colors.subtleLine,
                        modifier = Modifier.size(20.dp)
                    )
                }

                // Overflow menu (Image Insert, Repair, Sync, Theme)
                Box {
                    IconButton(onClick = { showOverflowMenu = true }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "更多操作", tint = colors.ink)
                    }
                    DropdownMenu(
                        expanded = showOverflowMenu,
                        onDismissRequest = { showOverflowMenu = false },
                        containerColor = colors.surface
                    ) {
                        DropdownMenuItem(
                            text = { Text("从相册插入图片", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.Image, null, tint = colors.ink) },
                            onClick = { showOverflowMenu = false; onPickGalleryImage() }
                        )
                        DropdownMenuItem(
                            text = { Text("从系统文件插入图片", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.FolderOpen, null, tint = colors.ink) },
                            onClick = { showOverflowMenu = false; onPickFileImage() }
                        )
                        DropdownMenuItem(
                            text = { Text("粘贴剪贴板图片", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.ContentPaste, null, tint = colors.ink) },
                            onClick = { showOverflowMenu = false; onPasteClipboardImage() }
                        )
                        DropdownMenuItem(
                            text = { Text("补齐当前笔记缺失图片", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.BrokenImage, null, tint = colors.ink) },
                            onClick = { showOverflowMenu = false; onRepairImages() }
                        )
                        DropdownMenuItem(
                            text = { Text(if (doc.isPage) "分享当前书页" else "分享当前章节", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.Share, null, tint = colors.ink) },
                            onClick = { showOverflowMenu = false; onShareCurrent() }
                        )
                        HorizontalDivider(color = colors.subtleLine)
                        DropdownMenuItem(
                            text = { Text(if (workspace.connected) "同步当前笔记" else "连接 GitHub 同步", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.CloudSync, null, tint = colors.ink) },
                            onClick = {
                                showOverflowMenu = false
                                if (workspace.connected) onSyncCurrent() else onOpenSync()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("主题与外观", color = colors.ink) },
                            leadingIcon = { Icon(Icons.Outlined.Palette, null, tint = colors.ink) },
                            onClick = { showOverflowMenu = false; onOpenTheme() }
                        )
                    }
                }
            }
            HorizontalDivider(thickness = 1.5.dp, color = colors.line)

            // Compact Save & Sync Status Strip
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.softSurface)
                    .padding(horizontal = 14.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = doc.localSavedNotice,
                    color = colors.muted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (isDirty) {
                        PaperBadge(
                            text = if (workspace.connected) "点此同步 ↑" else "离线草稿",
                            accent = true,
                            modifier = Modifier.clickable {
                                if (workspace.connected) onSyncCurrent() else onOpenSync()
                            }
                        )
                    } else {
                        Text(
                            text = if (workspace.connected) "GitHub 已同步" else "本机离线",
                            color = if (workspace.connected) colors.success else colors.muted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    // Toggle compact format bar manually even without text selection
                    Box(
                        modifier = Modifier
                            .border(1.dp, colors.line, RoundedCornerShape(4.dp))
                            .background(if (manualToolbarPinned) colors.primaryBg else colors.surface, RoundedCornerShape(4.dp))
                            .clickable { manualToolbarPinned = !manualToolbarPinned }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            Icon(
                                Icons.Outlined.TextFormat,
                                contentDescription = "格式工具栏",
                                tint = if (manualToolbarPinned) colors.primaryInk else colors.ink,
                                modifier = Modifier.size(13.dp)
                            )
                            Text(
                                "格式",
                                color = if (manualToolbarPinned) colors.primaryInk else colors.ink,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }

            if (!error.isNullOrBlank()) {
                Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                    InlineMessageBanner(error, isError = true, onDismiss = onDismissMessage)
                }
            } else if (!notice.isNullOrBlank()) {
                Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
                    InlineMessageBanner(notice, isError = false, onDismiss = onDismissMessage)
                }
            }

            // Main Markdown Editor Surface (independently scrollable, resizes smoothly with IME)
            MarkdownWebEditor(
                controller = controller,
                repository = repository,
                docKey = doc.docKey,
                initialContent = doc.content,
                imageBaseUrl = doc.imageBaseUrl,
                mode = doc.mode,
                readOnly = busy,
                onContentChanged = onContentChanged,
                onSelectionChanged = { hasSel, _ -> onSelectionChanged(hasSel) },
                onFormatError = onFormatError,
                onMissingImageClicked = { onRepairImages() },
                onWebImagePaste = onWebImagePaste,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clipToBounds()
            )

            // Mobile Compact Icon Formatting Toolbar:
            // Appears cleanly above the soft keyboard once text selection completes (or when pinned),
            // preserving Android's native Cut/Copy/Paste ActionMode menu and never obscuring text or keyboard.
            val showFormatBar = doc.hasSelection || manualToolbarPinned
            AnimatedVisibility(
                visible = showFormatBar,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface)
                ) {
                    HorizontalDivider(thickness = 1.5.dp, color = colors.line)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        MOBILE_FORMAT_TOOLS.forEach { tool ->
                            Box(
                                modifier = Modifier
                                    .border(1.2.dp, colors.line, RoundedCornerShape(6.dp))
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(colors.surface)
                                    .clickable(enabled = !busy) { controller.applyFormat(tool.action) }
                                    .padding(horizontal = 9.dp, vertical = 7.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = tool.label,
                                    color = colors.ink,
                                    style = TextStyle(
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Bold,
                                        fontStyle = if (tool.italic) FontStyle.Italic else FontStyle.Normal,
                                        textDecoration = if (tool.strike) TextDecoration.LineThrough else TextDecoration.None,
                                        fontSize = 12.sp
                                    )
                                )
                            }
                        }
                        // Quick image insert buttons right in the bar
                        Box(
                            modifier = Modifier
                                .border(1.2.dp, colors.line, RoundedCornerShape(6.dp))
                                .clip(RoundedCornerShape(6.dp))
                                .background(colors.softSurface)
                                .clickable(enabled = !busy) { onPickGalleryImage() }
                                .padding(horizontal = 9.dp, vertical = 6.dp)
                        ) {
                            Icon(Icons.Outlined.Image, contentDescription = "插入图片", tint = colors.ink, modifier = Modifier.size(16.dp))
                        }
                        Box(
                            modifier = Modifier
                                .border(1.2.dp, colors.line, RoundedCornerShape(6.dp))
                                .clip(RoundedCornerShape(6.dp))
                                .background(colors.softSurface)
                                .clickable(enabled = !busy) { onPasteClipboardImage() }
                                .padding(horizontal = 9.dp, vertical = 6.dp)
                        ) {
                            Icon(Icons.Outlined.ContentPaste, contentDescription = "粘贴剪贴板图片", tint = colors.ink, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val isWide = maxWidth >= 840.dp
        if (isWide) {
            Row(modifier = Modifier.fillMaxSize()) {
                if (wideSidebarOpen) {
                    Box(
                        modifier = Modifier
                            .width(270.dp)
                            .fillMaxHeight()
                            .background(colors.surface)
                            .statusBarsPadding()
                            .navigationBarsPadding()
                    ) {
                        drawerPanel()
                    }
                    Box(Modifier.width(1.6.dp).fillMaxHeight().background(colors.line))
                }
                Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    editorMainBody(true)
                }
            }
        } else {
            ModalNavigationDrawer(
                drawerState = drawerState,
                gesturesEnabled = drawerState.isOpen,
                drawerContent = {
                    ModalDrawerSheet(
                        drawerContainerColor = colors.surface,
                        drawerContentColor = colors.ink,
                        modifier = Modifier.width(292.dp)
                    ) {
                        drawerPanel()
                    }
                }
            ) {
                editorMainBody(false)
            }
        }
    }

    if (showNewChapterDialog) {
        SingleTextInputDialog(
            title = "新建章节",
            label = "章节标题",
            confirmText = "创建",
            onDismiss = { showNewChapterDialog = false },
            onConfirm = { name ->
                showNewChapterDialog = false
                onCreateChapter(name)
            }
        )
    }
}

@Composable
private fun EditorSidebarPanel(
    isPage: Boolean,
    activeTab: String,
    onTabChange: (String) -> Unit,
    chapters: List<Chapter>,
    currentChapterId: String,
    headings: List<com.papernotes.android.data.OutlineHeading>,
    collapsedHeadings: Set<Int>,
    onToggleHeadingCollapse: (Int) -> Unit,
    onJumpHeading: (Int) -> Unit,
    onSelectChapter: (Chapter) -> Unit,
    onNewChapter: () -> Unit
) {
    val colors = LocalPaperColors.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp, vertical = 14.dp)
    ) {
        Text(
            text = if (isPage) "书页目录" else "章节与目录",
            color = colors.ink,
            style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        )
        Spacer(Modifier.height(10.dp))

        if (!isPage) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.4.dp, colors.line, RoundedCornerShape(7.dp))
                    .clip(RoundedCornerShape(7.dp))
            ) {
                listOf("chapters" to "章节 (${chapters.size})", "outline" to "目录").forEach { (key, label) ->
                    val chosen = activeTab == key
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .background(if (chosen) colors.primaryBg else colors.surface)
                            .clickable { onTabChange(key) }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = label,
                            color = if (chosen) colors.primaryInk else colors.ink,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        HorizontalDivider(thickness = 1.2.dp, color = colors.line)
        Spacer(Modifier.height(8.dp))

        // Independently scrollable LazyColumn for either Chapters or Foldable Document Outline
        if (!isPage && activeTab == "chapters") {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                itemsIndexed(chapters, key = { _, c -> c.id }) { idx, ch ->
                    val current = ch.id == currentChapterId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(7.dp))
                            .border(1.2.dp, if (current) colors.line else colors.subtleLine, RoundedCornerShape(7.dp))
                            .background(if (current) colors.softSurface else colors.surface)
                            .clickable { onSelectChapter(ch) }
                            .padding(horizontal = 10.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "%02d".format(idx + 1),
                            color = colors.muted,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                        Text(
                            text = ch.title,
                            color = if (current) colors.spineBrown else colors.ink,
                            fontWeight = if (current) FontWeight.Bold else FontWeight.Medium,
                            fontSize = 13.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
                item {
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(7.dp))
                            .border(1.2.dp, colors.line, RoundedCornerShape(7.dp))
                            .clickable(onClick = onNewChapter)
                            .padding(vertical = 10.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.ink, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("新建章节", color = colors.ink, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        } else {
            if (headings.isEmpty()) {
                Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(
                        text = "正文中使用 # / ## / ### 标题后，\n目录会自动显示在这里。",
                        color = colors.muted,
                        fontSize = 12.sp,
                        lineHeight = 19.sp
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    items(headings, key = { it.index }) { h ->
                        val collapsed = h.index in collapsedHeadings
                        val indent = ((h.level - 1).coerceIn(0, 5) * 14).dp
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = indent)
                                .clip(RoundedCornerShape(6.dp))
                                .clickable { onJumpHeading(h.offset) }
                                .padding(horizontal = 6.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            if (h.hasChildren) {
                                Icon(
                                    imageVector = if (collapsed) Icons.AutoMirrored.Outlined.KeyboardArrowRight else Icons.Outlined.KeyboardArrowDown,
                                    contentDescription = if (collapsed) "展开子标题" else "折叠子标题",
                                    tint = colors.muted,
                                    modifier = Modifier
                                        .size(18.dp)
                                        .clickable { onToggleHeadingCollapse(h.index) }
                                )
                            } else {
                                Spacer(Modifier.width(18.dp))
                            }
                            Text(
                                text = "H${h.level}",
                                color = colors.muted,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold,
                                fontSize = 9.sp
                            )
                            Text(
                                text = h.title,
                                color = colors.ink,
                                fontWeight = if (h.level <= 2) FontWeight.Bold else FontWeight.Normal,
                                fontSize = if (h.level == 1) 14.sp else 13.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }
        }
    }
}
