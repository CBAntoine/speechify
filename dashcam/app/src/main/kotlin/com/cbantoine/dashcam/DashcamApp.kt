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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class DashcamApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        // Before content providers start, so a crash in one of them is reported too.
        CrashReports.install(this)
    }

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

    /** Why the last run stopped unexpectedly, until the user copies or dismisses it. */
    val crashReport = MutableStateFlow(CrashReports.take(app))

    init {
        // Safe mode: if Dashcam stopped while the scanner was running, start without it so
        // recording keeps working. The camera screen says so and the user can turn it back on.
        if (crashReport.value?.scannerWasRunning == true) {
            appScope.launch { settingsRepository.update { it.copy(scanActive = false) } }
        }
    }
}

val Context.appGraph: AppGraph
    get() = (applicationContext as DashcamApp).graph
