package com.papernotes.android.ui.editor

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import com.papernotes.android.data.AttachmentPolicy
import com.papernotes.android.data.PaperNotesRepository
import com.papernotes.android.ui.theme.LocalPaperColors
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayInputStream

enum class EditorViewMode(val jsName: String, val label: String) {
    VISUAL("visual", "所见即写"),
    SOURCE("source", "源代码")
}

class EditorController {
    internal var webView: WebView? = null
    internal var isReady: Boolean = false
    private val pendingScripts = mutableListOf<String>()

    private fun eval(js: String) {
        val wv = webView
        if (wv != null && isReady) {
            wv.post { wv.evaluateJavascript(js, null) }
        } else {
            pendingScripts.add(js)
        }
    }

    internal fun markReady() {
        isReady = true
        val wv = webView ?: return
        val queued = pendingScripts.toList()
        pendingScripts.clear()
        wv.post {
            queued.forEach { wv.evaluateJavascript(it, null) }
        }
    }

    fun setDocument(content: String, docKey: String, imageBaseUrl: String) {
        val c = Json.encodeToString(content)
        val k = Json.encodeToString(docKey)
        val b = Json.encodeToString(imageBaseUrl)
        eval("window.PaperEditor && window.PaperEditor.setDocument($c, $k, $b);")
    }

    fun setMode(mode: EditorViewMode) {
        val m = Json.encodeToString(mode.jsName)
        eval("window.PaperEditor && window.PaperEditor.setMode($m);")
    }

    fun setTheme(themeCssName: String) {
        val t = Json.encodeToString(themeCssName)
        eval("window.PaperEditor && window.PaperEditor.setTheme($t);")
    }

    fun setReadOnly(readOnly: Boolean) {
        eval("window.PaperEditor && window.PaperEditor.setReadOnly($readOnly);")
    }

    fun applyFormat(action: String, codeLanguage: String = "") {
        val a = Json.encodeToString(action)
        val l = Json.encodeToString(codeLanguage)
        eval("window.PaperEditor && window.PaperEditor.applyFormat($a, $l);")
    }

    fun insertText(snippet: String) {
        val s = Json.encodeToString(snippet)
        eval("window.PaperEditor && window.PaperEditor.insertText($s);")
    }

    fun undo() {
        eval("window.PaperEditor && window.PaperEditor.undo();")
    }

    fun redo() {
        eval("window.PaperEditor && window.PaperEditor.redo();")
    }

    fun focusHeading(offset: Int) {
        eval("window.PaperEditor && window.PaperEditor.focusHeading($offset);")
    }

    fun refreshImages() {
        eval("window.PaperEditor && window.PaperEditor.refreshImages();")
    }
}

class EditorJsBridge(
    private val mainHandler: Handler,
    private val onReadyCallback: () -> Unit,
    private val onContentChangedCallback: (String, Boolean, Boolean) -> Unit,
    private val onSelectionChangedCallback: (Boolean, Int) -> Unit,
    private val onFormatErrorCallback: (String) -> Unit,
    private val onMissingImageCallback: (String) -> Unit,
    private val onWebImagePasteCallback: (String, String) -> Unit
) {
    @JavascriptInterface
    fun onReady() {
        mainHandler.post { onReadyCallback() }
    }

    @JavascriptInterface
    fun onContentChanged(content: String, canUndo: Boolean, canRedo: Boolean) {
        mainHandler.post { onContentChangedCallback(content, canUndo, canRedo) }
    }

    @JavascriptInterface
    fun onSelectionChanged(hasSelection: Boolean, selectionLength: Int) {
        mainHandler.post { onSelectionChangedCallback(hasSelection, selectionLength) }
    }

    @JavascriptInterface
    fun onFormatError(message: String) {
        mainHandler.post { onFormatErrorCallback(message) }
    }

    @JavascriptInterface
    fun onMissingImageClicked(src: String) {
        mainHandler.post { onMissingImageCallback(src) }
    }

    @JavascriptInterface
    fun onWebImagePaste(mime: String, base64Data: String) {
        mainHandler.post { onWebImagePasteCallback(mime, base64Data) }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MarkdownWebEditor(
    controller: EditorController,
    repository: PaperNotesRepository,
    docKey: String,
    initialContent: String,
    imageBaseUrl: String,
    mode: EditorViewMode,
    readOnly: Boolean,
    onContentChanged: (content: String, canUndo: Boolean, canRedo: Boolean) -> Unit,
    onSelectionChanged: (hasSelection: Boolean, length: Int) -> Unit,
    onFormatError: (String) -> Unit,
    onMissingImageClicked: (String) -> Unit,
    onWebImagePaste: (mime: String, base64Data: String) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = LocalPaperColors.current
    val bgArgb = colors.background.toArgb()

    val latestContentCb by rememberUpdatedState(onContentChanged)
    val latestSelectionCb by rememberUpdatedState(onSelectionChanged)
    val latestFormatErrCb by rememberUpdatedState(onFormatError)
    val latestMissingImgCb by rememberUpdatedState(onMissingImageClicked)
    val latestPasteCb by rememberUpdatedState(onWebImagePaste)

    var webReady by remember { mutableStateOf(false) }

    LaunchedEffect(webReady, docKey, imageBaseUrl) {
        if (webReady) {
            controller.setTheme(colors.resolved.cssName)
            controller.setMode(mode)
            controller.setReadOnly(readOnly)
            controller.setDocument(initialContent, docKey, imageBaseUrl)
        }
    }

    LaunchedEffect(webReady, colors.resolved.cssName) {
        if (webReady) controller.setTheme(colors.resolved.cssName)
    }

    LaunchedEffect(webReady, mode) {
        if (webReady) controller.setMode(mode)
    }

    LaunchedEffect(webReady, readOnly) {
        if (webReady) controller.setReadOnly(readOnly)
    }

    DisposableEffect(Unit) {
        onDispose {
            controller.webView?.destroy()
            controller.webView = null
            controller.isReady = false
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .addPathHandler("/attachments/") { relPath ->
                    // Format: <docDir>/assets/<32hex>.<ext>, e.g. docs/notebooks/<bookId>/assets/<hex>.png
                    val clean = relPath.substringBefore('?').trimStart('/')
                    if (!AttachmentPolicy.MANAGED_PATH_REGEX.matches(clean)) {
                        return@addPathHandler WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    }
                    val att = try {
                        repository.attachments.getAttachment(repository.currentRepository(), clean)
                            ?: runBlocking { repository.ensureAttachmentLocal(clean) }
                    } catch (_: Exception) {
                        null
                    }
                    if (att == null) {
                        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    } else {
                        WebResourceResponse(
                            AttachmentPolicy.attachmentMime(att.path),
                            null,
                            200,
                            "OK",
                            mapOf("Cache-Control" to "public, max-age=31536000, immutable"),
                            ByteArrayInputStream(att.bytes)
                        )
                    }
                }
                .build()

            val handler = Handler(Looper.getMainLooper())
            val bridge = EditorJsBridge(
                mainHandler = handler,
                onReadyCallback = {
                    controller.markReady()
                    webReady = true
                },
                onContentChangedCallback = { text, u, r -> latestContentCb(text, u, r) },
                onSelectionChangedCallback = { hasSel, len -> latestSelectionCb(hasSel, len) },
                onFormatErrorCallback = { msg -> latestFormatErrCb(msg) },
                onMissingImageCallback = { src -> latestMissingImgCb(src) },
                onWebImagePasteCallback = { mime, b64 -> latestPasteCb(mime, b64) }
            )

            WebView(context).apply {
                layoutParams = android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(bgArgb)
                isVerticalScrollBarEnabled = true
                isHorizontalScrollBarEnabled = false
                overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = false
                    allowFileAccess = false
                    allowContentAccess = false
                    builtInZoomControls = false
                    displayZoomControls = false
                    cacheMode = WebSettings.LOAD_NO_CACHE
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                }
                addJavascriptInterface(bridge, "AndroidBridge")
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest
                    ): WebResourceResponse? {
                        val uri = request.url
                        if (uri.host == WebViewAssetLoader.DEFAULT_DOMAIN) {
                            return assetLoader.shouldInterceptRequest(uri)
                        }
                        // Allow external https images if note explicitly links one, block arbitrary schemes
                        if (uri.scheme == "https" || uri.scheme == "http") {
                            return super.shouldInterceptRequest(view, request)
                        }
                        return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    }

                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        // Never navigate away from the editor surface on link clicks
                        val url = request.url ?: Uri.EMPTY
                        return url.host != WebViewAssetLoader.DEFAULT_DOMAIN
                    }
                }
                controller.webView = this
                loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/editor/index.html")
            }
        },
        update = { wv ->
            wv.setBackgroundColor(bgArgb)
        }
    )
}
