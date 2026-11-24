package com.cbantoine.dashcam

import com.cbantoine.dashcam.scanner.IdentitySchema
import com.cbantoine.dashcam.scanner.RecallsParser
import com.cbantoine.dashcam.scanner.VehicleIdentity
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class VehicleIdentityTest {
    private val civic = """
        {"is_vehicle": true, "make": "Honda", "model": "Civic", "year_from": 2020, "year_to": 2022,
         "generation": "10th generation (facelift)", "body_style": "4-door sedan", "fuel": "petrol",
         "engine": "2.0 L 4-cylinder", "drivetrain": "FWD", "confidence": "high",
         "evidence": "Headlight shape and fastback roofline"}
    """.trimIndent()

    @Test
    fun parsesStructuredOutput() {
        val identity = VehicleIdentity.parse(civic)
        assertThat(identity.title).isEqualTo("Honda Civic")
        assertThat(identity.yearsLabel).isEqualTo("2020–2022")
        assertThat(identity.specsLabel).isEqualTo("Petrol · 2.0 L 4-cylinder · FWD")
        assertThat(identity.isUsable).isTrue()
    }

    @Test
    fun yearsAreSanitised() {
        assertThat(VehicleIdentity(yearFrom = 0, yearTo = 0).years).isNull()
        assertThat(VehicleIdentity(yearFrom = 2021, yearTo = 0).yearsLabel).isEqualTo("2021")
        assertThat(VehicleIdentity(yearFrom = 2022, yearTo = 2019).years).isEqualTo(2019..2022)
        assertThat(VehicleIdentity(yearFrom = 3000, yearTo = 2021).yearsLabel).isEqualTo("2021")
    }

    @Test
    fun unknownSpecsAreLeftOut() {
        val identity = VehicleIdentity(make = "Tesla", fuel = "electric", engine = "unknown", drivetrain = "unknown")
        assertThat(identity.specsLabel).isEqualTo("Electric")
        assertThat(VehicleIdentity(make = "Ford").specsLabel).isNull()
    }

    @Test
    fun notAVehicleIsNotUsable() {
        assertThat(VehicleIdentity(isVehicle = false, make = "Honda").isUsable).isFalse()
        assertThat(VehicleIdentity(make = " ").isUsable).isFalse()
    }

    @Test
    fun schemaFollowsTheStructuredOutputRules() {
        val schema = IdentitySchema.schema
        @Suppress("UNCHECKED_CAST")
        val properties = schema["properties"] as Map<String, Map<String, Any>>
        assertThat(schema["additionalProperties"]).isEqualTo(false)
        assertThat(schema["required"] as List<*>).containsExactlyElementsIn(properties.keys)
        val unsupported = setOf("minimum", "maximum", "multipleOf", "minLength", "maxLength", "oneOf", "not")
        properties.values.forEach { property -> assertThat(property.keys.intersect(unsupported)).isEmpty() }
        // Every field the app reads is in the schema.
        assertThat(properties.keys).containsAtLeast("make", "model", "year_from", "year_to", "body_style", "fuel", "engine", "drivetrain")
    }

    @Test
    fun parsesNhtsaRecalls() {
        val body = """
            {"Count": 3, "Message": "Results returned successfully", "results": [
              {"Manufacturer": "Honda (American Honda Motor Co.)", "NHTSACampaignNumber": "20V314000",
               "ReportReceivedDate": "28/05/2020", "Component": "STRUCTURE:BODY", "Summary": "Hood latch",
               "ModelYear": "2020", "Make": "HONDA", "Model": "CIVIC"},
              {"NHTSACampaignNumber": "22V100000", "ReportReceivedDate": "01/03/2022",
               "Component": "ELECTRICAL SYSTEM", "Summary": "Wiring"},
              {"NHTSACampaignNumber": "20V314000", "ReportReceivedDate": "28/05/2020",
               "Component": "STRUCTURE:BODY", "Summary": "Hood latch", "ModelYear": "2021"}
            ]}
        """.trimIndent()
        val items = RecallsParser.merge(RecallsParser.parse(body))
        assertThat(items.map { it.campaign }).containsExactly("22V100000", "20V314000").inOrder()
        assertThat(items.last().date).isEqualTo(LocalDate.of(2020, 5, 28))
        assertThat(items.first().component).isEqualTo("ELECTRICAL SYSTEM")
    }

    @Test
    fun recallParsingIsLenient() {
        assertThat(RecallsParser.parse("""{"Count": 0, "Results": []}""")).isEmpty()
        assertThat(RecallsParser.parse("{}")).isEmpty()
        val iso = RecallsParser.parse("""{"Results": [{"nhtsa_campaign_number": "23V865000", "report_received_date": "2023-12-20"}]}""")
        assertThat(iso.single().date).isEqualTo(LocalDate.of(2023, 12, 20))
    }
}
