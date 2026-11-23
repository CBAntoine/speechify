package com.cbantoine.dashcam.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

private val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "dashcam_settings")

class SettingsRepository(context: Context) {
    private val store = context.applicationContext.settingsStore

    val settings: Flow<DashcamSettings> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map(::read)
        .distinctUntilChanged()

    suspend fun update(transform: (DashcamSettings) -> DashcamSettings) {
        store.edit { prefs -> write(prefs, transform(read(prefs))) }
    }

    private object Keys {
        val quality = stringPreferencesKey("quality")
        val clipMinutes = intPreferencesKey("clip_minutes")
        val recordAudio = booleanPreferencesKey("record_audio")
        val useHevc = booleanPreferencesKey("use_hevc")
        val stabilization = booleanPreferencesKey("stabilization")
        val orientation = stringPreferencesKey("orientation")
        val zoomRatio = floatPreferencesKey("zoom_ratio")
        val overlayTimestamp = booleanPreferencesKey("overlay_timestamp")
        val overlaySpeed = booleanPreferencesKey("overlay_speed")
        val overlayCoordinates = booleanPreferencesKey("overlay_coordinates")
        val speedUnit = stringPreferencesKey("speed_unit")
        val impactSensitivity = stringPreferencesKey("impact_sensitivity")
        val loopStorageGb = intPreferencesKey("loop_storage_gb")
        val storageVolume = intPreferencesKey("storage_volume")
        val autoSaveProtected = booleanPreferencesKey("auto_save_protected")
        val autoStart = booleanPreferencesKey("auto_start")
        val stopOnPowerDisconnect = booleanPreferencesKey("stop_on_power_disconnect")
        val keepScreenOn = booleanPreferencesKey("keep_screen_on")
        val pictureInPicture = booleanPreferencesKey("picture_in_picture")
        val onboardingDone = booleanPreferencesKey("onboarding_done")
        val batteryPromptDismissed = booleanPreferencesKey("battery_prompt_dismissed")
    }

    private fun read(p: Preferences): DashcamSettings {
        val d = DashcamSettings()
        return DashcamSettings(
            quality = p[Keys.quality].toEnum(d.quality),
            clipMinutes = p[Keys.clipMinutes]?.takeIf { it in DashcamSettings.CLIP_LENGTH_OPTIONS } ?: d.clipMinutes,
            recordAudio = p[Keys.recordAudio] ?: d.recordAudio,
            useHevc = p[Keys.useHevc] ?: d.useHevc,
            stabilization = p[Keys.stabilization] ?: d.stabilization,
            orientation = p[Keys.orientation].toEnum(d.orientation),
            zoomRatio = p[Keys.zoomRatio] ?: d.zoomRatio,
            overlayTimestamp = p[Keys.overlayTimestamp] ?: d.overlayTimestamp,
            overlaySpeed = p[Keys.overlaySpeed] ?: d.overlaySpeed,
            overlayCoordinates = p[Keys.overlayCoordinates] ?: d.overlayCoordinates,
            speedUnit = p[Keys.speedUnit].toEnum(d.speedUnit),
            impactSensitivity = p[Keys.impactSensitivity].toEnum(d.impactSensitivity),
            loopStorageGb = p[Keys.loopStorageGb]?.takeIf { it > 0 } ?: d.loopStorageGb,
            storageVolume = p[Keys.storageVolume] ?: d.storageVolume,
            autoSaveProtectedToGallery = p[Keys.autoSaveProtected] ?: d.autoSaveProtectedToGallery,
            autoStartOnLaunch = p[Keys.autoStart] ?: d.autoStartOnLaunch,
            stopOnPowerDisconnect = p[Keys.stopOnPowerDisconnect] ?: d.stopOnPowerDisconnect,
            keepScreenOn = p[Keys.keepScreenOn] ?: d.keepScreenOn,
            pictureInPicture = p[Keys.pictureInPicture] ?: d.pictureInPicture,
            onboardingDone = p[Keys.onboardingDone] ?: d.onboardingDone,
            batteryPromptDismissed = p[Keys.batteryPromptDismissed] ?: d.batteryPromptDismissed,
        )
    }

    private fun write(p: MutablePreferences, s: DashcamSettings) {
        p[Keys.quality] = s.quality.name
        p[Keys.clipMinutes] = s.clipMinutes
        p[Keys.recordAudio] = s.recordAudio
        p[Keys.useHevc] = s.useHevc
        p[Keys.stabilization] = s.stabilization
        p[Keys.orientation] = s.orientation.name
        p[Keys.zoomRatio] = s.zoomRatio
        p[Keys.overlayTimestamp] = s.overlayTimestamp
        p[Keys.overlaySpeed] = s.overlaySpeed
        p[Keys.overlayCoordinates] = s.overlayCoordinates
        p[Keys.speedUnit] = s.speedUnit.name
        p[Keys.impactSensitivity] = s.impactSensitivity.name
        p[Keys.loopStorageGb] = s.loopStorageGb
        p[Keys.storageVolume] = s.storageVolume
        p[Keys.autoSaveProtected] = s.autoSaveProtectedToGallery
        p[Keys.autoStart] = s.autoStartOnLaunch
        p[Keys.stopOnPowerDisconnect] = s.stopOnPowerDisconnect
        p[Keys.keepScreenOn] = s.keepScreenOn
        p[Keys.pictureInPicture] = s.pictureInPicture
        p[Keys.onboardingDone] = s.onboardingDone
        p[Keys.batteryPromptDismissed] = s.batteryPromptDismissed
    }

    private inline fun <reified E : Enum<E>> String?.toEnum(default: E): E =
        this?.let { name -> enumValues<E>().firstOrNull { it.name == name } } ?: default
}
