package com.papernotes.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

enum class ThemePreference(val key: String, val label: String, val subtitle: String) {
    DAY("day", "日间", "纯白纸面 · 经典线框"),
    NIGHT("night", "夜间", "炭墨纸面 · 柔和对比"),
    GREEN("green", "浅绿护眼", "柔和豆绿 · 长时间阅读"),
    YELLOW("yellow", "浅黄阅读", "暖色纸张 · 沉浸手记"),
    SYSTEM("system", "跟随系统", "自动切换日间与夜间");

    companion object {
        fun fromKey(key: String?): ThemePreference =
            entries.firstOrNull { it.key == key } ?: DAY
    }
}

enum class ResolvedTheme(val cssName: String) {
    DAY("day"),
    NIGHT("night"),
    GREEN("green"),
    YELLOW("yellow")
}

@Immutable
data class PaperColors(
    val resolved: ResolvedTheme,
    val isDark: Boolean,
    val background: Color,
    val surface: Color,
    val softSurface: Color,
    val bookFace: Color,
    val ink: Color,
    val muted: Color,
    val line: Color,
    val subtleLine: Color,
    val depthEdge: Color,
    val spineBrown: Color,
    val primaryBg: Color,
    val primaryInk: Color,
    val error: Color,
    val errorBg: Color,
    val success: Color,
    val successBg: Color,
    val warning: Color,
    val warningBg: Color,
    val imagePlaceholderBg: Color,
    val scrim: Color
)

val DayPaperColors = PaperColors(
    resolved = ResolvedTheme.DAY,
    isDark = false,
    background = Color(0xFFFFFFFF),
    surface = Color(0xFFFFFFFF),
    softSurface = Color(0xFFF3F3F1),
    bookFace = Color(0xFFFFFFFF),
    ink = Color(0xFF111111),
    muted = Color(0xFF555555),
    line = Color(0xFF111111),
    subtleLine = Color(0xFFD1D1D1),
    depthEdge = Color(0xFF111111),
    spineBrown = Color(0xFF6E4726),
    primaryBg = Color(0xFF111111),
    primaryInk = Color(0xFFFFFFFF),
    error = Color(0xFFA12626),
    errorBg = Color(0xFFFDF2F2),
    success = Color(0xFF1F6338),
    successBg = Color(0xFFEEF7F1),
    warning = Color(0xFF8A5300),
    warningBg = Color(0xFFFFF8E8),
    imagePlaceholderBg = Color(0xFFF5F5F3),
    scrim = Color(0x80000000)
)

val NightPaperColors = PaperColors(
    resolved = ResolvedTheme.NIGHT,
    isDark = true,
    background = Color(0xFF17191C),
    surface = Color(0xFF222427),
    softSurface = Color(0xFF343639),
    bookFace = Color(0xFF303136),
    ink = Color(0xFFEDE9E2),
    muted = Color(0xFFBCB6AD),
    line = Color(0xFF97938A),
    subtleLine = Color(0xFF52504B),
    depthEdge = Color(0xFF0D0E0F),
    spineBrown = Color(0xFFD5AD80),
    primaryBg = Color(0xFFD8D2C8),
    primaryInk = Color(0xFF17191C),
    error = Color(0xFFFFAAA5),
    errorBg = Color(0xFF332022),
    success = Color(0xFF9AD4AD),
    successBg = Color(0xFF1D2C22),
    warning = Color(0xFFF0C987),
    warningBg = Color(0xFF2E271A),
    imagePlaceholderBg = Color(0xFF292B2F),
    scrim = Color(0xAA000000)
)

val GreenPaperColors = PaperColors(
    resolved = ResolvedTheme.GREEN,
    isDark = false,
    background = Color(0xFFE9F3E7),
    surface = Color(0xFFF2F8EF),
    softSurface = Color(0xFFDFEDDD),
    bookFace = Color(0xFFF2F8EF),
    ink = Color(0xFF25392C),
    muted = Color(0xFF5D7261),
    line = Color(0xFF415D49),
    subtleLine = Color(0xFFADC2B0),
    depthEdge = Color(0xFF415D49),
    spineBrown = Color(0xFF795033),
    primaryBg = Color(0xFF25392C),
    primaryInk = Color(0xFFF2F8EF),
    error = Color(0xFF9C2E2E),
    errorBg = Color(0xFFF7EAEA),
    success = Color(0xFF255B38),
    successBg = Color(0xFFDAECD8),
    warning = Color(0xFF7F5108),
    warningBg = Color(0xFFF5EED6),
    imagePlaceholderBg = Color(0xFFDFEDDD),
    scrim = Color(0x80000000)
)

val YellowPaperColors = PaperColors(
    resolved = ResolvedTheme.YELLOW,
    isDark = false,
    background = Color(0xFFFBF5E0),
    surface = Color(0xFFFFF9E9),
    softSurface = Color(0xFFF1E8CC),
    bookFace = Color(0xFFFFF9E9),
    ink = Color(0xFF473C2A),
    muted = Color(0xFF786B55),
    line = Color(0xFF756548),
    subtleLine = Color(0xFFCBBFA3),
    depthEdge = Color(0xFF756548),
    spineBrown = Color(0xFF795033),
    primaryBg = Color(0xFF473C2A),
    primaryInk = Color(0xFFFFF9E9),
    error = Color(0xFF9D2C26),
    errorBg = Color(0xFFF8E7E1),
    success = Color(0xFF3A6433),
    successBg = Color(0xFFECEFD8),
    warning = Color(0xFF845100),
    warningBg = Color(0xFFF4E6C1),
    imagePlaceholderBg = Color(0xFFF1E8CC),
    scrim = Color(0x80000000)
)

fun resolvePaperColors(preference: ThemePreference, systemDark: Boolean): PaperColors =
    when (preference) {
        ThemePreference.DAY -> DayPaperColors
        ThemePreference.NIGHT -> NightPaperColors
        ThemePreference.GREEN -> GreenPaperColors
        ThemePreference.YELLOW -> YellowPaperColors
        ThemePreference.SYSTEM -> if (systemDark) NightPaperColors else DayPaperColors
    }

val LocalPaperColors = staticCompositionLocalOf { DayPaperColors }
val LocalReducedMotion = staticCompositionLocalOf { false }

val PaperTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 26.sp,
        lineHeight = 34.sp,
        letterSpacing = 0.5.sp
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 21.sp,
        lineHeight = 28.sp
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        lineHeight = 25.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 22.sp
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.6.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Bold,
        fontSize = 10.sp,
        lineHeight = 12.sp,
        letterSpacing = 0.5.sp
    )
)

@Composable
fun PaperNotesTheme(
    preference: ThemePreference,
    reducedMotion: Boolean = false,
    content: @Composable () -> Unit
) {
    val systemDark = isSystemInDarkTheme()
    val colors = resolvePaperColors(preference, systemDark)
    val materialScheme = if (colors.isDark) {
        darkColorScheme(
            primary = colors.primaryBg,
            onPrimary = colors.primaryInk,
            background = colors.background,
            onBackground = colors.ink,
            surface = colors.surface,
            onSurface = colors.ink,
            surfaceVariant = colors.softSurface,
            onSurfaceVariant = colors.muted,
            outline = colors.line,
            error = colors.error
        )
    } else {
        lightColorScheme(
            primary = colors.primaryBg,
            onPrimary = colors.primaryInk,
            background = colors.background,
            onBackground = colors.ink,
            surface = colors.surface,
            onSurface = colors.ink,
            surfaceVariant = colors.softSurface,
            onSurfaceVariant = colors.muted,
            outline = colors.line,
            error = colors.error
        )
    }

    CompositionLocalProvider(
        LocalPaperColors provides colors,
        LocalReducedMotion provides reducedMotion
    ) {
        MaterialTheme(
            colorScheme = materialScheme,
            typography = PaperTypography,
            content = content
        )
    }
}
