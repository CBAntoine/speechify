package com.cbantoine.dashcam

import com.cbantoine.dashcam.recording.OverlayText
import com.cbantoine.dashcam.recording.SpeedFormat
import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.settings.SpeedUnit
import com.cbantoine.dashcam.telemetry.EventType
import com.cbantoine.dashcam.telemetry.GpsFix
import com.cbantoine.dashcam.telemetry.TelemetryEvent
import com.cbantoine.dashcam.telemetry.TelemetrySample
import com.cbantoine.dashcam.telemetry.TelemetryTrack
import com.google.common.truth.Truth.assertThat
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class TelemetryTest {
    private val track = TelemetryTrack(
        startedAtMs = 0,
        durationMs = 60_000,
        samples = listOf(0L, 1_000L, 2_000L, 10_000L).map { TelemetrySample(it, 45.5, -73.6, speed = it / 1000f) },
        events = listOf(TelemetryEvent(1_500, EventType.IMPACT, 3.1f)),
        peakG = 3.1f,
    )

    @Test
    fun sampleAtPicksLatestEarlierSample() {
        assertThat(track.sampleAt(1_500)?.t).isEqualTo(1_000)
        assertThat(track.sampleAt(2_000)?.t).isEqualTo(2_000)
        assertThat(track.sampleAt(-1)).isNull()
    }

    @Test
    fun sampleAtIgnoresStaleSamples() {
        assertThat(track.sampleAt(8_500)).isNull()
        assertThat(track.sampleAt(12_000)?.t).isEqualTo(10_000)
    }

    @Test
    fun sidecarJsonRoundTrips() {
        val json = TelemetryTrack.json.encodeToString(TelemetryTrack.serializer(), track)
        assertThat(TelemetryTrack.json.decodeFromString(TelemetryTrack.serializer(), json)).isEqualTo(track)
    }

    @Test
    fun speedConversions() {
        assertThat(SpeedFormat.value(27.78f, SpeedUnit.KMH)).isEqualTo(100)
        assertThat(SpeedFormat.value(26.82f, SpeedUnit.MPH)).isEqualTo(60)
        assertThat(SpeedFormat.value(0.2f, SpeedUnit.KMH)).isEqualTo(0)
        assertThat(SpeedFormat.value(null, SpeedUnit.KMH)).isNull()
    }

    @Test
    fun overlayTextFollowsSettings() {
        val zone = ZoneId.of("UTC")
        val now = LocalDateTime.of(2026, 11, 23, 8, 5, 9).atZone(zone).toInstant().toEpochMilli()
        val fix = GpsFix(45.501234, -73.567891, 25f, null, 4f, null, now, 0)
        val all = DashcamSettings(overlayCoordinates = true, speedUnit = SpeedUnit.KMH)
        assertThat(OverlayText.build(now, fix, all, zone).lines)
            .containsExactly("2026-11-23  08:05:09", "90 km/h   45.50123, -73.56789").inOrder()
        val noGps = OverlayText.build(now, null, DashcamSettings(speedUnit = SpeedUnit.MPH), zone).lines
        assertThat(noGps).containsExactly("2026-11-23  08:05:09", "-- mph").inOrder()
        val off = DashcamSettings(overlayTimestamp = false, overlaySpeed = false)
        assertThat(OverlayText.build(now, fix, off, zone).lines).isEmpty()
    }
}
