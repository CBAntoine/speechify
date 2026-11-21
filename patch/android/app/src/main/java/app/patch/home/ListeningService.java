package app.patch.home;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * While you're talking to Patch, this keeps Patch running and listening when you switch to another app
 * (the browser, Spotify…), so you can keep asking it to tap, scroll and choose things there.
 * Shows a "Patch is listening" notification with a Stop button.
 */
public class ListeningService extends Service {
    private static final String TAG = "Patch";
    private static final String CHANNEL = "listening";
    private static final String ACTION_STOP = "app.patch.home.STOP_LISTENING";
    private static volatile boolean running;

    static boolean isRunning() {
        return running;
    }

    static void start(Context context) {
        Intent i = new Intent(context, ListeningService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
        } catch (RuntimeException e) {
            Log.w(TAG, "Couldn't keep listening in the background", e);
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, ListeningService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            MainActivity.endConversation();
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.listening_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ListeningService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(getString(R.string.listening_title))
            .setContentText(getString(R.string.listening_text))
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, getString(R.string.listening_stop), stop).build());
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(1, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(1, b.build());
            running = true;
            Log.i(TAG, "Listening in the background");
        } catch (RuntimeException e) {
            Log.w(TAG, "Couldn't keep listening in the background", e);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        Log.i(TAG, "Stopped listening in the background");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
