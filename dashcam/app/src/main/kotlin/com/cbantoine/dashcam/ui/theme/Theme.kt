package com.cbantoine.dashcam.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** A dark, high-contrast scheme: readable at a glance in a car, day or night. */
private val DashcamColors = darkColorScheme(
    primary = Color(0xFFFFC53D),
    onPrimary = Color(0xFF261A00),
    primaryContainer = Color(0xFF3D2E00),
    onPrimaryContainer = Color(0xFFFFE08A),
    inversePrimary = Color(0xFF7A5900),
    secondary = Color(0xFF8FD3FF),
    onSecondary = Color(0xFF00344D),
    secondaryContainer = Color(0xFF13384D),
    onSecondaryContainer = Color(0xFFC9E8FF),
    tertiary = Color(0xFF4ADE80),
    onTertiary = Color(0xFF003916),
    tertiaryContainer = Color(0xFF0F3D22),
    onTertiaryContainer = Color(0xFFB8F5CC),
    error = Color(0xFFFF5449),
    onError = Color(0xFF410002),
    errorContainer = Color(0xFF5C1512),
    onErrorContainer = Color(0xFFFFDAD5),
    background = Color(0xFF0A0C10),
    onBackground = Color(0xFFE6E8EC),
    surface = Color(0xFF0F1216),
    onSurface = Color(0xFFE6E8EC),
    surfaceVariant = Color(0xFF1E232B),
    onSurfaceVariant = Color(0xFFB6BDC8),
    surfaceTint = Color(0xFFFFC53D),
    inverseSurface = Color(0xFFE6E8EC),
    inverseOnSurface = Color(0xFF15181D),
    outline = Color(0xFF4A525E),
    outlineVariant = Color(0xFF2A3038),
    scrim = Color.Black,
    surfaceBright = Color(0xFF2A3038),
    surfaceDim = Color(0xFF0A0C10),
    surfaceContainerLowest = Color(0xFF07090C),
    surfaceContainerLow = Color(0xFF12151A),
    surfaceContainer = Color(0xFF161A20),
    surfaceContainerHigh = Color(0xFF1C2128),
    surfaceContainerHighest = Color(0xFF232932),
)

object DashcamPalette {
    val Rec = Color(0xFFFF453A)
    val Amber = Color(0xFFFFC53D)
    val Ok = Color(0xFF4ADE80)
    val Hud = Color(0x8C000000)
    val HudStrong = Color(0xD90B0D11)
    val HudOutline = Color(0x33FFFFFF)
}

private val Base = Typography()

private val DashcamTypography = Base.copy(
    displayLarge = Base.displayLarge.copy(fontWeight = FontWeight.SemiBold),
    headlineMedium = Base.headlineMedium.copy(fontWeight = FontWeight.SemiBold),
    titleLarge = Base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
)

/** Numbers that don't jitter as they change (timer, speed). */
val HudNumbers = TextStyle(
    fontFamily = FontFamily.Default,
    fontWeight = FontWeight.Bold,
    fontFeatureSettings = "tnum",
    fontSize = 15.sp,
    letterSpacing = 0.5.sp,
)

@Composable
fun DashcamTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DashcamColors, typography = DashcamTypography, content = content)
}
