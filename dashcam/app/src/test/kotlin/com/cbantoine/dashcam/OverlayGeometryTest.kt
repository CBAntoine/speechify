package com.cbantoine.dashcam

import com.cbantoine.dashcam.recording.OverlayGeometry
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class OverlayGeometryTest {
    private val w = 1920
    private val h = 1080

    private fun corner(rotation: Int, x: Float, y: Float): Pair<Float, Float> =
        OverlayGeometry.map(OverlayGeometry.uprightToBuffer(0, 0, w, h, rotation), x, y)

    @Test
    fun identityWhenNoRotation() {
        assertThat(corner(0, 0f, 0f)).isEqualTo(0f to 0f)
        assertThat(corner(0, 1920f, 1080f)).isEqualTo(1920f to 1080f)
    }

    @Test
    fun rotation90MapsUprightTopLeftToBufferBottomLeft() {
        // Rotating the buffer 90° clockwise moves its bottom-left corner to the upright top-left.
        assertThat(OverlayGeometry.uprightSize(w, h, 90)).isEqualTo(1080 to 1920)
        assertThat(corner(90, 0f, 0f)).isEqualTo(0f to 1080f)
        assertThat(corner(90, 1080f, 0f)).isEqualTo(0f to 0f)
        assertThat(corner(90, 1080f, 1920f)).isEqualTo(1920f to 0f)
    }

    @Test
    fun rotation180And270() {
        assertThat(corner(180, 0f, 0f)).isEqualTo(1920f to 1080f)
        assertThat(corner(270, 0f, 0f)).isEqualTo(1920f to 0f)
        assertThat(corner(270, 1080f, 1920f)).isEqualTo(0f to 1080f)
    }

    @Test
    fun cropOffsetIsApplied() {
        val m = OverlayGeometry.uprightToBuffer(100, 50, 1600, 900, 0)
        assertThat(OverlayGeometry.map(m, 0f, 0f)).isEqualTo(100f to 50f)
    }

    @Test
    fun readsRotationFromMatrix() {
        val rotate90 = floatArrayOf(0f, -1f, 1080f, 1f, 0f, 0f, 0f, 0f, 1f)
        assertThat(OverlayGeometry.rotationOf(rotate90)).isEqualTo(90)
        val scaledOnly = floatArrayOf(0.48f, 0f, 0f, 0f, 0.48f, -30f, 0f, 0f, 1f)
        assertThat(OverlayGeometry.rotationOf(scaledOnly)).isEqualTo(0)
        assertThat(OverlayGeometry.normalize(-90)).isEqualTo(270)
    }

    @Test
    fun safeBoxIsCentered16by9() {
        val box = OverlayGeometry.safeBox(2400, 1080)
        assertThat(box.height).isEqualTo(1080f)
        assertThat(box.width).isEqualTo(1920f)
        assertThat(box.left).isEqualTo(240f)
        val portrait = OverlayGeometry.safeBox(1080, 1920)
        assertThat(portrait.width).isEqualTo(1080f)
        assertThat(portrait.height).isEqualTo(1920f)
    }
}
