package com.papernotes.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.papernotes.android.ui.theme.LocalPaperColors

/**
 * Exact vector rendering of the PaperNotes ("纸间") icon matching desktop/make-icon.ps1:
 * rounded paper frame, crisp ink outline, hard offset shadow, and centered brown spine.
 */
@Composable
fun PaperBrandIcon(
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
    spineProgress: Float = 1f,
    shadowProgress: Float = 1f
) {
    val colors = LocalPaperColors.current
    Canvas(modifier = modifier.size(size)) {
        val scale = this.size.minDimension / 256f
        fun s(v: Float) = v * scale

        val ink: Color = if (colors.isDark) colors.line else colors.ink
        val shadowColor: Color = colors.depthEdge
        val faceColor: Color = colors.surface
        val spineFill: Color = colors.spineBrown

        // Hard offset shadow
        val shadowOffset = 16f * shadowProgress
        drawRoundRect(
            color = shadowColor,
            topLeft = Offset(s(16f + shadowOffset), s(16f + shadowOffset)),
            size = Size(s(200f), s(200f)),
            cornerRadius = CornerRadius(s(44f), s(44f))
        )

        // Outer border
        drawRoundRect(
            color = ink,
            topLeft = Offset(s(16f), s(16f)),
            size = Size(s(200f), s(200f)),
            cornerRadius = CornerRadius(s(44f), s(44f))
        )

        // Inner paper square
        drawRoundRect(
            color = faceColor,
            topLeft = Offset(s(31f), s(31f)),
            size = Size(s(170f), s(170f)),
            cornerRadius = CornerRadius(s(29f), s(29f))
        )

        // Centered book spine (grows upward cleanly during startup animation)
        val clamped = spineProgress.coerceIn(0f, 1f)
        if (clamped > 0.01f) {
            val fullH = 106f
            val h = fullH * clamped
            val topY = 63f + (fullH - h)
            drawRect(
                color = ink,
                topLeft = Offset(s(94f), s(topY)),
                size = Size(s(44f), s(h))
            )
            if (h > 16f) {
                drawRect(
                    color = spineFill,
                    topLeft = Offset(s(101f), s(topY + 7f)),
                    size = Size(s(30f), s((h - 14f).coerceAtLeast(0f)))
                )
            }
        }
    }
}
