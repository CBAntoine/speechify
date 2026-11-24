package com.cbantoine.dashcam.scanner

import kotlin.math.max
import kotlin.math.min

/** Paint colours as people name them on cars. [swatch] is an ARGB colour for the UI. */
enum class VehicleColour(val label: String, val swatch: Long, val chromatic: Boolean) {
    WHITE("White", 0xFFF2F2F2, false),
    SILVER("Silver", 0xFFB8BCC2, false),
    GREY("Grey", 0xFF6E7378, false),
    BLACK("Black", 0xFF1C1D1F, false),
    RED("Red", 0xFFC62828, true),
    ORANGE("Orange", 0xFFEF6C00, true),
    YELLOW("Yellow", 0xFFF9C80E, true),
    GREEN("Green", 0xFF2E7D32, true),
    BLUE("Blue", 0xFF1E5AA8, true),
    PURPLE("Purple", 0xFF6A3FA0, true),
    BROWN("Brown", 0xFF6D4C35, true),
    BEIGE("Beige", 0xFFCDBB98, true),
}

/**
 * Names a vehicle's body colour from pixels sampled off its panels. Each pixel is classified in
 * HSV; shadows and tyres pull towards black and grey, so a clear chromatic colour wins when it
 * covers a good share of the samples.
 */
object ColourNamer {
    private const val CHROMATIC_SHARE_TO_WIN = 0.28f

    fun classify(r: Int, g: Int, b: Int): VehicleColour {
        val rf = r / 255f
        val gf = g / 255f
        val bf = b / 255f
        val maxC = max(rf, max(gf, bf))
        val minC = min(rf, min(gf, bf))
        val v = maxC
        val delta = maxC - minC
        val s = if (maxC <= 0f) 0f else delta / maxC
        if (v < 0.2f) return VehicleColour.BLACK
        if (s < 0.15f || (s < 0.25f && v < 0.35f)) {
            return when {
                v > 0.8f -> VehicleColour.WHITE
                v > 0.55f -> VehicleColour.SILVER
                v > 0.3f -> VehicleColour.GREY
                else -> VehicleColour.BLACK
            }
        }
        val h = hue(rf, gf, bf, maxC, delta)
        return when {
            h < 15f || h >= 330f -> VehicleColour.RED
            h < 40f -> when {
                v < 0.55f -> VehicleColour.BROWN
                s < 0.45f -> VehicleColour.BEIGE
                else -> VehicleColour.ORANGE
            }
            h < 70f -> when {
                s < 0.4f -> VehicleColour.BEIGE
                v < 0.5f -> VehicleColour.BROWN
                else -> VehicleColour.YELLOW
            }
            h < 165f -> VehicleColour.GREEN
            h < 260f -> VehicleColour.BLUE
            else -> VehicleColour.PURPLE
        }
    }

    /** The colour covering most of [pixels] (ARGB), with its share of the samples. */
    fun dominant(pixels: IntArray): Pair<VehicleColour, Float>? {
        if (pixels.isEmpty()) return null
        val counts = IntArray(VehicleColour.entries.size)
        for (p in pixels) {
            counts[classify(p shr 16 and 0xFF, p shr 8 and 0xFF, p and 0xFF).ordinal]++
        }
        return pick(counts.map { it.toFloat() })
    }

    /** Picks from per-colour weights, letting a clear chromatic colour beat shadow greys. */
    internal fun pick(weights: List<Float>): Pair<VehicleColour, Float>? {
        val total = weights.sum()
        if (total <= 0f) return null
        val colours = VehicleColour.entries
        val top = colours[weights.indices.maxBy { weights[it] }]
        if (!top.chromatic) {
            val chromatic = colours.filter { it.chromatic }.maxBy { weights[it.ordinal] }
            val share = weights[chromatic.ordinal] / total
            if (share >= CHROMATIC_SHARE_TO_WIN) return chromatic to share
        }
        return top to weights[top.ordinal] / total
    }

    private fun hue(r: Float, g: Float, b: Float, maxC: Float, delta: Float): Float {
        if (delta <= 0f) return 0f
        val h = when (maxC) {
            r -> 60f * (((g - b) / delta) % 6f)
            g -> 60f * (((b - r) / delta) + 2f)
            else -> 60f * (((r - g) / delta) + 4f)
        }
        return if (h < 0f) h + 360f else h
    }
}

/** Colour samples for one vehicle across frames. */
class ColourVotes {
    private val weights = FloatArray(VehicleColour.entries.size)

    fun add(colour: VehicleColour, share: Float) {
        weights[colour.ordinal] += share
    }

    fun best(): VehicleColour? = ColourNamer.pick(weights.toList())?.first
}
