package com.cbantoine.dashcam

import com.cbantoine.dashcam.scanner.NormBox
import com.cbantoine.dashcam.scanner.PlateCandidate
import com.cbantoine.dashcam.scanner.PlateText
import com.cbantoine.dashcam.scanner.PlateVotes
import com.cbantoine.dashcam.scanner.TextLine
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class PlateTextTest {
    private val centre = NormBox(0.35f, 0.6f, 0.65f, 0.75f)

    private fun line(text: String, confidence: Float = 0.9f, box: NormBox = centre) =
        TextLine(text, confidence, box, text.split(' '))

    @Test
    fun readsAnOntarioPlate() {
        val plate = PlateText.best(listOf(line("ABCD 123")))!!
        assertThat(plate.text).isEqualTo("ABCD 123")
        assertThat(plate.key).isEqualTo("ABCD123")
    }

    @Test
    fun fixesOneOcrMixUpWhereTheFormatIsClear() {
        assertThat(PlateText.best(listOf(line("ABC0 123")))!!.text).isEqualTo("ABCO 123")
        assertThat(PlateText.best(listOf(line("ABCD 12S")))!!.text).isEqualTo("ABCD 125")
    }

    @Test
    fun skipsTheCrownBetweenLettersAndDigits() {
        val plate = PlateText.best(listOf(line("ABCD W 123")))!!
        assertThat(plate.text).isEqualTo("ABCD 123")
    }

    @Test
    fun ignoresRegionWordsBadgesAndPhoneNumbers() {
        val lines = listOf(line("ONTARIO"), line("HYBRID"), line("GLE350"), line("416 555 1234"), line("YOURS TO DISCOVER"))
        assertThat(PlateText.candidates(lines)).isEmpty()
    }

    @Test
    fun prefersTextNearTheMiddleOfTheCar() {
        val edge = line("WXYZ 789", box = NormBox(0.0f, 0.6f, 0.15f, 0.7f))
        assertThat(PlateText.best(listOf(edge, line("ABCD 123")))!!.text).isEqualTo("ABCD 123")
    }

    @Test
    fun findsTheProvinceOrState() {
        assertThat(PlateText.region(listOf(line("Ontario"), line("ABCD 123")))).isEqualTo("ONTARIO")
        assertThat(PlateText.region(listOf(line("Yours to discover")))).isEqualTo("ONTARIO")
        assertThat(PlateText.region(listOf(line("Je me souviens")))).isEqualTo("QUÉBEC")
        assertThat(PlateText.region(listOf(line("Québec")))).isEqualTo("QUÉBEC")
        assertThat(PlateText.region(listOf(line("West Virginia")))).isEqualTo("WEST VIRGINIA")
        assertThat(PlateText.region(listOf(line("ABCD 123")))).isNull()
    }

    private fun candidate(key: String, score: Float = 0.9f) =
        PlateCandidate(key.substring(0, 4) + " " + key.substring(4), key, score, centre)

    @Test
    fun twoMatchingReadsMakeAPlateShowable() {
        val votes = PlateVotes()
        votes.add(candidate("ABCD123"))
        assertThat(votes.best()!!.agreeing).isEqualTo(1)
        votes.add(candidate("ABCD123"))
        val best = votes.best()!!
        assertThat(best.text).isEqualTo("ABCD 123")
        assertThat(best.isShowable).isTrue()
        assertThat(best.confidence).isWithin(1e-4f).of(0.9f)
    }

    @Test
    fun nearMissReadsSupportTheMajority() {
        val votes = PlateVotes()
        repeat(2) { votes.add(candidate("ABCD123")) }
        votes.add(candidate("ABCD128"))
        val best = votes.best()!!
        assertThat(best.text).isEqualTo("ABCD 123")
        assertThat(best.reads).isEqualTo(3)
        // Two exact reads plus half a vote for the near miss, out of three.
        assertThat(best.confidence).isWithin(1e-4f).of(0.9f * 2.5f / 3f)
    }

    @Test
    fun settlesAfterFourAgreeingReads() {
        val votes = PlateVotes()
        repeat(3) { votes.add(candidate("ABCD123")) }
        assertThat(votes.isSettled).isFalse()
        votes.add(candidate("ABCD123"))
        assertThat(votes.isSettled).isTrue()
    }
}
