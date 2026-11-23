package com.cbantoine.dashcam.recording

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.tile.RecordTileService
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Hosts the [DashcamEngine].
 *
 * - While the app is on screen the activity binds to this service, so the camera preview runs.
 * - While recording, it is a camera/microphone/location foreground service with an ongoing
 *   notification. Android then lets it keep recording while other apps are in front and while
 *   the screen is off.
 */
class RecordingService : LifecycleService(), DashcamEngine.Callbacks {
    private lateinit var engine: DashcamEngine
    private val binder = Binder()
    private var inForeground = false

    override fun onCreate() {
        super.onCreate()
        engine = DashcamEngine(this, appGraph, this)
        engine.start()
        lifecycleScope.launch {
            combine(appGraph.recorderState.state, appGraph.settings) { state, settings -> state to settings }
                .distinctUntilChanged { old, new -> notificationKey(old.first) == notificationKey(new.first) && old.second.clipMinutes == new.second.clipMinutes }
                .collect { (state, settings) ->
                    if (inForeground) {
                        RecordingNotifications.update(this@RecordingService, RecordingNotifications.recording(this@RecordingService, state, settings))
                    }
                }
        }
        lifecycleScope.launch {
            appGraph.recorderState.state.map { it.isSessionActive }.distinctUntilChanged().collect {
                RecordTileService.requestRefresh(this@RecordingService)
            }
        }
    }

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return binder
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_START -> startRecording()
            ACTION_STOP -> if (engine.isSessionActive) engine.stopRecording() else stopIfIdle()
            ACTION_PROTECT -> engine.protectCurrentClip()
            ACTION_MUTE -> engine.setMuted(true)
            ACTION_UNMUTE -> engine.setMuted(false)
            ACTION_CANCEL_AUTO_STOP -> engine.cancelAutoStop()
            else -> stopIfIdle()
        }
        return START_NOT_STICKY
    }

    private fun startRecording() {
        if (!enterForeground()) {
            stopIfIdle()
            return
        }
        if (!engine.startRecording()) {
            leaveForeground()
            stopSelf()
        }
    }

    private fun enterForeground(): Boolean {
        val graph = appGraph
        val notification = RecordingNotifications.recording(
            this,
            graph.recorderState.state.value.copy(phase = RecorderPhase.STARTING),
            graph.settings.value,
        )
        return try {
            ServiceCompat.startForeground(this, RecordingNotifications.ID_RECORDING, notification, foregroundTypes())
            inForeground = true
            true
        } catch (e: Exception) {
            Log.e(TAG, "Couldn't start the camera foreground service", e)
            // startForegroundService() requires a startForeground() call, or Android kills the app.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                runCatching {
                    ServiceCompat.startForeground(
                        this, RecordingNotifications.ID_RECORDING, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
                    )
                }
            }
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            false
        }
    }

    private fun foregroundTypes(): Int {
        val location = granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return if (location && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            } else {
                0
            }
        }
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        if (appGraph.settings.value.recordAudio && granted(Manifest.permission.RECORD_AUDIO)) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        if (location) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        return types
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun leaveForeground() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        inForeground = false
    }

    private fun stopIfIdle() {
        if (engine.isSessionActive) return
        if (inForeground) leaveForeground()
        stopSelf()
    }

    override fun onSessionFinished() {
        leaveForeground()
        // Stays alive (camera preview only) while the activity is still bound.
        stopSelf()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Swiping the app away from Recents must not stop a recording in progress.
        if (!engine.isSessionActive) stopSelf()
    }

    override fun onDestroy() {
        engine.release()
        super.onDestroy()
    }

    private data class NotificationKey(
        val phase: RecorderPhase,
        val muted: Boolean,
        val audio: Boolean,
        val protected: Boolean,
        val countdown: Int?,
        val started: Long?,
        val quality: String?,
    )

    private fun notificationKey(state: RecorderUiState) = NotificationKey(
        state.phase, state.muted, state.audioEnabled, state.currentClipProtected,
        state.stopCountdownSec, state.sessionStartedAtMs, state.quality?.label,
    )

    companion object {
        private const val TAG = "RecordingService"
        const val ACTION_START = "com.cbantoine.dashcam.action.SERVICE_START"
        const val ACTION_STOP = "com.cbantoine.dashcam.action.SERVICE_STOP"
        const val ACTION_PROTECT = "com.cbantoine.dashcam.action.SERVICE_PROTECT"
        const val ACTION_MUTE = "com.cbantoine.dashcam.action.SERVICE_MUTE"
        const val ACTION_UNMUTE = "com.cbantoine.dashcam.action.SERVICE_UNMUTE"
        const val ACTION_CANCEL_AUTO_STOP = "com.cbantoine.dashcam.action.SERVICE_CANCEL_AUTO_STOP"

        /** Must be called while the app is in the foreground (Android's camera rules). */
        fun startRecording(context: Context) {
            ContextCompat.startForegroundService(
                context, Intent(context, RecordingService::class.java).setAction(ACTION_START),
            )
        }

        fun stopRecording(context: Context) {
            val controller = context.appGraph.recorderState.controller
            if (controller != null) {
                controller.stopRecording()
            } else {
                runCatching {
                    context.startService(Intent(context, RecordingService::class.java).setAction(ACTION_STOP))
                }
            }
        }
    }
}
