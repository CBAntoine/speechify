package app.neonclips.ui.editor

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import app.neonclips.Graph
import app.neonclips.core.CamKey
import app.neonclips.core.Captions
import app.neonclips.core.Clip
import app.neonclips.core.Envelope
import app.neonclips.core.FaceFrame
import app.neonclips.core.Highlights
import app.neonclips.core.MAX_CLIP_MS
import app.neonclips.core.MIN_CLIP_MS
import app.neonclips.core.Project
import app.neonclips.core.ReframeMode
import app.neonclips.core.Reframing
import app.neonclips.core.Scribe
import app.neonclips.media.Exporter
import app.neonclips.media.FaceScan
import app.neonclips.media.MediaProbe
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

data class ExportState(
    val index: Int,
    val total: Int,
    val progress: Float,
    val step: String,
    val saved: List<Uri> = emptyList(),
    val error: String? = null,
    val finished: Boolean = false,
)

/** Everything the editor screen shows and does for one project. Lives as long as the screen. */
@OptIn(UnstableApi::class)
@Stable
class EditorController(
    private val context: Context,
    initial: Project,
    private val scope: CoroutineScope,
) {
    private val store = Graph.store
    private val settings = Graph.settings
    private val exporter = Exporter(context)
    private val sourceUri: Uri = Uri.parse(initial.sourceUri)

    var project by mutableStateOf(initial)
        private set
    var clipId by mutableStateOf(initial.clips.firstOrNull()?.id)
        private set
    val clip: Clip? get() = clipId?.let(project::clip)
    val envelope: Envelope? = store.loadEnvelope(initial.id)

    /** Playhead in source time. Updated every frame while the screen is showing. */
    val positionMs = mutableLongStateOf(initial.clips.firstOrNull()?.startMs ?: 0L)
    var playing by mutableStateOf(false)
        private set

    /** The stretch of the source the timeline shows. */
    var windowStart by mutableLongStateOf(0L)
        private set
    var windowEnd by mutableLongStateOf(initial.durationMs)
        private set
    var thumbs by mutableStateOf<List<Bitmap>>(emptyList())
        private set

    var tracking by mutableStateOf<Float?>(null)
        private set
    var transcribing by mutableStateOf(false)
        private set
    var exporting by mutableStateOf<ExportState?>(null)
        private set
    var message by mutableStateOf<String?>(null)

    val player: ExoPlayer = ExoPlayer.Builder(context).build().apply {
        setMediaItem(MediaItem.fromUri(sourceUri))
        prepare()
        addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
            }

            override fun onPlayerError(error: PlaybackException) {
                message = "This video could not be played: ${error.errorCodeName}"
            }
        })
    }

    private var saveJob: Job? = null
    private var trackJob: Job? = null
    private var thumbJob: Job? = null
    private var exportJob: Job? = null
    private var captionJob: Job? = null

    init {
        clip?.let {
            player.seekTo(it.startMs)
            fitWindow()
            ensureTracked()
        }
        applyPreviewGain()
    }

    // ---- playback ----

    /** Called once per display frame: follows the player and loops playback inside the clip. */
    fun onFrame() {
        val c = clip ?: return
        if (scrubbing) return
        val pos = player.currentPosition
        if (player.isPlaying && (pos >= c.endMs || pos < c.startMs - 250)) {
            player.seekTo(c.startMs)
            positionMs.longValue = c.startMs
        } else if (player.isPlaying || !seekPending()) {
            positionMs.longValue = pos
        }
    }

    private var lastSeekAt = 0L
    private fun seekPending() = android.os.SystemClock.uptimeMillis() - lastSeekAt < 400

    private var scrubbing = false

    fun seek(ms: Long) {
        val t = ms.coerceIn(0, max(0, project.durationMs - 1))
        lastSeekAt = android.os.SystemClock.uptimeMillis()
        positionMs.longValue = t
        player.seekTo(t)
    }

    fun beginScrub() {
        scrubbing = true
        player.pause()
        runCatching { player.isScrubbingModeEnabled = true }
    }

    fun endScrub() {
        scrubbing = false
        runCatching { player.isScrubbingModeEnabled = false }
        lastSeekAt = android.os.SystemClock.uptimeMillis()
    }

    fun togglePlay() {
        val c = clip ?: return
        if (player.isPlaying) {
            player.pause()
        } else {
            val pos = positionMs.longValue
            if (pos >= c.endMs - 100 || pos < c.startMs) seek(c.startMs)
            player.play()
        }
    }

    fun pause() = player.pause()

    private fun applyPreviewGain() {
        // The preview can only turn sound down; boosts are applied in the export.
        player.volume = 10f.pow((clip?.gainDb ?: 0f) / 20f).coerceIn(0f, 1f)
    }

    // ---- clips ----

    fun select(id: String) {
        if (project.clip(id) == null) return
        player.pause()
        clipId = id
        val c = clip!!
        seek(c.startMs)
        fitWindow()
        applyPreviewGain()
        ensureTracked()
    }

    fun update(change: (Clip) -> Clip) {
        val c = clip ?: return
        updateClip(c.id, change)
    }

    private fun updateClip(id: String, change: (Clip) -> Clip) {
        val c = project.clip(id) ?: return
        project = project.withClip(change(c))
        saveSoon()
    }

    private fun saveSoon() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(500)
            val snapshot = project
            withContext(Dispatchers.IO) { store.save(snapshot) }
        }
    }

    /** Adds a clip of the default length starting at the playhead and selects it. */
    fun newClipAtPlayhead() {
        val len = settings.clipSeconds * 1000L
        val start = positionMs.longValue.coerceIn(0, max(0, project.durationMs - MIN_CLIP_MS))
        val end = min(project.durationMs, start + len)
        val id = "c" + ((project.clips.mapNotNull { it.id.removePrefix("c").toIntOrNull() }.maxOrNull() ?: 0) + 1)
        project = project.withClip(Clip(id = id, startMs = start, endMs = end))
        saveSoon()
        select(id)
    }

    fun deleteClip() {
        val c = clip ?: return
        if (project.clips.size <= 1) {
            message = "A project keeps at least one clip."
            return
        }
        val index = project.clips.indexOf(c)
        project = project.copy(clips = project.clips - c)
        saveSoon()
        select(project.clips[min(index, project.clips.lastIndex)].id)
    }

    /** Moves the clip's ends. Keeps it inside the source and between the shortest and longest allowed lengths. */
    fun setRange(startMs: Long, endMs: Long) = update { c ->
        var s = startMs.coerceIn(0, project.durationMs - MIN_CLIP_MS)
        var e = endMs.coerceIn(s + MIN_CLIP_MS, project.durationMs)
        if (e - s > MAX_CLIP_MS) {
            if (s != c.startMs) s = e - MAX_CLIP_MS else e = s + MAX_CLIP_MS
        }
        c.copy(startMs = s, endMs = e, captions = Captions.within(c.captions, s, e))
    }

    /** Clip ends land in a pause, or beside a word rather than inside it, when this is on. */
    var snap by mutableStateOf(true)

    /**
     * Call when a trim ends. [movedStart] says which end moved (null for neither). With snap on
     * that end is moved to the nearest clean cut point; then the timeline re-centres and any
     * newly exposed footage is tracked.
     */
    fun rangeSettled(movedStart: Boolean? = null) {
        val c = clip
        if (c != null && snap && movedStart != null) {
            if (movedStart) setRange(Highlights.snapEdge(envelope, c.captions, c.startMs, isStart = true), c.endMs)
            else setRange(c.startMs, Highlights.snapEdge(envelope, c.captions, c.endMs, isStart = false))
        }
        fitWindow()
        ensureTracked()
    }

    fun setIn() {
        val c = clip ?: return
        setRange(positionMs.longValue, c.endMs)
        rangeSettled(movedStart = true)
    }

    fun setOut() {
        val c = clip ?: return
        setRange(c.startMs, positionMs.longValue)
        rangeSettled(movedStart = false)
    }

    private fun fitWindow() {
        val c = clip ?: return
        val pad = max(2_500L, c.durationMs / 4)
        windowStart = max(0, c.startMs - pad)
        windowEnd = min(project.durationMs, c.endMs + pad)
        loadThumbs()
    }

    private fun loadThumbs() {
        val from = windowStart
        val to = windowEnd
        thumbJob?.cancel()
        thumbJob = scope.launch {
            val frames = withContext(Dispatchers.IO) {
                val out = ArrayList<Bitmap>(THUMBS)
                runCatching {
                    val mmr = MediaProbe.retriever(context, sourceUri)
                    try {
                        for (i in 0 until THUMBS) {
                            val t = from + (to - from) * (2 * i + 1) / (2 * THUMBS)
                            MediaProbe.frame(mmr, t, project.width, project.height, 160, exact = false)?.let { out += it }
                        }
                    } finally {
                        mmr.release()
                    }
                }.onFailure { Log.w("NeonClips", "Timeline thumbnails failed", it) }
                out
            }
            thumbs = frames
        }
    }

    // ---- reframe ----

    fun setMode(mode: ReframeMode) {
        update { c ->
            val keys = when (mode) {
                // Leaving auto for manual starts from one fixed framing where the camera is now.
                ReframeMode.MANUAL -> Reframing.shotAt(c.reframe, project.width, project.height, positionMs.longValue)
                    .let { listOf(CamKey(c.startMs, it.cx, it.cy)) }
                ReframeMode.AUTO -> emptyList()
                ReframeMode.CENTER -> c.reframe.keys
            }
            c.copy(reframe = c.reframe.copy(mode = mode, keys = keys, follow = null, trackedFromMs = -1, trackedToMs = -1))
        }
        if (mode == ReframeMode.AUTO) ensureTracked() else trackJob?.cancel()
    }

    fun setZoom(zoom: Float) = update { it.copy(reframe = it.reframe.copy(zoom = zoom.coerceIn(1f, Reframing.MAX_ZOOM))) }

    /**
     * Moves the crop by a fraction of the source frame. In auto mode the whole tracked path is
     * nudged; in manual mode with several keyframes the one at the playhead is set; otherwise
     * the single fixed framing moves.
     */
    fun pan(dx: Float, dy: Float) = update { c ->
        val t = positionMs.longValue
        val r = c.reframe
        val win = Reframing.window(project.width, project.height, r.zoom)
        val shot = Reframing.shotAt(r, project.width, project.height, t)
        val cx = Reframing.clampCenter(shot.cx + dx, win.w)
        val cy = Reframing.clampCenter(shot.cy + dy, win.h)
        when {
            r.mode == ReframeMode.AUTO && r.keys.isNotEmpty() -> {
                val ox = cx - shot.cx
                val oy = cy - shot.cy
                c.copy(reframe = r.copy(keys = r.keys.map { it.copy(cx = it.cx + ox, cy = it.cy + oy) }))
            }
            r.mode == ReframeMode.MANUAL && r.keys.size >= 2 ->
                c.copy(reframe = r.copy(keys = Reframing.upsertKey(r.keys, CamKey(t, cx, cy))))
            else -> c.copy(
                reframe = r.copy(mode = ReframeMode.MANUAL, keys = listOf(CamKey(c.startMs, cx, cy)), trackedFromMs = -1, trackedToMs = -1)
            )
        }
    }

    /** Pins the current framing at the playhead so the camera can move to or from it. */
    fun addKey() = update { c ->
        val t = positionMs.longValue.coerceIn(c.startMs, c.endMs)
        val shot = Reframing.shotAt(c.reframe, project.width, project.height, t)
        val base = if (c.reframe.mode == ReframeMode.MANUAL) c.reframe.keys else emptyList()
        c.copy(reframe = c.reframe.copy(mode = ReframeMode.MANUAL, keys = Reframing.upsertKey(base, CamKey(t, shot.cx, shot.cy))))
    }

    fun deleteKeyNearPlayhead() = update { c ->
        val t = positionMs.longValue
        val nearest = c.reframe.keys.minByOrNull { kotlin.math.abs(it.tMs - t) } ?: return@update c
        if (c.reframe.keys.size <= 1) return@update c
        c.copy(reframe = c.reframe.copy(keys = c.reframe.keys - nearest))
    }

    /** Scans again from scratch and goes back to the automatic choice of who to follow. */
    fun retrack() {
        clip?.let { scans.remove(it.id) }
        update { it.copy(reframe = it.reframe.copy(mode = ReframeMode.AUTO, keys = emptyList(), follow = null, trackedFromMs = -1, trackedToMs = -1)) }
        ensureTracked()
    }

    private fun trackRange(c: Clip): Pair<Long, Long> =
        max(0, c.startMs - 1_500) to min(project.durationMs, c.endMs + 1_500)

    private fun ensureTracked() {
        val c = clip ?: return
        if (c.reframe.mode != ReframeMode.AUTO || c.reframe.isTracked(c.startMs, c.endMs)) return
        trackJob?.cancel()
        trackJob = scope.launch {
            tracking = 0f
            try {
                track(c) { tracking = it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("NeonClips", "Face tracking failed", e)
                message = "Face tracking failed, so the crop stays centred."
            } finally {
                tracking = null
            }
        }
    }

    /** Face detections per clip, kept so the camera path can be rebuilt without another scan. */
    private class Scan(val fromMs: Long, val toMs: Long, val frames: List<FaceFrame>)

    private val scans = HashMap<String, Scan>()

    private fun pathFor(c: Clip, frames: List<FaceFrame>): List<CamKey> =
        Reframing.autoPath(frames, Reframing.window(project.width, project.height, c.reframe.zoom), c.reframe.follow)

    /**
     * Follow the person at this point of the source frame (0..1) instead of the automatic pick.
     * Uses the detections already made for this clip when there are any.
     */
    fun follow(x: Float, y: Float) {
        val c = clip ?: return
        val pick = CamKey(positionMs.longValue.coerceIn(c.startMs, c.endMs), x, y)
        val scan = scans[c.id]?.takeIf { it.fromMs <= c.startMs && it.toMs >= c.endMs }
        update { now ->
            val r = now.reframe.copy(mode = ReframeMode.AUTO, follow = pick)
            if (scan != null) now.copy(reframe = r.copy(keys = pathFor(now.copy(reframe = r), scan.frames), trackedFromMs = scan.fromMs, trackedToMs = scan.toMs))
            else now.copy(reframe = r.copy(keys = emptyList(), trackedFromMs = -1, trackedToMs = -1))
        }
        if (scan == null) ensureTracked()
        message = "Following the face you tapped."
    }

    private suspend fun track(c: Clip, onProgress: (Float) -> Unit): Clip {
        val (from, to) = trackRange(c)
        val frames = FaceScan.scan(context, sourceUri, project.width, project.height, from, to, c.reframe.follow, onProgress)
        scans[c.id] = Scan(from, to, frames)
        val keys = pathFor(c, frames)
        updateClip(c.id) { now ->
            if (now.reframe.mode != ReframeMode.AUTO) now
            else now.copy(reframe = now.reframe.copy(keys = keys, trackedFromMs = from, trackedToMs = to))
        }
        return project.clip(c.id) ?: c
    }

    // ---- captions ----

    fun setHook(text: String) = update { it.copy(hook = text.take(60)) }

    fun setCaptionShift(ms: Float) = update { it.copy(captionShiftMs = (ms / 10).toLong() * 10) }

    /** Bumped whenever the caption list is replaced wholesale, so the editor rebuilds its rows. */
    var captionsVersion by mutableIntStateOf(0)
        private set

    fun editCaption(startMs: Long, text: String) = update { c ->
        c.copy(captions = c.captions.map { if (it.startMs == startMs) Captions.retext(it, text) else it })
    }

    fun deleteCaption(startMs: Long) = update { c -> c.copy(captions = c.captions.filterNot { it.startMs == startMs }) }

    fun addCaption() = update { c ->
        val t = positionMs.longValue.coerceIn(c.startMs, c.endMs - 300)
        c.copy(captions = Captions.insert(c.captions, t, "Caption"), captionsOn = true)
    }

    fun autoCaption() {
        val c = clip ?: return
        val key = settings.elevenLabsKey
        when {
            transcribing -> return
            !project.hasAudio -> { message = "This video has no sound to caption."; return }
            key.isBlank() -> { message = "Add your ElevenLabs API key in Settings to caption automatically."; return }
        }
        player.pause()
        captionJob = scope.launch {
            transcribing = true
            val audio = File(context.cacheDir, "caption-${project.id}-${c.id}.m4a")
            try {
                exporter.extractAudio(project, c, audio)
                val words = withContext(Dispatchers.IO) { Scribe.transcribe(audio, key) }
                val captions = Captions.shift(Captions.fromWords(words), c.startMs)
                updateClip(c.id) { it.copy(captions = Captions.within(captions, it.startMs, it.endMs), captionsOn = true) }
                captionsVersion++
                message = if (captions.isEmpty()) "No speech was found in this clip." else "${captions.size} captions added."
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("NeonClips", "Captions failed", e)
                message = "Captions failed: ${e.message ?: "unknown error"}"
            } finally {
                audio.delete()
                transcribing = false
            }
        }
    }

    // ---- audio ----

    fun setGain(db: Float) {
        update { it.copy(gainDb = db.coerceIn(-12f, 12f)) }
        applyPreviewGain()
    }

    /** Gain that brings the clip's average loudness to a level that holds up on phone speakers. */
    fun normalise() {
        val c = clip ?: return
        val env = envelope ?: return
        val a = (c.startMs / env.hopMs).toInt().coerceIn(0, env.rms.size)
        val z = (c.endMs / env.hopMs).toInt().coerceIn(a, env.rms.size)
        if (z - a < 4) return
        var sum = 0.0
        for (i in a until z) sum += env.rms[i].toDouble() * env.rms[i]
        val meanDb = Envelope.toDb(kotlin.math.sqrt(sum / (z - a)).toFloat())
        setGain(TARGET_DB - meanDb)
    }

    // ---- export ----

    fun export(all: Boolean) {
        val targets = if (all) project.clips else listOfNotNull(clip)
        if (targets.isEmpty() || exportJob?.isActive == true) return
        player.pause()
        exportJob = scope.launch {
            val saved = ArrayList<Uri>()
            var state = ExportState(0, targets.size, 0f, "Starting")
            exporting = state
            try {
                for ((i, target) in targets.withIndex()) {
                    var c = project.clip(target.id) ?: continue
                    state = state.copy(index = i, progress = 0f, step = "Tracking faces")
                    exporting = state
                    if (c.reframe.mode == ReframeMode.AUTO && !c.reframe.isTracked(c.startMs, c.endMs)) {
                        c = track(c) { p -> exporting = state.copy(progress = p * 0.2f) }
                    }
                    state = state.copy(step = "Rendering")
                    val out = File(context.filesDir, "exports/${project.id}-${c.id}.mp4")
                    exporter.export(project, c, out, settings.exportHeight) { p ->
                        exporting = state.copy(progress = 0.2f + p * 0.8f)
                    }
                    val name = "NeonClips-${safeName(project.title)}-${c.id}-${System.currentTimeMillis() / 1000}.mp4"
                    val uri = withContext(Dispatchers.IO) { Exporter.saveToGallery(context, out, name) }
                    out.delete()
                    saved += uri
                    updateClip(c.id) { it.copy(exportedUri = uri.toString()) }
                }
                exporting = state.copy(progress = 1f, step = "Saved", saved = saved, finished = true)
            } catch (e: CancellationException) {
                exporting = null
                throw e
            } catch (e: Exception) {
                Log.w("NeonClips", "Export failed", e)
                exporting = state.copy(error = e.message ?: "The export failed.", saved = saved, finished = true)
            }
        }
    }

    fun cancelExport() {
        exportJob?.cancel()
        exporting = null
    }

    fun closeExport() {
        if (exporting?.finished == true) exporting = null
    }

    fun share(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val intent = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris.first())
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        }
        intent.type = "video/mp4"
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching {
            context.startActivity(Intent.createChooser(intent, "Share clip").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { message = "No app on this phone can receive the video." }
    }

    private fun safeName(title: String) = title.replace(Regex("[^A-Za-z0-9]+"), "-").trim('-').take(32).ifEmpty { "clip" }

    fun release() {
        trackJob?.cancel()
        thumbJob?.cancel()
        captionJob?.cancel()
        exportJob?.cancel()
        saveJob?.cancel()
        player.release()
        val snapshot = project
        // Outlives the screen on purpose: the last edit must reach disk.
        Graph.scope.launch(Dispatchers.IO) { store.save(snapshot) }
    }

    private companion object {
        const val THUMBS = 10
        const val TARGET_DB = -16f
    }
}
