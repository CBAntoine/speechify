package com.cbantoine.dashcam

import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Rational
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.cbantoine.dashcam.recording.RecordingService
import com.cbantoine.dashcam.ui.DashcamRoot
import com.cbantoine.dashcam.ui.SystemAccess
import com.cbantoine.dashcam.ui.theme.DashcamTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var serviceBound = false
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) = Unit
        override fun onServiceDisconnected(name: ComponentName?) = Unit
    }

    /** Actions from shortcuts, the Quick Settings tile and notifications. */
    private val pendingAction = MutableStateFlow<String?>(null)
    private var pictureInPictureAllowed = false
    private var pictureInPictureSource: Rect? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val freshLaunch = savedInstanceState == null
        if (freshLaunch) pendingAction.value = intent?.action

        setContent {
            DashcamTheme {
                DashcamRoot(
                    pendingAction = pendingAction,
                    autoStartAllowed = freshLaunch,
                    onCameraPermissionGranted = ::bindCameraService,
                )
            }
        }

        val graph = appGraph
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.CREATED) {
                combine(graph.recorderState.state, graph.settings) { state, settings ->
                    Triple(state.isSessionActive, settings.keepScreenOn, settings.pictureInPicture)
                }.distinctUntilChanged().collect { (recording, keepScreenOn, pip) ->
                    if (recording && keepScreenOn) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                    pictureInPictureAllowed = recording && pip && supportsPictureInPicture()
                    updatePictureInPictureParams()
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        bindCameraService()
    }

    override fun onStop() {
        super.onStop()
        if (serviceBound) {
            unbindService(connection)
            serviceBound = false
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pendingAction.value = intent.action
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 12+ enters picture-in-picture on its own (setAutoEnterEnabled).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && pictureInPictureAllowed) {
            runCatching { enterPictureInPictureMode(pictureInPictureParams()) }
        }
    }

    /** Binding keeps the camera preview running while the app is visible. */
    private fun bindCameraService() {
        if (serviceBound || !SystemAccess.hasCamera(this)) return
        serviceBound = bindService(Intent(this, RecordingService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    private fun supportsPictureInPicture() =
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    /** Where the live video sits on screen, so the floating preview animates out of it. */
    fun setPictureInPictureSource(bounds: Rect) {
        if (bounds == pictureInPictureSource) return
        pictureInPictureSource = bounds
        updatePictureInPictureParams()
    }

    private fun pictureInPictureParams(): PictureInPictureParams =
        PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setSourceRectHint(pictureInPictureSource)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setAutoEnterEnabled(pictureInPictureAllowed)
                    setSeamlessResizeEnabled(true)
                }
            }
            .build()

    private fun updatePictureInPictureParams() {
        if (supportsPictureInPicture()) runCatching { setPictureInPictureParams(pictureInPictureParams()) }
    }

    companion object {
        const val ACTION_START_RECORDING = "com.cbantoine.dashcam.action.START_RECORDING"
        const val ACTION_OPEN_CLIPS = "com.cbantoine.dashcam.action.OPEN_CLIPS"
    }
}
