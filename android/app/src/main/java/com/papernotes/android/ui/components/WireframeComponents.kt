package com.papernotes.android.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.papernotes.android.ui.theme.LocalPaperColors
import com.papernotes.android.ui.theme.LocalReducedMotion

/**
 * Hard-edged black offset shadow modifier giving the crisp architectural / hand-drawn
 * depth signature of PaperNotes without blurry elevation halos.
 */
fun Modifier.paperHardShadow(
    offsetX: Dp = 3.dp,
    offsetY: Dp = 3.dp,
    cornerRadius: Dp = 8.dp,
    color: Color
): Modifier = this.drawBehind {
    if (offsetX > 0.dp || offsetY > 0.dp) {
        drawRoundRect(
            color = color,
            topLeft = Offset(offsetX.toPx(), offsetY.toPx()),
            size = size,
            cornerRadius = CornerRadius(cornerRadius.toPx(), cornerRadius.toPx())
        )
    }
}

fun Modifier.paperDashedBorder(
    color: Color,
    strokeWidth: Dp = 1.8.dp,
    cornerRadius: Dp = 8.dp,
    dashLength: Dp = 7.dp,
    gapLength: Dp = 5.dp
): Modifier = this.drawBehind {
    drawRoundRect(
        color = color,
        style = Stroke(
            width = strokeWidth.toPx(),
            pathEffect = PathEffect.dashPathEffect(
                floatArrayOf(dashLength.toPx(), gapLength.toPx()),
                0f
            )
        ),
        cornerRadius = CornerRadius(cornerRadius.toPx(), cornerRadius.toPx())
    )
}

@Composable
fun PaperCard(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 10.dp,
    borderWidth: Dp = 1.8.dp,
    shadowOffset: Dp = 3.dp,
    backgroundColor: Color = LocalPaperColors.current.surface,
    borderColor: Color = LocalPaperColors.current.line,
    onClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit
) {
    val colors = LocalPaperColors.current
    val reducedMotion = LocalReducedMotion.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()

    val currentShadow by animateDpAsState(
        targetValue = if (pressed && onClick != null) 1.dp else shadowOffset,
        animationSpec = if (reducedMotion) snap() else spring(stiffness = 600f),
        label = "cardShadow"
    )
    val pressShift by animateDpAsState(
        targetValue = if (pressed && onClick != null && !reducedMotion) (shadowOffset - 1.dp).coerceAtLeast(0.dp) else 0.dp,
        animationSpec = if (reducedMotion) snap() else spring(stiffness = 600f),
        label = "cardShift"
    )

    val shape = RoundedCornerShape(cornerRadius)
    Box(
        modifier = modifier
            .padding(end = shadowOffset, bottom = shadowOffset)
            .offset(x = pressShift, y = pressShift)
            .paperHardShadow(
                offsetX = currentShadow,
                offsetY = currentShadow,
                cornerRadius = cornerRadius,
                color = colors.depthEdge
            )
            .clip(shape)
            .background(backgroundColor)
            .border(BorderStroke(borderWidth, borderColor), shape)
            .then(
                if (onClick != null) {
                    Modifier.clickable(
                        interactionSource = interactionSource,
                        indication = null,
                        onClick = onClick
                    )
                } else Modifier
            ),
        content = content
    )
}

@Composable
fun PaperButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    enabled: Boolean = true,
    danger: Boolean = false,
    shadowOffset: Dp = 2.dp,
    contentPadding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 9.dp),
    content: @Composable RowScope.() -> Unit
) {
    val colors = LocalPaperColors.current
    val reducedMotion = LocalReducedMotion.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()

    val bg = when {
        !enabled -> colors.softSurface
        danger && primary -> colors.error
        primary -> colors.primaryBg
        else -> colors.surface
    }
    val fg = when {
        !enabled -> colors.muted
        danger && primary -> Color.White
        danger -> colors.error
        primary -> colors.primaryInk
        else -> colors.ink
    }
    val borderColor = when {
        !enabled -> colors.subtleLine
        danger -> colors.error
        primary -> colors.primaryBg
        else -> colors.line
    }

    val effectiveShadow = if (enabled) {
        if (pressed) 0.dp else shadowOffset
    } else 0.dp

    val shift by animateDpAsState(
        targetValue = if (pressed && enabled && !reducedMotion) shadowOffset else 0.dp,
        animationSpec = if (reducedMotion) snap() else spring(stiffness = 700f),
        label = "btnShift"
    )

    val shape = RoundedCornerShape(8.dp)
    Box(
        modifier = modifier
            .padding(end = shadowOffset, bottom = shadowOffset)
            .offset(x = shift, y = shift)
            .paperHardShadow(
                offsetX = effectiveShadow,
                offsetY = effectiveShadow,
                cornerRadius = 8.dp,
                color = if (danger) colors.error else colors.depthEdge
            )
            .clip(shape)
            .background(bg)
            .border(1.5.dp, borderColor, shape)
            .clickable(
                enabled = enabled,
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            )
            .defaultMinSize(minHeight = 38.dp)
            .padding(contentPadding),
        contentAlignment = Alignment.Center
    ) {
        Surface(color = Color.Transparent, contentColor = fg) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                content = content
            )
        }
    }
}

@Composable
fun PaperBadge(
    text: String,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    accent: Boolean = false
) {
    val colors = LocalPaperColors.current
    val bg = when {
        filled -> colors.primaryBg
        accent -> colors.softSurface
        else -> colors.surface
    }
    val fg = when {
        filled -> colors.primaryInk
        accent -> colors.spineBrown
        else -> colors.ink
    }
    val border = if (filled) colors.primaryBg else colors.line
    Box(
        modifier = modifier
            .border(1.2.dp, border, RoundedCornerShape(3.dp))
            .background(bg, RoundedCornerShape(3.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = text,
            color = fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = TextStyle(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
                letterSpacing = 0.5.sp
            )
        )
    }
}
