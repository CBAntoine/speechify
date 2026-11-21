package app.neonclips

import android.app.Application
import app.neonclips.data.ProjectStore
import app.neonclips.data.Settings
import app.neonclips.source.ImportManager
import app.neonclips.source.YtDlp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** The app's few long-lived objects. */
object Graph {
    lateinit var app: Application
        private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val settings by lazy { Settings(app) }
    val store by lazy { ProjectStore(app) }
    val ytDlp by lazy { YtDlp(app) }
    val imports by lazy { ImportManager(app, store, settings, ytDlp, scope) }

    fun init(application: Application) {
        app = application
    }
}

class NeonClipsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(this)
    }
}
