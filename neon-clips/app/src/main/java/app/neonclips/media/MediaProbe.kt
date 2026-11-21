package app.neonclips.media

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Log

data class Probe(
    val durationMs: Long,
    /** Display-oriented size: rotation is already applied. */
    val width: Int,
    val height: Int,
    val hasAudio: Boolean,
)

object MediaProbe {
    fun probe(context: Context, uri: Uri): Probe {
        val mmr = MediaMetadataRetriever()
        try {
            mmr.setDataSource(context, uri)
            fun int(key: Int) = mmr.extractMetadata(key)?.toIntOrNull() ?: 0
            val w = int(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
            val h = int(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
            require(w > 0 && h > 0) { "This file has no video track." }
            val sideways = int(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION) % 180 != 0
            return Probe(
                durationMs = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0,
                width = if (sideways) h else w,
                height = if (sideways) w else h,
                hasAudio = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes",
            )
        } finally {
            mmr.release()
        }
    }

    /** Opens a retriever for repeated frame grabs; the caller releases it. */
    fun retriever(context: Context, uri: Uri): MediaMetadataRetriever =
        MediaMetadataRetriever().apply { setDataSource(context, uri) }

    /** A frame scaled so its longer side is about [maxSide] pixels. [exact] decodes the true frame, not the nearest keyframe. */
    fun frame(mmr: MediaMetadataRetriever, tMs: Long, srcW: Int, srcH: Int, maxSide: Int, exact: Boolean): Bitmap? {
        val scale = maxSide.toFloat() / maxOf(srcW, srcH)
        val w = (srcW * scale).toInt().coerceAtLeast(2)
        val h = (srcH * scale).toInt().coerceAtLeast(2)
        val option = if (exact) MediaMetadataRetriever.OPTION_CLOSEST else MediaMetadataRetriever.OPTION_CLOSEST_SYNC
        return runCatching { mmr.getScaledFrameAtTime(tMs * 1000, option, w, h) }
            .onFailure { Log.w("NeonClips", "No frame at $tMs ms", it) }
            .getOrNull()
    }
}
