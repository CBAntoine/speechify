package app.neonclips.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToLong

/** Speech-to-text with word timings, through the ElevenLabs Scribe API. */
object Scribe {
    const val ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"

    /** Newest first; an account without access to one falls through to the next. */
    val MODELS = listOf("scribe_v3", "scribe_v2", "scribe_v1")

    class ScribeException(message: String, val status: Int = 0) : IOException(message)

    /**
     * Uploads [audio] and returns its words with times relative to the start of the file.
     * Blocking: call from a background thread.
     */
    fun transcribe(audio: File, apiKey: String, mimeType: String = "audio/mp4"): List<Word> {
        var last: ScribeException? = null
        for (model in MODELS) {
            try {
                return parse(post(audio, apiKey, mimeType, model))
            } catch (e: ScribeException) {
                last = e
                // Only a rejected model id is worth retrying with an older model.
                val modelProblem = e.status in listOf(400, 403, 404, 422) && e.message.orEmpty().contains("model", ignoreCase = true)
                if (!modelProblem) throw e
            }
        }
        throw last ?: ScribeException("Transcription failed")
    }

    private fun post(audio: File, apiKey: String, mimeType: String, model: String): String {
        val boundary = "----neonclips" + System.nanoTime().toString(16)
        val conn = URL(ENDPOINT).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 20_000
            conn.readTimeout = 180_000
            conn.setRequestProperty("xi-api-key", apiKey)
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            conn.setChunkedStreamingMode(64 * 1024)
            conn.outputStream.use { out ->
                fun field(name: String, value: String) {
                    out.write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n".toByteArray())
                }
                field("model_id", model)
                field("timestamps_granularity", "word")
                field("tag_audio_events", "false")
                out.write(
                    ("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"clip.m4a\"\r\n" +
                        "Content-Type: $mimeType\r\n\r\n").toByteArray()
                )
                audio.inputStream().use { it.copyTo(out) }
                out.write("\r\n--$boundary--\r\n".toByteArray())
            }
            val status = conn.responseCode
            val body = (if (status in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw ScribeException(errorMessage(status, body), status)
            return body
        } finally {
            conn.disconnect()
        }
    }

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    internal fun errorMessage(status: Int, body: String): String {
        val detail = runCatching {
            when (val d = json.parseToJsonElement(body).jsonObject["detail"]) {
                is JsonObject -> (d["message"] as? JsonPrimitive)?.content
                is JsonPrimitive -> d.content
                else -> null
            }
        }.getOrNull()
        return when (status) {
            401 -> "ElevenLabs rejected the API key."
            else -> detail ?: "ElevenLabs returned HTTP $status."
        }
    }

    /** Keeps spoken words; drops spacing tokens and tagged sounds like "(laughter)". */
    fun parse(body: String): List<Word> {
        val root = json.parseToJsonElement(body).jsonObject
        val words = root["words"] as? JsonArray ?: return emptyList()
        return words.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val type = (o["type"] as? JsonPrimitive)?.content ?: "word"
            if (type != "word") return@mapNotNull null
            val text = (o["text"] as? JsonPrimitive)?.content?.trim().orEmpty()
            val start = (o["start"] as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
            val end = (o["end"] as? JsonPrimitive)?.doubleOrNull ?: start
            if (text.isEmpty()) null else Word((start * 1000).roundToLong(), (end * 1000).roundToLong(), text)
        }
    }
}
