package app.neonclips.core

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

const val OUT_ASPECT = 9f / 16f

/** Size of the crop window as fractions of the source frame. */
data class Window(val w: Float, val h: Float)

/** The crop window at one instant: centre and size, all as fractions of the source frame. */
data class Shot(val cx: Float, val cy: Float, val w: Float, val h: Float) {
    val left get() = cx - w / 2
    val top get() = cy - h / 2
}

/** A face found in one analysed frame. Coordinates are fractions of the source frame. */
data class FaceBox(val cx: Float, val cy: Float, val w: Float, val h: Float)

data class FaceFrame(val tMs: Long, val faces: List<FaceBox>)

object Reframing {
    const val MAX_ZOOM = 3f

    /** The largest window of [outAspect] that fits a [srcW]x[srcH] frame, shrunk by [zoom]. */
    fun window(srcW: Int, srcH: Int, zoom: Float = 1f, outAspect: Float = OUT_ASPECT): Window {
        val srcAspect = srcW.toFloat() / max(1, srcH)
        val z = zoom.coerceIn(1f, MAX_ZOOM)
        return if (srcAspect > outAspect) Window(outAspect / srcAspect / z, 1f / z)
        else Window(1f / z, srcAspect / outAspect / z)
    }

    fun clampCenter(c: Float, size: Float): Float =
        if (size >= 1f) 0.5f else c.coerceIn(size / 2, 1 - size / 2)

    /** Where the camera is at [tMs]. Always returns a window that lies fully inside the frame. */
    fun shotAt(reframe: Reframe, srcW: Int, srcH: Int, tMs: Long): Shot {
        val win = window(srcW, srcH, reframe.zoom)
        val (cx, cy) = when {
            reframe.mode == ReframeMode.CENTER || reframe.keys.isEmpty() -> 0.5f to 0.5f
            else -> sample(reframe.keys, tMs)
        }
        return Shot(clampCenter(cx, win.w), clampCenter(cy, win.h), win.w, win.h)
    }

    /**
     * Camera position at [tMs] from keyframes, using monotone cubic interpolation: the path is
     * smooth through every key and never overshoots, so two keys a frame apart act as a hard cut.
     */
    fun sample(keys: List<CamKey>, tMs: Long): Pair<Float, Float> {
        if (keys.isEmpty()) return 0.5f to 0.5f
        if (tMs <= keys.first().tMs) return keys.first().cx to keys.first().cy
        if (tMs >= keys.last().tMs) return keys.last().cx to keys.last().cy
        var lo = 0
        var hi = keys.size - 1
        while (hi - lo > 1) {
            val mid = (lo + hi) ushr 1
            if (keys[mid].tMs <= tMs) lo = mid else hi = mid
        }
        return pchip(keys, lo, tMs) { it.cx } to pchip(keys, lo, tMs) { it.cy }
    }

    private inline fun pchip(keys: List<CamKey>, i: Int, tMs: Long, v: (CamKey) -> Float): Float {
        val k0 = keys[i]
        val k1 = keys[i + 1]
        val h = (k1.tMs - k0.tMs).toFloat()
        if (h <= 0f) return v(k1)
        val d = (v(k1) - v(k0)) / h
        val m0 = if (i == 0) 0f else tangent((v(k0) - v(keys[i - 1])) / max(1f, (k0.tMs - keys[i - 1].tMs).toFloat()), d)
        val m1 = if (i + 2 >= keys.size) 0f else tangent(d, (v(keys[i + 2]) - v(k1)) / max(1f, (keys[i + 2].tMs - k1.tMs).toFloat()))
        val s = (tMs - k0.tMs) / h
        val s2 = s * s
        val s3 = s2 * s
        return (2 * s3 - 3 * s2 + 1) * v(k0) + (s3 - 2 * s2 + s) * h * m0 +
            (-2 * s3 + 3 * s2) * v(k1) + (s3 - s2) * h * m1
    }

    /** Fritsch-Carlson style tangent: zero at a turning point, harmonic mean otherwise. */
    private fun tangent(a: Float, b: Float): Float =
        if (a * b <= 0f) 0f else 2 * a * b / (a + b)

    /** Sets (or moves) the key nearest [tMs]; a key within [mergeMs] is replaced instead of added. */
    fun upsertKey(keys: List<CamKey>, key: CamKey, mergeMs: Long = 250): List<CamKey> {
        val kept = keys.filter { abs(it.tMs - key.tMs) > mergeMs }
        return (kept + key).sortedBy { it.tMs }
    }

    /** Smallest face height (fraction of frame height) that counts as the subject of the shot. */
    const val MIN_SUBJECT = 0.11f

    /** Two consecutive samples further apart than this are treated as a scene cut. */
    const val CUT_JUMP = 0.22f

    /**
     * The face the camera should follow in each analysed frame, or null to hold position.
     * Small faces (a corner facecam, a character in the distance) are ignored so gameplay stays
     * centred; among large faces the one nearest the previous subject wins unless another is
     * clearly bigger.
     *
     * With [follow] the choice is the user's: at that time the face nearest that point is the
     * subject, and it is tracked forwards and backwards from there by position, however small
     * it is and whoever else is in the frame.
     */
    fun subjects(frames: List<FaceFrame>, follow: CamKey? = null): List<FaceBox?> {
        if (follow != null) followed(frames, follow)?.let { return it }
        var prev: FaceBox? = null
        return frames.map { f ->
            val big = f.faces.filter { it.h >= MIN_SUBJECT }
            val pick = if (big.isEmpty()) null else {
                val largest = big.maxBy { it.w * it.h }
                val p = prev
                val near = if (p == null) null else big.minBy { abs(it.cx - p.cx) + abs(it.cy - p.cy) }
                if (near != null && near.w * near.h >= 0.55f * largest.w * largest.h &&
                    abs(near.cx - p!!.cx) < CUT_JUMP
                ) near else largest
            }
            if (pick != null) prev = pick
            pick
        }
    }

    private fun followed(frames: List<FaceFrame>, follow: CamKey): List<FaceBox?>? {
        val seedIndex = frames.indices.filter { frames[it].faces.isNotEmpty() }
            .minByOrNull { abs(frames[it].tMs - follow.tMs) } ?: return null
        fun dist(f: FaceBox, x: Float, y: Float) = abs(f.cx - x) + abs(f.cy - y)
        val seed = frames[seedIndex].faces.minBy { dist(it, follow.cx, follow.cy) }
        val out = arrayOfNulls<FaceBox>(frames.size)
        out[seedIndex] = seed
        // Walk away from the seed in both directions, keeping to the face that continues it.
        for (step in intArrayOf(1, -1)) {
            var prev = seed
            var i = seedIndex + step
            while (i in frames.indices) {
                val faces = frames[i].faces
                val near = faces.minByOrNull { dist(it, prev.cx, prev.cy) }
                val pick = when {
                    near == null -> null
                    dist(near, prev.cx, prev.cy) < CUT_JUMP -> near
                    // The shot changed. Take the main face of the new shot rather than lose the subject.
                    else -> faces.filter { it.h >= MIN_SUBJECT }.maxByOrNull { it.w * it.h }
                }
                out[i] = pick
                if (pick != null) prev = pick
                i += step
            }
        }
        return out.asList()
    }

    /**
     * Turns face detections into camera keyframes.
     *
     * The camera follows the subject with a dead zone and damped motion, so small head movements
     * do not shake the frame; a jump across the frame between two samples is a cut and the camera
     * snaps. With no subject for [driftAfterMs] it eases back to centre.
     */
    fun autoPath(
        frames: List<FaceFrame>,
        window: Window,
        follow: CamKey? = null,
        driftAfterMs: Long = 1500,
        epsilon: Float = 0.006f,
    ): List<CamKey> {
        if (frames.isEmpty()) return emptyList()
        val picks = subjects(frames, follow)
        if (picks.all { it == null }) return emptyList()

        val deadX = window.w * 0.14f
        val deadY = window.h * 0.10f
        val tau = 420f // ms; time constant of the follow motion

        val first = picks.firstNotNullOf { it }
        var camX = clampCenter(first.cx, window.w)
        var camY = clampCenter(faceY(first, window), window.h)
        var lastSeenMs = frames.first().tMs
        var lastTarget: FaceBox? = null
        val dense = ArrayList<CamKey>(frames.size + 8)

        for (i in frames.indices) {
            val t = frames[i].tMs
            val dt = if (i == 0) 0f else (t - frames[i - 1].tMs).toFloat()
            val target = picks[i]
            if (target != null) {
                val tx = clampCenter(target.cx, window.w)
                val ty = clampCenter(faceY(target, window), window.h)
                val lt = lastTarget
                val isCut = i > 0 && (lt == null && abs(tx - camX) > CUT_JUMP ||
                    lt != null && abs(target.cx - lt.cx) > CUT_JUMP)
                if (isCut) {
                    // Hold the old framing up to the previous sample, then jump.
                    dense += CamKey(max(frames[i - 1].tMs, t - 1), camX, camY)
                    camX = tx
                    camY = ty
                } else {
                    val k = 1f - exp(-dt / tau)
                    if (abs(tx - camX) > deadX) camX += (tx - sign(tx - camX) * deadX * 0.5f - camX) * k
                    if (abs(ty - camY) > deadY) camY += (ty - sign(ty - camY) * deadY * 0.5f - camY) * k
                }
                lastSeenMs = t
                lastTarget = target
            } else if (t - lastSeenMs > driftAfterMs) {
                val k = 1f - exp(-dt / (tau * 2.5f))
                camX += (0.5f - camX) * k
                camY += (0.5f - camY) * k
                lastTarget = null
            }
            dense += CamKey(t, camX, camY)
        }
        return simplify(dense, epsilon)
    }

    /** Aim slightly below the face so the head and shoulders are framed, not the forehead. */
    private fun faceY(f: FaceBox, window: Window): Float =
        if (window.h >= 1f) 0.5f else f.cy + f.h * 0.35f

    private fun sign(v: Float) = if (v < 0f) -1f else 1f

    /** Ramer-Douglas-Peucker on (t, cx) and (t, cy): drops keys the path does not need. */
    fun simplify(keys: List<CamKey>, epsilon: Float): List<CamKey> {
        if (keys.size <= 2) return keys
        val keep = BooleanArray(keys.size)
        keep[0] = true
        keep[keys.size - 1] = true
        val stack = ArrayDeque<Pair<Int, Int>>()
        stack.addLast(0 to keys.size - 1)
        while (stack.isNotEmpty()) {
            val (a, b) = stack.removeLast()
            if (b - a < 2) continue
            val ka = keys[a]
            val kb = keys[b]
            val span = max(1L, kb.tMs - ka.tMs).toFloat()
            var worst = -1
            var worstErr = epsilon
            for (i in a + 1 until b) {
                val s = (keys[i].tMs - ka.tMs) / span
                val ex = abs(keys[i].cx - (ka.cx + (kb.cx - ka.cx) * s))
                val ey = abs(keys[i].cy - (ka.cy + (kb.cy - ka.cy) * s))
                val e = max(ex, ey)
                if (e > worstErr) {
                    worstErr = e
                    worst = i
                }
            }
            if (worst >= 0) {
                keep[worst] = true
                stack.addLast(a to worst)
                stack.addLast(worst to b)
            }
        }
        return keys.filterIndexed { i, _ -> keep[i] }
    }

    /**
     * Pairs of analysed frames whose subject jumped, i.e. a cut happened somewhere between them.
     * The caller can analyse a frame in the middle and ask again, until the gap is a frame or two.
     */
    fun cutGaps(frames: List<FaceFrame>, minGapMs: Long = 50, follow: CamKey? = null): List<LongRange> {
        val picks = subjects(frames, follow)
        val out = ArrayList<LongRange>()
        for (i in 1 until frames.size) {
            val a = picks[i - 1]
            val b = picks[i]
            val gap = frames[i].tMs - frames[i - 1].tMs
            if (gap <= minGapMs) continue
            val jumped = when {
                a != null && b != null -> abs(a.cx - b.cx) > CUT_JUMP
                a == null && b == null -> false
                else -> abs((a ?: b)!!.cx - 0.5f) > CUT_JUMP / 2
            }
            if (jumped) out += frames[i - 1].tMs..frames[i].tMs
        }
        return out
    }

    /** Fits [value] into [lo]..[hi]; used by UI drags. */
    fun fit(value: Float, lo: Float, hi: Float) = min(max(value, lo), hi)
}
