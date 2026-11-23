package com.cbantoine.dashcam.recording

import kotlin.math.atan2
import kotlin.math.roundToInt

/**
 * Coordinate math for drawing upright text onto camera buffers. The overlay canvas is in buffer
 * coordinates (usually sensor orientation) and CameraX rotates the buffer clockwise by the
 * output's rotation afterwards, so text must be drawn pre-rotated. Kept free of Android types
 * so it can be unit tested.
 */
object OverlayGeometry {
    data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float) {
        val width: Float get() = right - left
        val height: Float get() = bottom - top
    }

    fun normalize(degrees: Int): Int = ((degrees % 360) + 360) % 360

    /** Rotation (0/90/180/270, clockwise) encoded in a 3x3 matrix in android.graphics.Matrix order. */
    fun rotationOf(matrixValues: FloatArray): Int {
        val degrees = Math.toDegrees(atan2(matrixValues[3].toDouble(), matrixValues[0].toDouble()))
        return normalize((degrees / 90.0).roundToInt() * 90)
    }

    /** Size of the cropped buffer once rotated upright. */
    fun uprightSize(cropWidth: Int, cropHeight: Int, rotation: Int): Pair<Int, Int> =
        if (normalize(rotation) % 180 == 0) cropWidth to cropHeight else cropHeight to cropWidth

    /**
     * Matrix (android.graphics.Matrix value order) mapping upright output coordinates to buffer
     * coordinates, for a crop rect at [left],[top] of [width]x[height] rotated clockwise by [rotation].
     */
    fun uprightToBuffer(left: Int, top: Int, width: Int, height: Int, rotation: Int): FloatArray {
        val l = left.toFloat()
        val t = top.toFloat()
        val w = width.toFloat()
        val h = height.toFloat()
        return when (normalize(rotation)) {
            90 -> floatArrayOf(0f, 1f, l, -1f, 0f, h + t, 0f, 0f, 1f)
            180 -> floatArrayOf(-1f, 0f, w + l, 0f, -1f, h + t, 0f, 0f, 1f)
            270 -> floatArrayOf(0f, -1f, w + l, 1f, 0f, t, 0f, 0f, 1f)
            else -> floatArrayOf(1f, 0f, l, 0f, 1f, t, 0f, 0f, 1f)
        }
    }

    /** Applies [matrixValues] to a point; handy for tests. */
    fun map(matrixValues: FloatArray, x: Float, y: Float): Pair<Float, Float> = Pair(
        matrixValues[0] * x + matrixValues[1] * y + matrixValues[2],
        matrixValues[3] * x + matrixValues[4] * y + matrixValues[5],
    )

    /**
     * Largest centered 16:9 (or 9:16 when portrait) box inside the upright frame. Preview and video
     * are both 16:9 crops, so text inside this box is visible in every output.
     */
    fun safeBox(uprightWidth: Int, uprightHeight: Int): Box {
        val w = uprightWidth.toFloat()
        val h = uprightHeight.toFloat()
        val aspect = if (w >= h) 16f / 9f else 9f / 16f
        val (boxW, boxH) = if (w / h > aspect) h * aspect to h else w to w / aspect
        val left = (w - boxW) / 2f
        val top = (h - boxH) / 2f
        return Box(left, top, left + boxW, top + boxH)
    }
}
