package app.neonclips

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.neonclips.core.CamKey
import app.neonclips.core.Caption
import app.neonclips.core.Captions
import app.neonclips.core.Clip
import app.neonclips.core.Discover
import app.neonclips.core.TimeWindow
import app.neonclips.core.Highlights
import app.neonclips.core.Project
import app.neonclips.core.Reframe
import app.neonclips.core.ReframeMode
import app.neonclips.core.Reframing
import app.neonclips.media.AudioScan
import app.neonclips.media.Exporter
import app.neonclips.media.FaceScan
import app.neonclips.media.MediaProbe
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.abs

/**
 * Runs the real media pipeline on a device: probing, loudness, face tracking and rendering.
 * The two small videos in the test assets are synthetic: `landscape.mp4` is red on the left and
 * blue on the right with a loud burst at 5.0 s; `portrait_rotated.mp4` is stored sideways with a
 * rotation flag, green on top and yellow below once upright.
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class PipelineTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun asset(name: String): File {
        val file = File(context.cacheDir, name)
        instrumentation.context.assets.open(name).use { input -> file.outputStream().use { input.copyTo(it) } }
        return file
    }

    /** Kept after the run so the rendered files can be pulled off the device and looked at. */
    private val outDir = File(context.getExternalFilesDir(null), "test-out").apply { mkdirs() }

    private fun project(file: File): Project {
        val probe = MediaProbe.probe(context, Uri.fromFile(file))
        return Project("t", "test", 0, Uri.fromFile(file).toString(), probe.durationMs, probe.width, probe.height, probe.hasAudio)
    }

    private fun frame(file: File, tMs: Long): Bitmap {
        val mmr = MediaMetadataRetriever()
        mmr.setDataSource(file.absolutePath)
        try {
            return mmr.getFrameAtTime(tMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST)!!
        } finally {
            mmr.release()
        }
    }

    private fun rgb(b: Bitmap, fx: Float, fy: Float): Triple<Int, Int, Int> {
        val p = b.getPixel((b.width * fx).toInt(), (b.height * fy).toInt())
        return Triple(p shr 16 and 0xFF, p shr 8 and 0xFF, p and 0xFF)
    }

    /** Share of pixels in the horizontal band around [fy] that satisfy [match]. */
    private fun share(b: Bitmap, fy: Float, halfBand: Float, match: (Int, Int, Int) -> Boolean): Float {
        var hits = 0
        var total = 0
        for (y in (b.height * (fy - halfBand)).toInt() until (b.height * (fy + halfBand)).toInt()) {
            for (x in 0 until b.width) {
                val p = b.getPixel(x, y)
                if (match(p shr 16 and 0xFF, p shr 8 and 0xFF, p and 0xFF)) hits++
                total++
            }
        }
        return hits.toFloat() / total
    }

    private val isPink = { r: Int, g: Int, b: Int -> r > 200 && g < 130 && b in 80..200 }
    private val isWhite = { r: Int, g: Int, b: Int -> r > 225 && g > 225 && b > 225 }

    @Test
    fun probeReadsSizeDurationAndRotation() {
        val land = MediaProbe.probe(context, Uri.fromFile(asset("landscape.mp4")))
        assertEquals(640 to 360, land.width to land.height)
        assertTrue(land.hasAudio)
        assertTrue("duration ${land.durationMs}", abs(land.durationMs - 8000) < 200)

        val portrait = MediaProbe.probe(context, Uri.fromFile(asset("portrait_rotated.mp4")))
        assertEquals("a sideways file must be reported upright", 360 to 640, portrait.width to portrait.height)
        assertTrue(!portrait.hasAudio)
    }

    @Test
    fun loudnessFindsTheBurst() = runBlocking {
        val file = asset("landscape.mp4")
        val env = AudioScan.envelope(context, Uri.fromFile(file))!!
        assertTrue("envelope covers ${env.durationMs} ms", abs(env.durationMs - 8000) < 300)
        val loudest = env.rms.indices.maxBy { env.rms[it] } * env.hopMs
        assertTrue("loudest at $loudest ms", loudest in 4900..5600)
        val quiet = env.rms[20]
        val loud = env.rms[(5200 / env.hopMs)]
        assertTrue("burst $loud vs talk $quiet", loud > quiet * 8)

        val moment = Highlights.detect(env, 8000, clipMs = 3000, maxCount = 1).single()
        assertTrue("moment $moment should contain the burst", 5200 in moment.startMs..moment.endMs)
        assertEquals(null, AudioScan.envelope(context, Uri.fromFile(asset("portrait_rotated.mp4"))))
    }

    @Test
    fun exportMovesTheCropCutsOnTimeAndBurnsText() = runBlocking {
        val project = project(asset("landscape.mp4"))
        // Left half until source time 4.0 s, then a hard cut to the right half.
        val clip = Clip(
            id = "c1",
            startMs = 2000,
            endMs = 6000,
            hook = "Hook",
            reframe = Reframe(ReframeMode.MANUAL, listOf(CamKey(2000, 0.25f), CamKey(3999, 0.25f), CamKey(4000, 0.75f))),
            captions = listOf(Captions.retext(Caption(5000, 5900, "late one"), "late one")),
            gainDb = 6f,
        )
        val out = File(outDir, "landscape-out.mp4")
        var lastProgress = 0f
        val result = Exporter(context).export(project, clip, out, 640) { lastProgress = it }

        assertTrue(out.length() > 10_000)
        assertEquals(360 to 640, result.width to result.height)
        assertTrue("duration ${result.durationMs}", abs(result.durationMs - 4000) < 250)
        assertTrue("progress was reported ($lastProgress)", lastProgress > 0f)

        val early = frame(out, 1000) // source 3.0 s
        assertEquals("output must be upright 9:16", 360 to 640, early.width to early.height)
        rgb(early, 0.5f, 0.9f).let { (r, _, b) -> assertTrue("left half is red, got r=$r b=$b", r > b + 40) }
        val afterCut = frame(out, 2300) // source 4.3 s
        rgb(afterCut, 0.5f, 0.9f).let { (r, _, b) -> assertTrue("right half is blue, got r=$r b=$b", b > r + 40) }
        val beforeCut = frame(out, 1800) // source 3.8 s
        rgb(beforeCut, 0.5f, 0.9f).let { (r, _, b) -> assertTrue("still red just before the cut, got r=$r b=$b", r > b + 40) }

        // Hook title: pink, in the upper part, only during the opening.
        assertTrue("hook visible at 0.5 s", share(frame(out, 500), 0.2f, 0.05f, isPink) > 0.02f)
        assertTrue("hook gone at 3.0 s", share(frame(out, 3000), 0.2f, 0.05f, isPink) < 0.002f)
        // Caption at source 5.0-5.9 s = output 3.0-3.9 s, lower third; the second word is lit pink late on.
        val captioned = frame(out, 3200)
        assertTrue("caption visible at 3.2 s", share(captioned, 0.7f, 0.05f, isWhite) > 0.01f)
        assertTrue("no caption at 2.6 s", share(frame(out, 2600), 0.7f, 0.05f, isWhite) < 0.002f)
        assertTrue("spoken word lit at 3.7 s", share(frame(out, 3700), 0.7f, 0.05f, isPink) > 0.005f)
    }

    @Test
    fun exportOfSidewaysSourceComesOutUpright() = runBlocking {
        val project = project(asset("portrait_rotated.mp4"))
        val clip = Clip(id = "c1", startMs = 500, endMs = 2500, reframe = Reframe(ReframeMode.CENTER))
        val out = File(outDir, "portrait-out.mp4")
        Exporter(context).export(project, clip, out, 640) {}
        val f = frame(out, 1000)
        assertEquals(360 to 640, f.width to f.height)
        rgb(f, 0.5f, 0.15f).let { (r, g, b) -> assertTrue("top is green, got $r,$g,$b", g > r + 40 && g > b + 40) }
        rgb(f, 0.5f, 0.9f).let { (r, g, b) -> assertTrue("bottom is yellow, got $r,$g,$b", r > 180 && g > 150 && b < 110) }
    }

    @Test
    fun audioOfAClipIsExtractedForCaptioning() = runBlocking {
        val project = project(asset("landscape.mp4"))
        val out = File(outDir, "clip-audio.m4a")
        Exporter(context).extractAudio(project, Clip("c1", 4000, 7000), out)
        assertTrue(out.length() > 1000)
        val mmr = MediaMetadataRetriever()
        mmr.setDataSource(out.absolutePath)
        val duration = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
        val hasVideo = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO)
        mmr.release()
        assertTrue("duration $duration", abs(duration - 3000) < 250)
        assertTrue("audio only", hasVideo != "yes")
    }

    /**
     * Needs a video with a real face, which is not shipped in the repo. Push one where the face
     * sits at the left for 3 s and then jumps to the right:
     * `adb push face_cut.mp4 /data/local/tmp/` then `adb shell run-as app.neonclips cp /data/local/tmp/face_cut.mp4 cache/`.
     */
    @Test
    fun faceTrackingFollowsAFaceAndFindsTheCut() = runBlocking {
        val file = File(context.cacheDir, "face_cut.mp4")
        assumeTrue("face_cut.mp4 not pushed", file.exists())
        val probe = MediaProbe.probe(context, Uri.fromFile(file))
        var progress = 0f
        val frames = FaceScan.scan(context, Uri.fromFile(file), probe.width, probe.height, 0, probe.durationMs) { progress = it }
        val keys = Reframing.autoPath(frames, Reframing.window(probe.width, probe.height))
        File(outDir, "face-keys.txt").writeText(keys.joinToString("\n"))
        assertTrue("found a face path: $keys", keys.size >= 2)
        assertEquals(1f, progress, 0.001f)
        val left = Reframing.sample(keys, 1500).first
        val right = Reframing.sample(keys, 4500).first
        assertTrue("left framing $left", abs(left - 0.27f) < 0.07f)
        assertTrue("right framing $right", abs(right - 0.77f) < 0.07f)
        // The cut is at 3.0 s; the crop must switch within a couple of frames of it.
        assertTrue("still left at 2.9 s", Reframing.sample(keys, 2900).first < 0.4f)
        assertTrue("already right at 3.1 s", Reframing.sample(keys, 3100).first > 0.6f)
    }

    /**
     * Runs the bundled yt-dlp on the device against the live site. Only runs when a proxy is
     * passed (`-e proxy http://10.0.2.2:PORT`), which is how an emulator inside a locked-down
     * build machine reaches the internet; certificate checks are off for that hop only, in this
     * test only. The app itself never does either.
     */
    @Test
    fun bundledDownloaderSearchesFromTheDevice() {
        val proxy = InstrumentationRegistry.getArguments().getString("proxy")
        assumeTrue("no proxy given", proxy != null)
        YoutubeDL.getInstance().init(context)
        val request = YoutubeDLRequest(Discover.searchUrl("gta 6", TimeWindow.WEEK)).apply {
            addOption("--flat-playlist")
            addOption("--dump-json")
            addOption("--playlist-end", 6)
            addOption("--extractor-args", "youtubetab:approximate_date")
            addOption("--no-warnings")
            addOption("--proxy", proxy!!)
            addOption("--no-check-certificates")
        }
        val response = YoutubeDL.getInstance().execute(request)
        File(outDir, "search.jsonl").writeText(response.out)
        val hits = Discover.parseSearch(response.out)
        assertTrue("got ${hits.size} results; stderr: ${response.err.take(400)}", hits.size >= 3)
        assertTrue(hits.all { it.url.startsWith("https://") && it.title.isNotBlank() })
        assertTrue("view counts present", hits.count { (it.views ?: 0) > 0 } >= 3)
        assertTrue("most viewed first", hits.zipWithNext().count { (a, b) -> (a.views ?: 0) >= (b.views ?: 0) } >= hits.size - 2)
    }
}
