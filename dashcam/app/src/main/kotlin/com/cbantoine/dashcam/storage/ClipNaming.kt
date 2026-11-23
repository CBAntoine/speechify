package com.cbantoine.dashcam.storage

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Clip files are named after the local time their recording started:
 * `DASH_20261123_140322.mp4`, with `_1`, `_2`… if two start within the same second and an `_I`
 * suffix when the clip contains a detected impact. The telemetry sidecar shares the base name.
 */
object ClipNaming {
    private const val PREFIX = "DASH_"
    private const val IMPACT_SUFFIX = "_I"
    const val VIDEO_EXTENSION = ".mp4"
    const val SIDECAR_EXTENSION = ".json"

    private val formatter = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")
    private val pattern = Regex("""^DASH_(\d{8}_\d{6})(?:_(\d{1,3}))?(_I)?\.mp4$""")

    data class Parsed(val startedAtMs: Long, val sequence: Int, val impact: Boolean, val baseName: String)

    fun segmentName(startedAtMs: Long, sequence: Int = 0, zone: ZoneId = ZoneId.systemDefault()): String {
        val stamp = LocalDateTime.ofInstant(Instant.ofEpochMilli(startedAtMs), zone).format(formatter)
        val seq = if (sequence > 0) "_$sequence" else ""
        return "$PREFIX$stamp$seq$VIDEO_EXTENSION"
    }

    fun parse(fileName: String, zone: ZoneId = ZoneId.systemDefault()): Parsed? {
        val match = pattern.matchEntire(fileName) ?: return null
        val (stamp, seq, impact) = match.destructured
        val startedAt = runCatching {
            LocalDateTime.parse(stamp, formatter).atZone(zone).toInstant().toEpochMilli()
        }.getOrNull() ?: return null
        val sequence = seq.toIntOrNull() ?: 0
        val base = PREFIX + stamp + (if (sequence > 0) "_$sequence" else "")
        return Parsed(startedAt, sequence, impact.isNotEmpty(), base)
    }

    /** Base name without the impact flag or extension; stable while a clip moves between folders. */
    fun baseName(fileName: String): String =
        fileName.removeSuffix(VIDEO_EXTENSION).removeSuffix(IMPACT_SUFFIX)

    fun videoName(baseName: String, impact: Boolean): String =
        baseName + (if (impact) IMPACT_SUFFIX else "") + VIDEO_EXTENSION

    fun sidecarName(videoFileName: String): String = baseName(videoFileName) + SIDECAR_EXTENSION
}
