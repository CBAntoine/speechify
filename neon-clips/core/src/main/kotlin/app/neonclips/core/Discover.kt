package app.neonclips.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.net.URLEncoder
import java.util.Base64
import kotlin.math.max

enum class TimeWindow(val label: String, internal val code: Int) {
    TODAY("Today", 2),
    WEEK("This week", 3),
    MONTH("This month", 4),
    YEAR("This year", 5),
    ALL("All time", 0),
}

enum class Length(val label: String, internal val code: Int) {
    ANY("Any length", 0),
    SHORT("Under 4 min", 1),
    MEDIUM("4-20 min", 3),
    LONG("Over 20 min", 2),
}

object Discover {

    /**
     * A YouTube results URL that lists videos for [query] ordered by view count, limited to
     * [window] and [length]. The `sp` value is the same filter blob the site builds when you pick
     * those filters by hand: a small protobuf, base64-encoded.
     */
    fun searchUrl(query: String, window: TimeWindow = TimeWindow.WEEK, length: Length = Length.ANY): String {
        val filters = java.io.ByteArrayOutputStream()
        if (window.code != 0) { filters.write(0x08); filters.write(window.code) }   // upload date
        filters.write(0x10); filters.write(0x01)                                    // type = video
        if (length.code != 0) { filters.write(0x18); filters.write(length.code) }   // duration
        val bytes = java.io.ByteArrayOutputStream()
        bytes.write(0x08); bytes.write(0x03)                                        // sort = view count
        bytes.write(0x12); bytes.write(filters.size())
        bytes.write(filters.toByteArray())
        val sp = Base64.getEncoder().encodeToString(bytes.toByteArray())
        return "https://www.youtube.com/results?search_query=" +
            URLEncoder.encode(query.trim(), "UTF-8") + "&sp=" + URLEncoder.encode(sp, "UTF-8")
    }

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /** Parses yt-dlp `--flat-playlist --dump-json` output: one JSON object per line. */
    fun parseSearch(output: String): List<VideoHit> =
        output.lineSequence().map { it.trim() }.filter { it.startsWith("{") }
            .mapNotNull { runCatching { hit(json.parseToJsonElement(it).jsonObject) }.getOrNull() }
            .distinctBy { it.id }
            .toList()

    /** Parses yt-dlp `--dump-json` output for a single video. */
    fun parseInfo(output: String): RemoteInfo? {
        val line = output.lineSequence().map { it.trim() }.firstOrNull { it.startsWith("{") } ?: return null
        val o = runCatching { json.parseToJsonElement(line).jsonObject }.getOrNull() ?: return null
        val hit = hit(o) ?: return null
        val heat = (o["heatmap"] as? JsonArray).orEmpty().mapNotNull { e ->
            val p = e as? JsonObject ?: return@mapNotNull null
            val s = p.double("start_time") ?: return@mapNotNull null
            val z = p.double("end_time") ?: return@mapNotNull null
            HeatPoint(s, z, p.double("value") ?: 0.0)
        }
        return RemoteInfo(hit, heat)
    }

    private fun hit(o: JsonObject): VideoHit? {
        val id = o.string("id") ?: return null
        val url = o.string("webpage_url") ?: o.string("original_url") ?: o.string("url") ?: return null
        val live = o.string("live_status")
        val thumbs = (o["thumbnails"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.string("url") }
        val published = o.long("timestamp") ?: o.long("release_timestamp") ?: o.string("upload_date")?.let(::dateToEpoch)
        return VideoHit(
            id = id,
            url = url,
            title = o.string("title") ?: id,
            channel = o.string("channel") ?: o.string("uploader") ?: "",
            durationSec = o.double("duration")?.toLong(),
            views = o.long("view_count"),
            publishedAtSec = published,
            thumbnail = o.string("thumbnail") ?: thumbs.lastOrNull(),
            wasLive = live == "was_live" || live == "post_live",
            isLiveNow = live == "is_live" || live == "is_upcoming",
        )
    }

    /** "20261121" -> epoch seconds at midnight UTC. */
    private fun dateToEpoch(yyyymmdd: String): Long? = runCatching {
        java.time.LocalDate.parse(yyyymmdd, java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
            .atStartOfDay(java.time.ZoneOffset.UTC).toEpochSecond()
    }.getOrNull()

    /** Views gained per hour since upload: what "performing" means when two videos differ in age. */
    fun velocity(hit: VideoHit, nowSec: Long): Double? {
        val views = hit.views ?: return null
        val at = hit.publishedAtSec ?: return null
        return views / max(1.0, (nowSec - at) / 3600.0)
    }

    enum class Sort(val label: String) { VIEWS("Most views"), VELOCITY("Fastest rising") }

    fun rank(hits: List<VideoHit>, sort: Sort, nowSec: Long): List<VideoHit> = when (sort) {
        Sort.VIEWS -> hits.sortedByDescending { it.views ?: -1 }
        Sort.VELOCITY -> hits.sortedByDescending { velocity(it, nowSec) ?: -1.0 }
    }.filterNot { it.isLiveNow }

    private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
    private fun JsonObject.prim(key: String): JsonPrimitive? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }
    private fun JsonObject.string(key: String): String? = prim(key)?.takeIf { it.isString }?.content
    private fun JsonObject.long(key: String): Long? = prim(key)?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }
    private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull
    @Suppress("unused")
    private fun JsonObject.bool(key: String): Boolean? = prim(key)?.booleanOrNull
}

object Fmt {
    /** 41554956 -> "41.6M" */
    fun count(n: Long?): String = when {
        n == null -> "-"
        n >= 1_000_000_000 -> trim1(n / 1e9) + "B"
        n >= 1_000_000 -> trim1(n / 1e6) + "M"
        n >= 1_000 -> trim1(n / 1e3) + "K"
        else -> n.toString()
    }

    private fun trim1(v: Double): String {
        val s = String.format(java.util.Locale.US, if (v >= 100) "%.0f" else "%.1f", v)
        return s.removeSuffix(".0")
    }

    /** 95000 ms -> "1:35"; over an hour -> "1:02:03" */
    fun clock(ms: Long): String {
        val total = max(0, ms) / 1000
        val h = total / 3600
        val m = total % 3600 / 60
        val s = total % 60
        return if (h > 0) String.format(java.util.Locale.US, "%d:%02d:%02d", h, m, s)
        else String.format(java.util.Locale.US, "%d:%02d", m, s)
    }

    /** Timecode with hundredths, for the editor: "00:01.49" */
    fun timecode(ms: Long): String {
        val t = max(0, ms)
        return String.format(java.util.Locale.US, "%02d:%02d.%02d", t / 60000, t / 1000 % 60, t % 1000 / 10)
    }

    fun age(publishedAtSec: Long?, nowSec: Long): String {
        if (publishedAtSec == null) return ""
        val h = max(0, nowSec - publishedAtSec) / 3600
        return when {
            h < 1 -> "just now"
            h < 48 -> "${h}h ago"
            h < 24 * 60 -> "${h / 24}d ago"
            h < 24 * 365 * 2 -> "${h / (24 * 30)}mo ago"
            else -> "${h / (24 * 365)}y ago"
        }
    }
}
