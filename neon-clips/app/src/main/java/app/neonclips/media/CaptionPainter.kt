package app.neonclips.media

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import app.neonclips.R
import app.neonclips.core.CaptionStyle
import app.neonclips.core.Captions

/**
 * Draws hook titles and captions. The editor preview and the exporter both draw through this
 * class, so what you see while editing is what lands in the file.
 */
class CaptionPainter(context: Context) {
    private val anton: Typeface = ResourcesCompat.getFont(context, R.font.anton) ?: Typeface.DEFAULT_BOLD

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply { typeface = anton }
    private val stroke = Paint(fill).apply {
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        color = 0xFF0B0510.toInt()
    }

    private class Line(val words: List<Int>, val width: Float)

    /** Draws [frame] on a canvas of [w]x[h] pixels (the 9:16 output, at any scale). */
    fun draw(canvas: Canvas, w: Int, h: Int, frame: Captions.Frame, style: CaptionStyle) {
        if (frame.words.isEmpty()) return
        var size = w * style.size * (if (frame.isHook) 1.12f else 1f)
        val maxWidth = w * 0.86f
        var lines: List<Line>
        var space: Float
        // Shrink until every word fits on a line and the block is at most three lines.
        while (true) {
            fill.textSize = size
            space = fill.measureText(" ") * 1.15f
            val widths = frame.words.map { fill.measureText(it) }
            lines = wrap(widths, space, maxWidth)
            if ((lines.size <= 3 && widths.max() <= maxWidth) || size < w * 0.04f) break
            size *= 0.92f
        }
        stroke.textSize = size
        stroke.strokeWidth = size * 0.16f

        val lineHeight = size * 1.12f
        val centreY = h * (if (frame.isHook) 0.2f else style.position)
        val metrics = fill.fontMetrics
        var baseline = centreY - lines.size * lineHeight / 2f + (lineHeight - (metrics.descent + metrics.ascent)) / 2f

        for (line in lines) {
            var x = (w - line.width) / 2f
            for (i in line.words) {
                val word = frame.words[i]
                fill.color = when {
                    frame.isHook -> HOT
                    i == frame.active -> HOT
                    else -> WHITE
                }
                canvas.drawText(word, x, baseline, stroke)
                canvas.drawText(word, x, baseline, fill)
                x += fill.measureText(word) + space
            }
            baseline += lineHeight
        }
    }

    private fun wrap(widths: List<Float>, space: Float, maxWidth: Float): List<Line> {
        val lines = ArrayList<Line>()
        var current = ArrayList<Int>()
        var width = 0f
        for ((i, ww) in widths.withIndex()) {
            val next = if (current.isEmpty()) ww else width + space + ww
            if (current.isNotEmpty() && next > maxWidth) {
                lines += Line(current, width)
                current = arrayListOf(i)
                width = ww
            } else {
                current += i
                width = next
            }
        }
        if (current.isNotEmpty()) lines += Line(current, width)
        return lines
    }

    companion object {
        const val HOT = 0xFFFF3D8B.toInt()
        const val WHITE = 0xFFFFFFFF.toInt()
    }
}
