package com.cbantoine.dashcam.scanner

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import androidx.camera.core.ImageProxy
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A camera frame and the transform that turns it upright. Valid until the next [FrameProcessor.load]. */
internal class Frame(
    val bitmap: Bitmap,
    val upright: Matrix,
    /** Size of the upright frame in pixels. */
    val width: Int,
    val height: Int,
    val temporary: Boolean,
) {
    fun toPixels(box: NormBox) = RectF(box.left * width, box.top * height, box.right * width, box.bottom * height)
}

/**
 * Bitmap work for the scanner. The camera frame is copied once and never rotated as a whole;
 * every crop is drawn through one matrix that rotates, crops and scales in a single step.
 * Confined to the scanner thread.
 */
internal class FrameProcessor {
    private var frameBitmap: Bitmap? = null
    private var detectorInput: Bitmap? = null
    private val colourSample = createBitmap(COLOUR_W, COLOUR_H)
    private val colourPixels = IntArray(COLOUR_W * COLOUR_H)
    private val filtered = Paint(Paint.FILTER_BITMAP_FLAG)
    private val matrix = Matrix()

    fun load(image: ImageProxy): Frame {
        val plane = image.planes[0]
        val bitmap: Bitmap
        val temporary: Boolean
        if (plane.pixelStride == 4 && plane.rowStride == image.width * 4) {
            // RGBA rows with no padding are already a bitmap's memory layout.
            bitmap = frameBitmap?.takeIf { it.width == image.width && it.height == image.height }
                ?: createBitmap(image.width, image.height).also { frameBitmap = it }
            plane.buffer.rewind()
            bitmap.copyPixelsFromBuffer(plane.buffer)
            temporary = false
        } else {
            bitmap = image.toBitmap()
            temporary = true
        }
        val crop = image.cropRect
        val rotation = image.imageInfo.rotationDegrees
        val upright = Matrix().apply {
            postTranslate(-crop.left.toFloat(), -crop.top.toFloat())
            postRotate(rotation.toFloat())
            when (rotation) {
                90 -> postTranslate(crop.height().toFloat(), 0f)
                180 -> postTranslate(crop.width().toFloat(), crop.height().toFloat())
                270 -> postTranslate(0f, crop.width().toFloat())
            }
        }
        val sideways = rotation == 90 || rotation == 270
        return Frame(
            bitmap = bitmap,
            upright = upright,
            width = if (sideways) crop.height() else crop.width(),
            height = if (sideways) crop.width() else crop.height(),
            temporary = temporary,
        )
    }

    fun release(frame: Frame) {
        if (frame.temporary) frame.bitmap.recycle()
    }

    /** [tile] of the upright frame, squeezed into the detector's square input. Reused each call. */
    fun detectorInput(frame: Frame, tile: Tile, size: Int): Bitmap {
        val target = detectorInput?.takeIf { it.width == size }
            ?: createBitmap(size, size).also { detectorInput = it }
        render(frame, RectF(tile.left, tile.top, tile.left + tile.width, tile.top + tile.height), target)
        return target
    }

    /**
     * A new upright bitmap of [box]. It is scaled down to at most [maxWidth] pixels wide, or up
     * towards [minWidth] (by no more than [maxUpscale]) so that small text is easier to read.
     */
    fun crop(frame: Frame, box: NormBox, maxWidth: Int, minWidth: Int = 0, maxUpscale: Float = 1f): Bitmap? {
        val region = frame.toPixels(box)
        if (region.width() < MIN_CROP_PX || region.height() < MIN_CROP_PX) return null
        var scale = min(1f, maxWidth / region.width())
        if (region.width() * scale < minWidth) scale = min(minWidth / region.width(), maxUpscale)
        val target = createBitmap(
            max(1, (region.width() * scale).roundToInt()),
            max(1, (region.height() * scale).roundToInt()),
        )
        render(frame, region, target)
        return target
    }

    /** A coarse grid of pixels from [box], for naming the colour. Reused each call. */
    fun colourPixels(frame: Frame, box: NormBox): IntArray {
        render(frame, frame.toPixels(box), colourSample)
        colourSample.getPixels(colourPixels, 0, COLOUR_W, 0, 0, COLOUR_W, COLOUR_H)
        return colourPixels
    }

    private fun render(frame: Frame, region: RectF, target: Bitmap) {
        matrix.set(frame.upright)
        matrix.postTranslate(-region.left, -region.top)
        matrix.postScale(target.width / region.width(), target.height / region.height())
        val canvas = Canvas(target)
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(frame.bitmap, matrix, filtered)
    }

    private companion object {
        const val COLOUR_W = 24
        const val COLOUR_H = 16
        const val MIN_CROP_PX = 16f
    }
}

/** Pixelates [box] (normalized to the bitmap) in place into blocks far too coarse to read. */
internal fun Bitmap.pixelate(box: NormBox, blocksAcross: Int = 5) {
    val rect = Rect(
        (box.left.coerceIn(0f, 1f) * width).roundToInt(),
        (box.top.coerceIn(0f, 1f) * height).roundToInt(),
        (box.right.coerceIn(0f, 1f) * width).roundToInt(),
        (box.bottom.coerceIn(0f, 1f) * height).roundToInt(),
    )
    if (rect.width() < 2 || rect.height() < 2) return
    val region = Bitmap.createBitmap(this, rect.left, rect.top, rect.width(), rect.height())
    val blocksDown = max(1, (blocksAcross * rect.height().toFloat() / rect.width()).roundToInt())
    val tiny = region.scale(blocksAcross, blocksDown)
    // Unfiltered upscaling keeps the blocks hard-edged.
    Canvas(this).drawBitmap(tiny, null, rect, Paint())
    // Either call may hand back its input instead of a copy.
    if (tiny !== region && tiny !== this) tiny.recycle()
    if (region !== this) region.recycle()
}

internal fun Bitmap.toJpeg(quality: Int = 85): ByteArray =
    ByteArrayOutputStream().use { out ->
        compress(Bitmap.CompressFormat.JPEG, quality, out)
        out.toByteArray()
    }
