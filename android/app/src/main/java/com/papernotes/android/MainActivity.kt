package com.papernotes.android

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.papernotes.android.ui.AppScreen
import com.papernotes.android.ui.PaperNotesViewModel
import com.papernotes.android.ui.screens.BookshelfScreen
import com.papernotes.android.ui.screens.CabinetHomeScreen
import com.papernotes.android.ui.screens.GlobalSearchSheet
import com.papernotes.android.ui.screens.ImportBottomSheet
import com.papernotes.android.ui.screens.MarkdownEditorScreen
import com.papernotes.android.ui.screens.NotebookDetailScreen
import com.papernotes.android.ui.screens.OnboardingScreen
import com.papernotes.android.ui.screens.SettingsSheet
import com.papernotes.android.ui.screens.ShareLinkSheet
import com.papernotes.android.ui.screens.SplashScreen
import com.papernotes.android.ui.screens.SyncCenterSheet
import com.papernotes.android.ui.screens.SyncConflictDialog
import com.papernotes.android.ui.screens.ThemePickerSheet
import com.papernotes.android.ui.theme.LocalPaperColors
import com.papernotes.android.ui.theme.PaperNotesTheme
import com.papernotes.android.ui.theme.ThemePreference
import com.papernotes.android.ui.theme.resolvePaperColors

class MainActivity : ComponentActivity() {
    private val viewModel: PaperNotesViewModel by viewModels {
        PaperNotesViewModel.factory((application as PaperNotesApp).repository)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PaperNotesRoot(viewModel = viewModel, activity = this)
        }
    }
}

@Composable
private fun PaperNotesRoot(
    viewModel: PaperNotesViewModel,
    activity: ComponentActivity
) {
    val ui by viewModel.ui.collectAsState()
    val context = LocalContext.current
    val themePref = ThemePreference.fromKey(ui.workspace.settings.themePreference)
    val systemDark = isSystemInDarkTheme()
    val resolvedColors = resolvePaperColors(themePref, systemDark)

    // Respect both Android system "Remove animations" and in-app reduced motion toggle
    val systemReducedMotion = remember(context) {
        try {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        } catch (_: Exception) {
            false
        }
    }
    val reducedMotion = systemReducedMotion || ui.workspace.settings.reducedMotionOverride

    DisposableEffect(resolvedColors.isDark) {
        val style = if (resolvedColors.isDark) {
            SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
        }
        activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        onDispose {}
    }

    // SAF & Photo Picker Launchers (zero unnecessary storage permissions)
    val galleryImageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) viewModel.insertImageFromUri(context, uri)
    }

    val fileImageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) viewModel.insertImageFromUri(context, uri)
    }

    val importMdLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isNotEmpty()) viewModel.importMarkdownFiles(context, uris)
    }

    val importFolderLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { treeUri ->
        if (treeUri != null) viewModel.importMarkdownFolder(context, treeUri)
    }

    val repairFolderLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { treeUri ->
        if (treeUri != null) viewModel.repairCurrentNoteImages(context, treeUri)
    }

    // System predictive back gesture support across every screen & overlay
    BackHandler(enabled = ui.screen !is AppScreen.Home && ui.screen !is AppScreen.Splash ||
        ui.showSearchSheet || ui.showImportSheet || ui.showSyncSheet || ui.showThemeSheet || ui.showSettingsSheet || ui.activeConflict != null
    ) {
        viewModel.navigateBack()
    }

    PaperNotesTheme(preference = themePref, reducedMotion = reducedMotion) {
        val colors = LocalPaperColors.current

        Box(modifier = Modifier.fillMaxSize().background(colors.background)) {
            when (val screen = ui.screen) {
                AppScreen.Splash -> {
                    SplashScreen(onFinished = { viewModel.finishSplash() })
                }

                AppScreen.Onboarding -> {
                    OnboardingScreen(onDone = { viewModel.finishOnboarding() })
                }

                AppScreen.Home -> {
                    CabinetHomeScreen(
                        workspace = ui.workspace,
                        assignedCabinetOf = { viewModel.repo.assignedCabinet(it) },
                        notice = ui.notice,
                        error = ui.error,
                        onDismissMessage = { viewModel.clearMessages() },
                        onOpenCabinet = { viewModel.openCabinet(it) },
                        onCreateCabinet = { viewModel.createCabinet(it) },
                        onRenameCabinet = { id, name -> viewModel.renameCabinet(id, name) },
                        onDeleteCabinet = { viewModel.deleteCabinet(it) },
                        onUndoDeleteCabinet = { viewModel.undoDeleteCabinet(it) },
                        onCreateNotebook = { title, desc, cab -> viewModel.createNotebook(title, desc, cab) },
                        onCreatePage = { title, cab -> viewModel.createStandalonePage(title, cab) },
                        onOpenSearch = { viewModel.toggleSearchSheet(true) },
                        onOpenTheme = { viewModel.toggleThemeSheet(true) },
                        onOpenImport = { viewModel.toggleImportSheet(true) },
                        onOpenSync = { viewModel.toggleSyncSheet(true) },
                        onOpenSettings = { viewModel.toggleSettingsSheet(true) },
                        onShareCabinet = { viewModel.shareCabinet(it) }
                    )
                }

                is AppScreen.Bookshelf -> {
                    BookshelfScreen(
                        cabinetId = screen.cabinetId,
                        workspace = ui.workspace,
                        assignedCabinetOf = { viewModel.repo.assignedCabinet(it) },
                        notice = ui.notice,
                        error = ui.error,
                        onDismissMessage = { viewModel.clearMessages() },
                        onBack = { viewModel.navigateBack() },
                        onOpenItem = { item -> viewModel.openShelfItem(screen.cabinetId, item.id) },
                        onCreateNotebook = { title, desc, cab -> viewModel.createNotebook(title, desc, cab) },
                        onCreatePage = { title, cab -> viewModel.createStandalonePage(title, cab) },
                        onMoveItems = { ids, target -> viewModel.moveItemsToCabinet(ids, target) },
                        onDeleteItems = { ids -> viewModel.deleteItems(ids) },
                        onOpenImport = { viewModel.toggleImportSheet(true) },
                        onShareCabinet = { viewModel.shareCabinet(screen.cabinetId) }
                    )
                }

                is AppScreen.NotebookDetail -> {
                    NotebookDetailScreen(
                        cabinetId = screen.cabinetId,
                        bookId = screen.bookId,
                        workspace = ui.workspace,
                        notice = ui.notice,
                        error = ui.error,
                        onDismissMessage = { viewModel.clearMessages() },
                        onBack = { viewModel.navigateBack() },
                        onOpenChapter = { ch -> viewModel.openEditor(screen.cabinetId, screen.bookId, ch.id, isPage = false) },
                        onCreateChapter = { title -> viewModel.createChapter(screen.cabinetId, screen.bookId, title) },
                        onUpdateDescription = { desc -> viewModel.updateNotebookDescription(screen.bookId, desc) },
                        onReorderChapters = { ids -> viewModel.reorderChapters(screen.bookId, ids) },
                        onDeleteChapters = { ids -> viewModel.deleteChapters(screen.bookId, ids) },
                        onMoveToCabinet = { target ->
                            viewModel.moveItemsToCabinet(setOf(screen.bookId), target)
                            viewModel.openCabinet(target)
                        },
                        onSyncNotebook = { viewModel.syncNotebookAll(screen.bookId) },
                        onOpenSync = { viewModel.toggleSyncSheet(true) },
                        onOpenImport = { viewModel.toggleImportSheet(true) },
                        onShareNotebook = { viewModel.shareNotebook(screen.bookId) }
                    )
                }

                is AppScreen.Editor -> {
                    val doc = ui.activeEditor
                    if (doc != null) {
                        MarkdownEditorScreen(
                            cabinetId = screen.cabinetId,
                            bookId = screen.bookId,
                            doc = doc,
                            workspace = ui.workspace,
                            repository = viewModel.repo,
                            busy = ui.busy,
                            notice = ui.notice,
                            error = ui.error,
                            pendingImageSnippet = ui.pendingImageSnippet,
                            imageRefreshNonce = ui.imageRefreshNonce,
                            onConsumeImageSnippet = { viewModel.consumePendingImageSnippet() },
                            onDismissMessage = { viewModel.clearMessages() },
                            onBack = { viewModel.navigateBack() },
                            onModeChange = { viewModel.setEditorMode(it) },
                            onContentChanged = { c, u, r -> viewModel.onEditorContentChanged(c, u, r) },
                            onSelectionChanged = { viewModel.onEditorSelectionChanged(it) },
                            onFormatError = { viewModel.onEditorFormatError(it) },
                            onSwitchChapter = { ch ->
                                viewModel.openEditor(screen.cabinetId, screen.bookId, ch.id, isPage = false)
                            },
                            onCreateChapter = { title -> viewModel.createChapter(screen.cabinetId, screen.bookId, title) },
                            onPickGalleryImage = {
                                galleryImageLauncher.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                )
                            },
                            onPickFileImage = {
                                fileImageLauncher.launch(arrayOf("image/png", "image/jpeg", "image/gif", "image/webp"))
                            },
                            onPasteClipboardImage = { viewModel.insertImageFromClipboard(context) },
                            onWebImagePaste = { mime, b64 -> viewModel.insertWebPastedImage(mime, b64) },
                            onRepairImages = { repairFolderLauncher.launch(null) },
                            onSyncCurrent = { viewModel.syncCurrentEditorNote() },
                            onOpenSync = { viewModel.toggleSyncSheet(true) },
                            onOpenTheme = { viewModel.toggleThemeSheet(true) },
                            onShareCurrent = { viewModel.shareCurrentEditorNote() }
                        )
                    }
                }
            }

            // Overlays & Sheets
            if (ui.showThemeSheet) {
                ThemePickerSheet(
                    current = themePref,
                    reducedMotion = ui.workspace.settings.reducedMotionOverride,
                    onSelect = { viewModel.setTheme(it) },
                    onReducedMotionChange = { viewModel.setReducedMotion(it) },
                    onDismiss = { viewModel.toggleThemeSheet(false) }
                )
            }

            if (ui.showSyncSheet) {
                SyncCenterSheet(
                    workspace = ui.workspace,
                    busy = ui.busy,
                    onConnect = { repo, token, importLocal -> viewModel.connectGitHub(repo, token, importLocal) },
                    onDisconnect = { viewModel.disconnectGitHub() },
                    onSwitchOffline = { viewModel.switchToOfflineLocal() },
                    onRestore = { viewModel.restoreFromGitHub() },
                    onSyncSelected = { keys -> viewModel.syncSelected(keys) },
                    onDismiss = { viewModel.toggleSyncSheet(false) }
                )
            }

            if (ui.showImportSheet) {
                val activeCabId = when (val s = ui.screen) {
                    is AppScreen.Bookshelf -> s.cabinetId
                    is AppScreen.NotebookDetail -> s.cabinetId
                    is AppScreen.Editor -> s.cabinetId
                    else -> com.papernotes.android.data.DEFAULT_CABINET_ID
                }
                ImportBottomSheet(
                    inEditor = ui.screen is AppScreen.Editor,
                    pendingShare = ui.pendingShareImport,
                    shareError = ui.shareImportError,
                    onParseShareLink = { viewModel.parseShareLink(it) },
                    onConfirmShareImport = { viewModel.confirmImportShare(activeCabId) },
                    onClearShareImport = { viewModel.clearPendingShareImport() },
                    onImportMdFiles = {
                        viewModel.toggleImportSheet(false)
                        importMdLauncher.launch(arrayOf("text/markdown", "text/plain", "*/*"))
                    },
                    onImportFolder = {
                        viewModel.toggleImportSheet(false)
                        importFolderLauncher.launch(null)
                    },
                    onPickGalleryImage = {
                        viewModel.toggleImportSheet(false)
                        galleryImageLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    },
                    onPickFileImage = {
                        viewModel.toggleImportSheet(false)
                        fileImageLauncher.launch(arrayOf("image/png", "image/jpeg", "image/gif", "image/webp"))
                    },
                    onPasteClipboardImage = {
                        viewModel.toggleImportSheet(false)
                        viewModel.insertImageFromClipboard(context)
                    },
                    onRepairNoteImages = {
                        viewModel.toggleImportSheet(false)
                        repairFolderLauncher.launch(null)
                    },
                    onDismiss = { viewModel.toggleImportSheet(false); viewModel.clearPendingShareImport() }
                )
            }

            ui.activeShare?.let { shareState ->
                ShareLinkSheet(
                    state = shareState,
                    onDismiss = { viewModel.dismissShare() }
                )
            }

            if (ui.showSearchSheet) {
                GlobalSearchSheet(
                    workspace = ui.workspace,
                    assignedCabinetOf = { viewModel.repo.assignedCabinet(it) },
                    onOpenCabinet = { viewModel.openCabinet(it) },
                    onOpenItem = { cabId, itemId -> viewModel.openShelfItem(cabId, itemId) },
                    onOpenChapter = { cabId, bookId, chId, isPage ->
                        viewModel.openEditor(cabId, bookId, chId, isPage)
                    },
                    onDismiss = { viewModel.toggleSearchSheet(false) }
                )
            }

            if (ui.showSettingsSheet) {
                SettingsSheet(
                    workspace = ui.workspace,
                    onOpenTheme = { viewModel.toggleThemeSheet(true) },
                    onOpenSync = { viewModel.toggleSyncSheet(true) },
                    onRestoreWelcome = { viewModel.restoreWelcomeGuide() },
                    onReopenOnboarding = { viewModel.reopenOnboarding() },
                    onDismiss = { viewModel.toggleSettingsSheet(false) }
                )
            }

            ui.activeConflict?.let { conflict ->
                SyncConflictDialog(
                    conflict = conflict,
                    onResolve = { viewModel.resolveConflict(it) },
                    onDismiss = { viewModel.dismissConflict() }
                )
            }

            // Busy Transfer Pill Overlay
            if (ui.busy) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(colors.scrim),
                    contentAlignment = Alignment.Center
                ) {
                    Row(
                        modifier = Modifier
                            .border(2.dp, colors.line, RoundedCornerShape(10.dp))
                            .background(colors.surface, RoundedCornerShape(10.dp))
                            .padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        CircularProgressIndicator(
                            color = colors.ink,
                            strokeWidth = 2.5.dp,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = ui.busyLabel.ifBlank { "处理中…" },
                            color = colors.ink,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                    }
                }
            }
        }
    }
}
