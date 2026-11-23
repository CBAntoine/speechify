package com.cbantoine.dashcam

import com.cbantoine.dashcam.telemetry.ImpactAnalyzer
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class ImpactAnalyzerTest {
    private val g = 9.80665f
    private val step = 20_000_000L // 50 Hz

    private fun ImpactAnalyzer.feed(samplesG: List<Float>, startNs: Long): List<Float> {
        var t = startNs
        return samplesG.mapNotNull { value ->
            onSample(value * g, 0f, 0f, t, gravityRemoved = true).also { t += step }
        }
    }

    private fun warmedUp(threshold: Float?): ImpactAnalyzer =
        ImpactAnalyzer(threshold).also { it.feed(List(150) { 0.05f }, startNs = 0) }

    @Test
    fun sustainedSpikeTriggersOnce() {
        val analyzer = warmedUp(2.5f)
        val hits = analyzer.feed(listOf(0.1f, 2.7f, 3.2f, 2.9f, 0.2f), startNs = 3_000_000_000L)
        assertThat(hits).containsExactly(3.2f)
    }

    @Test
    fun singleModerateSpikeIsIgnored() {
        val analyzer = warmedUp(2.5f)
        assertThat(analyzer.feed(listOf(0.1f, 2.8f, 0.1f, 0.1f), startNs = 3_000_000_000L)).isEmpty()
    }

    @Test
    fun singleViolentSpikeTriggers() {
        val analyzer = warmedUp(2.5f)
        assertThat(analyzer.feed(listOf(0.1f, 4.5f, 0.1f), startNs = 3_000_000_000L)).containsExactly(4.5f)
    }

    @Test
    fun cooldownSuppressesRepeatHits() {
        val analyzer = warmedUp(2.0f)
        val first = analyzer.feed(listOf(3f, 3f), startNs = 3_000_000_000L)
        val second = analyzer.feed(listOf(3f, 3f), startNs = 5_000_000_000L)
        val later = analyzer.feed(listOf(3f, 3f), startNs = 20_000_000_000L)
        assertThat(first).hasSize(1)
        assertThat(second).isEmpty()
        assertThat(later).hasSize(1)
    }

    @Test
    fun ignoresEverythingDuringWarmupAndWhenOff() {
        assertThat(ImpactAnalyzer(2.0f).feed(listOf(5f, 5f), startNs = 0)).isEmpty()
        assertThat(warmedUp(null).feed(listOf(5f, 5f), startNs = 3_000_000_000L)).isEmpty()
    }

    @Test
    fun removesGravityFromRawAccelerometer() {
        val analyzer = ImpactAnalyzer(2.0f)
        var t = 0L
        repeat(150) {
            analyzer.onSample(0f, 0f, g, t, gravityRemoved = false)
            t += step
        }
        assertThat(analyzer.lastMagnitudeG).isLessThan(0.05f)
        val hit = listOf(4f, 4f).firstNotNullOfOrNull { value ->
            analyzer.onSample(value * g, 0f, g, t, gravityRemoved = false).also { t += step }
        }
        assertThat(hit).isNotNull()
    }
}
