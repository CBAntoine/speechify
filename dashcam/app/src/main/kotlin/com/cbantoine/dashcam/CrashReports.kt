package com.cbantoine.dashcam

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.edit
import java.io.File
import java.time.Instant

/**
 * Remembers why Dashcam last stopped unexpectedly, so the next start can say so and the user can
 * copy the details. Nothing leaves the phone unless the user shares it.
 */
object CrashReports {
    private const val FILE = "last_crash.txt"
    private const val PREFS = "crash_reports"
    private const val KEY_SCANNING = "scanning"
    private const val KEY_SEEN_EXIT = "seen_exit_ms"

    /** An unexpected stop of the last run. [scannerWasRunning] if the car scanner was on then. */
    data class Report(val text: String, val scannerWasRunning: Boolean)

    /** Call from Application.attachBaseContext, so even a crash while content providers start is kept. */
    fun install(context: Context) {
        val file = File(context.filesDir, FILE)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { file.writeText(describe(context, "Crash in thread \"${thread.name}\"", error.stackTraceToString())) }
            previous?.uncaughtException(thread, error)
        }
    }

    /** The last unexpected stop, if there was one since the previous call. */
    fun take(context: Context): Report? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val scanning = prefs.getBoolean(KEY_SCANNING, false)
        val file = File(context.filesDir, FILE)
        var text = runCatching { file.takeIf { it.exists() }?.readText() }.getOrNull()
        file.delete()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val native = nativeCrashOrAnr(context, prefs)
            if (text == null) text = native
        }
        prefs.edit(commit = true) { putBoolean(KEY_SCANNING, false) }
        return text?.let { Report(it, scanning) }
    }

    /** Written synchronously, so it is on disk even if the process dies a moment later. */
    fun markScanning(context: Context, scanning: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit(commit = true) { putBoolean(KEY_SCANNING, scanning) }
    }

    /** Native crashes and ANRs can't be caught in-process; Android records them for us. */
    @RequiresApi(Build.VERSION_CODES.R)
    private fun nativeCrashOrAnr(context: Context, prefs: SharedPreferences): String? {
        val manager = context.getSystemService(ActivityManager::class.java) ?: return null
        val exit = runCatching { manager.getHistoricalProcessExitReasons(context.packageName, 0, 1) }
            .getOrNull()?.firstOrNull() ?: return null
        if (exit.timestamp <= prefs.getLong(KEY_SEEN_EXIT, 0L)) return null
        prefs.edit(commit = true) { putLong(KEY_SEEN_EXIT, exit.timestamp) }
        val title = when (exit.reason) {
            ApplicationExitInfo.REASON_CRASH_NATIVE -> "Native crash"
            ApplicationExitInfo.REASON_ANR -> "Not responding (ANR)"
            // Java crashes are written by the handler above; other exits are normal.
            else -> return null
        }
        val details = listOfNotNull(exit.description, "at ${Instant.ofEpochMilli(exit.timestamp)}").joinToString("\n")
        return describe(context, title, details)
    }

    private fun describe(context: Context, title: String, details: String): String = buildString {
        appendLine(
            "Dashcam ${BuildConfigInfo.versionName(context)} · Android ${Build.VERSION.RELEASE} " +
                "(API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}",
        )
        appendLine(title)
        append(details)
    }
}
