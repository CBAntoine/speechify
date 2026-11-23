package com.cbantoine.dashcam.tile

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.cbantoine.dashcam.MainActivity
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.recording.RecordingService

/** Quick Settings tile: start or stop recording from the notification shade. */
class RecordTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()
        val recording = appGraph.recorderState.state.value.isSessionActive
        if (recording) {
            RecordingService.stopRecording(this)
            refresh(recording = false)
        } else {
            // Android only lets a camera service start while the app is visible, so starting
            // goes through the activity.
            val intent = Intent(this, MainActivity::class.java)
                .setAction(MainActivity.ACTION_START_RECORDING)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startActivityAndCollapse(
                    PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            } else {
                startActivityAndCollapseLegacy(intent)
            }
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    @Suppress("DEPRECATION")
    private fun startActivityAndCollapseLegacy(intent: Intent) {
        startActivityAndCollapse(intent)
    }

    private fun refresh(recording: Boolean = appGraph.recorderState.state.value.isSessionActive) {
        val tile = qsTile ?: return
        tile.state = if (recording) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(R.string.tile_label)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = getString(if (recording) R.string.status_rec else R.string.status_ready)
        }
        tile.updateTile()
    }

    companion object {
        fun requestRefresh(context: Context) {
            runCatching {
                requestListeningState(context, ComponentName(context, RecordTileService::class.java))
            }
        }
    }
}
