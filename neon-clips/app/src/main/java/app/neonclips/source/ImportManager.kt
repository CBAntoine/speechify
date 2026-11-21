package app.neonclips.source

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import app.neonclips.core.Clip
import app.neonclips.core.Fmt
import app.neonclips.core.HeatPoint
import app.neonclips.core.Highlights
import app.neonclips.core.Origin
import app.neonclips.core.Project
import app.neonclips.core.VideoHit
import app.neonclips.data.ProjectStore
import app.neonclips.data.Settings
import app.neonclips.media.AudioScan
import app.neonclips.media.MediaProbe
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

enum class Stage(val label: String) {
    QUEUED("Queued"),
    FETCHING("Downloading"),
    COPYING("Copying"),
    ANALYZING("Finding highlights"),
    DONE("Ready"),
    FAILED("Failed"),
}

data class ImportJob(
    val id: String,
    val title: String,
    val thumbnail: String? = null,
    val stage: Stage = Stage.QUEUED,
    /** 0..1, or null when the amount done is unknown. */
    val progress: Float? = null,
    val error: String? = null,
    val projectId: String? = null,
) {
    val running: Boolean get() = stage != Stage.DONE && stage != Stage.FAILED
}

/** Turns a picked file or a remote video into a project: fetch, measure loudness, pick moments. */
class ImportManager(
    private val context: Context,
    private val store: ProjectStore,
    private val settings: Settings,
    private val ytDlp: YtDlp,
    private val scope: CoroutineScope,
) {
    private val _jobs = MutableStateFlow<List<ImportJob>>(emptyList())
    val jobs: StateFlow<List<ImportJob>> = _jobs

    private val running = HashMap<String, Job>()
    private val oneAtATime = Mutex()

    fun importLocal(uri: Uri): String {
        val id = store.newId()
        val title = displayName(uri) ?: "Video"
        start(ImportJob(id, title)) {
            val dir = store.dir(id)
            // Keep reading the original where Android lets us; otherwise take a private copy.
            val source = try {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                uri
            } catch (e: SecurityException) {
                set(id) { it.copy(stage = Stage.COPYING, progress = null) }
                copyIn(uri, File(dir, "source.mp4"))
            }
            analyse(id, title, source, origin = null, heatmap = emptyList())
        }
        return id
    }

    /** [sectionSec] limits the download to that stretch of the video, in seconds. */
    fun importRemote(hit: VideoHit, sectionSec: LongRange?, heatmap: List<HeatPoint>, maxHeight: Int): String {
        val id = store.newId()
        val title = if (sectionSec == null) hit.title else "${hit.title} @ ${Fmt.clock(sectionSec.first * 1000)}"
        start(ImportJob(id, title, hit.thumbnail)) {
            set(id) { it.copy(stage = Stage.FETCHING, progress = null) }
            val file = ytDlp.download(hit.url, store.dir(id), maxHeight, sectionSec, processId = id) { p ->
                set(id) { it.copy(progress = p) }
            }
            val origin = Origin(hit.url, hit.channel, hit.views, offsetMs = (sectionSec?.first ?: 0) * 1000)
            analyse(id, title, Uri.fromFile(file), origin, heatmap)
        }
        return id
    }

    fun cancel(id: String) {
        ytDlp.cancel(id)
        running.remove(id)?.cancel()
        store.delete(id)
        _jobs.update { jobs -> jobs.filterNot { it.id == id } }
    }

    fun dismiss(id: String) = _jobs.update { jobs -> jobs.filterNot { it.id == id && !it.running } }

    private fun start(job: ImportJob, work: suspend () -> Unit) {
        _jobs.update { it + job }
        running[job.id] = scope.launch {
            try {
                oneAtATime.withLock { work() }
                set(job.id) { it.copy(stage = Stage.DONE, progress = 1f, projectId = job.id) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("NeonClips", "Import failed", e)
                store.delete(job.id)
                set(job.id) { it.copy(stage = Stage.FAILED, progress = null, error = e.message ?: "Something went wrong.") }
            } finally {
                running.remove(job.id)
            }
        }
    }

    private suspend fun analyse(id: String, title: String, source: Uri, origin: Origin?, heatmap: List<HeatPoint>) {
        set(id) { it.copy(stage = Stage.ANALYZING, progress = 0f) }
        val probe = withContext(Dispatchers.IO) { MediaProbe.probe(context, source) }
        withContext(Dispatchers.IO) { poster(source, probe.durationMs, probe.width, probe.height, File(store.dir(id), "poster.jpg")) }
        val envelope = if (probe.hasAudio) AudioScan.envelope(context, source) { p -> set(id) { it.copy(progress = p) } } else null
        if (envelope != null) withContext(Dispatchers.IO) { store.saveEnvelope(id, envelope) }
        val moments = Highlights.detect(
            envelope?.takeIf { it.rms.isNotEmpty() },
            probe.durationMs,
            heatmap,
            heatOffsetMs = origin?.offsetMs ?: 0,
            clipMs = settings.clipSeconds * 1000L,
        )
        require(probe.durationMs > 0) { "This video has no length the app can read." }
        // Every project has something to edit, even when nothing stood out.
        val clips = moments.mapIndexed { i, m -> Clip(id = "c${i + 1}", startMs = m.startMs, endMs = m.endMs) }
            .ifEmpty { listOf(Clip(id = "c1", startMs = 0, endMs = minOf(probe.durationMs, settings.clipSeconds * 1000L))) }
        store.save(
            Project(
                id = id,
                title = title,
                createdAt = System.currentTimeMillis(),
                sourceUri = source.toString(),
                durationMs = probe.durationMs,
                width = probe.width,
                height = probe.height,
                hasAudio = probe.hasAudio && envelope != null,
                origin = origin,
                moments = moments,
                clips = clips,
            )
        )
    }

    private fun poster(source: Uri, durationMs: Long, w: Int, h: Int, out: File) {
        runCatching {
            val mmr = MediaProbe.retriever(context, source)
            try {
                MediaProbe.frame(mmr, durationMs / 5, w, h, 480, exact = false)?.let { bmp ->
                    out.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 82, it) }
                    bmp.recycle()
                }
            } finally {
                mmr.release()
            }
        }
    }

    private suspend fun copyIn(uri: Uri, dest: File): Uri = withContext(Dispatchers.IO) {
        val input = context.contentResolver.openInputStream(uri) ?: error("Could not open that video.")
        input.use { i -> dest.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
        Uri.fromFile(dest)
    }

    private fun displayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.substringBeforeLast('.') else null
        }
    }.getOrNull()

    private fun set(id: String, change: (ImportJob) -> ImportJob) =
        _jobs.update { jobs -> jobs.map { if (it.id == id) change(it) else it } }
}
