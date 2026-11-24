package com.cbantoine.dashcam

import com.anthropic.core.jsonMapper
import com.cbantoine.dashcam.scanner.SERVER_FALLBACK_BETA
import com.cbantoine.dashcam.scanner.VehicleColour
import com.cbantoine.dashcam.scanner.identifyRequest
import com.cbantoine.dashcam.settings.ClaudeModel
import com.fasterxml.jackson.databind.JsonNode
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

/** Checks the request the SDK will send, serialized exactly as it goes over the wire. */
@RunWith(JUnit4::class)
class IdentifyRequestTest {
    private val mapper = jsonMapper()

    @Test
    fun opusRequestUsesLowEffortStructuredOutputAndServerFallbacks() {
        val params = identifyRequest(byteArrayOf(1, 2, 3), ClaudeModel.OPUS_5_5, VehicleColour.SILVER, "Canada")
        val body: JsonNode = mapper.valueToTree(params._body())

        assertThat(body["model"].asText()).isEqualTo("claude-opus-5-5")
        assertThat(body["max_tokens"].asLong()).isEqualTo(8_000L)
        assertThat(body["fallbacks"].asText()).isEqualTo("default")
        // Thinking is always on for Opus 5.5; effort is the only control, so it isn't sent.
        assertThat(body.has("thinking")).isFalse()

        val output = body["output_config"]
        assertThat(output["effort"].asText()).isEqualTo("low")
        assertThat(output["format"]["type"].asText()).isEqualTo("json_schema")
        val schema = output["format"]["schema"]
        assertThat(schema["additionalProperties"].asBoolean(true)).isFalse()
        assertThat(schema["required"].map { it.asText() }).containsAtLeast("make", "model", "year_from", "year_to")
        assertThat(schema["properties"]["drivetrain"]["enum"].map { it.asText() }).containsExactly("FWD", "RWD", "AWD", "4WD", "unknown")

        val content = body["messages"][0]["content"]
        assertThat(body["messages"][0]["role"].asText()).isEqualTo("user")
        assertThat(content[0]["type"].asText()).isEqualTo("image")
        assertThat(content[0]["source"]["type"].asText()).isEqualTo("base64")
        assertThat(content[0]["source"]["media_type"].asText()).isEqualTo("image/jpeg")
        assertThat(content[0]["source"]["data"].asText()).isEqualTo("AQID")
        assertThat(content[1]["text"].asText()).contains("seen in Canada")
        assertThat(content[1]["text"].asText()).contains("silver")
        assertThat(body["system"].asText()).contains("pixelated on purpose")

        assertThat(params._headers().values("anthropic-beta")).contains(SERVER_FALLBACK_BETA)
    }

    @Test
    fun haikuHasNoServerSideFallback() {
        val params = identifyRequest(byteArrayOf(1), ClaudeModel.HAIKU_5_5, colour = null, market = null)
        val body: JsonNode = mapper.valueToTree(params._body())
        assertThat(body["model"].asText()).isEqualTo("claude-haiku-5-5")
        assertThat(body.has("fallbacks")).isFalse()
        assertThat(params._headers().values("anthropic-beta")).isEmpty()
        assertThat(body["messages"][0]["content"][1]["text"].asText()).isEqualTo("Identify this vehicle.")
    }
}
