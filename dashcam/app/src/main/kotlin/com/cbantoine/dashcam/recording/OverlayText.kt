package com.cbantoine.dashcam.recording

import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.settings.SpeedUnit
import com.cbantoine.dashcam.telemetry.GpsFix
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

object SpeedFormat {
    private const val MPS_TO_KMH = 3.6f
    private const val MPS_TO_MPH = 2.236936f

    fun convert(speedMps: Float, unit: SpeedUnit): Int =
        (speedMps * if (unit == SpeedUnit.MPH) MPS_TO_MPH else MPS_TO_KMH).roundToInt().coerceAtLeast(0)

    /** Speed as a whole number, or null when unknown. Below walking pace reads as 0. */
    fun value(speedMps: Float?, unit: SpeedUnit): Int? = speedMps?.let { if (it < 0.5f) 0 else convert(it, unit) }

    fun unitLabel(unit: SpeedUnit): String = if (unit == SpeedUnit.MPH) "mph" else "km/h"
}

/** The text burned into each frame. Uses fixed, locale-independent formats like a hardware dashcam. */
object OverlayText {
    private val timeFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd  HH:mm:ss", Locale.US)

    fun build(nowMs: Long, fix: GpsFix?, settings: DashcamSettings, zone: ZoneId = ZoneId.systemDefault()): OverlayRenderer.Content {
        val lines = ArrayList<String>(2)
        if (settings.overlayTimestamp) {
            lines += LocalDateTime.ofInstant(Instant.ofEpochMilli(nowMs), zone).format(timeFormat)
        }
        val details = ArrayList<String>(2)
        if (settings.overlaySpeed) {
            val speed = SpeedFormat.value(fix?.speedMps, settings.speedUnit)?.toString() ?: "--"
            details += "$speed ${SpeedFormat.unitLabel(settings.speedUnit)}"
        }
        if (settings.overlayCoordinates && fix != null) {
            details += String.format(Locale.US, "%.5f, %.5f", fix.latitude, fix.longitude)
        }
        if (details.isNotEmpty()) lines += details.joinToString("   ")
        return OverlayRenderer.Content(lines)
    }
}
