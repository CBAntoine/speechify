package com.cbantoine.dashcam.scanner

import android.util.Log
import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.errors.AnthropicIoException
import com.anthropic.errors.AnthropicServiceException
import com.anthropic.errors.PermissionDeniedException
import com.anthropic.errors.RateLimitException
import com.anthropic.errors.UnauthorizedException
import com.anthropic.models.beta.messages.BetaBase64ImageSource
import com.anthropic.models.beta.messages.BetaContentBlockParam
import com.anthropic.models.beta.messages.BetaJsonOutputFormat
import com.anthropic.models.beta.messages.BetaOutputConfig
import com.anthropic.models.beta.messages.BetaStopReason
import com.anthropic.models.beta.messages.MessageCreateParams
import com.cbantoine.dashcam.settings.ClaudeModel
import java.time.Duration
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException

sealed interface IdentifyOutcome {
    data class Success(val identity: VehicleIdentity) : IdentifyOutcome
    data object NoKey : IdentifyOutcome
    data object InvalidKey : IdentifyOutcome
    data object Offline : IdentifyOutcome
    data object RateLimited : IdentifyOutcome
    data object Refused : IdentifyOutcome
    data class Failed(val reason: String) : IdentifyOutcome
}

/**
 * Asks Claude what a vehicle is from a cropped photo of it, using the user's own API key. The
 * crop has its licence plate pixelated before it leaves the phone; plates are only read on the
 * device.
 */
class VehicleIdentifier(private val keys: ApiKeyStore) {
    private var client: AnthropicClient? = null
    private var clientKey: String? = null

    suspend fun identify(
        jpeg: ByteArray,
        model: ClaudeModel,
        colour: VehicleColour?,
        market: String?,
    ): IdentifyOutcome = withContext(Dispatchers.IO) {
        val key = keys.get() ?: return@withContext IdentifyOutcome.NoKey
        try {
            val message = client(key).beta().messages().create(identifyRequest(jpeg, model, colour, market))
            when (message.stopReason().orElse(null)) {
                BetaStopReason.REFUSAL -> return@withContext IdentifyOutcome.Refused
                BetaStopReason.MAX_TOKENS -> return@withContext IdentifyOutcome.Failed("The answer was cut off")
                else -> Unit
            }
            val text = message.content().mapNotNull { block -> block.text().orElse(null)?.text() }.joinToString("")
            if (text.isBlank()) return@withContext IdentifyOutcome.Failed("Claude sent an empty answer")
            IdentifyOutcome.Success(VehicleIdentity.parse(text))
        } catch (e: UnauthorizedException) {
            IdentifyOutcome.InvalidKey
        } catch (e: PermissionDeniedException) {
            IdentifyOutcome.Failed("This API key can't use ${model.label}")
        } catch (e: RateLimitException) {
            IdentifyOutcome.RateLimited
        } catch (e: AnthropicIoException) {
            IdentifyOutcome.Offline
        } catch (e: AnthropicServiceException) {
            Log.w(TAG, "Identification failed", e)
            IdentifyOutcome.Failed("Claude returned an error (${e.statusCode()})")
        } catch (e: SerializationException) {
            Log.w(TAG, "Unexpected identification JSON", e)
            IdentifyOutcome.Failed("Claude's answer couldn't be read")
        } catch (e: Exception) {
            Log.w(TAG, "Identification failed", e)
            IdentifyOutcome.Failed(e.message ?: "Something went wrong")
        } catch (e: LinkageError) {
            // Never let a broken client take down the process, which is also recording.
            Log.e(TAG, "Anthropic client unavailable", e)
            IdentifyOutcome.Failed("The Claude client couldn't start")
        }
    }

    /** Drops the HTTP client, for example after the key changed. */
    @Synchronized
    fun reset() {
        client?.close()
        client = null
        clientKey = null
    }

    @Synchronized
    private fun client(key: String): AnthropicClient {
        client?.let { if (clientKey == key) return it }
        client?.close()
        return AnthropicOkHttpClient.builder()
            .apiKey(key)
            .timeout(Duration.ofSeconds(60))
            .maxRetries(2)
            .build()
            .also {
                client = it
                clientKey = key
            }
    }

    private companion object {
        const val TAG = "VehicleIdentifier"
    }
}

/** The identification request: one image and a short prompt, answered as [IdentitySchema] JSON. */
internal fun identifyRequest(jpeg: ByteArray, model: ClaudeModel, colour: VehicleColour?, market: String?): MessageCreateParams {
    val image = BetaBase64ImageSource.builder()
        .data(Base64.getEncoder().encodeToString(jpeg))
        .mediaType(BetaBase64ImageSource.MediaType.IMAGE_JPEG)
        .build()
    val prompt = buildList {
        add("Identify this vehicle.")
        market?.let { add("It was seen in $it.") }
        colour?.let { add("Its body colour, measured on the phone, is ${it.label.lowercase()}.") }
    }.joinToString(" ")
    val schema = BetaJsonOutputFormat.Schema.builder().apply {
        IdentitySchema.schema.forEach { (name, value) -> putAdditionalProperty(name, JsonValue.from(value)) }
    }.build()
    return MessageCreateParams.builder()
        .model(model.id)
        .maxTokens(MAX_TOKENS)
        .system(SYSTEM_PROMPT)
        .addUserMessageOfContentBlockParams(listOf(BetaContentBlockParam.ofImage(image), BetaContentBlockParam.ofText(prompt)))
        .outputConfig(
            BetaOutputConfig.builder()
                // A quick look is enough to name a car, and keeps the panel responsive.
                .effort(BetaOutputConfig.Effort.LOW)
                .format(BetaJsonOutputFormat.builder().schema(schema).build())
                .build(),
        )
        .apply {
            // If a safety classifier declines the request, the API retries it on the model
            // Anthropic recommends instead of failing.
            if (model.serverFallback) {
                addBeta(SERVER_FALLBACK_BETA)
                fallbacksDefault()
            }
        }
        .build()
}

private const val MAX_TOKENS = 8_000L
internal const val SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"

private val SYSTEM_PROMPT = """
    You identify vehicles in photos taken by the user's own dashcam app. Work out the make, model and model-year range from visible design features such as the headlights, grille, tail lights, body lines and badges.
    The licence plate is pixelated on purpose; ignore it.
    The specifications describe what this model and these years most commonly have, not claims about this particular car.
    If the vehicle is partly hidden or blurry, give your best guess and lower the confidence. Don't describe people.
""".trimIndent()
