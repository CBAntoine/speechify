package com.cbantoine.dashcam.scanner

import java.text.Normalizer
import kotlin.math.abs

/** One line of text found by OCR. [box] is normalized to the image that was read. */
data class TextLine(
    val text: String,
    val confidence: Float,
    val box: NormBox,
    val elements: List<String> = emptyList(),
)

/** A plate-like string found on a vehicle. [key] is the bare characters used for voting. */
data class PlateCandidate(val text: String, val key: String, val score: Float, val box: NormBox)

/** The plate a vehicle most likely carries, from all reads so far. */
data class PlateReading(val text: String, val confidence: Float, val reads: Int, val agreeing: Int) {
    /** Two matching reads before a plate is shown at all: a single read can be a badge or sticker. */
    val isShowable: Boolean get() = agreeing >= 2
}

/**
 * Picks licence plates out of OCR text. Plate formats are checked from most to least specific
 * (Ontario's "ABCD 123" first), with the usual OCR mix-ups (0/O, 1/I, 5/S, 8/B) fixed only
 * where a format says which kind of character belongs there.
 */
object PlateText {
    private const val MIN_SCORE = 0.25f
    private const val DEFAULT_CONFIDENCE = 0.6f

    private class PlateFormat(val pattern: String, val score: Float, val spaceAt: Int?)

    private val FORMATS = listOf(
        PlateFormat("LLLLDDD", 1f, 4), // Ontario passenger plates: ABCD 123
        PlateFormat("LLLDDD", 0.95f, 3), // older Ontario and many others: ABC 123
        PlateFormat("LLLDDDD", 0.9f, 3), // many US states: ABC 1234
        PlateFormat("DDDLLL", 0.85f, 3), // 123 ABC
        PlateFormat("DLLLDDD", 0.85f, null), // 7ABC123
    )

    private val DIGIT_TO_LETTER = mapOf('0' to 'O', '1' to 'I', '2' to 'Z', '5' to 'S', '6' to 'G', '8' to 'B')
    private val LETTER_TO_DIGIT = mapOf(
        'O' to '0', 'Q' to '0', 'D' to '0', 'I' to '1', 'L' to '1', 'Z' to '2', 'S' to '5', 'G' to '6', 'B' to '8',
    )

    /** Words on or around plates (and badges on the car) that are never the plate itself. */
    private val IGNORED_WORDS = setOf(
        "ONTARIO", "QUEBEC", "ALBERTA", "MANITOBA", "SASKATCHEWAN", "YUKON", "NUNAVUT", "CANADA",
        "YOURS", "DISCOVER", "SOUVIENS", "COUNTRY", "DEALER", "MOTORS", "SALES", "SERVICE",
        "HYBRID", "ELECTRIC", "SPORT", "LIMITED", "TOURING", "PLATINUM", "QUATTRO", "XDRIVE", "4MATIC",
        "TURBO", "ECOBOOST", "DIESEL", "PLUGIN",
        "TOYOTA", "HONDA", "NISSAN", "MAZDA", "SUBARU", "HYUNDAI", "FORD", "CHEVROLET", "DODGE", "JEEP",
        "BUICK", "CADILLAC", "LINCOLN", "LEXUS", "ACURA", "INFINITI", "VOLKSWAGEN", "MERCEDES", "BENZ",
        "VOLVO", "TESLA", "PORSCHE", "MITSUBISHI", "CHRYSLER", "GENESIS", "JAGUAR", "POLESTAR", "RIVIAN",
        "2500HD", "3500HD", "1500HD", "GLE350", "GLC300", "GLA250", "CLA250", "RX350", "RX450H", "ES350",
        "ES300H", "NX350", "ML350", "IONIQ5", "IONIQ6", "MODEL3", "QX60", "QX50", "XC40", "XC60", "XC90",
    )

    private val REGION_KEYWORDS: List<Pair<String, String>> = listOf(
        "YOURS TO DISCOVER" to "ONTARIO",
        "ONTARIO" to "ONTARIO",
        "JE ME SOUVIENS" to "QUÉBEC",
        "QUEBEC" to "QUÉBEC",
        "BRITISH COLUMBIA" to "BRITISH COLUMBIA",
        "WILD ROSE COUNTRY" to "ALBERTA",
        "ALBERTA" to "ALBERTA",
        "LAND OF LIVING SKIES" to "SASKATCHEWAN",
        "SASKATCHEWAN" to "SASKATCHEWAN",
        "MANITOBA" to "MANITOBA",
        "NOVA SCOTIA" to "NOVA SCOTIA",
        "NEW BRUNSWICK" to "NEW BRUNSWICK",
        "NOUVEAU BRUNSWICK" to "NEW BRUNSWICK",
        "PRINCE EDWARD ISLAND" to "PRINCE EDWARD ISLAND",
        "NEWFOUNDLAND" to "NEWFOUNDLAND AND LABRADOR",
        "YUKON" to "YUKON",
        "NUNAVUT" to "NUNAVUT",
        "NORTHWEST TERRITORIES" to "NORTHWEST TERRITORIES",
        "EMPIRE STATE" to "NEW YORK",
        "PURE MICHIGAN" to "MICHIGAN",
    ) + US_STATES.map { it to it }

    /** The most plate-like string in the text, or null. */
    fun best(lines: List<TextLine>): PlateCandidate? = candidates(lines).maxByOrNull { it.score }

    fun candidates(lines: List<TextLine>): List<PlateCandidate> =
        lines.flatMap(::fromLine).filter { it.score >= MIN_SCORE }

    /** The province or state printed on the plate, if any was read. */
    fun region(lines: List<TextLine>): String? {
        for (line in lines) {
            val words = " " + normalizeWords(line.text) + " "
            REGION_KEYWORDS.firstOrNull { (keyword, _) -> words.contains(" $keyword ") }?.let { return it.second }
        }
        return null
    }

    private fun fromLine(line: TextLine): List<PlateCandidate> {
        val tokens = line.elements.ifEmpty { line.text.split(' ') }.map(::clean).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return emptyList()
        val groups = buildList {
            tokens.forEach { add(listOf(it)) }
            for (i in 0 until tokens.size - 1) add(listOf(tokens[i], tokens[i + 1]))
            // Ontario plates have a crown between the letters and the digits, which OCR may
            // read as a stray character.
            for (i in 0 until tokens.size - 2) {
                if (tokens[i + 1].length == 1) add(listOf(tokens[i], tokens[i + 2]))
            }
            if (tokens.size in 3..4) add(tokens)
        }
        val prior = (if (line.confidence > 0f) line.confidence else DEFAULT_CONFIDENCE) * positionPrior(line.box)
        return groups.mapNotNull { candidate(it, line.box, prior) }.distinctBy { it.key }
    }

    private fun candidate(group: List<String>, box: NormBox, prior: Float): PlateCandidate? {
        if (group.any { it in IGNORED_WORDS }) return null
        val raw = group.joinToString("")
        if (raw.length !in 5..8 || raw in IGNORED_WORDS) return null
        for (format in FORMATS) {
            val fixed = match(raw, format) ?: continue
            val text = format.spaceAt?.let { fixed.substring(0, it) + " " + fixed.substring(it) } ?: fixed
            return PlateCandidate(text, fixed, format.score * prior, box)
        }
        val letters = raw.count { it in 'A'..'Z' }
        val digits = raw.count { it in '0'..'9' }
        // All letters is usually a word (a badge, a dealer); all digits is often a phone number.
        if (letters == 0 || digits == 0) return null
        val score = if (letters >= 2 && digits >= 2) 0.7f else 0.55f
        val text = if (group.size == 2) group.joinToString(" ") else raw
        return PlateCandidate(text, raw, score * prior, box)
    }

    /** [raw] in [format], allowing one character fixed for a common OCR mix-up. */
    private fun match(raw: String, format: PlateFormat): String? {
        if (raw.length != format.pattern.length) return null
        var fixes = 0
        val out = StringBuilder(raw.length)
        for ((i, c) in raw.withIndex()) {
            val wantLetter = format.pattern[i] == 'L'
            val fixed = when {
                wantLetter && c in 'A'..'Z' -> c
                !wantLetter && c in '0'..'9' -> c
                wantLetter -> DIGIT_TO_LETTER[c]?.also { fixes++ } ?: return null
                else -> LETTER_TO_DIGIT[c]?.also { fixes++ } ?: return null
            }
            out.append(fixed)
        }
        return if (fixes <= 1) out.toString() else null
    }

    /** Plates sit near the middle of the car, below the window line. */
    private fun positionPrior(box: NormBox): Float {
        val horizontal = if (abs(box.centerX - 0.5f) <= 0.3f) 1f else 0.6f
        val vertical = if (box.centerY >= 0.2f) 1f else 0.7f
        return horizontal * vertical
    }

    private fun clean(token: String): String = token.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }

    private fun normalizeWords(text: String): String =
        Normalizer.normalize(text.uppercase(), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .replace(Regex("[^A-Z]+"), " ")
            .trim()
}

/** Accumulates plate reads for one vehicle across frames. */
class PlateVotes {
    private class Tally(val text: String, var count: Int, var scoreSum: Float)

    private val tallies = LinkedHashMap<String, Tally>()

    var reads: Int = 0
        private set

    fun add(candidate: PlateCandidate) {
        reads++
        val tally = tallies.getOrPut(candidate.key) { Tally(candidate.text, 0, 0f) }
        tally.count++
        tally.scoreSum += candidate.score
    }

    fun best(): PlateReading? {
        if (tallies.isEmpty()) return null
        // Reads one character off are most likely the same plate with OCR noise: half a vote.
        val (key, support) = tallies.keys
            .map { key ->
                val near = tallies.filterKeys { it != key && nearlySame(it, key) }.values.sumOf { it.count }
                key to tallies.getValue(key).count + 0.5f * near
            }
            .maxWith(compareBy<Pair<String, Float>> { it.second }.thenBy { tallies.getValue(it.first).scoreSum })
        val tally = tallies.getValue(key)
        val share = (support / reads).coerceAtMost(1f)
        val confidence = (share * tally.scoreSum / tally.count).coerceIn(0f, 1f)
        return PlateReading(tally.text, confidence, reads, tally.count)
    }

    /** Enough agreeing reads that more OCR on this vehicle wouldn't change the answer. */
    val isSettled: Boolean
        get() = best()?.let { it.agreeing >= 4 && it.agreeing.toFloat() / reads >= 0.6f } == true

    private fun nearlySame(a: String, b: String): Boolean =
        a.length == b.length && a.indices.count { a[it] != b[it] } == 1
}

private val US_STATES = listOf(
    "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO", "CONNECTICUT", "DELAWARE",
    "FLORIDA", "GEORGIA", "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY",
    "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI",
    "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO",
    "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA", "OHIO", "OKLAHOMA", "OREGON", "PENNSYLVANIA",
    "RHODE ISLAND", "SOUTH CAROLINA", "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT",
    "WEST VIRGINIA", "VIRGINIA", "WASHINGTON", "WISCONSIN", "WYOMING",
)
