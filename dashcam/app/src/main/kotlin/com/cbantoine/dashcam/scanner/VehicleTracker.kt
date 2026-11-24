package com.cbantoine.dashcam.scanner

import kotlin.math.max

/** A vehicle followed across frames. Only [VehicleTracker] changes it. */
class TrackedVehicle internal constructor(val id: Int, box: NormBox, kind: VehicleKind, nowMs: Long) {
    var box: NormBox = box
        private set
    var lastSeenMs: Long = nowMs
        private set
    val firstSeenMs: Long = nowMs
    var hits: Int = 1
        private set

    /** Seen in enough frames to be a real vehicle rather than a one-off false positive. */
    var confirmed: Boolean = false
        private set

    private val kindVotes = IntArray(VehicleKind.entries.size).also { it[kind.ordinal]++ }

    /** The class the detector reported most often: a van can flicker between car and truck. */
    val kind: VehicleKind
        get() = VehicleKind.entries[kindVotes.indices.maxBy { kindVotes[it] }]

    internal fun observe(detection: Detection, nowMs: Long, smoothing: Float, confirmHits: Int) {
        box = box.lerp(detection.box, smoothing)
        kindVotes[detection.kind.ordinal]++
        lastSeenMs = nowMs
        hits++
        if (hits >= confirmHits) confirmed = true
    }
}

/**
 * Follows vehicles from one detection pass to the next by matching boxes (greedy, by overlap), so
 * each car keeps an ID while plate reads and colour samples accumulate on it.
 */
class VehicleTracker(
    private val matchIou: Float = 0.2f,
    private val confirmHits: Int = 2,
    private val maxAgeMs: Long = 1_500,
    private val tentativeMaxAgeMs: Long = 500,
    private val smoothing: Float = 0.6f,
    private val maxTracks: Int = 24,
) {
    private var nextId = 1
    private val tracks = mutableListOf<TrackedVehicle>()

    val active: List<TrackedVehicle> get() = tracks

    /** Updates the tracks with one pass of detections and returns the tracks that were dropped. */
    fun update(detections: List<Detection>, nowMs: Long): List<TrackedVehicle> {
        val pairs = buildList {
            tracks.forEachIndexed { t, track ->
                detections.forEachIndexed { d, detection ->
                    val score = matchScore(track.box, detection.box)
                    if (score > 0f) add(Triple(t, d, score))
                }
            }
        }.sortedByDescending { it.third }

        val trackUsed = BooleanArray(tracks.size)
        val detectionUsed = BooleanArray(detections.size)
        for ((t, d, _) in pairs) {
            if (trackUsed[t] || detectionUsed[d]) continue
            trackUsed[t] = true
            detectionUsed[d] = true
            tracks[t].observe(detections[d], nowMs, smoothing, confirmHits)
        }
        detections.forEachIndexed { d, detection ->
            if (!detectionUsed[d] && tracks.size < maxTracks) {
                tracks += TrackedVehicle(nextId++, detection.box, detection.kind, nowMs)
            }
        }

        val dropped = tracks.filter { track ->
            val age = nowMs - track.lastSeenMs
            age > maxAgeMs || (!track.confirmed && age > tentativeMaxAgeMs)
        }
        tracks.removeAll(dropped)
        return dropped
    }

    fun clear(): List<TrackedVehicle> {
        val dropped = tracks.toList()
        tracks.clear()
        return dropped
    }

    private fun matchScore(previous: NormBox, next: NormBox): Float {
        val iou = previous.iou(next)
        if (iou >= matchIou) return iou
        // A car moving fast across the frame barely overlaps its last box at a few passes per
        // second. Accept a box of similar size up to one box away, ranked below any real
        // overlap so a neighbouring car's own detection still wins.
        val dx = previous.centerX - next.centerX
        val dy = previous.centerY - next.centerY
        val reach = max(previous.width, previous.height)
        val sizeRatio = if (previous.area > 0f) next.area / previous.area else 0f
        return if (dx * dx + dy * dy < reach * reach && sizeRatio in 0.6f..1.7f) 0.01f else 0f
    }
}
