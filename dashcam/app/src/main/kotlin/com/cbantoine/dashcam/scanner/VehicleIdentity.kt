package com.cbantoine.dashcam.scanner

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** What Claude says a vehicle is, as returned in the structured JSON output. */
@Serializable
data class VehicleIdentity(
    @SerialName("is_vehicle") val isVehicle: Boolean = true,
    val make: String = "",
    val model: String = "",
    @SerialName("year_from") val yearFrom: Int = 0,
    @SerialName("year_to") val yearTo: Int = 0,
    val generation: String = "",
    @SerialName("body_style") val bodyStyle: String = "",
    val fuel: String = "unknown",
    val engine: String = "",
    val drivetrain: String = "unknown",
    val confidence: String = "low",
    val evidence: String = "",
) {
    val title: String get() = listOf(make, model).filter { it.isNotBlank() }.joinToString(" ")

    val isUsable: Boolean get() = isVehicle && make.isNotBlank()

    /** Model years as a range, or null when Claude couldn't date it. */
    val years: IntRange?
        get() {
            val from = if (yearFrom in VALID_YEARS) yearFrom else null
            val to = if (yearTo in VALID_YEARS) yearTo else null
            return when {
                from != null && to != null -> if (from <= to) from..to else to..from
                from != null -> from..from
                to != null -> to..to
                else -> null
            }
        }

    val yearsLabel: String?
        get() = years?.let { if (it.first == it.last) "${it.first}" else "${it.first}–${it.last}" }

    /** "Petrol · 2.0 L 4-cylinder · FWD", leaving out whatever is unknown. */
    val specsLabel: String?
        get() = listOfNotNull(
            FUEL_LABELS[fuel],
            engine.trim().takeIf { it.isNotEmpty() && !it.equals("unknown", ignoreCase = true) },
            drivetrain.takeIf { it in setOf("FWD", "RWD", "AWD", "4WD") },
        ).joinToString(" · ").ifEmpty { null }

    companion object {
        private val VALID_YEARS = 1950..2035

        private val FUEL_LABELS = mapOf(
            "petrol" to "Petrol",
            "diesel" to "Diesel",
            "hybrid" to "Hybrid",
            "plug_in_hybrid" to "Plug-in hybrid",
            "electric" to "Electric",
        )

        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String): VehicleIdentity = json.decodeFromString(serializer(), text)
    }
}

/**
 * The JSON schema for [VehicleIdentity], in the subset structured outputs accept: every object
 * lists all of its properties as required and sets additionalProperties to false, and enums
 * stand in for numeric ranges, which aren't supported.
 */
object IdentitySchema {
    private val properties: Map<String, Map<String, Any>> = linkedMapOf(
        "is_vehicle" to mapOf(
            "type" to "boolean",
            "description" to "False if the photo doesn't show a road vehicle clearly enough to identify.",
        ),
        "make" to mapOf("type" to "string", "description" to "Manufacturer, e.g. Honda. Empty if unknown."),
        "model" to mapOf(
            "type" to "string",
            "description" to "Model name as sold in North America, e.g. Civic or CR-V. Empty if unknown.",
        ),
        "year_from" to mapOf(
            "type" to "integer",
            "description" to "First model year this exact design was sold, or 0 if unknown.",
        ),
        "year_to" to mapOf(
            "type" to "integer",
            "description" to "Last model year this exact design was sold, or 0 if unknown.",
        ),
        "generation" to mapOf(
            "type" to "string",
            "description" to "Generation or facelift, e.g. 11th generation. Empty if unknown.",
        ),
        "body_style" to mapOf(
            "type" to "string",
            "description" to "For example 4-door sedan, 5-door hatchback, SUV, minivan or pickup.",
        ),
        "fuel" to mapOf(
            "type" to "string",
            "enum" to listOf("petrol", "diesel", "hybrid", "plug_in_hybrid", "electric", "unknown"),
            "description" to "The most common powertrain for this model and years.",
        ),
        "engine" to mapOf(
            "type" to "string",
            "description" to "The most common engine for this model and years, e.g. 2.0 L 4-cylinder. Empty if unknown.",
        ),
        "drivetrain" to mapOf(
            "type" to "string",
            "enum" to listOf("FWD", "RWD", "AWD", "4WD", "unknown"),
            "description" to "The most common drivetrain for this model and years.",
        ),
        "confidence" to mapOf("type" to "string", "enum" to listOf("high", "medium", "low")),
        "evidence" to mapOf(
            "type" to "string",
            "description" to "The visible design features the identification rests on, in under 12 words.",
        ),
    )

    val schema: Map<String, Any> = linkedMapOf(
        "type" to "object",
        "properties" to properties,
        "required" to properties.keys.toList(),
        "additionalProperties" to false,
    )
}
