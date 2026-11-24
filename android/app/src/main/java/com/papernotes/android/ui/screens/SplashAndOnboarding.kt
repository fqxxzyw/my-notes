package com.papernotes.android.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.papernotes.android.ui.components.PaperBadge
import com.papernotes.android.ui.components.PaperBrandIcon
import com.papernotes.android.ui.components.PaperButton
import com.papernotes.android.ui.components.PaperCard
import com.papernotes.android.ui.theme.LocalPaperColors
import com.papernotes.android.ui.theme.LocalReducedMotion
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SplashScreen(onFinished: () -> Unit) {
    val colors = LocalPaperColors.current
    val reducedMotion = LocalReducedMotion.current

    val iconScale = remember { Animatable(if (reducedMotion) 1f else 0.78f) }
    val shadowProg = remember { Animatable(if (reducedMotion) 1f else 0f) }
    val spineProg = remember { Animatable(if (reducedMotion) 1f else 0f) }
    val textAlpha = remember { Animatable(if (reducedMotion) 1f else 0f) }
    val exitAlpha = remember { Animatable(1f) }

    LaunchedEffect(reducedMotion) {
        if (reducedMotion) {
            delay(320)
            onFinished()
            return@LaunchedEffect
        }
        launch {
            iconScale.animateTo(
                1f,
                animationSpec = spring(dampingRatio = 0.58f, stiffness = Spring.StiffnessMediumLow)
            )
        }
        launch {
            delay(80)
            shadowProg.animateTo(1f, tween(280, easing = FastOutSlowInEasing))
        }
        launch {
            delay(160)
            spineProg.animateTo(1f, spring(dampingRatio = 0.65f, stiffness = Spring.StiffnessLow))
        }
        delay(320)
        textAlpha.animateTo(1f, tween(320, easing = FastOutSlowInEasing))
        delay(380)
        exitAlpha.animateTo(0f, tween(200))
        onFinished()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .alpha(exitAlpha.value),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            PaperBrandIcon(
                size = 86.dp,
                spineProgress = spineProg.value,
                shadowProgress = shadowProg.value,
                modifier = Modifier.graphicsLayer {
                    scaleX = iconScale.value
                    scaleY = iconScale.value
                }
            )
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.alpha(textAlpha.value)
            ) {
                Text(
                    text = "纸间",
                    color = colors.ink,
                    style = TextStyle(
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = 28.sp,
                        letterSpacing = 6.sp
                    )
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "PAPER NOTES · ARCHIVE",
                    color = colors.muted,
                    style = TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.sp,
                        letterSpacing = 2.sp
                    )
                )
            }
        }
    }
}

private data class OnboardingPage(
    val kicker: String,
    val title: String,
    val body: String,
    val tip: String
)

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val colors = LocalPaperColors.current
    val scope = rememberCoroutineScope()
    val pages = remember {
        listOf(
            OnboardingPage(
                kicker = "STEP 01 · BOOKCASE",
                title = "书柜、笔记本与独立书页",
                body = "用「书柜」分类知识，把成体系的笔记收进「笔记本 → 章节」，单篇灵感则以轻薄的「独立书页」直接摆上书架。",
                tip = "已为你预备默认书柜与可编辑、可删除的「使用说明与教程」。"
            ),
            OnboardingPage(
                kicker = "STEP 02 · MARKDOWN",
                title = "所见即写与源码高亮",
                body = "支持标题、粗斜体、任务清单、表格、代码块与图片。选中文字后在键盘上方提供简洁图标条，并完整保留系统剪切/复制/粘贴菜单。",
                tip = "自动保存本机草稿，随时查看章节与折叠目录。"
            ),
            OnboardingPage(
                kicker = "STEP 03 · SYNC & RESTORE",
                title = "离线优先，按需 GitHub 同步",
                body = "无需登录即可离线写作。连接自己的 GitHub 仓库后，「同步」提交你勾选的本机改动，「恢复」下载仓库作为离线副本并保留草稿。",
                tip = "令牌经 Android Keystore 加密，笔记与图片按仓库严格隔离。"
            )
        )
    }

    val pagerState = rememberPagerState(pageCount = { pages.size })

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Top header with brand + Skip
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                PaperBrandIcon(size = 28.dp)
                Text(
                    text = "纸间",
                    color = colors.ink,
                    style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                )
            }
            TextButton(onClick = onDone) {
                Text("跳过引导", color = colors.muted, fontWeight = FontWeight.SemiBold)
            }
        }

        // Pager
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) { index ->
            val page = pages[index]
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                PaperCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(168.dp),
                    shadowOffset = 4.dp
                ) {
                    OnboardingIllustration(index = index, modifier = Modifier.fillMaxSize())
                }
                Spacer(Modifier.height(20.dp))
                PaperBadge(text = page.kicker)
                Spacer(Modifier.height(10.dp))
                Text(
                    text = page.title,
                    color = colors.ink,
                    textAlign = TextAlign.Center,
                    style = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = page.body,
                    color = colors.muted,
                    textAlign = TextAlign.Center,
                    style = TextStyle(fontSize = 14.sp, lineHeight = 22.sp)
                )
                Spacer(Modifier.height(14.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.2.dp, colors.subtleLine, RoundedCornerShape(6.dp))
                        .background(colors.softSurface, RoundedCornerShape(6.dp))
                        .padding(horizontal = 12.dp, vertical = 9.dp)
                ) {
                    Text(
                        text = page.tip,
                        color = colors.ink,
                        style = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }

        // Indicators + CTA
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(pages.size) { i ->
                    val selected = pagerState.currentPage == i
                    Box(
                        modifier = Modifier
                            .height(8.dp)
                            .width(if (selected) 24.dp else 8.dp)
                            .clip(CircleShape)
                            .background(if (selected) colors.ink else colors.subtleLine)
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (pagerState.currentPage > 0) {
                    PaperButton(
                        onClick = {
                            scope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) }
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("上一步", fontWeight = FontWeight.SemiBold)
                    }
                }
                val isLast = pagerState.currentPage == pages.lastIndex
                PaperButton(
                    onClick = {
                        if (isLast) onDone()
                        else scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                    },
                    primary = true,
                    modifier = Modifier.weight(1.4f)
                ) {
                    Text(
                        text = if (isLast) "开始离线写作 →" else "下一步 →",
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}

@Composable
private fun OnboardingIllustration(index: Int, modifier: Modifier = Modifier) {
    val colors = LocalPaperColors.current
    Canvas(modifier = modifier.padding(20.dp)) {
        val w = size.width
        val h = size.height
        val stroke = Stroke(width = 3.5f)
        val thin = Stroke(width = 2f)
        when (index) {
            0 -> {
                // Wireframe bookcase with 3 notebooks + 1 thin dog-ear page
                val plankY = h * 0.82f
                drawLine(colors.line, Offset(w * 0.1f, plankY), Offset(w * 0.9f, plankY), strokeWidth = 4f)
                drawLine(colors.line, Offset(w * 0.1f, plankY + 12f), Offset(w * 0.9f, plankY + 12f), strokeWidth = 2.5f)
                val bookW = w * 0.13f
                val bookH = h * 0.62f
                val startX = w * 0.18f
                for (i in 0..2) {
                    val x = startX + i * (bookW + 10f)
                    drawRect(colors.bookFace, Offset(x, plankY - bookH), Size(bookW, bookH))
                    drawRect(colors.line, Offset(x, plankY - bookH), Size(bookW, bookH), style = stroke)
                    // Spine accent line
                    drawRect(colors.spineBrown, Offset(x + bookW * 0.36f, plankY - bookH * 0.72f), Size(bookW * 0.28f, bookH * 0.44f))
                }
                // Thin folio page on the right
                val pageX = startX + 3 * (bookW + 10f) + 6f
                val pageW = bookW * 0.55f
                drawRect(colors.softSurface, Offset(pageX, plankY - bookH), Size(pageW, bookH))
                drawRect(colors.line, Offset(pageX, plankY - bookH), Size(pageW, bookH), style = stroke)
                val slant = Path().apply {
                    moveTo(pageX + pageW, plankY - bookH)
                    lineTo(pageX + pageW + 46f, plankY - bookH - 14f)
                    lineTo(pageX + pageW + 58f, plankY - bookH - 2f)
                    lineTo(pageX + pageW + 58f, plankY - 12f)
                    lineTo(pageX + pageW, plankY)
                    close()
                }
                drawPath(slant, colors.bookFace)
                drawPath(slant, colors.line, style = thin)
            }
            1 -> {
                // Crisp Markdown paper sheet with heading, ruled lines, and code card
                val sheetLeft = w * 0.16f
                val sheetW = w * 0.68f
                drawRect(colors.depthEdge, Offset(sheetLeft + 6f, h * 0.12f + 6f), Size(sheetW, h * 0.76f))
                drawRect(colors.surface, Offset(sheetLeft, h * 0.12f), Size(sheetW, h * 0.76f))
                drawRect(colors.line, Offset(sheetLeft, h * 0.12f), Size(sheetW, h * 0.76f), style = stroke)
                drawRect(colors.spineBrown, Offset(sheetLeft + 18f, h * 0.24f), Size(sheetW * 0.46f, 10f))
                drawLine(colors.line, Offset(sheetLeft + 18f, h * 0.42f), Offset(sheetLeft + sheetW - 22f, h * 0.42f), 3f)
                drawLine(colors.muted, Offset(sheetLeft + 18f, h * 0.52f), Offset(sheetLeft + sheetW - 44f, h * 0.52f), 2.5f)
                drawRect(colors.softSurface, Offset(sheetLeft + 18f, h * 0.62f), Size(sheetW - 36f, h * 0.18f))
                drawRect(colors.line, Offset(sheetLeft + 18f, h * 0.62f), Size(sheetW - 36f, h * 0.18f), style = thin)
            }
            else -> {
                // Sync <-> Restore diagram between Device box and GitHub repo box
                val boxW = w * 0.28f
                val boxH = h * 0.52f
                val topY = h * 0.24f
                val leftX = w * 0.1f
                val rightX = w * 0.62f
                drawRect(colors.surface, Offset(leftX, topY), Size(boxW, boxH))
                drawRect(colors.line, Offset(leftX, topY), Size(boxW, boxH), style = stroke)
                drawRect(colors.softSurface, Offset(rightX, topY), Size(boxW, boxH))
                drawRect(colors.line, Offset(rightX, topY), Size(boxW, boxH), style = stroke)
                // Top arrow (Sync ->)
                val y1 = h * 0.42f
                drawLine(colors.spineBrown, Offset(leftX + boxW + 10f, y1), Offset(rightX - 10f, y1), 4f)
                drawLine(colors.spineBrown, Offset(rightX - 22f, y1 - 8f), Offset(rightX - 10f, y1), 4f)
                drawLine(colors.spineBrown, Offset(rightX - 22f, y1 + 8f), Offset(rightX - 10f, y1), 4f)
                // Bottom arrow (<- Restore)
                val y2 = h * 0.60f
                drawLine(colors.line, Offset(rightX - 10f, y2), Offset(leftX + boxW + 10f, y2), 4f)
                drawLine(colors.line, Offset(leftX + boxW + 22f, y2 - 8f), Offset(leftX + boxW + 10f, y2), 4f)
                drawLine(colors.line, Offset(leftX + boxW + 22f, y2 + 8f), Offset(leftX + boxW + 10f, y2), 4f)
            }
        }
    }
}
