package app.neonclips.media

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.DefaultGainProvider
import androidx.media3.common.audio.GainProcessor
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.OverlayEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import app.neonclips.core.Captions
import app.neonclips.core.Clip
import app.neonclips.core.Project
import app.neonclips.core.Reframing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs
import kotlin.math.pow

/**
 * Moves the 9:16 window around the source frame over time. Frame times arrive relative to the
 * start of the clip, so the clip's start is added to get back to source time.
 */
@UnstableApi
class ReframeEffect(private val clip: Clip, private val outW: Int, private val outH: Int) : MatrixTransformation {
    private val matrix = Matrix()
    private var inW = 16
    private var inH = 9

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        inW = inputWidth
        inH = inputHeight
        return Size(outW, outH)
    }

    override fun getMatrix(presentationTimeUs: Long): Matrix {
        val shot = Reframing.shotAt(clip.reframe, inW, inH, clip.startMs + presentationTimeUs / 1000)
        // Normalised device coordinates: x runs -1..1 left to right, y runs -1..1 bottom to top.
        matrix.reset()
        matrix.postTranslate(-(2f * shot.cx - 1f), -(1f - 2f * shot.cy))
        matrix.postScale(1f / shot.w, 1f / shot.h)
        return matrix
    }
}

/** Burns the hook title and captions into the frame. Redraws only when the words on screen change. */
@UnstableApi
class CaptionOverlay(
    private val clip: Clip,
    private val painter: CaptionPainter,
    private val outW: Int,
    private val outH: Int,
) : BitmapOverlay() {
    private val blank: Bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
    private var drawn: Bitmap? = null
    private var shown: Captions.Frame? = null

    override fun getBitmap(presentationTimeUs: Long): Bitmap {
        val frame = Captions.frameAt(clip, clip.startMs + presentationTimeUs / 1000) ?: return blank
        if (frame == shown) drawn?.let { return it }
        // A fresh bitmap each time tells the overlay to upload the new picture.
        val bmp = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.TRANSPARENT)
        painter.draw(Canvas(bmp), outW, outH, frame, clip.style)
        drawn = bmp
        shown = frame
        return bmp
    }
}

@UnstableApi
class Exporter(private val context: Context) {
    private val painter = CaptionPainter(context)

    data class Result(val file: File, val width: Int, val height: Int, val durationMs: Long, val bytes: Long)

    /** Renders [clip] as a 9:16 H.264 MP4 at [outHeight] pixels tall. [onProgress] gets 0..1. */
    suspend fun export(project: Project, clip: Clip, out: File, outHeight: Int, onProgress: (Float) -> Unit): Result {
        val outW = outHeight * 9 / 16
        val video: List<Effect> = listOf(
            ReframeEffect(clip, outW, outHeight),
            OverlayEffect(listOf(CaptionOverlay(clip, painter, outW, outHeight))),
        )
        val audio: List<AudioProcessor> =
            if (project.hasAudio && abs(clip.gainDb) > 0.1f) {
                listOf(GainProcessor(DefaultGainProvider.Builder(10f.pow(clip.gainDb / 20f)).build()))
            } else emptyList()
        val edited = EditedMediaItem.Builder(clipped(project, clip))
            .setRemoveAudio(!project.hasAudio)
            .setEffects(Effects(audio, video))
            .build()
        val sequence =
            if (project.hasAudio) EditedMediaItemSequence.withAudioAndVideoFrom(listOf(edited))
            else EditedMediaItemSequence.withVideoFrom(listOf(edited))
        val composition = Composition.Builder(sequence)
            // Phone HDR footage becomes normal SDR so it looks right everywhere it is posted.
            .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
            .build()
        val bitrate = if (outHeight >= 1920) 10_000_000 else 5_000_000
        val result = run(composition, out, onProgress) {
            setVideoMimeType(MimeTypes.VIDEO_H264)
            setAudioMimeType(MimeTypes.AUDIO_AAC)
            setEncoderFactory(
                DefaultEncoderFactory.Builder(context)
                    .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
                    .build()
            )
        }
        return Result(out, outW, outHeight, result.durationMs, out.length())
    }

    /** Writes just the clip's sound to an .m4a file, for transcription. */
    suspend fun extractAudio(project: Project, clip: Clip, out: File) {
        val edited = EditedMediaItem.Builder(clipped(project, clip)).setRemoveVideo(true).build()
        run(Composition.Builder(EditedMediaItemSequence.withAudioFrom(listOf(edited))).build(), out, {}) {
            setAudioMimeType(MimeTypes.AUDIO_AAC)
        }
    }

    private fun clipped(project: Project, clip: Clip): MediaItem =
        MediaItem.Builder()
            .setUri(Uri.parse(project.sourceUri))
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(clip.startMs)
                    .setEndPositionMs(clip.endMs)
                    .build()
            )
            .build()

    private suspend fun run(
        composition: Composition,
        out: File,
        onProgress: (Float) -> Unit,
        configure: Transformer.Builder.() -> Unit,
    ): ExportResult = withContext(Dispatchers.Main.immediate) {
        out.parentFile?.mkdirs()
        out.delete()
        suspendCancellableCoroutine { cont ->
            val handler = Handler(Looper.getMainLooper())
            val transformer = Transformer.Builder(context)
                .apply(configure)
                // A stalled render fails after this long instead of hanging; slow phones need the slack.
                .setMaxDelayBetweenMuxerSamplesMs(60_000)
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        if (cont.isActive) cont.resume(exportResult)
                    }

                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        out.delete()
                        if (cont.isActive) cont.resumeWithException(exportException)
                    }
                })
                .build()
            transformer.start(composition, out.absolutePath)

            val holder = ProgressHolder()
            val tick = object : Runnable {
                override fun run() {
                    if (!cont.isActive) return
                    if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress / 100f)
                    handler.postDelayed(this, 150)
                }
            }
            handler.post(tick)
            cont.invokeOnCancellation {
                handler.post {
                    runCatching { transformer.cancel() }
                    out.delete()
                }
            }
        }
    }

    companion object {
        /** Copies a finished export into the phone's gallery under Movies/NeonClips. */
        fun saveToGallery(context: Context, file: File, name: String): Uri {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/NeonClips")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
                ?: error("The gallery refused the file.")
            try {
                resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
                resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                throw e
            }
            return uri
        }
    }
}
