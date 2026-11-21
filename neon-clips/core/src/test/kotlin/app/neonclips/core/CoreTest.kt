package app.neonclips.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DiscoverTest {
    @Test fun `search url carries the same filter blob the site builds`() {
        assertTrue(Discover.searchUrl("gta 6", TimeWindow.WEEK).endsWith("search_query=gta+6&sp=CAMSBAgDEAE%3D"))
        assertTrue(Discover.searchUrl("gta 6", TimeWindow.TODAY).endsWith("sp=CAMSBAgCEAE%3D"))
        assertTrue(Discover.searchUrl("gta 6", TimeWindow.MONTH).endsWith("sp=CAMSBAgEEAE%3D"))
        assertTrue(Discover.searchUrl("gta 6", TimeWindow.ALL).endsWith("sp=CAMSAhAB"))
        assertTrue(Discover.searchUrl("kai cenat & speed", TimeWindow.WEEK, Length.LONG).contains("search_query=kai+cenat+%26+speed&sp=CAMSBggDEAEYAg%3D%3D"))
    }

    @Test fun `parses real search output`() {
        val text = javaClass.getResource("/yt-search.jsonl")!!.readText()
        val hits = Discover.parseSearch(text + "\nWARNING: not json\n")
        assertEquals(4, hits.size)
        val first = hits.first()
        assertEquals("https://www.youtube.com/watch?v=${first.id}", first.url)
        assertTrue(first.title.isNotBlank() && first.channel.isNotBlank())
        assertTrue(first.views!! > 1_000_000)
        assertTrue(first.durationSec!! > 0)
        assertNotNull(first.publishedAtSec)
        assertTrue(first.thumbnail!!.startsWith("https://i.ytimg.com/"))
        assertTrue(hits.any { it.wasLive })
    }

    @Test fun `parses video info with a most-replayed graph`() {
        val info = Discover.parseInfo(
            """{"id":"abc","webpage_url":"https://www.youtube.com/watch?v=abc","title":"T","channel":"C",
               |"duration":600,"view_count":12,"upload_date":"20261120","thumbnail":"https://i.ytimg.com/x.jpg",
               |"heatmap":[{"start_time":0.0,"end_time":6.0,"value":1.0},{"start_time":6.0,"end_time":12.0,"value":0.25}]}""".trimMargin().replace("\n", "")
        )!!
        assertEquals(2, info.heatmap.size)
        assertEquals(0.25, info.heatmap[1].value)
        assertEquals(600, info.hit.durationSec)
        assertEquals(1795132800, info.hit.publishedAtSec)
        assertNull(Discover.parseInfo("ERROR: Sign in to confirm you are not a bot"))
    }

    @Test fun `ranks by views or by views per hour`() {
        val now = 1_000_000L
        val old = VideoHit("a", "u", "old", views = 1000, publishedAtSec = now - 100 * 3600)
        val fresh = VideoHit("b", "u", "fresh", views = 500, publishedAtSec = now - 2 * 3600)
        val live = VideoHit("c", "u", "live", views = 9999, isLiveNow = true)
        assertEquals(listOf("a", "b"), Discover.rank(listOf(fresh, old, live), Discover.Sort.VIEWS, now).map { it.id })
        assertEquals(listOf("b", "a"), Discover.rank(listOf(old, fresh, live), Discover.Sort.VELOCITY, now).map { it.id })
    }

    @Test fun formats() {
        assertEquals("41.6M", Fmt.count(41_554_956))
        assertEquals("1.2B", Fmt.count(1_200_000_000))
        assertEquals("950", Fmt.count(950))
        assertEquals("12K", Fmt.count(12_000))
        assertEquals("1:35", Fmt.clock(95_000))
        assertEquals("23:45:42", Fmt.clock(85_542_000))
        assertEquals("00:01.49", Fmt.timecode(1_490))
        assertEquals("13h ago", Fmt.age(1000, 1000 + 13 * 3600))
        assertEquals("3d ago", Fmt.age(1000, 1000 + 80 * 3600))
    }
}

class HighlightsTest {
    /** [seconds] of quiet talk at [base] amplitude with loud bursts at the given seconds. */
    private fun envelope(seconds: Int, base: Float, bursts: Map<Int, Float>): Envelope {
        val rms = FloatArray(seconds * 20) { i ->
            val s = i / 20
            val wobble = 0.8f + 0.4f * abs(sin(i * 0.37f))
            val burst = bursts.entries.firstOrNull { s in it.key until it.key + 4 }?.value
            (burst ?: base) * wobble
        }
        return Envelope(rms, 50)
    }

    @Test fun `finds the loud moments and puts the peak inside the clip`() {
        val env = envelope(600, 0.03f, mapOf(120 to 0.6f, 400 to 0.45f))
        val moments = Highlights.detect(env, 600_000, clipMs = 30_000, maxCount = 4)
        assertTrue(moments.size >= 2)
        val top2 = moments.take(2)
        assertTrue(top2.any { 120_000 in it.startMs..it.endMs }, "burst at 2:00 missed: $moments")
        assertTrue(top2.any { 400_000 in it.startMs..it.endMs }, "burst at 6:40 missed: $moments")
        for (m in moments) {
            assertTrue(m.endMs - m.startMs in 26_000..34_000, "length ${m.endMs - m.startMs}")
            assertTrue(m.startMs >= 0 && m.endMs <= 600_000)
            assertTrue(m.score in 1f..100f)
        }
        assertEquals(100f, moments.first().score)
        assertEquals("Loud reaction", moments.first().reason)
    }

    @Test fun `picks never show the same footage twice`() {
        val env = envelope(900, 0.03f, mapOf(100 to 0.5f, 110 to 0.55f, 125 to 0.5f, 500 to 0.5f, 520 to 0.45f))
        val moments = Highlights.detect(env, 900_000, clipMs = 30_000).sortedBy { it.startMs }
        assertTrue(moments.size >= 2)
        for ((a, b) in moments.zipWithNext()) assertTrue(a.endMs <= b.startMs, "overlap: $a then $b")
    }

    @Test fun `a dropped clip edge moves off a word or into a pause`() {
        val caps = listOf(Captions.retext(Caption(1000, 2200, "no way bro"), "no way bro"))
        // 1500 is inside "way" (1400-1800).
        assertEquals(1340, Highlights.snapEdge(null, caps, 1500, isStart = true))
        assertEquals(1920, Highlights.snapEdge(null, caps, 1500, isStart = false))
        val rms = FloatArray(200) { 0.3f }
        for (i in 104..107) rms[i] = 0.01f
        val t = Highlights.snapEdge(Envelope(rms, 50), emptyList(), 5_000, isStart = true)
        assertTrue(t in 5_200..5_400, "$t")
        assertEquals(5_000, Highlights.snapEdge(null, emptyList(), 5_000, isStart = true))
    }

    @Test fun `short and silent videos still give something to clip`() {
        assertEquals(listOf(Moment(0, 20_000, 10_000, 100f, "Whole video")), Highlights.detect(null, 20_000, clipMs = 30_000))
        val silent = Highlights.detect(Envelope(FloatArray(20 * 300), 50), 300_000, clipMs = 30_000)
        assertTrue(silent.isNotEmpty())
        assertTrue(silent.all { it.reason == "Evenly spaced" && it.endMs <= 300_000 })
    }

    @Test fun `silence with sharp edges is not a highlight`() {
        // Loud talk with a few seconds of dead air: the dip must not win.
        val rms = FloatArray(20 * 300) { i -> if (i / 20 in 150..155) 0f else 0.2f }
        for (i in 20 * 60 until 20 * 63) rms[i] = 0.8f
        val m = Highlights.detect(Envelope(rms, 50), 300_000, clipMs = 20_000, maxCount = 1).single()
        assertTrue(60_000 in m.startMs..m.endMs, "$m")
    }

    @Test fun `most replayed graph steers the pick and survives a section offset`() {
        val heat = List(100) { i -> HeatPoint(i * 36.0, (i + 1) * 36.0, if (i == 50) 1.0 else 0.1) }
        // The file is the section 1700s..1900s of an hour-long video; the hot bucket is 1800s..1836s.
        val moments = Highlights.detect(null, 200_000, heat, heatOffsetMs = 1_700_000, clipMs = 30_000, maxCount = 1)
        val m = moments.single()
        assertEquals("Most replayed", m.reason)
        assertTrue(m.peakMs in 100_000..136_000, "$m")
    }

    @Test fun `picks heat peaks before download and skips the intro`() {
        val heat = List(100) { i ->
            HeatPoint(i * 60.0, (i + 1) * 60.0, when (i) { 0 -> 1.0; 1 -> 0.6; 40 -> 0.9; 70 -> 0.7; else -> 0.1 })
        }
        val moments = Highlights.fromHeatmap(heat, clipSec = 45, maxCount = 3)
        assertTrue(moments.size >= 2)
        assertTrue(moments[0].peakMs in 2_400_000..2_460_000, "${moments[0]}")
        assertTrue(moments[1].peakMs in 4_200_000..4_260_000, "${moments[1]}")
        assertTrue(moments.none { it.startMs < 120_000 })
        assertTrue(moments.all { it.endMs - it.startMs == 45_000L })
    }

    @Test fun `cuts land in the gaps between sounds`() {
        val rms = FloatArray(200) { 0.3f }
        for (i in 108..111) rms[i] = 0.01f
        val t = Highlights.quietPoint(Envelope(rms, 50), 5_000, 1_500)
        assertTrue(t in 5_400..5_600, "$t")
    }

    @Test fun `envelope builder measures loudness of pcm`() {
        val b = EnvelopeBuilder(48_000, 2, 50)
        repeat(48_000) { i ->
            val v = (sin(2 * PI * 440 * i / 48_000) * 16384).toInt().toShort()
            b.feed(v); b.feed(v)
        }
        val env = b.build()
        assertEquals(20, env.rms.size)
        assertTrue(env.rms.all { abs(it - 0.3536f) < 0.01f }, env.rms.joinToString())
        assertEquals(1000, env.durationMs)
        val peaks = env.peaks(0, 1000, 5)
        assertEquals(5, peaks.size)
        assertTrue(peaks.all { it > 0.3f })
    }
}

class ReframingTest {
    @Test fun `window is the largest 9 by 16 that fits`() {
        val wide = Reframing.window(1920, 1080)
        assertEquals(1f, wide.h)
        assertEquals(0.3164f, wide.w, 0.0005f)
        val tall = Reframing.window(1080, 1920)
        assertEquals(1f, tall.w, 0.0001f); assertEquals(1f, tall.h, 0.0001f)
        val square = Reframing.window(1000, 1000)
        assertEquals(0.5625f, square.w, 0.0001f)
        val tallest = Reframing.window(1080, 2400)
        assertEquals(1f, tallest.w); assertEquals(0.8f, tallest.h, 0.0001f)
        val zoomed = Reframing.window(1920, 1080, zoom = 2f)
        assertEquals(0.5f, zoomed.h); assertEquals(0.1582f, zoomed.w, 0.0005f)
    }

    @Test fun `shot always stays inside the frame`() {
        val r = Reframe(ReframeMode.MANUAL, listOf(CamKey(0, -0.4f, 2f), CamKey(1000, 1.7f, -1f)), zoom = 1.5f)
        for (t in 0..1000 step 50) {
            val s = Reframing.shotAt(r, 1920, 1080, t.toLong())
            assertTrue(s.left >= -1e-5f && s.left + s.w <= 1 + 1e-5f, "$s")
            assertTrue(s.top >= -1e-5f && s.top + s.h <= 1 + 1e-5f, "$s")
        }
        assertEquals(0.5f, Reframing.shotAt(Reframe(), 1920, 1080, 500).cx)
    }

    @Test fun `interpolation is smooth, monotone and holds at the ends`() {
        val keys = listOf(CamKey(1000, 0.2f), CamKey(2000, 0.8f), CamKey(3000, 0.8f), CamKey(3001, 0.3f))
        assertEquals(0.2f, Reframing.sample(keys, 0).first)
        assertEquals(0.3f, Reframing.sample(keys, 9000).first)
        var prev = 0.2f
        for (t in 1000..2000 step 20) {
            val x = Reframing.sample(keys, t.toLong()).first
            assertTrue(x >= prev - 1e-5f && x <= 0.8f + 1e-5f, "overshoot or reversal at $t: $x")
            prev = x
        }
        for (t in 2000..3000 step 100) assertEquals(0.8f, Reframing.sample(keys, t.toLong()).first, 1e-4f)
        assertEquals(0.5f, Reframing.sample(keys, 1500).first, 0.02f)
    }

    private fun face(cx: Float, h: Float = 0.3f) = FaceBox(cx, 0.4f, h * 0.45f, h)

    @Test fun `camera follows a face and ignores small ones`() {
        val win = Reframing.window(1920, 1080)
        val still = List(30) { FaceFrame(it * 333L, listOf(face(0.7f), face(0.1f, 0.05f))) }
        val keys = Reframing.autoPath(still, win)
        assertTrue(keys.isNotEmpty() && keys.size <= 3, "a still subject needs almost no keys: $keys")
        assertTrue(keys.all { abs(it.cx - 0.7f) < 0.01f })

        val facecamOnly = List(30) { FaceFrame(it * 333L, listOf(face(0.1f, 0.06f))) }
        assertTrue(Reframing.autoPath(facecamOnly, win).isEmpty(), "a corner facecam must not pull the crop")
    }

    @Test fun `small movements do not shake the camera but a walk is followed`() {
        val win = Reframing.window(1920, 1080)
        val jitter = List(40) { FaceFrame(it * 333L, listOf(face(0.5f + 0.012f * sin(it * 1.3f)))) }
        val jk = Reframing.autoPath(jitter, win)
        assertTrue(jk.maxOf { it.cx } - jk.minOf { it.cx } < 0.005f, "$jk")

        val walk = List(40) { FaceFrame(it * 333L, listOf(face(0.3f + 0.4f * it / 39f))) }
        val wk = Reframing.autoPath(walk, win)
        assertTrue(wk.last().cx > 0.6f, "$wk")
        var prev = 0f
        for (t in 0..13_000 step 100) {
            val x = Reframing.sample(wk, t.toLong()).first
            assertTrue(x >= prev - 0.002f, "camera moved backwards at $t")
            prev = x
        }
    }

    @Test fun `a jump across the frame is a hard cut, not a pan`() {
        val win = Reframing.window(1920, 1080)
        val frames = List(20) { FaceFrame(it * 333L, listOf(face(if (it < 10) 0.25f else 0.75f))) }
        val keys = Reframing.autoPath(frames, win)
        val cutAt = 10 * 333L
        assertEquals(0.25f, Reframing.sample(keys, cutAt - 2).first, 0.01f)
        assertEquals(0.75f, Reframing.sample(keys, cutAt).first, 0.01f)
        assertEquals(listOf(9 * 333L..10 * 333L), Reframing.cutGaps(frames))
        assertTrue(Reframing.cutGaps(frames.map { it.copy(tMs = it.tMs / 10) }).isEmpty())
    }

    @Test fun `camera drifts back to centre when the subject is gone`() {
        val win = Reframing.window(1920, 1080)
        val frames = List(40) { FaceFrame(it * 333L, if (it < 6) listOf(face(0.75f)) else emptyList()) }
        val keys = Reframing.autoPath(frames, win)
        assertEquals(0.75f, Reframing.sample(keys, 2_500).first, 0.01f)
        assertEquals(0.5f, Reframing.sample(keys, 13_000).first, 0.03f)
    }

    @Test fun `tapping a person makes the camera follow them instead of the bigger face`() {
        val win = Reframing.window(1920, 1080)
        // A large host on the left the whole time and a smaller guest on the right.
        val frames = List(30) { FaceFrame(it * 333L, listOf(face(0.25f, 0.4f), face(0.75f + 0.002f * it, 0.2f))) }
        val auto = Reframing.autoPath(frames, win)
        assertTrue(auto.all { abs(it.cx - 0.25f) < 0.02f }, "by default the bigger face wins: $auto")
        val guest = Reframing.autoPath(frames, win, follow = CamKey(5_000, 0.8f, 0.4f))
        assertTrue(guest.isNotEmpty() && guest.all { it.cx > 0.7f }, "the tapped face is followed throughout: $guest")
        // A tapped small face is followed even though it would be too small to pick automatically.
        val small = List(10) { FaceFrame(it * 333L, listOf(face(0.6f, 0.07f))) }
        assertTrue(Reframing.autoPath(small, win).isEmpty())
        assertTrue(Reframing.autoPath(small, win, follow = CamKey(0, 0.6f, 0.4f)).all { abs(it.cx - 0.6f) < 0.02f })
        // Tapping where nobody was ever detected falls back to the automatic choice.
        assertEquals(auto, Reframing.autoPath(frames.map { it.copy(faces = it.faces.take(1)) }, win, follow = null))
    }

    @Test fun `upsert replaces a nearby key`() {
        val keys = listOf(CamKey(0, 0.5f), CamKey(1000, 0.6f))
        assertEquals(listOf(CamKey(0, 0.5f), CamKey(1100, 0.9f)), Reframing.upsertKey(keys, CamKey(1100, 0.9f)))
        assertEquals(3, Reframing.upsertKey(keys, CamKey(500, 0.9f)).size)
    }
}

class CaptionsTest {
    private fun words(vararg w: Triple<Int, Int, String>) = w.map { Word(it.first.toLong(), it.second.toLong(), it.third) }

    @Test fun `groups words into short captions and breaks at pauses and sentence ends`() {
        val caps = Captions.fromWords(
            words(
                Triple(0, 200, "Oh"), Triple(220, 400, "my"), Triple(420, 700, "god!"),
                Triple(720, 900, "He"), Triple(920, 1100, "actually"), Triple(1120, 1400, "jumped"),
                Triple(2600, 2900, "No"), Triple(2920, 3200, "way"),
            )
        )
        assertEquals(listOf("Oh my god!", "He actually", "jumped", "No way"), caps.map { it.text })
        assertEquals(720, caps[0].endMs, "holds until the next caption starts, not past it")
        assertEquals(1750, caps[2].endMs, "holds briefly into a pause")
        assertTrue(caps.zipWithNext().all { (a, b) -> a.endMs <= b.startMs })
        assertEquals(3, caps[0].words.size)
    }

    @Test fun `captions do not end on a dangling article and drop commas and full stops`() {
        val caps = Captions.fromWords(
            words(
                Triple(260, 400, "Oh"), Triple(440, 600, "my"), Triple(680, 1000, "God,"), Triple(1140, 1300, "he"),
                Triple(1320, 1800, "actually"), Triple(1900, 2200, "jumped"), Triple(2240, 2400, "off"),
                Triple(2460, 2550, "the"), Triple(2580, 3000, "bridge."), Triple(3080, 3300, "No"), Triple(3320, 3600, "way."),
            )
        )
        assertEquals(listOf("Oh my God", "he actually", "jumped off", "the bridge", "No way"), caps.map { it.text })
        assertTrue(caps.zipWithNext().all { (a, b) -> a.endMs <= b.startMs })
        assertEquals(listOf("the", "bridge"), caps[3].words.map { it.text })
    }

    @Test fun `hook owns the opening then captions take over`() {
        val caps = Captions.shift(Captions.fromWords(words(Triple(100, 400, "clip"), Triple(450, 800, "that"), Triple(3000, 3300, "bro"))), 10_000)
        val clip = Clip("c", 10_000, 30_000, hook = "Trailer. Game. Reaction.", captions = caps)
        val hook = Captions.frameAt(clip, 10_500)!!
        assertTrue(hook.isHook)
        assertEquals("TRAILER. GAME. REACTION.", hook.text)
        val later = Captions.frameAt(clip, 13_100)!!
        assertEquals(listOf("BRO"), later.words)
        assertEquals(0, later.active)
        assertNull(Captions.frameAt(clip, 20_000))
        assertNull(Captions.frameAt(clip.copy(captionsOn = false), 13_100))
        // Captions shifted 300 ms later: nothing yet at the original time, the word shows 300 ms on.
        assertNull(Captions.frameAt(clip.copy(captionShiftMs = 300), 13_100))
        assertEquals(listOf("BRO"), Captions.frameAt(clip.copy(captionShiftMs = 300), 13_400)!!.words)

        val noHook = clip.copy(hook = "")
        val f = Captions.frameAt(noHook, 10_500)!!
        assertEquals("CLIP THAT", f.text)
        assertEquals(1, f.active)
        assertEquals(-1, Captions.frameAt(noHook.copy(style = CaptionStyle(karaoke = false)), 10_500)!!.active)
    }

    @Test fun `captions are trimmed to the clip`() {
        val caps = listOf(Caption(0, 1000, "a"), Caption(1500, 2500, "b"), Caption(4000, 5000, "c"))
        assertEquals(listOf(Caption(2000, 2500, "b")), Captions.within(caps, 2000, 3900))
    }

    @Test fun `editing a caption re-times its words and new captions never overlap`() {
        val c = Captions.retext(Caption(1000, 2000, "old"), "no way bro")
        assertEquals(listOf(Word(1000, 1333, "no"), Word(1333, 1666, "way"), Word(1666, 2000, "bro")), c.words)
        val list = Captions.insert(listOf(Caption(0, 1000, "a"), Caption(1800, 2500, "b")), 500, "new")
        assertEquals(listOf(0L to 1000L, 1000L to 1800L, 1800L to 2500L), list.map { it.startMs to it.endMs })
        assertEquals(1, Captions.insert(listOf(Caption(0, 1000, "a")), 5000, "x").count { it.text == "x" })
    }

    @Test fun `scribe response keeps words and drops spacing and sounds`() {
        val words = Scribe.parse(
            """{"language_code":"en","text":"Oh my","words":[
              {"text":"Oh","start":0.119,"end":0.359,"type":"word","speaker_id":"speaker_0"},
              {"text":" ","start":0.359,"end":0.4,"type":"spacing"},
              {"text":"my","start":0.4,"end":0.62,"type":"word"},
              {"text":"(laughter)","start":0.7,"end":1.5,"type":"audio_event"}]}"""
        )
        assertEquals(listOf(Word(119, 359, "Oh"), Word(400, 620, "my")), words)
        assertEquals("ElevenLabs rejected the API key.", Scribe.errorMessage(401, """{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}"""))
        assertEquals("Model not found", Scribe.errorMessage(404, """{"detail":{"status":"x","message":"Model not found"}}"""))
    }
}
