package com.cbantoine.dashcam.telemetry

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Per-clip telemetry stored next to the video as a JSON sidecar. Times are ms from clip start. */
@Serializable
data class TelemetryTrack(
    val version: Int = 1,
    val startedAtMs: Long,
    val durationMs: Long,
    val samples: List<TelemetrySample> = emptyList(),
    val events: List<TelemetryEvent> = emptyList(),
    val peakG: Float = 0f,
) {
    /** The latest sample at or before [positionMs], if it is less than five seconds old. */
    fun sampleAt(positionMs: Long): TelemetrySample? {
        if (samples.isEmpty()) return null
        var low = 0
        var high = samples.lastIndex
        var best = -1
        while (low <= high) {
            val mid = (low + high) ushr 1
            if (samples[mid].t <= positionMs) {
                best = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        val sample = samples.getOrNull(best) ?: return null
        return sample.takeIf { positionMs - it.t <= 5_000 }
    }

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
    }
}

@Serializable
data class TelemetrySample(
    val t: Long,
    val lat: Double,
    val lon: Double,
    val speed: Float? = null,
    val bearing: Float? = null,
    val accuracy: Float? = null,
)

@Serializable
enum class EventType { IMPACT, MANUAL }

@Serializable
data class TelemetryEvent(val t: Long, val type: EventType, val g: Float? = null)

/** Accumulates telemetry for the clip being recorded. Main thread only. */
class SegmentTelemetry {
    private var startedAtMs = 0L
    private val samples = ArrayList<TelemetrySample>(300)
    private val events = ArrayList<TelemetryEvent>()
    private var peakG = 0f
    private var lastSampleAt = Long.MIN_VALUE

    val isStarted: Boolean get() = startedAtMs > 0

    fun begin(startedAtMs: Long) {
        this.startedAtMs = startedAtMs
    }

    fun addFix(fix: GpsFix, nowMs: Long) {
        if (!isStarted || fix.timeMs == lastSampleAt) return
        lastSampleAt = fix.timeMs
        samples += TelemetrySample(
            t = (nowMs - startedAtMs).coerceAtLeast(0),
            lat = fix.latitude,
            lon = fix.longitude,
            speed = fix.speedMps,
            bearing = fix.bearingDeg,
            accuracy = fix.accuracyM,
        )
    }

    fun addEvent(nowMs: Long, type: EventType, g: Float?) {
        val t = if (isStarted) (nowMs - startedAtMs).coerceAtLeast(0) else 0
        events += TelemetryEvent(t, type, g)
    }

    fun observeG(g: Float) {
        if (g > peakG) peakG = g
    }

    fun build(endedAtMs: Long): TelemetryTrack? {
        if (!isStarted) return null
        return TelemetryTrack(
            startedAtMs = startedAtMs,
            durationMs = (endedAtMs - startedAtMs).coerceAtLeast(0),
            samples = samples.toList(),
            events = events.toList(),
            peakG = peakG,
        )
    }
}
