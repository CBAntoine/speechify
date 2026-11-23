package com.cbantoine.dashcam.storage

import com.cbantoine.dashcam.settings.VideoQuality
import kotlin.math.max

/** Pure decisions about loop storage so they can be unit tested without a device. */
object StoragePolicy {
    private const val GIB = 1L shl 30

    /** [onActiveVolume]: on the volume new clips are written to (the one [freeBytes] measures). */
    data class LoopClip(val id: String, val sizeBytes: Long, val startedAtMs: Long, val onActiveVolume: Boolean = true)

    /**
     * Picks the oldest loop clips to delete until all loop clips fit [loopBudgetBytes] and the
     * active volume has at least [minFreeBytes] free. Clips in [busyIds] (being recorded,
     * finalized or moved) are never selected, and deleting a clip on another volume never
     * counts as freeing space on the active one.
     */
    fun selectForDeletion(
        loopClips: List<LoopClip>,
        freeBytes: Long,
        loopBudgetBytes: Long,
        minFreeBytes: Long,
        busyIds: Set<String> = emptySet(),
    ): List<LoopClip> {
        var loopTotal = loopClips.sumOf { it.sizeBytes }
        var free = freeBytes
        val victims = mutableListOf<LoopClip>()
        for (clip in loopClips.filter { it.id !in busyIds }.sortedBy { it.startedAtMs }) {
            val overBudget = loopTotal > loopBudgetBytes
            val needSpace = free < minFreeBytes
            if (!overBudget && !needSpace) break
            // Only over budget clips, or clips whose deletion actually frees space, are removed.
            if (!overBudget && !clip.onActiveVolume) continue
            victims += clip
            loopTotal -= clip.sizeBytes
            if (clip.onActiveVolume) free += clip.sizeBytes
        }
        return victims
    }

    /** Rough size of one clip, used to keep enough headroom for the next one. */
    fun estimateClipBytes(quality: VideoQuality, hevc: Boolean, clipMinutes: Int, audio: Boolean): Long {
        val videoBitsPerSecond = quality.approxMbps * 1_000_000L * (if (hevc) 6 else 10) / 10
        val audioBitsPerSecond = if (audio) 192_000L else 0L
        return (videoBitsPerSecond + audioBitsPerSecond) / 8 * 60L * clipMinutes
    }

    /** Free space to keep on the volume: at least 1 GiB and three clips' worth. */
    fun minFreeBytes(estimatedClipBytes: Long): Long = max(GIB, estimatedClipBytes * 3)

    /** Whether there is room to start another clip right now. */
    fun canStartClip(freeBytes: Long, estimatedClipBytes: Long): Boolean =
        freeBytes >= estimatedClipBytes + 256L * 1024 * 1024
}
