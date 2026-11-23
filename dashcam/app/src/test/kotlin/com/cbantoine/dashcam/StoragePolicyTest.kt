package com.cbantoine.dashcam

import com.cbantoine.dashcam.settings.VideoQuality
import com.cbantoine.dashcam.storage.StoragePolicy
import com.cbantoine.dashcam.storage.StoragePolicy.LoopClip
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class StoragePolicyTest {
    private val mb = 1_000_000L
    private val clips = (1..10).map { LoopClip(id = "clip$it", sizeBytes = 100 * mb, startedAtMs = it * 60_000L) }

    @Test
    fun nothingDeletedWhenWithinBudget() {
        val victims = StoragePolicy.selectForDeletion(clips, freeBytes = 50_000 * mb, loopBudgetBytes = 2_000 * mb, minFreeBytes = 1_000 * mb)
        assertThat(victims).isEmpty()
    }

    @Test
    fun deletesOldestUntilUnderBudget() {
        val victims = StoragePolicy.selectForDeletion(clips, freeBytes = 50_000 * mb, loopBudgetBytes = 750 * mb, minFreeBytes = 1_000 * mb)
        assertThat(victims.map { it.id }).containsExactly("clip1", "clip2", "clip3").inOrder()
    }

    @Test
    fun deletesToRestoreFreeSpaceEvenUnderBudget() {
        val victims = StoragePolicy.selectForDeletion(clips, freeBytes = 800 * mb, loopBudgetBytes = 5_000 * mb, minFreeBytes = 1_000 * mb)
        assertThat(victims.map { it.id }).containsExactly("clip1", "clip2").inOrder()
    }

    @Test
    fun neverDeletesBusyClips() {
        // clip10 is recording and clip9 is still being finalized after a rotation.
        val victims = StoragePolicy.selectForDeletion(
            clips, freeBytes = 0, loopBudgetBytes = 0, minFreeBytes = Long.MAX_VALUE, busyIds = setOf("clip9", "clip10"),
        )
        assertThat(victims.map { it.id }).containsNoneOf("clip9", "clip10")
        assertThat(victims).hasSize(8)
    }

    @Test
    fun clipsOnAnotherVolumeDoNotCountAsFreedSpace() {
        val otherVolume = (1..3).map { LoopClip("sd$it", 100 * mb, startedAtMs = it.toLong(), onActiveVolume = false) }
        val victims = StoragePolicy.selectForDeletion(
            otherVolume + clips, freeBytes = 800 * mb, loopBudgetBytes = 50_000 * mb, minFreeBytes = 1_000 * mb,
        )
        // Under budget: only clips on the full volume help, so the SD card's older clips stay.
        assertThat(victims.map { it.id }).containsExactly("clip1", "clip2").inOrder()
    }

    @Test
    fun overBudgetDeletesOldestOnAnyVolume() {
        val otherVolume = listOf(LoopClip("sd1", 100 * mb, startedAtMs = 1, onActiveVolume = false))
        val victims = StoragePolicy.selectForDeletion(
            otherVolume + clips, freeBytes = 50_000 * mb, loopBudgetBytes = 1_000 * mb, minFreeBytes = 1_000 * mb,
        )
        assertThat(victims.map { it.id }).containsExactly("sd1").inOrder()
    }

    @Test
    fun clipEstimatesScaleWithQualityAndCodec() {
        val fhd = StoragePolicy.estimateClipBytes(VideoQuality.FHD, hevc = false, clipMinutes = 1, audio = true)
        val fhdHevc = StoragePolicy.estimateClipBytes(VideoQuality.FHD, hevc = true, clipMinutes = 1, audio = true)
        val uhd = StoragePolicy.estimateClipBytes(VideoQuality.UHD, hevc = false, clipMinutes = 1, audio = true)
        assertThat(fhd).isIn(com.google.common.collect.Range.closed(100 * mb, 150 * mb))
        assertThat(fhdHevc).isLessThan(fhd)
        assertThat(uhd).isGreaterThan(fhd * 2)
        assertThat(StoragePolicy.minFreeBytes(fhd)).isAtLeast(1L shl 30)
    }
}
