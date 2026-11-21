package app.neonclips.core

import kotlin.math.max
import kotlin.math.min

object Captions {

    /** Words a caption should not end on while the sentence carries straight on. */
    private val WEAK = setOf(
        "the", "a", "an", "to", "of", "my", "your", "his", "her", "their", "our", "this", "that's",
        "and", "or", "but", "in", "on", "at", "for", "with", "is", "it's", "i'm", "i", "so",
    )

    /**
     * Groups timed words into short, punchy captions: a few words on screen at a time, broken at
     * pauses and sentence ends, the way short-form captions are cut. Commas and full stops are
     * dropped; question and exclamation marks stay.
     */
    fun fromWords(
        words: List<Word>,
        maxChars: Int = 16,
        maxWords: Int = 3,
        pauseMs: Long = 450,
        holdMs: Long = 350,
    ): List<Caption> {
        val clean = words.map { it.copy(text = it.text.trim()) }.filter { it.text.isNotEmpty() }
        val out = ArrayList<Caption>()
        var group = ArrayList<Word>()

        fun tidy(w: Word): Word = w.copy(text = w.text.trimEnd(',', '.', ';', ':').ifEmpty { w.text })

        fun close(nextStart: Long?) {
            if (group.isEmpty()) return
            val shown = group.map(::tidy)
            val start = shown.first().startMs
            var end = max(shown.last().endMs, start + 200)
            // Keep the caption up briefly after the last word, but never into the next caption.
            end = if (nextStart == null) end + holdMs else min(end + holdMs, max(end, nextStart))
            out += Caption(start, end, shown.joinToString(" ") { it.text }, shown)
            group = ArrayList()
        }

        for (w in clean) {
            if (group.isNotEmpty()) {
                val chars = group.sumOf { it.text.length } + group.size + w.text.length
                val paused = w.startMs - group.last().endMs > pauseMs
                val ended = group.last().text.last() in ".!?"
                if (paused || ended) {
                    close(w.startMs)
                } else if (group.size >= maxWords || chars > maxChars) {
                    // "jumped off the | bridge" reads badly: carry a trailing "the" to the next caption.
                    val last = group.last()
                    if (group.size >= 2 && last.text.lowercase().trimEnd(',') in WEAK) {
                        group.removeAt(group.lastIndex)
                        close(last.startMs)
                        group += last
                    } else {
                        close(w.startMs)
                    }
                }
            }
            group += w
        }
        close(null)
        return out
    }

    /** Shifts caption and word times, e.g. from clip-relative to source time. */
    fun shift(captions: List<Caption>, byMs: Long): List<Caption> = captions.map { c ->
        c.copy(
            startMs = c.startMs + byMs,
            endMs = c.endMs + byMs,
            words = c.words.map { it.copy(startMs = it.startMs + byMs, endMs = it.endMs + byMs) },
        )
    }

    fun shiftWords(words: List<Word>, byMs: Long): List<Word> =
        words.map { it.copy(startMs = it.startMs + byMs, endMs = it.endMs + byMs) }

    /** The caption showing at [tMs], if any. Captions are sorted and do not overlap. */
    fun at(captions: List<Caption>, tMs: Long): Caption? {
        var lo = 0
        var hi = captions.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val c = captions[mid]
            when {
                tMs < c.startMs -> hi = mid - 1
                tMs >= c.endMs -> lo = mid + 1
                else -> return c
            }
        }
        return null
    }

    /** Index of the word being spoken at [tMs] inside [caption], or -1 for none. */
    fun activeWord(caption: Caption, tMs: Long): Int {
        if (caption.words.isEmpty()) return -1
        var last = -1
        for ((i, w) in caption.words.withIndex()) {
            if (tMs >= w.startMs) last = i else break
        }
        return last
    }

    /** What the caption renderer should draw: the text to show and which word to light. */
    data class Frame(val text: String, val words: List<String>, val active: Int, val isHook: Boolean)

    /**
     * What is on screen at source time [tMs] for [clip]. The hook title owns the first
     * [HOOK_MS]; after that, captions. Returns null when nothing should be drawn.
     */
    fun frameAt(clip: Clip, tMs: Long): Frame? {
        val rel = tMs - clip.startMs
        if (clip.hook.isNotBlank() && rel in 0 until HOOK_MS) {
            val text = if (clip.style.uppercase) clip.hook.uppercase() else clip.hook
            return Frame(text.trim(), text.trim().split(Regex("\\s+")), -1, true)
        }
        if (!clip.captionsOn) return null
        val shifted = tMs - clip.captionShiftMs
        val c = at(clip.captions, shifted) ?: return null
        val words = (if (c.words.isNotEmpty()) c.words.map { it.text } else c.text.trim().split(Regex("\\s+")))
            .map { if (clip.style.uppercase) it.uppercase() else it }
        val active = if (clip.style.karaoke) activeWord(c, shifted) else -1
        return Frame(words.joinToString(" "), words, active, false)
    }

    /** Replaces a caption's text, spreading its time evenly over the new words. */
    fun retext(caption: Caption, text: String): Caption {
        val parts = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (parts.isEmpty()) return caption.copy(text = "", words = emptyList())
        if (parts == caption.words.map { it.text }) return caption.copy(text = text)
        val span = (caption.endMs - caption.startMs).coerceAtLeast(1)
        val words = parts.mapIndexed { i, w ->
            Word(caption.startMs + span * i / parts.size, caption.startMs + span * (i + 1) / parts.size, w)
        }
        return caption.copy(text = text, words = words)
    }

    /** Adds a caption at [tMs], shortened if needed so it does not run into the next one. */
    fun insert(captions: List<Caption>, tMs: Long, text: String, lengthMs: Long = 1500): List<Caption> {
        val start = at(captions, tMs)?.endMs ?: tMs
        val next = captions.filter { it.startMs > start }.minOfOrNull { it.startMs } ?: Long.MAX_VALUE
        val end = min(start + lengthMs, next)
        if (end - start < 200) return captions
        return (captions + retext(Caption(start, end, text), text)).sortedBy { it.startMs }
    }

    /**
     * Moves a clip edge off the middle of a word: a start lands just before the word, an end
     * just after it. Returns [tMs] unchanged when it is not inside any word.
     */
    fun clearOfWords(captions: List<Caption>, tMs: Long, isStart: Boolean): Long {
        for (c in captions) {
            if (tMs < c.startMs || tMs > c.endMs) continue
            for (w in c.words) {
                if (tMs > w.startMs && tMs < w.endMs) return if (isStart) max(0, w.startMs - 60) else w.endMs + 120
            }
        }
        return tMs
    }

    /** Captions that fall inside a clip, trimmed to its edges. */
    fun within(captions: List<Caption>, startMs: Long, endMs: Long): List<Caption> =
        captions.filter { it.endMs > startMs && it.startMs < endMs }
            .map { it.copy(startMs = max(it.startMs, startMs), endMs = min(it.endMs, endMs)) }
}
