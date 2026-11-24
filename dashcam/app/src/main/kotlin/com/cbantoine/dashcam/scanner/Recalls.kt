package com.cbantoine.dashcam.scanner

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

data class RecallItem(
    val campaign: String,
    val component: String,
    val summary: String,
    val date: LocalDate?,
)

/** Safety recalls on record for a make, model and range of model years. */
data class RecallSummary(val items: List<RecallItem>, val yearsChecked: IntRange) {
    val count: Int get() = items.size
}

/** Parses NHTSA's recallsByVehicle responses. Keys are matched loosely, in case their casing changes. */
object RecallsParser {
    private val json = Json { ignoreUnknownKeys = true }
    private val DATE_FORMATS = listOf(
        DateTimeFormatter.ofPattern("dd/MM/yyyy"),
        DateTimeFormatter.ISO_LOCAL_DATE,
    )

    fun parse(body: String): List<RecallItem> {
        val root = json.parseToJsonElement(body) as? JsonObject ?: return emptyList()
        val results = root.field("results") as? JsonArray ?: return emptyList()
        return results.mapNotNull { element ->
            val recall = element as? JsonObject ?: return@mapNotNull null
            RecallItem(
                campaign = recall.text("NHTSACampaignNumber", "nhtsa_campaign_number"),
                component = recall.text("Component", "components"),
                summary = recall.text("Summary"),
                date = parseDate(recall.text("ReportReceivedDate", "report_received_date")),
            ).takeIf { it.campaign.isNotEmpty() || it.summary.isNotEmpty() }
        }
    }

    /** Joins per-year results: one campaign usually covers several years. Newest first. */
    fun merge(items: List<RecallItem>): List<RecallItem> =
        items.distinctBy { it.campaign.ifEmpty { it.summary } }
            .sortedWith(compareByDescending<RecallItem> { it.date ?: LocalDate.MIN })

    private fun parseDate(text: String): LocalDate? {
        if (text.isEmpty()) return null
        return DATE_FORMATS.firstNotNullOfOrNull { format -> runCatching { LocalDate.parse(text, format) }.getOrNull() }
    }

    private fun JsonObject.field(name: String) = entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

    private fun JsonObject.text(vararg names: String): String =
        names.firstNotNullOfOrNull { (field(it) as? JsonPrimitive)?.contentOrNull }?.trim().orEmpty()
}

/**
 * Looks up recalls in NHTSA's public database (US data; Canadian-market cars mostly share the
 * same campaigns). Free, keyless, and only the make, model and year leave the phone.
 */
class RecallsClient {
    suspend fun fetch(make: String, model: String, years: IntRange): RecallSummary = withContext(Dispatchers.IO) {
        val checked = years.last - minOf(years.last - years.first, MAX_YEARS - 1)..years.last
        val items = checked.flatMap { year -> RecallsParser.parse(get(url(make, model, year))) }
        RecallSummary(RecallsParser.merge(items), checked)
    }

    private fun url(make: String, model: String, year: Int): String {
        fun enc(value: String) = URLEncoder.encode(value.trim(), "UTF-8")
        return "https://api.nhtsa.gov/recalls/recallsByVehicle?make=${enc(make)}&model=${enc(model)}&modelYear=$year"
    }

    private fun get(url: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            val code = connection.responseCode
            // Never read an error as "no recalls": the panel says the lookup failed instead.
            if (code != HttpURLConnection.HTTP_OK) throw IOException("NHTSA returned HTTP $code")
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        /** A design usually spans several model years; checking the latest few keeps it to a few requests. */
        const val MAX_YEARS = 3
    }
}
