package com.cbantoine.dashcam.settings

import java.util.Locale

enum class VideoQuality(val label: String, internal val approxMbps: Int) {
    HD("720p", 8),
    FHD("1080p", 16),
    QHD("1440p", 24),
    UHD("4K", 45),
}

/** Thresholds are peak linear acceleration in g (gravity removed). */
enum class ImpactSensitivity(val thresholdG: Float?) {
    OFF(null),
    LOW(3.5f),
    MEDIUM(2.5f),
    HIGH(1.8f),
}

enum class SpeedUnit { KMH, MPH }

enum class MountOrientation { LANDSCAPE, PORTRAIT }

/** Claude models the car scanner can identify vehicles with. Opus is the default. */
enum class ClaudeModel(val id: String, val label: String, internal val serverFallback: Boolean) {
    OPUS_5_5("claude-opus-5-5", "Claude Opus 5.5", true),
    SONNET_5_5("claude-sonnet-5-5", "Claude Sonnet 5.5", true),

    // No server-side fallback is offered for Haiku.
    HAIKU_5_5("claude-haiku-5-5", "Claude Haiku 5.5", false),
}

data class DashcamSettings(
    val quality: VideoQuality = VideoQuality.FHD,
    val clipMinutes: Int = 1,
    val recordAudio: Boolean = true,
    val useHevc: Boolean = false,
    val stabilization: Boolean = false,
    val orientation: MountOrientation = MountOrientation.LANDSCAPE,
    val zoomRatio: Float = 1f,
    val overlayTimestamp: Boolean = true,
    val overlaySpeed: Boolean = true,
    val overlayCoordinates: Boolean = false,
    val speedUnit: SpeedUnit = defaultSpeedUnit(),
    val impactSensitivity: ImpactSensitivity = ImpactSensitivity.MEDIUM,
    val loopStorageGb: Int = 8,
    val storageVolume: Int = 0,
    val autoSaveProtectedToGallery: Boolean = true,
    val autoStartOnLaunch: Boolean = true,
    val stopOnPowerDisconnect: Boolean = false,
    val keepScreenOn: Boolean = true,
    val pictureInPicture: Boolean = false,
    val onboardingDone: Boolean = false,
    val batteryPromptDismissed: Boolean = false,
    /** Gives the camera a second, small stream for the on-device car scanner. */
    val scannerEnabled: Boolean = true,
    /** The scanner is switched on from the camera screen. */
    val scanActive: Boolean = false,
    val scannerAutoIdentify: Boolean = true,
    val scannerModel: ClaudeModel = ClaudeModel.OPUS_5_5,
) {
    val clipDurationMs: Long get() = clipMinutes * 60_000L
    val loopStorageBytes: Long get() = loopStorageGb * 1_000_000_000L

    companion object {
        val CLIP_LENGTH_OPTIONS = listOf(1, 2, 3, 5)
        val LOOP_LIMIT_OPTIONS = listOf(2, 4, 8, 16, 32, 64)

        fun defaultSpeedUnit(locale: Locale = Locale.getDefault()): SpeedUnit =
            if (locale.country in setOf("US", "GB", "LR", "MM")) SpeedUnit.MPH else SpeedUnit.KMH
    }
}
