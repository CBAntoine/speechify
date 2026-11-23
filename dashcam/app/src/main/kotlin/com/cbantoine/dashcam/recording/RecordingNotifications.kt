package com.cbantoine.dashcam.recording

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.cbantoine.dashcam.MainActivity
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.settings.DashcamSettings

object RecordingNotifications {
    const val CHANNEL_RECORDING = "recording"
    const val CHANNEL_ALERTS = "alerts"
    const val ID_RECORDING = 1001
    private const val ID_ALERT = 1002

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHANNEL_RECORDING,
                    context.getString(R.string.channel_recording_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = context.getString(R.string.channel_recording_desc)
                    setShowBadge(false)
                },
                NotificationChannel(
                    CHANNEL_ALERTS,
                    context.getString(R.string.channel_alerts_name),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply { description = context.getString(R.string.channel_alerts_desc) },
            ),
        )
    }

    fun recording(context: Context, state: RecorderUiState, settings: DashcamSettings): Notification {
        val title = when {
            state.phase == RecorderPhase.COOLING_DOWN -> context.getString(R.string.notif_cooling_title)
            state.phase == RecorderPhase.STARTING -> context.getString(R.string.notif_starting_title)
            state.muted || !state.audioEnabled -> context.getString(R.string.notif_recording_title_muted)
            else -> context.getString(R.string.notif_recording_title)
        }
        val text = when {
            state.stopCountdownSec != null -> context.getString(R.string.notif_countdown_text, state.stopCountdownSec)
            state.phase == RecorderPhase.COOLING_DOWN -> context.getString(R.string.notif_cooling_text)
            state.currentClipProtected -> context.getString(R.string.notif_protected_text)
            else -> context.getString(
                R.string.notif_recording_text,
                (state.quality ?: settings.quality).label,
                settings.clipMinutes,
            )
        }
        val builder = NotificationCompat.Builder(context, CHANNEL_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_dashcam)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setColor(ContextCompat.getColor(context, R.color.dashcam_red))
        state.sessionStartedAtMs?.let { builder.setWhen(it).setShowWhen(true).setUsesChronometer(true) }

        if (state.stopCountdownSec != null) {
            builder.addAction(0, context.getString(R.string.notif_action_keep), serviceAction(context, RecordingService.ACTION_CANCEL_AUTO_STOP))
        } else {
            builder.addAction(0, context.getString(R.string.notif_action_protect), serviceAction(context, RecordingService.ACTION_PROTECT))
        }
        if (state.audioEnabled) {
            val (label, action) = if (state.muted) {
                R.string.notif_action_unmute to RecordingService.ACTION_UNMUTE
            } else {
                R.string.notif_action_mute to RecordingService.ACTION_MUTE
            }
            builder.addAction(0, context.getString(label), serviceAction(context, action))
        }
        builder.addAction(0, context.getString(R.string.notif_action_stop), serviceAction(context, RecordingService.ACTION_STOP))
        return builder.build()
    }

    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS.
    fun update(context: Context, notification: Notification) {
        if (canPost(context)) NotificationManagerCompat.from(context).notify(ID_RECORDING, notification)
    }

    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS.
    fun alert(context: Context, title: String, text: String) {
        if (!canPost(context)) return
        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_dashcam)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setColor(ContextCompat.getColor(context, R.color.dashcam_red))
            .build()
        NotificationManagerCompat.from(context).notify(ID_ALERT, notification)
    }

    private fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun serviceAction(context: Context, action: String): PendingIntent = PendingIntent.getService(
        context,
        action.hashCode(),
        Intent(context, RecordingService::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
