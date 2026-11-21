package app.neonclips.ui.editor

import android.view.TextureView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.neonclips.Graph
import app.neonclips.core.Captions
import app.neonclips.core.OUT_ASPECT
import app.neonclips.core.ReframeMode
import app.neonclips.core.Reframing
import app.neonclips.media.CaptionPainter
import app.neonclips.ui.Chip
import app.neonclips.ui.Neon
import app.neonclips.ui.Tag
import kotlin.math.roundToInt

enum class ViewMode { OUTPUT, SOURCE }

/**
 * The monitor. "Output" shows the 9:16 short exactly as it will export, and dragging it moves
 * the crop. "Source" shows the whole frame with the crop box drawn on it.
 */
@Composable
fun Viewport(c: EditorController, modifier: Modifier = Modifier) {
    val clip = c.clip ?: return
    val project = c.project
    var mode by remember { mutableStateOf(ViewMode.OUTPUT) }
    val painter = remember { CaptionPainter(Graph.app) }
    val window = Reframing.window(project.width, project.height, clip.reframe.zoom)
    val srcAspect = project.width.toFloat() / project.height

    BoxWithConstraints(modifier.background(Color(0xFF08040C)), contentAlignment = Alignment.Center) {
        val density = LocalDensity.current
        val availW = constraints.maxWidth.toFloat()
        val availH = (constraints.maxHeight - with(density) { 12.dp.toPx() }).coerceAtLeast(1f)
        val aspect = if (mode == ViewMode.OUTPUT) OUT_ASPECT else srcAspect
        // The frame the video sits in: 9:16 for the output, the source's own shape otherwise.
        val boxH = minOf(availH, availW / aspect)
        val boxW = boxH * aspect
        // The video is laid out at the size that makes the crop window exactly fill the frame.
        val videoW = if (mode == ViewMode.OUTPUT) boxW / window.w else boxW
        val videoH = if (mode == ViewMode.OUTPUT) boxH / window.h else boxH
        val latest by rememberUpdatedState(Triple(mode, boxW, boxH))

        Box(
            Modifier
                .size(with(density) { boxW.toDp() }, with(density) { boxH.toDp() })
                .clip(RoundedCornerShape(4.dp))
                .clipToBounds()
                .background(Color.Black)
                .pointerInput(clip.id) {
                    detectTapGestures { at ->
                        val (m, w, h) = latest
                        // Output: tap to play or pause. Source: tap a person to follow them.
                        if (m == ViewMode.OUTPUT) c.togglePlay() else c.follow(at.x / w, at.y / h)
                    }
                }
                .pointerInput(clip.id) {
                    detectDragGestures { change, drag ->
                        change.consume()
                        val (m, w, h) = latest
                        val now = c.clip ?: return@detectDragGestures
                        val win = Reframing.window(c.project.width, c.project.height, now.reframe.zoom)
                        if (m == ViewMode.OUTPUT) {
                            // Dragging the picture right slides the window left across the source.
                            c.pan(-drag.x * win.w / w, -drag.y * win.h / h)
                        } else {
                            c.pan(drag.x / w, drag.y / h)
                        }
                    }
                }
        ) {
            AndroidView(
                factory = { ctx -> TextureView(ctx).also { c.player.setVideoTextureView(it) } },
                onRelease = { c.player.clearVideoTextureView(it) },
                modifier = Modifier
                    .layout { measurable, constraints ->
                        val placeable = measurable.measure(Constraints.fixed(videoW.roundToInt().coerceAtLeast(1), videoH.roundToInt().coerceAtLeast(1)))
                        layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, 0) }
                    }
                    .graphicsLayer {
                        if (mode == ViewMode.OUTPUT) {
                            val now = c.clip
                            if (now != null) {
                                val shot = Reframing.shotAt(now.reframe, c.project.width, c.project.height, c.positionMs.longValue)
                                translationX = -shot.left * videoW
                                translationY = -shot.top * videoH
                            }
                        }
                    },
            )

            if (mode == ViewMode.OUTPUT) {
                Canvas(Modifier.fillMaxSize()) {
                    val now = c.clip ?: return@Canvas
                    val frame = Captions.frameAt(now, c.positionMs.longValue) ?: return@Canvas
                    drawIntoCanvas { painter.draw(it.nativeCanvas, size.width.toInt(), size.height.toInt(), frame, now.style) }
                }
            } else {
                Canvas(Modifier.fillMaxSize()) {
                    val now = c.clip ?: return@Canvas
                    val shot = Reframing.shotAt(now.reframe, c.project.width, c.project.height, c.positionMs.longValue)
                    val left = shot.left * size.width
                    val top = shot.top * size.height
                    val w = shot.w * size.width
                    val h = shot.h * size.height
                    val dim = Color(0xB3000000)
                    drawRect(dim, Offset.Zero, Size(left, size.height))
                    drawRect(dim, Offset(left + w, 0f), Size(size.width - left - w, size.height))
                    drawRect(dim, Offset(left, 0f), Size(w, top))
                    drawRect(dim, Offset(left, top + h), Size(w, size.height - top - h))
                    val line = 2.dp.toPx()
                    drawRect(Neon.Mint, Offset(left, top), Size(w, h), style = Stroke(line))
                    val knob = 7.dp.toPx()
                    for (corner in listOf(Offset(left, top), Offset(left + w, top), Offset(left, top + h), Offset(left + w, top + h))) {
                        drawRoundRect(Neon.Mint, corner - Offset(knob / 2, knob / 2), Size(knob, knob), CornerRadius(1.dp.toPx()))
                    }
                    drawLine(Neon.Mint.copy(alpha = 0.35f), Offset(left + w / 2, top), Offset(left + w / 2, top + h), 1.dp.toPx())
                }
            }
        }

        Row(Modifier.align(Alignment.TopStart).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip("Output", mode == ViewMode.OUTPUT, { mode = ViewMode.OUTPUT }, Modifier.background(Color(0xCC08040C), Neon.Shape))
            Chip("Source", mode == ViewMode.SOURCE, { mode = ViewMode.SOURCE }, Modifier.background(Color(0xCC08040C), Neon.Shape))
        }

        Column(Modifier.align(Alignment.TopEnd).padding(8.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Tag("9:16 / " + if (mode == ViewMode.OUTPUT) "Output" else "Crop", Neon.Mint)
            val status = when {
                c.tracking != null -> "Tracking faces ${(c.tracking!! * 100).toInt()}%" to Neon.Lilac
                clip.reframe.mode == ReframeMode.AUTO && clip.reframe.keys.isNotEmpty() && clip.reframe.follow != null -> "Following your pick" to Neon.Lilac
                clip.reframe.mode == ReframeMode.AUTO && clip.reframe.keys.isNotEmpty() -> "Following face" to Neon.Lilac
                clip.reframe.mode == ReframeMode.AUTO -> "Auto / centred" to Neon.Lilac
                clip.reframe.mode == ReframeMode.MANUAL -> "Manual crop" to Neon.Peach
                else -> "Centred" to Neon.Dim
            }
            Tag(status.first, status.second)
            if (c.transcribing) Tag("Captioning", Neon.Peach)
        }
    }
}
