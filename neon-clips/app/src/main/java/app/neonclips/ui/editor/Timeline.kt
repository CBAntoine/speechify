package app.neonclips.ui.editor

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.neonclips.core.Fmt
import app.neonclips.core.HOOK_MS
import app.neonclips.core.ReframeMode
import app.neonclips.core.Reframing
import app.neonclips.ui.Neon
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

private enum class Grab { START, END, SCRUB }

/**
 * The sequence: thumbnails with trim handles, then caption, reframe and audio lanes. Drag a
 * pink handle to trim; drag anywhere else to scrub.
 */
@Composable
fun Timeline(c: EditorController, modifier: Modifier = Modifier) {
    val clip = c.clip ?: return
    val measurer = rememberTextMeasurer()
    val images = remember(c.thumbs) { c.thumbs.map { it.asImageBitmap() } }
    val waveform = remember(c.windowStart, c.windowEnd, c.envelope) {
        c.envelope?.peaks(c.windowStart, c.windowEnd, 160) ?: FloatArray(0)
    }
    val labelStyle = remember { TextStyle(color = Neon.Faint, fontFamily = Neon.Mono, fontSize = 8.sp) }

    Canvas(
        modifier
            .fillMaxSize()
            .pointerInput(clip.id) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    val now = c.clip ?: return@awaitEachGesture
                    val span = (c.windowEnd - c.windowStart).coerceAtLeast(1)
                    fun timeAt(x: Float) = c.windowStart + (x / size.width * span).toLong()
                    fun xAt(t: Long) = (t - c.windowStart).toFloat() / span * size.width
                    val reach = 22.dp.toPx()
                    val toStart = abs(down.position.x - xAt(now.startMs))
                    val toEnd = abs(down.position.x - xAt(now.endMs))
                    val grab = when {
                        toStart <= reach && toStart <= toEnd -> Grab.START
                        toEnd <= reach -> Grab.END
                        else -> Grab.SCRUB
                    }
                    c.beginScrub()
                    if (grab == Grab.SCRUB) c.seek(timeAt(down.position.x))
                    var x = down.position.x
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) break
                        x += change.positionChange().x
                        change.consume()
                        val t = timeAt(x.coerceIn(0f, size.width.toFloat()))
                        val cur = c.clip ?: break
                        when (grab) {
                            Grab.START -> { c.setRange(t, cur.endMs); c.seek(c.clip!!.startMs) }
                            Grab.END -> { c.setRange(cur.startMs, t); c.seek(c.clip!!.endMs - 60) }
                            Grab.SCRUB -> c.seek(t)
                        }
                    }
                    c.endScrub()
                    if (grab != Grab.SCRUB) {
                        c.rangeSettled(movedStart = grab == Grab.START)
                        c.seek(c.clip?.startMs ?: 0)
                    }
                }
            }
    ) {
        val now = c.clip ?: return@Canvas
        val w = size.width
        val span = (c.windowEnd - c.windowStart).coerceAtLeast(1).toFloat()
        fun x(t: Long) = (t - c.windowStart) / span * w

        val ruler = 14.dp.toPx()
        val gap = 4.dp.toPx()
        val thumbsH = size.height * 0.36f
        val laneH = (size.height - ruler - thumbsH - gap * 4) / 3f
        val thumbsTop = ruler
        val capTop = thumbsTop + thumbsH + gap
        val camTop = capTop + laneH + gap
        val audioTop = camTop + laneH + gap
        val startX = x(now.startMs)
        val endX = x(now.endMs)

        // Ruler: a tick each second, a label every few.
        val seconds = span / 1000f
        val step = when {
            seconds <= 12 -> 1
            seconds <= 40 -> 5
            seconds <= 100 -> 10
            else -> 30
        }
        var s = (c.windowStart / 1000 / step) * step
        while (s * 1000 <= c.windowEnd) {
            val tx = x(s * 1000)
            if (tx >= 0) {
                drawLine(Neon.Line, Offset(tx, ruler - 4.dp.toPx()), Offset(tx, ruler), 1.dp.toPx())
                drawLabel(measurer, Fmt.clock(s * 1000), labelStyle, Offset(tx + 2.dp.toPx(), 0f))
            }
            s += step
        }

        // Source lane: thumbnails.
        if (images.isNotEmpty()) {
            val slot = w / images.size
            clipRect(0f, thumbsTop, w, thumbsTop + thumbsH) {
                images.forEachIndexed { i, img ->
                    val scale = max(slot / img.width, thumbsH / img.height)
                    val dw = (img.width * scale).toInt()
                    val dh = (img.height * scale).toInt()
                    clipRect(i * slot, thumbsTop, (i + 1) * slot, thumbsTop + thumbsH) {
                        drawImage(
                            img,
                            dstOffset = IntOffset((i * slot + (slot - dw) / 2).toInt(), (thumbsTop + (thumbsH - dh) / 2).toInt()),
                            dstSize = IntSize(dw, dh),
                        )
                    }
                }
            }
        } else {
            drawRect(Neon.PanelHi, Offset(0f, thumbsTop), Size(w, thumbsH))
        }
        // Everything outside the clip is dimmed.
        val shade = Color(0xB80E0714)
        drawRect(shade, Offset(0f, thumbsTop), Size(startX.coerceAtLeast(0f), thumbsH))
        drawRect(shade, Offset(endX, thumbsTop), Size((w - endX).coerceAtLeast(0f), thumbsH))
        drawRect(Neon.Hot, Offset(startX, thumbsTop), Size(endX - startX, thumbsH), style = Stroke(2.dp.toPx()))
        val handleW = 7.dp.toPx()
        for (hx in listOf(startX - handleW / 2, endX - handleW / 2)) {
            drawRoundRect(Neon.Hot, Offset(hx, thumbsTop - 2.dp.toPx()), Size(handleW, thumbsH + 4.dp.toPx()), CornerRadius(2.dp.toPx()))
            drawLine(Neon.Ink, Offset(hx + handleW / 2, thumbsTop + thumbsH * 0.35f), Offset(hx + handleW / 2, thumbsTop + thumbsH * 0.65f), 1.5.dp.toPx())
        }

        // Captions lane: the hook, then each caption.
        lane(capTop, laneH)
        val radius = CornerRadius(2.dp.toPx())
        if (now.hook.isNotBlank()) {
            drawRoundRect(Neon.Hot.copy(alpha = 0.85f), Offset(startX, capTop + 2), Size(x(now.startMs + HOOK_MS) - startX, laneH - 4), radius)
        }
        if (now.captionsOn) {
            for (cap in now.captions) {
                val a = x(cap.startMs)
                val z = x(cap.endMs)
                drawRoundRect(Neon.Peach.copy(alpha = 0.9f), Offset(a, capTop + 2), Size((z - a - 1).coerceAtLeast(1f), laneH - 4), radius)
            }
        }
        drawLabel(measurer, "CAPTIONS", labelStyle, Offset(3.dp.toPx(), capTop + 1))

        // Reframe lane: where the crop centre sits, left to right, with its keyframes.
        lane(camTop, laneH)
        val r = now.reframe
        val path = Path()
        val n = 48
        for (i in 0..n) {
            val t = now.startMs + (now.endMs - now.startMs) * i / n
            val shot = Reframing.shotAt(r, c.project.width, c.project.height, t)
            val px = x(t)
            val py = camTop + 3 + (laneH - 6) * shot.cx
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        drawPath(path, Neon.Lilac, style = Stroke(1.5.dp.toPx()))
        if (r.mode != ReframeMode.CENTER) {
            for (k in r.keys) {
                if (k.tMs < now.startMs || k.tMs > now.endMs) continue
                drawCircle(Neon.Lilac, 2.5.dp.toPx(), Offset(x(k.tMs), camTop + 3 + (laneH - 6) * Reframing.clampCenter(k.cx, Reframing.window(c.project.width, c.project.height, r.zoom).w)))
            }
        }
        drawLabel(measurer, "REFRAME", labelStyle, Offset(3.dp.toPx(), camTop + 1))

        // Audio lane: loudness, scaled by the clip's gain inside the clip.
        lane(audioTop, laneH)
        if (waveform.isNotEmpty()) {
            val bar = w / waveform.size
            val gain = 10f.pow(now.gainDb / 20f)
            for (i in waveform.indices) {
                val bx = i * bar
                val inside = bx >= startX && bx <= endX
                val amp = (waveform[i] * (if (inside) gain else 1f) * 2.2f).coerceIn(0.02f, 1f)
                val bh = amp * (laneH - 2)
                drawRect(
                    if (inside) Neon.Mint else Neon.Mint.copy(alpha = 0.3f),
                    Offset(bx, audioTop + (laneH - bh) / 2),
                    Size(max(1f, bar - 1f), bh),
                )
            }
        }
        drawLabel(measurer, "AUDIO", labelStyle, Offset(3.dp.toPx(), audioTop + 1))

        // Playhead.
        val px = x(c.positionMs.longValue)
        if (px in 0f..w) {
            drawLine(Neon.Text, Offset(px, ruler - 2.dp.toPx()), Offset(px, size.height), 1.5.dp.toPx())
            val tip = 5.dp.toPx()
            drawPath(Path().apply { moveTo(px - tip, ruler - tip - 2); lineTo(px + tip, ruler - tip - 2); lineTo(px, ruler); close() }, Neon.Hot)
        }
    }
}

private fun DrawScope.lane(top: Float, height: Float) {
    drawRoundRect(Neon.Panel, Offset(0f, top), Size(size.width, height), CornerRadius(2.dp.toPx()))
    drawRoundRect(Neon.Line, Offset(0f, top), Size(size.width, height), CornerRadius(2.dp.toPx()), style = Stroke(1f))
}

private fun DrawScope.drawLabel(measurer: TextMeasurer, text: String, style: TextStyle, at: Offset) {
    val layout = measurer.measure(text, style, maxLines = 1)
    if (at.x + layout.size.width > size.width || at.y + layout.size.height > size.height) return
    drawText(layout, topLeft = at)
}

/**
 * The whole source in one strip: loudness, where the clips are, and the playhead. Tap or drag
 * to jump anywhere in the video.
 */
@Composable
fun Overview(c: EditorController, modifier: Modifier = Modifier) {
    val duration = c.project.durationMs.coerceAtLeast(1)
    val peaks = remember(c.envelope) { c.envelope?.peaks(0, duration, 200) ?: FloatArray(0) }
    Canvas(
        modifier.pointerInput(c.project.id) {
            awaitEachGesture {
                val down = awaitFirstDown()
                c.beginScrub()
                c.seek((down.position.x / size.width * duration).toLong())
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                    if (!change.pressed) break
                    change.consume()
                    c.seek((change.position.x.coerceIn(0f, size.width.toFloat()) / size.width * duration).toLong())
                }
                c.endScrub()
            }
        }
    ) {
        val w = size.width
        val h = size.height
        fun x(t: Long) = t.toFloat() / duration * w
        drawRoundRect(Neon.Panel, size = size, cornerRadius = CornerRadius(3.dp.toPx()))
        if (peaks.isNotEmpty()) {
            val bar = w / peaks.size
            for (i in peaks.indices) {
                val bh = (peaks[i] * 2.2f).coerceIn(0.03f, 1f) * (h - 4)
                drawRect(Neon.Faint, Offset(i * bar, (h - bh) / 2), Size(max(1f, bar - 1f), bh))
            }
        }
        for (clip in c.project.clips) {
            val selected = clip.id == c.clipId
            val a = x(clip.startMs)
            val z = max(a + 3f, x(clip.endMs))
            drawRect((if (selected) Neon.Hot else Neon.Mint).copy(alpha = if (selected) 0.45f else 0.25f), Offset(a, 0f), Size(z - a, h))
            drawRect(if (selected) Neon.Hot else Neon.Mint, Offset(a, 0f), Size(z - a, h), style = Stroke(1.dp.toPx()))
        }
        val px = min(w, x(c.positionMs.longValue))
        drawLine(Neon.Text, Offset(px, 0f), Offset(px, h), 1.5.dp.toPx())
    }
}
