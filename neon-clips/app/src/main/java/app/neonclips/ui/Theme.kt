package app.neonclips.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.neonclips.R

object Neon {
    val Ink = Color(0xFF0E0714)
    val Panel = Color(0xFF160C1F)
    val PanelHi = Color(0xFF22132E)
    val Line = Color(0xFF3A2547)
    val Hot = Color(0xFFFF3D8B)
    val Mint = Color(0xFF5EEAD4)
    val Peach = Color(0xFFFFB27D)
    val Lilac = Color(0xFFC4A1FF)
    val Lime = Color(0xFFD4F38A)
    val Text = Color(0xFFF5EFF9)
    val Dim = Color(0xFFA897B5)
    val Faint = Color(0xFF6F5F7C)

    val Display = FontFamily(Font(R.font.anton))
    val Mono = FontFamily(Font(R.font.jbmono_regular, FontWeight.Normal), Font(R.font.jbmono_bold, FontWeight.Bold))

    val Shape = RoundedCornerShape(6.dp)
}

@Composable
fun NeonTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Neon.Hot,
            onPrimary = Neon.Ink,
            secondary = Neon.Mint,
            onSecondary = Neon.Ink,
            background = Neon.Ink,
            onBackground = Neon.Text,
            surface = Neon.Panel,
            onSurface = Neon.Text,
            surfaceVariant = Neon.PanelHi,
            onSurfaceVariant = Neon.Dim,
            outline = Neon.Line,
            error = Color(0xFFFF6B6B),
        ),
        content = content,
    )
}

/** Small monospaced caps: section names, readouts, units. */
@Composable
fun Label(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Neon.Dim,
    size: TextUnit = 10.sp,
    bold: Boolean = false,
    maxLines: Int = 1,
) {
    Text(
        text.uppercase(),
        modifier,
        color = color,
        fontFamily = Neon.Mono,
        fontSize = size,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        letterSpacing = 0.8.sp,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The condensed display face: titles and anything that should shout. */
@Composable
fun Shout(
    text: String,
    modifier: Modifier = Modifier,
    size: TextUnit = 28.sp,
    color: Color = Neon.Text,
    maxLines: Int = 2,
) {
    Text(
        text.uppercase(),
        modifier,
        color = color,
        fontFamily = Neon.Display,
        fontSize = size,
        lineHeight = size * 1.08f,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun Body(text: String, modifier: Modifier = Modifier, color: Color = Neon.Dim, size: TextUnit = 13.sp, maxLines: Int = Int.MAX_VALUE) {
    Text(text, modifier, color = color, fontSize = size, lineHeight = size * 1.4f, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

@Composable
fun Panel(
    title: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    trailingColor: Color = Neon.Hot,
    padding: Dp = 10.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .clip(Neon.Shape)
            .background(Neon.Panel)
            .border(1.dp, Neon.Line, Neon.Shape)
            .padding(padding)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Label(title, Modifier.weight(1f), color = Neon.Text)
            if (trailing != null) Label(trailing, color = trailingColor, size = 9.sp)
        }
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
fun HotButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = Neon.Hot,
) {
    Box(
        modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(Neon.Shape)
            .background(if (enabled) color else Neon.PanelHi)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Label(text, color = if (enabled) Neon.Ink else Neon.Faint, size = 12.sp, bold = true)
    }
}

@Composable
fun LineButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = Neon.Text,
) {
    Box(
        modifier
            .defaultMinSize(minHeight = 40.dp)
            .clip(Neon.Shape)
            .border(1.dp, if (enabled) color.copy(alpha = 0.55f) else Neon.Line, Neon.Shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Label(text, color = if (enabled) color else Neon.Faint, size = 11.sp, bold = true)
    }
}

@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Neon.Mint) {
    Box(
        modifier
            .defaultMinSize(minHeight = 34.dp)
            .clip(Neon.Shape)
            .background(if (selected) color.copy(alpha = 0.16f) else Color.Transparent)
            .border(BorderStroke(1.dp, if (selected) color else Neon.Line), Neon.Shape)
            .clickable(role = Role.Tab, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Label(text, color = if (selected) color else Neon.Dim, size = 10.sp, bold = selected)
    }
}

/** A filled name tag, like the ones that mark tools on an editing diagram. */
@Composable
fun Tag(text: String, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(RoundedCornerShape(3.dp))
            .background(color)
            .padding(horizontal = 5.dp, vertical = 2.dp)
    ) {
        Label(text, color = Neon.Ink, size = 9.sp, bold = true)
    }
}

@Composable
fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    display: Boolean = false,
    secret: VisualTransformation = VisualTransformation.None,
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
    capitalize: Boolean = false,
) {
    val style = if (display) {
        TextStyle(color = Neon.Text, fontFamily = Neon.Display, fontSize = 20.sp)
    } else {
        TextStyle(color = Neon.Text, fontSize = 14.sp)
    }
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .defaultMinSize(minHeight = 44.dp)
            .clip(Neon.Shape)
            .background(Neon.Ink)
            .border(1.dp, Neon.Line, Neon.Shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        textStyle = style,
        singleLine = true,
        cursorBrush = SolidColor(Neon.Hot),
        visualTransformation = secret,
        keyboardOptions = KeyboardOptions(
            imeAction = imeAction,
            capitalization = if (capitalize) KeyboardCapitalization.Characters else KeyboardCapitalization.None,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone() }, onSearch = { onDone() }, onGo = { onDone() }),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, style = style.copy(color = Neon.Faint), maxLines = 1)
                inner()
            }
        },
    )
}

@Composable
fun ProgressLine(progress: Float?, modifier: Modifier = Modifier, color: Color = Neon.Hot) {
    Box(
        modifier
            .fillMaxWidth()
            .height(3.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(Neon.Line)
    ) {
        Box(
            Modifier
                .fillMaxWidth((progress ?: 1f).coerceIn(0f, 1f))
                .height(3.dp)
                .alpha(if (progress == null) 0.35f else 1f)
                .background(color)
        )
    }
}

enum class Glyph { Play, Pause, Back, Close, Search, Plus, Trash, Gear, Share, Upload, Link }

/** Line icons drawn on a 24-unit grid, so the app needs no icon library. */
@Composable
fun Icon(glyph: Glyph, modifier: Modifier = Modifier, color: Color = Neon.Text, size: Dp = 22.dp) {
    Canvas(modifier.size(size)) {
        val u = this.size.minDimension / 24f
        val stroke = Stroke(width = 2f * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun p(x: Float, y: Float) = Offset(x * u, y * u)
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) =
            drawLine(color, p(x1, y1), p(x2, y2), strokeWidth = 2f * u, cap = StrokeCap.Round)
        when (glyph) {
            Glyph.Play -> drawPath(Path().apply { moveTo(8 * u, 5 * u); lineTo(19 * u, 12 * u); lineTo(8 * u, 19 * u); close() }, color)
            Glyph.Pause -> {
                drawRect(color, p(7f, 5f), Size(3.5f * u, 14 * u))
                drawRect(color, p(13.5f, 5f), Size(3.5f * u, 14 * u))
            }
            Glyph.Back -> { line(20f, 12f, 5f, 12f); line(5f, 12f, 11f, 6f); line(5f, 12f, 11f, 18f) }
            Glyph.Close -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            Glyph.Search -> { drawCircle(color, 6f * u, p(10.5f, 10.5f), style = stroke); line(15f, 15f, 20f, 20f) }
            Glyph.Plus -> { line(12f, 5f, 12f, 19f); line(5f, 12f, 19f, 12f) }
            Glyph.Trash -> {
                line(5f, 7f, 19f, 7f); line(10f, 4f, 14f, 4f)
                drawPath(Path().apply { moveTo(7 * u, 7 * u); lineTo(8 * u, 20 * u); lineTo(16 * u, 20 * u); lineTo(17 * u, 7 * u) }, color, style = stroke)
            }
            Glyph.Gear -> {
                drawCircle(color, 3.2f * u, p(12f, 12f), style = stroke)
                for (i in 0 until 8) {
                    val a = Math.toRadians(i * 45.0)
                    val c = kotlin.math.cos(a).toFloat()
                    val s = kotlin.math.sin(a).toFloat()
                    line(12 + 6.2f * c, 12 + 6.2f * s, 12 + 8.6f * c, 12 + 8.6f * s)
                }
            }
            Glyph.Share -> {
                drawCircle(color, 2.4f * u, p(17f, 6f), style = stroke)
                drawCircle(color, 2.4f * u, p(7f, 12f), style = stroke)
                drawCircle(color, 2.4f * u, p(17f, 18f), style = stroke)
                line(9.2f, 10.8f, 14.8f, 7.2f); line(9.2f, 13.2f, 14.8f, 16.8f)
            }
            Glyph.Upload -> { line(12f, 16f, 12f, 4f); line(12f, 4f, 7f, 9f); line(12f, 4f, 17f, 9f); line(5f, 20f, 19f, 20f) }
            Glyph.Link -> {
                drawPath(Path().apply { moveTo(10 * u, 14 * u); lineTo(14 * u, 10 * u) }, color, style = stroke)
                drawPath(Path().apply { moveTo(11 * u, 7 * u); lineTo(13 * u, 5 * u); cubicTo(16 * u, 2 * u, 22 * u, 8 * u, 19 * u, 11 * u); lineTo(17 * u, 13 * u) }, color, style = stroke)
                drawPath(Path().apply { moveTo(13 * u, 17 * u); lineTo(11 * u, 19 * u); cubicTo(8 * u, 22 * u, 2 * u, 16 * u, 5 * u, 13 * u); lineTo(7 * u, 11 * u) }, color, style = stroke)
            }
        }
    }
}

@Composable
fun IconButton(glyph: Glyph, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Neon.Text) {
    Box(
        modifier
            .size(44.dp)
            .clip(Neon.Shape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph, color = color)
    }
}

/** Screen header: back, a small section code, and the screen name. */
@Composable
fun TopBar(code: String, title: String, onBack: (() -> Unit)?, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (onBack != null) IconButton(Glyph.Back, "Back", onBack) else Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Label(code, color = Neon.Hot, size = 9.sp)
            Shout(title, size = 22.sp, maxLines = 1)
        }
        trailing()
    }
}

val ScreenPadding = PaddingValues(horizontal = 14.dp)
