package app.neonclips.data

import android.content.Context
import androidx.core.content.edit

/** Small user preferences. The API key never leaves the phone except in calls to ElevenLabs. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var elevenLabsKey: String
        get() = prefs.getString("eleven_key", "").orEmpty()
        set(v) = prefs.edit { putString("eleven_key", v.trim()) }

    /** Target length of auto-picked clips, in seconds. */
    var clipSeconds: Int
        get() = prefs.getInt("clip_seconds", 30)
        set(v) = prefs.edit { putInt("clip_seconds", v) }

    /** Output height: 1920 (1080p) or 1280 (720p). */
    var exportHeight: Int
        get() = prefs.getInt("export_height", 1920)
        set(v) = prefs.edit { putInt("export_height", v) }

    var lastQuery: String
        get() = prefs.getString("last_query", "GTA 6").orEmpty()
        set(v) = prefs.edit { putString("last_query", v) }

    /** When the downloader last fetched its newest version, in epoch milliseconds. */
    var downloaderUpdatedAt: Long
        get() = prefs.getLong("downloader_updated_at", 0)
        set(v) = prefs.edit { putLong("downloader_updated_at", v) }

    var rightsNoticeSeen: Boolean
        get() = prefs.getBoolean("rights_notice", false)
        set(v) = prefs.edit { putBoolean("rights_notice", v) }
}
