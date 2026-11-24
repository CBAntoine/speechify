package com.cbantoine.dashcam

import com.cbantoine.dashcam.scanner.ColourNamer
import com.cbantoine.dashcam.scanner.ColourVotes
import com.cbantoine.dashcam.scanner.VehicleColour
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class ColourNamerTest {
    private fun argb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun namesCommonPaintColours() {
        val cases = mapOf(
            Triple(250, 250, 250) to VehicleColour.WHITE,
            Triple(180, 182, 186) to VehicleColour.SILVER,
            Triple(100, 102, 105) to VehicleColour.GREY,
            Triple(10, 10, 12) to VehicleColour.BLACK,
            Triple(200, 30, 30) to VehicleColour.RED,
            Triple(90, 20, 25) to VehicleColour.RED,
            Triple(230, 120, 20) to VehicleColour.ORANGE,
            Triple(240, 200, 30) to VehicleColour.YELLOW,
            Triple(40, 140, 60) to VehicleColour.GREEN,
            Triple(30, 60, 170) to VehicleColour.BLUE,
            Triple(110, 70, 40) to VehicleColour.BROWN,
            Triple(210, 190, 150) to VehicleColour.BEIGE,
        )
        for ((rgb, expected) in cases) {
            assertThat(ColourNamer.classify(rgb.first, rgb.second, rgb.third)).isEqualTo(expected)
        }
    }

    @Test
    fun clearPaintColourBeatsShadows() {
        val pixels = IntArray(100) { if (it < 60) argb(15, 15, 15) else argb(200, 30, 30) }
        val (colour, share) = ColourNamer.dominant(pixels)!!
        assertThat(colour).isEqualTo(VehicleColour.RED)
        assertThat(share).isWithin(1e-4f).of(0.4f)
    }

    @Test
    fun aFewSkyReflectionsDontMakeAWhiteCarBlue() {
        val pixels = IntArray(100) { if (it < 90) argb(245, 245, 245) else argb(30, 60, 170) }
        assertThat(ColourNamer.dominant(pixels)!!.first).isEqualTo(VehicleColour.WHITE)
    }

    @Test
    fun votesAccumulateAcrossFrames() {
        val votes = ColourVotes()
        votes.add(VehicleColour.SILVER, 0.7f)
        votes.add(VehicleColour.GREY, 0.5f)
        votes.add(VehicleColour.SILVER, 0.6f)
        assertThat(votes.best()).isEqualTo(VehicleColour.SILVER)
    }
}
