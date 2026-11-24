package com.papernotes.android.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.papernotes.android.data.ConflictResolution
import com.papernotes.android.data.ShareLinkCodec
import com.papernotes.android.data.SyncConflict
import com.papernotes.android.data.WorkspaceState
import com.papernotes.android.ui.PendingShareImport
import com.papernotes.android.ui.ShareModalState
import com.papernotes.android.ui.components.PaperBadge
import com.papernotes.android.ui.components.PaperButton
import com.papernotes.android.ui.components.PaperCard
import com.papernotes.android.ui.components.ShelfSoundHaptics
import com.papernotes.android.ui.theme.LocalPaperColors
import com.papernotes.android.ui.theme.ThemePreference

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThemePickerSheet(
    current: ThemePreference,
    reducedMotion: Boolean,
    onSelect: (ThemePreference) -> Unit,
    onReducedMotionChange: (Boolean) -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.ink
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            PaperBadge(text = "APPEARANCE · 纸面主题")
            Text(
                "选择阅读与写作主题",
                color = colors.ink,
                style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            )
            Text(
                "所有线框、书架、弹窗、图片占位与 Markdown 编辑器都会同步适配。",
                color = colors.muted,
                fontSize = 12.sp
            )

            ThemePreference.entries.forEach { pref ->
                val selected = pref == current
                PaperCard(
                    modifier = Modifier.fillMaxWidth(),
                    shadowOffset = if (selected) 3.dp else 1.dp,
                    borderColor = if (selected) colors.spineBrown else colors.line,
                    backgroundColor = if (selected) colors.softSurface else colors.surface,
                    onClick = { onSelect(pref) }
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        ThemeSwatch(pref)
                        Column(modifier = Modifier.weight(1f)) {
                            Text(pref.label, color = colors.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(pref.subtitle, color = colors.muted, fontSize = 11.sp)
                        }
                        if (selected) PaperBadge(text = "当前", filled = true)
                    }
                }
            }

            HorizontalDivider(thickness = 1.2.dp, color = colors.subtleLine)

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("减少动态效果", color = colors.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("关闭启动弹性动画与书架微旋/抬升过渡（亦自动遵循系统设置）", color = colors.muted, fontSize = 11.sp)
                }
                Switch(checked = reducedMotion, onCheckedChange = onReducedMotionChange)
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
private fun ThemeSwatch(pref: ThemePreference) {
    val (bg, line) = when (pref) {
        ThemePreference.DAY -> Color(0xFFFFFFFF) to Color(0xFF111111)
        ThemePreference.NIGHT -> Color(0xFF25272A) to Color(0xFFDCD8D0)
        ThemePreference.GREEN -> Color(0xFFE5F1E2) to Color(0xFF415D49)
        ThemePreference.YELLOW -> Color(0xFFFBF2D7) to Color(0xFF756548)
        ThemePreference.SYSTEM -> Color(0xFFFFFFFF) to Color(0xFF333333)
    }
    Box(
        modifier = Modifier
            .size(width = 32.dp, height = 38.dp)
            .border(1.4.dp, line, RoundedCornerShape(4.dp))
            .clip(RoundedCornerShape(4.dp))
            .then(
                if (pref == ThemePreference.SYSTEM) {
                    Modifier.background(Brush.linearGradient(listOf(Color(0xFFFFFFFF), Color(0xFF25272A))))
                } else Modifier.background(bg)
            )
            .padding(5.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Box(Modifier.fillMaxWidth().height(1.5.dp).background(line))
            Box(Modifier.fillMaxWidth(0.75f).height(1.5.dp).background(line))
            Box(Modifier.fillMaxWidth(0.55f).height(1.5.dp).background(line))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncCenterSheet(
    workspace: WorkspaceState,
    busy: Boolean,
    onConnect: (repo: String, token: String, importLocal: Boolean) -> Unit,
    onDisconnect: () -> Unit,
    onSwitchOffline: () -> Unit,
    onRestore: () -> Unit,
    onSyncSelected: (Set<String>) -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    var repoInput by remember(workspace.repository) { mutableStateOf(workspace.repository) }
    var tokenInput by remember { mutableStateOf("") }
    var importLocalChecked by remember { mutableStateOf(false) }
    var selectedKeys by remember(workspace.pendingSyncItems) {
        mutableStateOf(workspace.pendingSyncItems.map { it.key }.toSet())
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.ink
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            PaperBadge(text = "GITHUB · SYNC & RESTORE")
            Text(
                "同步、恢复与仓库连接",
                color = colors.ink,
                style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            )

            // 1. Sync vs Restore Clear Action Section (when connected)
            if (workspace.connected) {
                PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 3.dp) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("已连接仓库", color = colors.muted, fontSize = 11.sp)
                                Text(workspace.repository, color = colors.ink, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                            PaperBadge(text = "Keystore 加密", accent = true)
                        }
                        if (workspace.remoteSnapshotHead != null) {
                            Text(
                                text = "本地离线副本版本：${workspace.remoteSnapshotHead.take(8)}${if (workspace.remoteSnapshotStale) "（建议恢复更新）" else ""}",
                                color = colors.muted,
                                fontSize = 11.sp
                            )
                        }
                        // Explicit Restore Action
                        PaperButton(
                            onClick = onRestore,
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Outlined.CloudDownload, null, modifier = Modifier.size(18.dp))
                            Text("恢复：从 GitHub 下载离线副本（保留未同步草稿）", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                // Batch Sync Checklist
                PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 3.dp) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "同步：提交本机改动 (${workspace.pendingSyncItems.size})",
                                color = colors.ink,
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp
                            )
                            if (workspace.pendingSyncItems.isNotEmpty()) {
                                Text(
                                    text = if (selectedKeys.size == workspace.pendingSyncItems.size) "取消全选" else "全选",
                                    color = colors.spineBrown,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.clickable {
                                        selectedKeys = if (selectedKeys.size == workspace.pendingSyncItems.size) emptySet()
                                        else workspace.pendingSyncItems.map { it.key }.toSet()
                                    }
                                )
                            }
                        }
                        Text(
                            "正文和引用的本地图片将在同一次 Git 提交中原子上传；如远端已修改，将提示对比冲突而不会静默覆盖。",
                            color = colors.muted,
                            fontSize = 11.sp,
                            lineHeight = 16.sp
                        )
                        if (workspace.pendingSyncItems.isEmpty()) {
                            Text("当前没有待提交的本机改动。", color = colors.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
                        } else {
                            workspace.pendingSyncItems.forEach { item ->
                                val checked = item.key in selectedKeys
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(if (checked) colors.softSurface else colors.surface)
                                        .clickable {
                                            selectedKeys = if (checked) selectedKeys - item.key else selectedKeys + item.key
                                        }
                                        .padding(horizontal = 8.dp, vertical = 7.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Icon(
                                        if (checked) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                                        contentDescription = null,
                                        tint = colors.ink,
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(item.title, color = colors.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(item.subtitle, color = colors.muted, fontSize = 11.sp)
                                    }
                                }
                            }
                            PaperButton(
                                onClick = { onSyncSelected(selectedKeys) },
                                primary = true,
                                enabled = !busy && selectedKeys.isNotEmpty(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Outlined.CloudUpload, null, modifier = Modifier.size(18.dp))
                                Text("同步所选 (${selectedKeys.size} 项)", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    PaperButton(onClick = onDisconnect, danger = true, modifier = Modifier.weight(1f)) {
                        Text("断开并清除令牌", fontSize = 12.sp)
                    }
                    PaperButton(onClick = onSwitchOffline, modifier = Modifier.weight(1f)) {
                        Text("切换纯离线工作区", fontSize = 12.sp)
                    }
                }
            }

            // 2. Connect / Switch Repository Form
            PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 2.dp) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        if (workspace.connected) "切换其他 GitHub 仓库" else "连接自己的 GitHub 仓库",
                        color = colors.ink,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    Text(
                        "支持与 Windows 版、网页版连接同一仓库（兼容 docs/cabinets.json、docs/notebooks/、docs/pages/）。请使用仅授权单个仓库 Contents 读写权限的 Fine-grained PAT。",
                        color = colors.muted,
                        fontSize = 11.sp,
                        lineHeight = 16.sp
                    )
                    OutlinedTextField(
                        value = repoInput,
                        onValueChange = { repoInput = it },
                        label = { Text("仓库地址 (owner/repository 或 HTTPS 链接)") },
                        placeholder = { Text("例如：yourname/my-notes") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = colors.line,
                            unfocusedBorderColor = colors.subtleLine,
                            focusedTextColor = colors.ink,
                            unfocusedTextColor = colors.ink
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = tokenInput,
                        onValueChange = { tokenInput = it },
                        label = { Text("GitHub 精细访问令牌 (PAT)") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = colors.line,
                            unfocusedBorderColor = colors.subtleLine,
                            focusedTextColor = colors.ink,
                            unfocusedTextColor = colors.ink
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (workspace.repository.isEmpty()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.clickable { importLocalChecked = !importLocalChecked }
                        ) {
                            Checkbox(checked = importLocalChecked, onCheckedChange = { importLocalChecked = it })
                            Text(
                                "将当前未关联仓库的本机笔记复制到该仓库工作区（自动避免重复使用说明）",
                                color = colors.muted,
                                fontSize = 12.sp
                            )
                        }
                    }
                    PaperButton(
                        onClick = { onConnect(repoInput, tokenInput, importLocalChecked) },
                        primary = !workspace.connected,
                        enabled = !busy && repoInput.isNotBlank() && tokenInput.isNotBlank(),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("验证并连接 GitHub", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
        }
    }
}

@Composable
fun SyncConflictDialog(
    conflict: SyncConflict,
    onResolve: (ConflictResolution) -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    var previewTab by remember { mutableStateOf("local") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        titleContentColor = colors.ink,
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                PaperBadge(text = "SYNC CONFLICT · 远端版本冲突", accent = true)
                Text(conflict.title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(conflict.detail, color = colors.error, fontSize = 12.sp)
                Text("路径：${conflict.path}", color = colors.muted, fontFamily = FontFamily.Monospace, fontSize = 11.sp)

                if (conflict.localContent.isNotEmpty() || conflict.remoteContent.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.2.dp, colors.line, RoundedCornerShape(6.dp))
                            .clip(RoundedCornerShape(6.dp))
                    ) {
                        listOf("local" to "本机版本", "remote" to "远端版本").forEach { (k, lbl) ->
                            val active = previewTab == k
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .background(if (active) colors.primaryBg else colors.surface)
                                    .clickable { previewTab = k }
                                    .padding(vertical = 7.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(lbl, color = if (active) colors.primaryInk else colors.ink, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 80.dp, max = 180.dp)
                            .border(1.2.dp, colors.subtleLine, RoundedCornerShape(6.dp))
                            .background(colors.softSurface, RoundedCornerShape(6.dp))
                            .verticalScroll(rememberScrollState())
                            .padding(10.dp)
                    ) {
                        Text(
                            text = if (previewTab == "local") conflict.localContent.ifEmpty { "（空）" }
                            else conflict.remoteContent.ifEmpty { "（远端已删除或无法预览）" },
                            color = colors.ink,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            lineHeight = 16.sp
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    PaperButton(
                        onClick = { onResolve(ConflictResolution.KEEP_LOCAL_REBASE_REMOTE) },
                        primary = true,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("保留本机修改（以远端为新基准后重传）", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                    PaperButton(
                        onClick = { onResolve(ConflictResolution.SAVE_LOCAL_AS_COPY_AND_USE_REMOTE) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("另存本机为冲突副本，同时采用远端", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                    PaperButton(
                        onClick = { onResolve(ConflictResolution.USE_REMOTE_DISCARD_LOCAL) },
                        danger = true,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("采用远端版本（放弃本机此项草稿）", fontSize = 12.sp)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { PaperButton(onClick = onDismiss) { Text("暂不处理") } }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportBottomSheet(
    inEditor: Boolean,
    pendingShare: PendingShareImport?,
    shareError: String?,
    onParseShareLink: (String) -> Unit,
    onConfirmShareImport: () -> Unit,
    onClearShareImport: () -> Unit,
    onImportMdFiles: () -> Unit,
    onImportFolder: () -> Unit,
    onPickGalleryImage: () -> Unit,
    onPickFileImage: () -> Unit,
    onPasteClipboardImage: () -> Unit,
    onRepairNoteImages: () -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    var shareInput by remember { mutableStateOf("") }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.ink
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            PaperBadge(text = "IMPORT · 文件 / 分享链接")
            Text("导入笔记与分享链接", color = colors.ink, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 19.sp)
            Text("支持从系统文件导入或粘贴他人发来的纸间分享链接（桌面端与安卓端完全互通）。", color = colors.muted, fontSize = 12.sp)

            // Share Link Import Card
            PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 2.dp) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(Icons.Outlined.Link, contentDescription = null, tint = colors.ink, modifier = Modifier.size(16.dp))
                        Text("通过分享链接导入", color = colors.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }
                    OutlinedTextField(
                        value = shareInput,
                        onValueChange = { shareInput = it },
                        placeholder = { Text("粘贴 paper-share://... 或 GitHub 笔记链接", fontSize = 12.sp) },
                        maxLines = 3,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = colors.line,
                            unfocusedBorderColor = colors.subtleLine,
                            focusedTextColor = colors.ink,
                            unfocusedTextColor = colors.ink
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (!shareError.isNullOrBlank()) {
                        Text(shareError, color = colors.error, fontSize = 12.sp)
                    }
                    if (pendingShare != null) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.2.dp, colors.line, RoundedCornerShape(6.dp))
                                .background(colors.softSurface, RoundedCornerShape(6.dp))
                                .padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                PaperBadge(text = pendingShare.summary.scopeLabel, accent = true)
                                Text(
                                    pendingShare.summary.title,
                                    color = colors.ink,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            val counts = listOfNotNull(
                                if (pendingShare.summary.bookCount > 0) "${pendingShare.summary.bookCount} 本笔记本" else null,
                                if (pendingShare.summary.chapterCount > 0) "${pendingShare.summary.chapterCount} 篇章节" else null,
                                if (pendingShare.summary.pageCount > 0) "${pendingShare.summary.pageCount} 张书页" else null,
                                if (pendingShare.summary.imageCount > 0) "${pendingShare.summary.imageCount} 张图片" else null
                            ).joinToString(" · ")
                            Text("来源：${pendingShare.sourceLabel}${if (counts.isNotEmpty()) " · $counts" else ""}", color = colors.muted, fontSize = 11.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PaperButton(onClick = onClearShareImport, modifier = Modifier.weight(1f)) {
                                    Text("取消", fontSize = 12.sp)
                                }
                                PaperButton(onClick = onConfirmShareImport, primary = true, modifier = Modifier.weight(1f)) {
                                    Text("确认导入", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    } else {
                        PaperButton(
                            onClick = { onParseShareLink(shareInput) },
                            enabled = shareInput.isNotBlank(),
                            primary = true,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("解析分享链接", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                    }
                }
            }

            HorizontalDivider(color = colors.subtleLine)

            SheetActionRow(
                icon = Icons.Outlined.Description,
                title = "导入 Markdown 文件 (.md)",
                subtitle = "在笔记本中新增章节，在书柜中创建独立书页",
                onClick = onImportMdFiles
            )
            SheetActionRow(
                icon = Icons.Outlined.FolderOpen,
                title = "导入 Markdown 文件夹",
                subtitle = "整夹导入为笔记本，自动重写 Typora .assets 与 <img> 相对路径图片",
                onClick = onImportFolder
            )
            if (inEditor) {
                HorizontalDivider(color = colors.subtleLine)
                SheetActionRow(Icons.Outlined.Image, "从相册插入图片", "支持 PNG / JPEG / GIF / WebP（≤20 MiB）", onClick = onPickGalleryImage)
                SheetActionRow(Icons.Outlined.FolderOpen, "从系统文件插入图片", "以独立附件保存并写入相对路径", onClick = onPickFileImage)
                SheetActionRow(Icons.Outlined.ContentPaste, "粘贴剪贴板图片", "读取剪贴板中的图片附件", onClick = onPasteClipboardImage)
                SheetActionRow(Icons.Outlined.BrokenImage, "补齐当前笔记缺失图片", "重新选择原文件夹补齐图片，保留已有编辑", onClick = onRepairNoteImages)
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareLinkSheet(
    state: ShareModalState,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    val context = LocalContext.current
    var mode by remember(state) {
        mutableStateOf(
            if (state.offlineBlockedReason.isNotEmpty() && state.githubLink != null) "github" else "offline"
        )
    }
    var includeImages by remember(state) {
        mutableStateOf(state.offlineBlockedReason.isEmpty() && state.summary.imageCount > 0)
    }
    var copied by remember { mutableStateOf(false) }

    val encoded = remember(state, mode, includeImages) {
        if (mode == "github" && state.githubLink != null) null
        else if (state.offlineBlockedReason.isNotEmpty()) null
        else {
            val src = if (includeImages) state.payload else ShareLinkCodec.stripAttachments(state.payload)
            ShareLinkCodec.encodeShareLink(src)
        }
    }
    val linkText = when {
        mode == "github" && state.githubLink != null -> state.githubLink
        encoded != null && !encoded.overMemoryLimit -> encoded.uri
        else -> ""
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.ink
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaperBadge(text = state.summary.scopeLabel, accent = true)
                Text(
                    state.summary.title,
                    color = colors.ink,
                    fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            val meta = listOfNotNull(
                if (state.summary.bookCount > 0) "${state.summary.bookCount} 本笔记本" else null,
                if (state.summary.chapterCount > 0) "${state.summary.chapterCount} 篇章节" else null,
                if (state.summary.pageCount > 0) "${state.summary.pageCount} 张书页" else null,
                if (state.summary.imageCount > 0) "${state.summary.imageCount} 张图片" else null
            ).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text("包含：$meta", color = colors.muted, fontSize = 12.sp)
            }

            if (state.githubLink != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    PaperButton(onClick = { mode = "offline"; copied = false }, primary = mode == "offline", modifier = Modifier.weight(1f)) {
                        Text("离线分享链接", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                    PaperButton(onClick = { mode = "github"; copied = false }, primary = mode == "github", modifier = Modifier.weight(1f)) {
                        Text("GitHub 短链", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (mode == "offline" && state.summary.imageCount > 0 && state.offlineBlockedReason.isEmpty()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable { includeImages = !includeImages; copied = false }
                ) {
                    Checkbox(checked = includeImages, onCheckedChange = { includeImages = it; copied = false })
                    Text("内嵌图片附件（${state.summary.imageCount} 张）", color = colors.ink, fontSize = 13.sp)
                }
            }

            if (mode == "offline" && state.omittedLargeImages > 0) {
                Text(
                    "已跳过 ${state.omittedLargeImages} 张较大图片以控制离线内存上限（单图 ≤ 180 KB、总图 ≤ 320 KB）。",
                    color = colors.muted,
                    fontSize = 11.sp
                )
            }

            if (mode == "offline" && state.offlineBlockedReason.isNotEmpty()) {
                Text(state.offlineBlockedReason, color = colors.error, fontSize = 12.sp)
            } else if (mode == "offline" && encoded != null && encoded.overMemoryLimit) {
                Text("当前离线包超过 512 KB 内存上限，请取消勾选内嵌图片或切换 GitHub 短链。", color = colors.error, fontSize = 12.sp)
            } else if (mode == "offline" && encoded != null) {
                Text(
                    "离线包：${String.format("%.1f", encoded.rawBytes / 1024.0)} KB / 512 KB 上限（压缩后 ${encoded.charLength} 字符）",
                    color = colors.muted,
                    fontSize = 11.sp
                )
            }

            if (linkText.isNotEmpty()) {
                OutlinedTextField(
                    value = linkText,
                    onValueChange = {},
                    readOnly = true,
                    maxLines = 4,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = colors.ink),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.line,
                        unfocusedBorderColor = colors.line,
                        focusedTextColor = colors.ink,
                        unfocusedTextColor = colors.ink
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                Text("发给对方后，在纸间桌面端、网页版或安卓端点击「导入」粘贴此链接即可还原。", color = colors.muted, fontSize = 11.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    PaperButton(
                        onClick = {
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            cm.setPrimaryClip(ClipData.newPlainText("纸间分享链接", linkText))
                            copied = true
                        },
                        primary = true,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Outlined.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(if (copied) "已复制 ✓" else "复制链接", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    PaperButton(
                        onClick = {
                            val intent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_SUBJECT, "纸间分享：${state.summary.title}")
                                putExtra(Intent.EXTRA_TEXT, "我通过「纸间」分享了${state.summary.scopeLabel}「${state.summary.title}」，点击「导入」粘贴以下链接即可打开：\n$linkText")
                            }
                            context.startActivity(Intent.createChooser(intent, "分享笔记链接"))
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Outlined.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("发送给好友", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalSearchSheet(
    workspace: WorkspaceState,
    assignedCabinetOf: (String) -> String,
    onOpenCabinet: (String) -> Unit,
    onOpenItem: (String, String) -> Unit,
    onOpenChapter: (String, String, String, Boolean) -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    var query by remember { mutableStateOf("") }
    val q = query.trim().lowercase()

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.ink
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Outlined.Search, null, tint = colors.ink) },
                placeholder = { Text("搜索书柜、笔记本、书页或正文…") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.line,
                    unfocusedBorderColor = colors.subtleLine,
                    focusedTextColor = colors.ink,
                    unfocusedTextColor = colors.ink
                ),
                modifier = Modifier.fillMaxWidth()
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 160.dp, max = 420.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (q.isEmpty()) {
                    Text("输入关键词即时检索本机全部笔记与离线副本。", color = colors.muted, fontSize = 13.sp, modifier = Modifier.padding(8.dp))
                } else {
                    val matchedCabinets = workspace.cabinets.filter { it.title.lowercase().contains(q) }
                    val matchedItems = workspace.items.filter {
                        it.title.lowercase().contains(q) || it.description.lowercase().contains(q)
                    }
                    val matchedChapters = workspace.chaptersByBook.entries.flatMap { (bookId, list) ->
                        val item = workspace.items.find { it.id == bookId }
                        list.filter { ch ->
                            val text = workspace.drafts["$bookId/${ch.id}"]?.content ?: ch.content
                            ch.title.lowercase().contains(q) || text.lowercase().contains(q)
                        }.map { ch -> Triple(bookId, item, ch) }
                    }

                    if (matchedCabinets.isEmpty() && matchedItems.isEmpty() && matchedChapters.isEmpty()) {
                        Text("没有找到包含「$query」的笔记。", color = colors.muted, fontSize = 13.sp, modifier = Modifier.padding(8.dp))
                    }

                    matchedCabinets.forEach { cab ->
                        SheetActionRow(
                            icon = Icons.Outlined.FolderOpen,
                            title = cab.title,
                            subtitle = "书柜",
                            onClick = { onDismiss(); onOpenCabinet(cab.id) }
                        )
                    }
                    matchedItems.forEach { item ->
                        val cabId = assignedCabinetOf(item.id)
                        SheetActionRow(
                            icon = if (item.isPage) Icons.Outlined.Description else Icons.AutoMirrored.Outlined.MenuBook,
                            title = item.title,
                            subtitle = if (item.isPage) "独立书页" else "笔记本 · ${item.chapterCount} 章",
                            onClick = { onDismiss(); onOpenItem(cabId, item.id) }
                        )
                    }
                    matchedChapters.take(25).forEach { (bookId, item, ch) ->
                        val cabId = assignedCabinetOf(bookId)
                        val isPage = item?.isPage == true
                        SheetActionRow(
                            icon = Icons.Outlined.Description,
                            title = ch.title,
                            subtitle = if (isPage) "独立书页正文匹配" else "${item?.title ?: bookId} · 章节匹配",
                            onClick = { onDismiss(); onOpenChapter(cabId, bookId, ch.id, isPage) }
                        )
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    workspace: WorkspaceState,
    onOpenTheme: () -> Unit,
    onOpenSync: () -> Unit,
    onRestoreWelcome: () -> Unit,
    onReopenOnboarding: () -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalPaperColors.current
    val context = LocalContext.current
    val soundEnabled by ShelfSoundHaptics.soundEnabled.collectAsState()
    val hapticEnabled by ShelfSoundHaptics.hapticEnabled.collectAsState()
    LaunchedEffect(context) { ShelfSoundHaptics.init(context) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        contentColor = colors.ink
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            PaperBadge(text = "SETTINGS · 纸间 Android")
            Text("设置与说明", color = colors.ink, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 19.sp)

            PaperCard(modifier = Modifier.fillMaxWidth(), shadowOffset = 2.dp) {
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("书架滑动音效", color = colors.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text("滑动书柜与书架时播放纸脊轻叩音效", color = colors.muted, fontSize = 11.sp)
                        }
                        Switch(checked = soundEnabled, onCheckedChange = { ShelfSoundHaptics.setSoundEnabled(context, it) })
                    }
                    HorizontalDivider(color = colors.subtleLine, modifier = Modifier.padding(vertical = 4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("滑动微震动反馈", color = colors.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text("划过书脊时附带细腻轻震动", color = colors.muted, fontSize = 11.sp)
                        }
                        Switch(checked = hapticEnabled, onCheckedChange = { ShelfSoundHaptics.setHapticEnabled(context, it) })
                    }
                }
            }

            SheetActionRow(Icons.AutoMirrored.Outlined.MenuBook, "重新添加「使用说明与教程」", "以普通可编辑笔记添加到默认书柜", onClick = { onDismiss(); onRestoreWelcome() })
            SheetActionRow(Icons.AutoMirrored.Outlined.HelpOutline, "重新查看首次引导", "快速浏览书柜、书页与同步说明", onClick = onReopenOnboarding)
            SheetActionRow(Icons.Outlined.CloudUpload, "GitHub 同步与仓库管理", if (workspace.connected) "当前仓库：${workspace.repository}" else "当前处于离线模式", onClick = { onDismiss(); onOpenSync() })
            SheetActionRow(Icons.Outlined.Security, "安全与存储说明", "令牌经 Android Keystore AES-256-GCM 加密，按仓库隔离；不请求全局存储权限。", onClick = { onDismiss(); onOpenTheme() })

            Spacer(Modifier.height(10.dp))
        }
    }
}
