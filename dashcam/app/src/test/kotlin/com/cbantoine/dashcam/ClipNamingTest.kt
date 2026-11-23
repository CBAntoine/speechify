package com.cbantoine.dashcam

import com.cbantoine.dashcam.storage.ClipNaming
import com.google.common.truth.Truth.assertThat
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class ClipNamingTest {
    private val zone = ZoneId.of("America/Toronto")
    private val start = LocalDateTime.of(2026, 11, 23, 14, 3, 22).atZone(zone).toInstant().toEpochMilli()

    @Test
    fun namesFollowLocalStartTime() {
        assertThat(ClipNaming.segmentName(start, zone = zone)).isEqualTo("DASH_20261123_140322.mp4")
        assertThat(ClipNaming.segmentName(start, sequence = 2, zone = zone)).isEqualTo("DASH_20261123_140322_2.mp4")
    }

    @Test
    fun parseRoundTripsIncludingImpactFlag() {
        val parsed = ClipNaming.parse("DASH_20261123_140322_2_I.mp4", zone)!!
        assertThat(parsed.startedAtMs).isEqualTo(start)
        assertThat(parsed.sequence).isEqualTo(2)
        assertThat(parsed.impact).isTrue()
        assertThat(parsed.baseName).isEqualTo("DASH_20261123_140322_2")
    }

    @Test
    fun rejectsForeignFiles() {
        assertThat(ClipNaming.parse("DASH_20261123_140322.json", zone)).isNull()
        assertThat(ClipNaming.parse("VID_20261123_140322.mp4", zone)).isNull()
        assertThat(ClipNaming.parse("DASH_20261399_140322.mp4", zone)).isNull()
    }

    @Test
    fun baseAndSidecarNamesIgnoreImpactFlag() {
        assertThat(ClipNaming.baseName("DASH_20261123_140322_I.mp4")).isEqualTo("DASH_20261123_140322")
        assertThat(ClipNaming.sidecarName("DASH_20261123_140322_I.mp4")).isEqualTo("DASH_20261123_140322.json")
        assertThat(ClipNaming.videoName("DASH_20261123_140322", impact = true)).isEqualTo("DASH_20261123_140322_I.mp4")
    }
}
