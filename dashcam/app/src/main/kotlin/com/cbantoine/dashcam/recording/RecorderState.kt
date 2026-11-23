package com.cbantoine.dashcam.recording

import android.content.Context
import android.view.Surface
import androidx.camera.core.SurfaceRequest
import androidx.core.content.edit
import com.cbantoine.dashcam.settings.VideoQuality
import com.cbantoine.dashcam.telemetry.GpsFix
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class RecorderPhase { IDLE, STARTING, RECORDING, STOPPING, COOLING_DOWN }

enum class RecorderIssue { CAMERA_IN_USE, CAMERA_DISABLED, CAMERA_ERROR, STORAGE_FULL, PERMISSION_MISSING, OVERHEATING }

enum class ProtectReason { MANUAL, IMPACT }

data class ProtectNotice(val atMs: Long, val reason: ProtectReason, val g: Float? = null)

data class ZoomInfo(val ratio: Float, val min: Float, val max: Float)

data class RecorderUiState(
    val phase: RecorderPhase = RecorderPhase.IDLE,
    val cameraReady: Boolean = false,
    val previewAvailable: Boolean = true,
    val sessionStartedAtMs: Long? = null,
    val clipStartedAtMs: Long? = null,
    val clipsThisSession: Int = 0,
    val activeClipPath: String? = null,
    val currentClipProtected: Boolean = false,
    val audioEnabled: Boolean = false,
    val muted: Boolean = false,
    val quality: VideoQuality? = null,
    val hevc: Boolean = false,
    val issue: RecorderIssue? = null,
    val thermalWarning: Boolean = false,
    val stopCountdownSec: Int? = null,
    val lastProtect: ProtectNotice? = null,
    val zoom: ZoomInfo? = null,
    val supportedQualities: List<VideoQuality> = emptyList(),
    val hevcSupported: Boolean = false,
    val stabilizationSupported: Boolean = false,
) {
    val isSessionActive: Boolean
        get() = phase == RecorderPhase.STARTING || phase == RecorderPhase.RECORDING || phase == RecorderPhase.COOLING_DOWN
}

/** Commands the UI can send straight to a running engine. */
interface RecorderController {
    fun stopRecording()
    fun protectCurrentClip()
    fun setMuted(muted: Boolean)
    fun setZoom(ratio: Float)
    fun cancelAutoStop()
}

/** Shared, observable recorder state. The service writes it; the UI and tile read it. */
class RecorderStateHolder {
    private val _state = MutableStateFlow(RecorderUiState())
    val state: StateFlow<RecorderUiState> = _state.asStateFlow()

    /** The latest viewfinder request from the camera, consumed by the camera screen. */
    val surfaceRequest = MutableStateFlow<SurfaceRequest?>(null)
    val gps = MutableStateFlow<GpsFix?>(null)
    val gForce = MutableStateFlow(0f)

    /** Display rotation reported by the camera screen while it is visible. */
    val displayRotation = MutableStateFlow(Surface.ROTATION_90)

    @Volatile
    var controller: RecorderController? = null

    fun update(transform: (RecorderUiState) -> RecorderUiState) = _state.update(transform)
}

/** Remembers that a session was running so an unexpected process death can be reported. */
class SessionMarker(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    var wasInterrupted: Boolean = prefs.getBoolean(KEY_ACTIVE, false)
        private set

    fun markActive(active: Boolean) {
        prefs.edit { putBoolean(KEY_ACTIVE, active) }
        if (active) wasInterrupted = false
    }

    fun acknowledgeInterruption() {
        wasInterrupted = false
        prefs.edit { putBoolean(KEY_ACTIVE, false) }
    }

    private companion object {
        const val KEY_ACTIVE = "active"
    }
}
