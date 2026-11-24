package com.cbantoine.dashcam.scanner

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** A box in normalized coordinates of the upright camera frame: 0..1 on both axes. */
data class NormBox(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
    val area: Float get() = max(0f, width) * max(0f, height)
    val centerX: Float get() = (left + right) / 2f
    val centerY: Float get() = (top + bottom) / 2f

    fun intersection(other: NormBox): Float {
        val w = min(right, other.right) - max(left, other.left)
        val h = min(bottom, other.bottom) - max(top, other.top)
        return if (w <= 0f || h <= 0f) 0f else w * h
    }

    fun iou(other: NormBox): Float {
        val inter = intersection(other)
        val union = area + other.area - inter
        return if (union <= 0f) 0f else inter / union
    }

    /** Intersection over the smaller box: 1 when one box contains the other. */
    fun overlapOfSmaller(other: NormBox): Float {
        val smaller = min(area, other.area)
        return if (smaller <= 0f) 0f else intersection(other) / smaller
    }

    /** Overlap of the two boxes' vertical extents, relative to the shorter one. */
    fun verticalOverlap(other: NormBox): Float {
        val overlap = min(bottom, other.bottom) - max(top, other.top)
        val shorter = min(height, other.height)
        return if (overlap <= 0f || shorter <= 0f) 0f else overlap / shorter
    }

    fun union(other: NormBox) = NormBox(
        min(left, other.left),
        min(top, other.top),
        max(right, other.right),
        max(bottom, other.bottom),
    )

    fun lerp(to: NormBox, t: Float) = NormBox(
        left + (to.left - left) * t,
        top + (to.top - top) * t,
        right + (to.right - right) * t,
        bottom + (to.bottom - bottom) * t,
    )

    fun clamped() = NormBox(
        left.coerceIn(0f, 1f),
        top.coerceIn(0f, 1f),
        right.coerceIn(0f, 1f),
        bottom.coerceIn(0f, 1f),
    )

    /** Grows the box by a fraction of its size on each side (negative values shrink it). */
    fun expanded(horizontal: Float, vertical: Float) = NormBox(
        left - width * horizontal,
        top - height * vertical,
        right + width * horizontal,
        bottom + height * vertical,
    ).clamped()

    /** The part of this box between two fractions of its height, e.g. 0.3..1 for the lower 70%. */
    fun verticalSlice(from: Float, to: Float) = NormBox(left, top + height * from, right, top + height * to)

    /** [inner] (in this frame's coordinates) relative to this box: 0..1 spans this box. */
    fun relative(inner: NormBox): NormBox {
        if (width <= 0f || height <= 0f) return NormBox(0f, 0f, 0f, 0f)
        return NormBox(
            (inner.left - left) / width,
            (inner.top - top) / height,
            (inner.right - left) / width,
            (inner.bottom - top) / height,
        )
    }

    /** The inverse of [relative]: maps a box given relative to this one back to frame coordinates. */
    fun absolute(relative: NormBox) = NormBox(
        left + relative.left * width,
        top + relative.top * height,
        left + relative.right * width,
        top + relative.bottom * height,
    )
}

/** A region of the upright frame in pixels. */
data class Tile(val left: Float, val top: Float, val width: Float, val height: Float) {
    /** Maps a box normalized to this tile back to coordinates normalized to the whole frame. */
    fun toFrame(box: NormBox, frameWidth: Float, frameHeight: Float) = NormBox(
        (left + box.left * width) / frameWidth,
        (top + box.top * height) / frameHeight,
        (left + box.right * width) / frameWidth,
        (top + box.bottom * height) / frameHeight,
    )
}

object DetectionTiles {
    /**
     * Square tiles that cover a wide (or tall) frame. The detector's input is a small square, so
     * squeezing a 16:9 frame into it would both distort cars and lose resolution; two
     * overlapping squares avoid both. A frame that is nearly square gets a single tile.
     */
    fun forFrame(width: Int, height: Int): List<Tile> {
        val w = width.toFloat()
        val h = height.toFloat()
        val long = max(w, h)
        val short = min(w, h)
        if (short <= 0f || long / short < 1.25f) return listOf(Tile(0f, 0f, w, h))
        val count = ceil(long / short).toInt()
        val step = (long - short) / (count - 1)
        return List(count) { i ->
            if (w >= h) Tile(i * step, 0f, short, short) else Tile(0f, i * step, short, short)
        }
    }
}

enum class VehicleKind {
    CAR, MOTORCYCLE, BUS, TRUCK;

    companion object {
        /** Class indices in the COCO label map of the bundled EfficientDet-Lite0 model. */
        fun fromCocoIndex(index: Int): VehicleKind? = when (index) {
            2 -> CAR
            3 -> MOTORCYCLE
            5 -> BUS
            7 -> TRUCK
            else -> null
        }
    }
}

/** One detector hit, normalized to the whole upright frame. [tile] is the tile it came from. */
data class Detection(val box: NormBox, val kind: VehicleKind, val score: Float, val tile: Int = 0)

object DetectionMerge {
    /**
     * Combines detections from overlapping tiles. The detector already removes duplicates within
     * a tile, but a car straddling the seam shows up in both tiles, often cut off in one of
     * them, and the same vehicle can come back as both "car" and "truck".
     */
    fun merge(detections: List<Detection>): List<Detection> {
        val merged = mutableListOf<Detection>()
        for (d in detections.sortedByDescending { it.score }) {
            val index = merged.indexOfFirst { kept -> isSameVehicle(kept, d) }
            if (index < 0) {
                merged += d
            } else {
                val kept = merged[index]
                // Across a seam each tile sees part of the car: the union is the whole car.
                val box = if (kept.tile != d.tile) kept.box.union(d.box) else kept.box
                merged[index] = kept.copy(box = box)
            }
        }
        return merged
    }

    private fun isSameVehicle(a: Detection, b: Detection): Boolean {
        val iou = a.box.iou(b.box)
        if (iou > 0.6f) return true
        if (a.tile == b.tile) return false
        return (iou > 0.3f || a.box.overlapOfSmaller(b.box) > 0.6f) && a.box.verticalOverlap(b.box) > 0.6f
    }
}
