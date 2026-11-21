package app.neonclips.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Calls the real ElevenLabs API, so it only runs when asked:
 * `./gradlew :core:test -Dneonclips.live=true -Dneonclips.sample=/path/to/speech.m4a`
 * with the key in the ELEVENLABS_API_KEY environment variable.
 */
class ScribeLiveTest {
    @Test fun `transcribes speech into timed words and captions`() {
        if (System.getProperty("neonclips.live") != "true") return
        val sample = File(System.getProperty("neonclips.sample"))
        val words = Scribe.transcribe(sample, System.getenv("ELEVENLABS_API_KEY") ?: "set-by-proxy")
        println("WORDS " + words.joinToString(" ") { "${it.text}@${it.startMs}" })
        assertTrue(words.size >= 8, "expected a sentence, got $words")
        assertTrue(words.zipWithNext().all { (a, b) -> a.startMs <= b.startMs && a.endMs >= a.startMs })
        assertTrue(words.any { it.text.contains("jumped", ignoreCase = true) })
        val captions = Captions.fromWords(words)
        println("CAPTIONS " + captions.joinToString(" | ") { "${it.text} [${it.startMs}-${it.endMs}]" })
        assertTrue(captions.size >= 4)
        assertTrue(captions.zipWithNext().all { (a, b) -> a.endMs <= b.startMs })
    }
}
