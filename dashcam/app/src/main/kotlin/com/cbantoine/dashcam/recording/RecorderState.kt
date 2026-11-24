package com.cbantoine.dashcam.recording

import android.content.Context
import android.view.Surface
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.SurfaceRequest
import androidx.core.content.edit
import com.cbantoine.dashcam.settings.VideoQuality
import com.cbantoine.dashcam.telemetry.GpsFix
import java.util.concurrent.Executor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** WAITING: a session that has recorded before but isn't getting frames right now (camera taken). */
enum class RecorderPhase { IDLE, STARTING, RECORDING, WAITING, STOPPING, COOLING_DOWN }

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
    /** The camera is also feeding the car scanner's analysis stream. */
    val scannerAvailable: Boolean = false,
    /** The scanner is on in Settings but this camera can't run its stream at this video quality. */
    val scannerBlocked: Boolean = false,
) {
    val isSessionActive: Boolean
        get() = phase == RecorderPhase.STARTING || phase == RecorderPhase.RECORDING ||
            phase == RecorderPhase.WAITING || phase == RecorderPhase.COOLING_DOWN
}

/** Commands the UI can send straight to a running engine. */
interface RecorderController {
    fun stopRecording()
    fun protectCurrentClip()
    fun setMuted(muted: Boolean)
    fun setZoom(ratio: Float)
    fun cancelAutoStop()
}

/** Something that wants camera frames from the engine's analysis stream (the car scanner). */
class FrameAnalyzer(val executor: Executor, val analyzer: ImageAnalysis.Analyzer)

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

    /** Attached to the analysis stream while set; frames stop when it is null. */
    val frameAnalyzer = MutableStateFlow<FrameAnalyzer?>(null)

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
