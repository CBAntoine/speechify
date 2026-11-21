package app.neonclips.core

import kotlinx.serialization.Serializable

/** A video found by search, or described by a pasted link. */
@Serializable
data class VideoHit(
    val id: String,
    val url: String,
    val title: String,
    val channel: String = "",
    val durationSec: Long? = null,
    val views: Long? = null,
    /** Epoch seconds. Approximate ("3 days ago") when it comes from search results. */
    val publishedAtSec: Long? = null,
    val thumbnail: String? = null,
    val wasLive: Boolean = false,
    val isLiveNow: Boolean = false,
)

/** One bucket of the "most replayed" graph. [value] is 0..1. */
@Serializable
data class HeatPoint(val startSec: Double, val endSec: Double, val value: Double)

@Serializable
data class RemoteInfo(
    val hit: VideoHit,
    val heatmap: List<HeatPoint> = emptyList(),
)

/** Where an imported file came from, when it was downloaded rather than picked from the phone. */
@Serializable
data class Origin(
    val url: String,
    val channel: String = "",
    val views: Long? = null,
    /** Position of this file inside the full remote video, when only a section was downloaded. */
    val offsetMs: Long = 0,
)

/** A stretch of the source that looks worth clipping. All times are in source-file milliseconds. */
@Serializable
data class Moment(
    val startMs: Long,
    val endMs: Long,
    val peakMs: Long,
    /** 0..100 */
    val score: Float,
    val reason: String,
)

@Serializable
enum class ReframeMode { CENTER, AUTO, MANUAL }

/** A virtual-camera keyframe: where the centre of the 9:16 window sits in the source frame (0..1). */
@Serializable
data class CamKey(val tMs: Long, val cx: Float, val cy: Float = 0.5f)

@Serializable
data class Reframe(
    val mode: ReframeMode = ReframeMode.CENTER,
    val keys: List<CamKey> = emptyList(),
    /** 1 = the largest 9:16 window that fits the source; higher punches in. */
    val zoom: Float = 1f,
    /** A person picked by tapping them: at this time, the face nearest this point is the one to follow. */
    val follow: CamKey? = null,
    /** The stretch of the source that face tracking has already covered, or -1 for none. */
    val trackedFromMs: Long = -1,
    val trackedToMs: Long = -1,
) {
    fun isTracked(startMs: Long, endMs: Long): Boolean =
        trackedFromMs in 0..startMs && trackedToMs >= endMs
}

@Serializable
data class Word(val startMs: Long, val endMs: Long, val text: String)

@Serializable
data class Caption(
    val startMs: Long,
    val endMs: Long,
    val text: String,
    val words: List<Word> = emptyList(),
)

@Serializable
data class CaptionStyle(
    val uppercase: Boolean = true,
    /** Vertical centre of the caption block as a fraction of output height. */
    val position: Float = 0.70f,
    /** Text size as a fraction of output width. */
    val size: Float = 0.115f,
    /** Light the word being spoken in the accent colour. */
    val karaoke: Boolean = true,
)

@Serializable
data class Clip(
    val id: String,
    val startMs: Long,
    val endMs: Long,
    /** Big title shown for the first seconds of the short. */
    val hook: String = "",
    val reframe: Reframe = Reframe(ReframeMode.AUTO),
    val captions: List<Caption> = emptyList(),
    val captionsOn: Boolean = true,
    /** Shows every caption this much later (or earlier, if negative) than it was timed. */
    val captionShiftMs: Long = 0,
    val style: CaptionStyle = CaptionStyle(),
    val gainDb: Float = 0f,
    val exportedUri: String? = null,
) {
    val durationMs: Long get() = endMs - startMs
}

@Serializable
data class Project(
    val id: String,
    val title: String,
    val createdAt: Long,
    /** file:// or content:// */
    val sourceUri: String,
    val durationMs: Long,
    /** Display-oriented size of the source (rotation already applied). */
    val width: Int,
    val height: Int,
    val hasAudio: Boolean = true,
    val origin: Origin? = null,
    val moments: List<Moment> = emptyList(),
    val clips: List<Clip> = emptyList(),
) {
    fun clip(id: String): Clip? = clips.firstOrNull { it.id == id }

    fun withClip(clip: Clip): Project =
        copy(clips = if (clips.any { it.id == clip.id }) clips.map { if (it.id == clip.id) clip else it } else clips + clip)
}

/** How long hook titles stay on screen. */
const val HOOK_MS = 2600L

const val MIN_CLIP_MS = 3_000L
const val MAX_CLIP_MS = 180_000L
