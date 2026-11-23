package com.cbantoine.dashcam.recording

import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.Typeface
import androidx.camera.effects.Frame
import kotlin.math.min

/**
 * Burns the date, speed and position into every frame, like a hardware dashcam. Runs on the
 * overlay effect's GL thread. The overlay texture persists between frames, so it is only redrawn
 * when the text or geometry changes (about once per second).
 */
class OverlayRenderer {
    data class Content(val lines: List<String>) {
        companion object {
            val EMPTY = Content(emptyList())
        }
    }

    private data class Geometry(val width: Int, val height: Int, val crop: Rect, val rotation: Int)

    /** Text to draw; written from the main thread. */
    @Volatile
    var content: Content = Content.EMPTY

    /** Clockwise rotation that makes the sensor image upright for the current outputs. */
    @Volatile
    var outputRotationDegrees: Int = 0

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(220, 0, 0, 0)
        typeface = fill.typeface
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
    }
    private val matrix = Matrix()
    private val values = FloatArray(9)
    private var drawnContent: Content? = null
    private var drawnGeometry: Geometry? = null

    @Volatile
    private var forceRedraw = true

    /** Forces a redraw on the next frame, e.g. after the camera was rebound. */
    fun invalidate() {
        forceRedraw = true
    }

    fun onDraw(frame: Frame): Boolean {
        val content = content
        frame.sensorToBufferTransform.getValues(values)
        val bufferRotation = OverlayGeometry.rotationOf(values)
        val rotation = OverlayGeometry.normalize(outputRotationDegrees - bufferRotation)
        val geometry = Geometry(frame.size.width, frame.size.height, Rect(frame.cropRect), rotation)
        if (!forceRedraw && content == drawnContent && geometry == drawnGeometry) return true
        forceRedraw = false

        val canvas = frame.overlayCanvas
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        if (content.lines.isNotEmpty()) {
            val crop = geometry.crop
            val (uprightW, uprightH) = OverlayGeometry.uprightSize(crop.width(), crop.height(), rotation)
            val box = OverlayGeometry.safeBox(uprightW, uprightH)
            val textSize = min(box.width, box.height) * TEXT_SCALE
            fill.textSize = textSize
            stroke.textSize = textSize
            stroke.strokeWidth = textSize * 0.18f

            matrix.setValues(OverlayGeometry.uprightToBuffer(crop.left, crop.top, crop.width(), crop.height(), rotation))
            canvas.setMatrix(matrix)
            val margin = textSize * 0.9f
            val lineHeight = textSize * 1.3f
            var baseline = box.bottom - margin
            for (line in content.lines.asReversed()) {
                val x = box.left + margin
                canvas.drawText(line, x, baseline, stroke)
                canvas.drawText(line, x, baseline, fill)
                baseline -= lineHeight
            }
        }
        drawnContent = content
        drawnGeometry = geometry
        return true
    }

    private companion object {
        const val TEXT_SCALE = 0.036f
    }
}
