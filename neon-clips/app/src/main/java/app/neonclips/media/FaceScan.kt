package app.neonclips.media

import android.content.Context
import android.net.Uri
import app.neonclips.core.CamKey
import app.neonclips.core.FaceBox
import app.neonclips.core.FaceFrame
import app.neonclips.core.Reframing
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

object FaceScan {
    private const val STEP_MS = 400L
    private const val FRAME_SIDE = 960

    /**
     * Finds the faces in [startMs]..[endMs] of the video, a few times a second, with extra looks
     * around cuts. Turn the result into a camera path with [Reframing.autoPath]. [follow] is the
     * person the user picked, if any. [onProgress] gets 0..1.
     */
    suspend fun scan(
        context: Context,
        uri: Uri,
        srcW: Int,
        srcH: Int,
        startMs: Long,
        endMs: Long,
        follow: CamKey? = null,
        onProgress: (Float) -> Unit = {},
    ): List<FaceFrame> = withContext(Dispatchers.Default) {
        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setMinFaceSize(0.08f)
                .build()
        )
        val mmr = MediaProbe.retriever(context, uri)
        try {
            suspend fun detect(tMs: Long): FaceFrame {
                coroutineContext.ensureActive()
                val bmp = MediaProbe.frame(mmr, tMs, srcW, srcH, FRAME_SIDE, exact = true) ?: return FaceFrame(tMs, emptyList())
                try {
                    val faces = Tasks.await(detector.process(InputImage.fromBitmap(bmp, 0)))
                    val w = bmp.width.toFloat()
                    val h = bmp.height.toFloat()
                    return FaceFrame(tMs, faces.map { f ->
                        val r = f.boundingBox
                        FaceBox(r.exactCenterX() / w, r.exactCenterY() / h, r.width() / w, r.height() / h)
                    })
                } finally {
                    bmp.recycle()
                }
            }

            val times = generateSequence(startMs) { it + STEP_MS }.takeWhile { it < endMs }.toList()
            var frames = ArrayList<FaceFrame>(times.size + 16)
            for ((i, t) in times.withIndex()) {
                frames += detect(t)
                onProgress((i + 1f) / times.size * 0.9f)
            }

            // Where the subject jumped between two samples there was a cut. Look at the frames in
            // between until the cut is pinned down to about a frame, so the crop switches with it.
            repeat(4) { round ->
                val gaps = Reframing.cutGaps(frames, minGapMs = 45, follow = follow).take(8)
                if (gaps.isEmpty()) return@repeat
                for (gap in gaps) frames += detect((gap.first + gap.last) / 2)
                frames = ArrayList(frames.sortedBy { it.tMs })
                onProgress(0.9f + 0.025f * (round + 1))
            }

            onProgress(1f)
            frames
        } finally {
            runCatching { mmr.release() }
            detector.close()
        }
    }
}
