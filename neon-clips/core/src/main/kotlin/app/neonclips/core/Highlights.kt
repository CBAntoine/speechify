package app.neonclips.core

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sqrt

/** Loudness of the source over time: one RMS amplitude (0..1) per [hopMs]. */
class Envelope(val rms: FloatArray, val hopMs: Int) {
    val durationMs: Long get() = rms.size.toLong() * hopMs

    fun db(i: Int): Float = toDb(rms[i])

    /** Peak amplitude in each of [buckets] equal slices of [fromMs]..[toMs], for drawing a waveform. */
    fun peaks(fromMs: Long, toMs: Long, buckets: Int): FloatArray {
        val out = FloatArray(max(0, buckets))
        if (rms.isEmpty() || toMs <= fromMs) return out
        val span = (toMs - fromMs).toDouble()
        for (b in out.indices) {
            val a = ((fromMs + span * b / buckets) / hopMs).toInt().coerceIn(0, rms.size - 1)
            val z = ((fromMs + span * (b + 1) / buckets) / hopMs).toInt().coerceIn(a, rms.size - 1)
            var m = 0f
            for (i in a..z) m = max(m, rms[i])
            out[b] = m
        }
        return out
    }

    companion object {
        fun toDb(amp: Float): Float = (20f * log10(max(amp, 1e-4f))).coerceIn(-80f, 0f)
    }
}

/** Builds an [Envelope] from decoded 16-bit PCM as it streams out of the decoder. */
class EnvelopeBuilder(sampleRate: Int, private val channels: Int, private val hopMs: Int = 50) {
    private val framesPerHop = max(1, sampleRate * hopMs / 1000)
    private var values = FloatArray(4096)
    private var size = 0
    private var acc = 0.0
    private var accFrames = 0
    private var chanPos = 0
    private var frameSum = 0

    fun feed(sample: Short) {
        frameSum += sample
        if (++chanPos < channels) return
        val mono = frameSum.toDouble() / channels / 32768.0
        chanPos = 0
        frameSum = 0
        acc += mono * mono
        if (++accFrames == framesPerHop) flush()
    }

    fun feed(pcm: ShortArray, count: Int = pcm.size) {
        for (i in 0 until count) feed(pcm[i])
    }

    private fun flush() {
        if (size == values.size) values = values.copyOf(size * 2)
        values[size++] = sqrt(acc / max(1, accFrames)).toFloat()
        acc = 0.0
        accFrames = 0
    }

    fun build(): Envelope {
        if (accFrames > framesPerHop / 2) flush()
        return Envelope(values.copyOf(size), hopMs)
    }
}

object Highlights {

    /**
     * Finds the stretches of a video most worth clipping.
     *
     * Two signals are used. Sound: how far the loudness rises above what is normal for that part
     * of the video, plus sudden bursts (a shout, a laugh, an explosion). Audience: the "most
     * replayed" graph when the video came from a site that publishes one. Each candidate window is
     * [clipMs] long with the peak 40% of the way in, so the clip has a build-up and a reaction.
     */
    fun detect(
        envelope: Envelope?,
        durationMs: Long,
        heatmap: List<HeatPoint> = emptyList(),
        /** Offset of this file inside the video the heatmap describes. */
        heatOffsetMs: Long = 0,
        clipMs: Long = 30_000,
        maxCount: Int = 6,
    ): List<Moment> {
        val seconds = (durationMs / 1000).toInt()
        if (seconds < 1) return emptyList()
        val len = clipMs.coerceIn(MIN_CLIP_MS, MAX_CLIP_MS)
        if (durationMs <= len + 2_000) {
            return listOf(Moment(0, durationMs, durationMs / 2, 100f, "Whole video"))
        }

        val sound = envelope?.let { soundScore(it, seconds) }
        val heat = if (heatmap.isEmpty()) null else heatScore(heatmap, heatOffsetMs, seconds)
        val score = FloatArray(seconds) { i ->
            val s = sound?.get(i) ?: 0f
            val h = heat?.get(i) ?: 0f
            when {
                sound != null && heat != null -> 0.5f * s + 0.5f * h
                sound != null -> s
                else -> h
            }
        }
        if (score.all { it <= 0f }) {
            // Nothing stands out (silent video): offer evenly spaced clips instead of nothing.
            val n = min(maxCount, max(1, (durationMs / (len * 2)).toInt()))
            return List(n) { i ->
                val start = (durationMs - len) * (i + 1) / (n + 1)
                Moment(start, start + len, start + len * 2 / 5, 50f, "Evenly spaced")
            }
        }

        val smooth = smooth(score, 4)
        val top = smooth.max()
        // Peaks a full clip apart (plus the room the edges may move when snapped to a pause),
        // so no two picks show the same footage.
        val spacing = (len / 1000).toInt() + 4
        val peaks = pickPeaks(smooth, spacing, maxCount, floor = top * 0.25f)

        return peaks.map { p ->
            var start = p * 1000L - len * 2 / 5
            start = start.coerceIn(0, durationMs - len)
            var end = start + len
            if (envelope != null) {
                start = quietPoint(envelope, start, 1500).coerceIn(0, durationMs - MIN_CLIP_MS)
                end = quietPoint(envelope, end, 1500).coerceIn(start + MIN_CLIP_MS, durationMs)
            }
            val s = sound?.get(p) ?: 0f
            val h = heat?.get(p) ?: 0f
            val reason = when {
                heat != null && h >= 0.5f && h >= s -> "Most replayed"
                sound != null && burst(envelope!!, p) -> "Loud reaction"
                sound != null -> "Energy peak"
                else -> "Most replayed"
            }
            Moment(start, end, p * 1000L, (smooth[p] / top * 100f).coerceIn(1f, 100f), reason)
        }.sortedByDescending { it.score }
    }

    /**
     * Picks the peaks of a "most replayed" graph, before anything is downloaded. The opening of a
     * video always looks popular because every viewer starts there, so it is skipped.
     */
    fun fromHeatmap(heatmap: List<HeatPoint>, clipSec: Int = 45, maxCount: Int = 5): List<Moment> {
        if (heatmap.size < 5) return emptyList()
        val total = heatmap.last().endSec
        val seconds = total.toInt()
        if (seconds < clipSec * 2) return emptyList()
        val score = heatScore(heatmap, 0, seconds)
        val skip = max(heatmap[0].endSec * 2, min(30.0, total * 0.03)).toInt()
        for (i in 0 until min(skip, seconds)) score[i] = 0f
        val smooth = smooth(score, max(1, (heatmap[0].endSec - heatmap[0].startSec).toInt() / 2))
        val top = smooth.max()
        if (top <= 0f) return emptyList()
        val peaks = pickPeaks(smooth, max(clipSec + 1, (total / 40).toInt()), maxCount, floor = top * 0.3f)
        return peaks.map { p ->
            val start = (p - clipSec * 2 / 5).coerceIn(0, seconds - clipSec)
            Moment(start * 1000L, (start + clipSec) * 1000L, p * 1000L, smooth[p] / top * 100f, "Most replayed")
        }.sortedByDescending { it.score }
    }

    /** Per-second excitement from sound, 0..1. */
    internal fun soundScore(env: Envelope, seconds: Int): FloatArray {
        val perSec = 1000 / env.hopMs
        val loud = FloatArray(seconds)
        val burst = FloatArray(seconds)
        for (s in 0 until seconds) {
            var sum = 0f
            var peak = -80f
            var n = 0
            for (i in s * perSec until min((s + 1) * perSec, env.rms.size)) {
                val d = env.db(i)
                sum += d
                peak = max(peak, d)
                n++
            }
            loud[s] = if (n == 0) -80f else sum / n
            burst[s] = if (n == 0) 0f else peak - loud[s]
        }
        // What is normal around each second: a low-ish percentile of the surrounding 90 seconds.
        val half = 45
        val raw = FloatArray(seconds)
        val buf = FloatArray(half * 2 + 1)
        for (s in 0 until seconds) {
            val a = max(0, s - half)
            val z = min(seconds - 1, s + half)
            var n = 0
            for (i in a..z) buf[n++] = loud[i]
            java.util.Arrays.sort(buf, 0, n)
            val baseline = buf[(n * 0.4f).toInt().coerceIn(0, n - 1)]
            val rise = (loud[s] - baseline).coerceIn(0f, 24f)
            // Silence is never a highlight, however sharp its edges.
            val audible = ((loud[s] + 55f) / 15f).coerceIn(0f, 1f)
            raw[s] = (rise + 0.35f * burst[s].coerceIn(0f, 20f)) * audible
        }
        val top = raw.max()
        if (top <= 0.5f) return FloatArray(seconds)
        return FloatArray(seconds) { raw[it] / top }
    }

    /** True when the sound around [sec] stands well clear of what surrounds it. */
    private fun burst(env: Envelope, sec: Int): Boolean {
        val perSec = 1000 / env.hopMs
        val a = max(0, (sec - 2) * perSec)
        val z = min(env.rms.size, (sec + 3) * perSec)
        if (z - a < 2) return false
        var peak = -80f
        for (i in a until z) peak = max(peak, env.db(i))
        val from = max(0, (sec - 20) * perSec)
        val to = min(env.rms.size, (sec + 20) * perSec)
        val around = FloatArray(to - from) { env.db(from + it) }
        around.sort()
        val typical = around[around.size * 2 / 5]
        return peak - typical > 9f && peak > -25f
    }

    internal fun heatScore(heatmap: List<HeatPoint>, offsetMs: Long, seconds: Int): FloatArray {
        val out = FloatArray(seconds)
        var j = 0
        for (s in 0 until seconds) {
            val t = offsetMs / 1000.0 + s + 0.5
            while (j < heatmap.size - 1 && heatmap[j].endSec <= t) j++
            val p = heatmap[j]
            out[s] = if (t >= p.startSec && t < p.endSec) p.value.toFloat().coerceIn(0f, 1f) else 0f
        }
        return out
    }

    internal fun smooth(v: FloatArray, radius: Int): FloatArray {
        if (radius <= 0) return v.copyOf()
        val out = FloatArray(v.size)
        for (i in v.indices) {
            var sum = 0f
            var wsum = 0f
            for (k in -radius..radius) {
                val j = i + k
                if (j < 0 || j >= v.size) continue
                val w = (radius + 1 - abs(k)).toFloat()
                sum += v[j] * w
                wsum += w
            }
            out[i] = sum / wsum
        }
        return out
    }

    /** Highest values first, each at least [spacing] apart, none below [floor]. */
    internal fun pickPeaks(v: FloatArray, spacing: Int, maxCount: Int, floor: Float): List<Int> {
        val order = v.indices.sortedByDescending { v[it] }
        val picked = ArrayList<Int>()
        for (i in order) {
            if (picked.size >= maxCount || v[i] < floor || v[i] <= 0f) break
            if (picked.none { abs(it - i) < spacing }) picked += i
        }
        return picked
    }

    /**
     * Where a clip edge the user dropped at [tMs] should really sit: off the middle of a word
     * when the clip has timed captions, otherwise in the nearest pause.
     */
    fun snapEdge(env: Envelope?, captions: List<Caption>, tMs: Long, isStart: Boolean, radiusMs: Long = 350): Long {
        val clear = Captions.clearOfWords(captions, tMs, isStart)
        if (clear != tMs) return clear
        return if (env == null || env.rms.isEmpty()) tMs else quietPoint(env, tMs, radiusMs)
    }

    /** The quietest instant within [radiusMs] of [tMs], so a cut lands between words. */
    fun quietPoint(env: Envelope, tMs: Long, radiusMs: Long): Long {
        if (env.rms.isEmpty()) return tMs
        val a = ((tMs - radiusMs) / env.hopMs).toInt().coerceIn(0, env.rms.size - 1)
        val z = ((tMs + radiusMs) / env.hopMs).toInt().coerceIn(a, env.rms.size - 1)
        val centre = (tMs / env.hopMs).toInt().coerceIn(a, z)
        var best = centre
        var bestCost = Float.MAX_VALUE
        for (i in a..z) {
            // Prefer quiet, and among equally quiet points the one nearest the requested time.
            val lo = max(a, i - 1)
            val hi = min(z, i + 1)
            var m = 0f
            for (j in lo..hi) m += env.rms[j]
            val cost = m / (hi - lo + 1) + abs(i - centre) * 0.0004f
            if (cost < bestCost) {
                bestCost = cost
                best = i
            }
        }
        return (best.toLong() * env.hopMs + env.hopMs / 2).let { (it / 10.0).roundToLong() * 10 }
    }
}
