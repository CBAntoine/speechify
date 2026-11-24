package com.cbantoine.dashcam

import android.app.Application
import android.content.Context
import com.cbantoine.dashcam.recording.RecorderStateHolder
import com.cbantoine.dashcam.recording.RecordingNotifications
import com.cbantoine.dashcam.recording.SessionMarker
import com.cbantoine.dashcam.scanner.ApiKeyStore
import com.cbantoine.dashcam.scanner.VehicleScanner
import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.settings.SettingsRepository
import com.cbantoine.dashcam.storage.ClipRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class DashcamApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        RecordingNotifications.createChannels(this)
    }
}

/** Process-wide singletons. Small enough that a DI framework would be overkill. */
class AppGraph(app: Application) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val settingsRepository = SettingsRepository(app)
    val settings: StateFlow<DashcamSettings> =
        settingsRepository.settings.stateIn(appScope, SharingStarted.Eagerly, DashcamSettings())
    val clipRepository = ClipRepository(app, settings)
    val recorderState = RecorderStateHolder()
    val sessionMarker = SessionMarker(app)
    val apiKeyStore = ApiKeyStore(app)
    val vehicleScanner = VehicleScanner(app, appScope, settings, recorderState, apiKeyStore)
}

val Context.appGraph: AppGraph
    get() = (applicationContext as DashcamApp).graph
