package app.neonclips.source

import android.content.Context
import android.util.Log
import app.neonclips.core.Discover
import app.neonclips.core.Length
import app.neonclips.core.RemoteInfo
import app.neonclips.core.TimeWindow
import app.neonclips.core.VideoHit
import app.neonclips.data.Settings
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/** [raw] is the downloader's own error text, when there was one. */
class SourceException(message: String, val raw: String = message) : Exception(message)

/**
 * Finds and fetches videos with yt-dlp, which runs on the phone itself. The first call unpacks
 * its Python runtime, which takes a few seconds.
 */
class YtDlp(private val context: Context, private val settings: Settings, private val scope: CoroutineScope) {
    private val initLock = Mutex()
    private var ready = false
    private var updatedThisRun = false

    private suspend fun ensureReady() = initLock.withLock {
        if (!ready) start()
        refreshIfStale()
    }

    /**
     * The yt-dlp that ships inside the app is as old as the app. Video sites break old versions
     * within weeks, so the newest one is fetched before first use and every few days after.
     * Being offline or slow just skips it; the next call tries again.
     */
    private suspend fun refreshIfStale() {
        if (System.currentTimeMillis() - settings.downloaderUpdatedAt < REFRESH_EVERY_MS) return
        // The fetch runs on its own so a dead connection cannot hold a search hostage: after
        // half a minute the caller carries on with the version it has and the fetch finishes
        // (or fails) in the background.
        val job = refreshing?.takeIf { it.isActive } ?: scope.async(Dispatchers.IO) {
            try {
                YoutubeDL.getInstance().updateYoutubeDL(context, YoutubeDL.UpdateChannel._NIGHTLY)
                updatedThisRun = true
                settings.downloaderUpdatedAt = System.currentTimeMillis()
            } catch (e: Throwable) {
                Log.w("NeonClips", "Downloader update skipped", e)
            }
            Unit
        }.also { refreshing = it }
        withTimeoutOrNull(30_000) { job.await() }
    }

    private var refreshing: Deferred<Unit>? = null

    private suspend fun start() {
        withContext(Dispatchers.IO) {
            try {
                YoutubeDL.getInstance().init(context)
                FFmpeg.getInstance().init(context)
            } catch (e: Throwable) {
                // Errors too, not just exceptions: a downloader that cannot start must never take the app down.
                Log.e("NeonClips", "Downloader failed to start", e)
                throw SourceException("The downloader could not start: ${e.message ?: e.javaClass.simpleName}")
            }
        }
        ready = true
    }

    /** Videos for [query], most viewed first, limited to [window]. */
    suspend fun search(query: String, window: TimeWindow, length: Length, limit: Int = 30): List<VideoHit> {
        val out = run {
            YoutubeDLRequest(Discover.searchUrl(query, window, length)).apply {
                addOption("--flat-playlist")
                addOption("--dump-json")
                addOption("--playlist-end", limit)
                addOption("--extractor-args", "youtubetab:approximate_date")
                addOption("--no-warnings")
            }
        }
        return Discover.parseSearch(out)
    }

    /** Title, length, views and the "most replayed" graph for one video. */
    suspend fun info(url: String): RemoteInfo {
        val out = run {
            YoutubeDLRequest(url).apply {
                addOption("--dump-json")
                addOption("--skip-download")
                addOption("--no-playlist")
                addOption("--no-warnings")
            }
        }
        return Discover.parseInfo(out) ?: throw SourceException("Could not read that video's details.")
    }

    /**
     * Downloads [url] into [dir] as MP4, at most [maxHeight] pixels tall. With [sectionSec] only
     * that stretch (in seconds) is fetched. Returns the file. [onProgress] gets 0..1, or null
     * when the amount done is unknown.
     */
    suspend fun download(
        url: String,
        dir: File,
        maxHeight: Int,
        sectionSec: LongRange?,
        processId: String,
        onProgress: (Float?) -> Unit,
    ): File {
        dir.mkdirs()
        dir.listFiles { f -> f.name.startsWith("source.") }?.forEach { it.delete() }
        val sectionLen = sectionSec?.let { (it.last - it.first).coerceAtLeast(1) }
        // Errors arrive on the same stream as progress here, so the last one is remembered.
        run(processId, mergeErrors = true, onLine = { percent, line ->
            if (sectionLen != null) {
                // A section is cut out by ffmpeg, which reports how much time it has written.
                FFMPEG_TIME.find(line)?.let { t ->
                    val (h, m, s) = t.destructured
                    onProgress(((h.toInt() * 3600 + m.toInt() * 60 + s.toFloat()) / sectionLen).coerceIn(0f, 1f))
                }
            } else if (percent > 0f) {
                onProgress((percent / 100f).coerceIn(0f, 1f))
            }
        }) {
            YoutubeDLRequest(url).apply {
                // H.264 + AAC first: every phone decodes it and the editor can scrub it smoothly.
                addOption(
                    "-f",
                    "bv*[height<=$maxHeight][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=$maxHeight][ext=mp4]/" +
                        "bv*[height<=$maxHeight]+ba/b[height<=$maxHeight]/b"
                )
                addOption("--merge-output-format", "mp4")
                if (sectionSec != null) addOption("--download-sections", "*${sectionSec.first}-${sectionSec.last}")
                addOption("--no-playlist")
                addOption("--no-mtime")
                addOption("--no-part")
                addOption("-o", File(dir, "source.%(ext)s").absolutePath)
            }
        }
        return dir.listFiles { f -> f.name.startsWith("source.") && f.length() > 0 }?.maxByOrNull { it.length() }
            ?: throw SourceException("The download finished but no video file was written.")
    }

    fun cancel(processId: String) {
        runCatching { YoutubeDL.getInstance().destroyProcessById(processId) }
    }

    /** Fetches the newest yt-dlp. Sites change often; this is the fix when downloads start failing. */
    suspend fun update(): String {
        ensureReady()
        return withContext(Dispatchers.IO) {
            try {
                YoutubeDL.getInstance().updateYoutubeDL(context, YoutubeDL.UpdateChannel._NIGHTLY)
                updatedThisRun = true
                settings.downloaderUpdatedAt = System.currentTimeMillis()
                YoutubeDL.getInstance().versionName(context) ?: "updated"
            } catch (e: Exception) {
                throw SourceException("Could not update the downloader: ${e.message}")
            }
        }
    }

    fun version(): String? = runCatching { YoutubeDL.getInstance().versionName(context) }.getOrNull()

    private suspend fun run(
        processId: String? = null,
        mergeErrors: Boolean = false,
        onLine: ((Float, String) -> Unit)? = null,
        request: () -> YoutubeDLRequest,
    ): String {
        ensureReady()
        return try {
            execute(request(), processId, mergeErrors, onLine)
        } catch (e: SourceException) {
            // Sites change their pages often. One refresh of yt-dlp fixes most extraction failures.
            if (updatedThisRun || !e.raw.looksLikeStaleExtractor()) throw e
            runCatching { update() }.getOrElse { throw e }
            execute(request(), processId, mergeErrors, onLine)
        }
    }

    private suspend fun execute(
        request: YoutubeDLRequest,
        processId: String?,
        mergeErrors: Boolean,
        onLine: ((Float, String) -> Unit)?,
    ): String {
        var lastError = ""
        return try {
            runInterruptible(Dispatchers.IO) {
                YoutubeDL.getInstance().execute(request, processId, mergeErrors) { percent, _, line ->
                    if (line.startsWith("ERROR")) lastError = line
                    onLine?.invoke(percent, line)
                }.out
            }
        } catch (e: CancellationException) {
            processId?.let(::cancel)
            throw e
        } catch (e: YoutubeDL.CanceledException) {
            throw CancellationException("Cancelled")
        } catch (e: Exception) {
            val raw = e.message.orEmpty().ifBlank { lastError }
            throw SourceException(friendly(raw), raw)
        }
    }

    private fun String.looksLikeStaleExtractor(): Boolean =
        listOf("Unable to extract", "nsig", "Signature extraction", "player", "Unsupported URL", "format is not available", "HTTP Error 403")
            .any { contains(it, ignoreCase = true) }

    private fun friendly(raw: String): String {
        val line = raw.lineSequence().map { it.trim() }.lastOrNull { it.startsWith("ERROR") } ?: raw.trim().lineSequence().lastOrNull().orEmpty()
        return when {
            raw.contains("not a bot", true) || raw.contains("Sign in to confirm", true) ->
                "The site asked this network to sign in before it will serve the video. Try again later or on another connection."
            raw.contains("Private video", true) -> "That video is private."
            raw.contains("live event will begin", true) || raw.contains("is live", true) -> "That stream is still live. Clip it once it has ended."
            OFFLINE.any { raw.contains(it, true) } -> "No connection to the site. Check your internet and try again."
            raw.contains("Unsupported URL", true) -> "That link is not a video the downloader recognises."
            line.isNotBlank() -> line.removePrefix("ERROR:").trim().take(220)
            else -> "The download failed."
        }
    }

    private companion object {
        const val REFRESH_EVERY_MS = 3 * 24 * 3600 * 1000L
        val FFMPEG_TIME = Regex("""time=(\d+):(\d+):(\d+(?:\.\d+)?)""")

        /** Ways the downloader says the network is not there. */
        val OFFLINE = listOf(
            "No address associated with hostname", "Temporary failure in name resolution", "Name or service not known",
            "Network is unreachable", "resolve host", "timed out", "Connection refused", "Connection reset",
            "Unable to download webpage", "Unable to download API page", "TransportError",
        )
    }
}
