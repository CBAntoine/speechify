package app.neonclips

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.neonclips.core.VideoHit
import app.neonclips.ui.DiscoverScreen
import app.neonclips.ui.HomeScreen
import app.neonclips.ui.ImportSheet
import app.neonclips.ui.Neon
import app.neonclips.ui.NeonTheme
import app.neonclips.ui.SettingsScreen
import app.neonclips.ui.editor.EditorScreen

sealed interface Screen {
    data object Home : Screen
    data object Discover : Screen
    data object Settings : Screen
    data class Editor(val projectId: String) : Screen
}

/** A plain back stack; the app is four screens deep at most. */
class Nav {
    val stack = mutableStateListOf<Screen>(Screen.Home)

    /** The remote video whose import options are showing, if any. */
    var importing by mutableStateOf<VideoHit?>(null)

    /** Open this project as soon as its import finishes. */
    var openWhenReady by mutableStateOf<String?>(null)

    fun push(screen: Screen) {
        if (stack.lastOrNull() != screen) stack.add(screen)
    }

    fun pop() {
        if (stack.size > 1) stack.removeAt(stack.lastIndex)
    }

    fun home() {
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
    }

    fun openLink(url: String) {
        importing = VideoHit(id = url, url = url, title = url)
    }
}

class MainActivity : ComponentActivity() {
    private val nav = Nav()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        if (savedInstanceState == null) handle(intent)
        setContent { NeonTheme { App(nav) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** A shared link opens the import options; a shared or opened video file is imported directly. */
    private fun handle(intent: Intent?) {
        intent ?: return
        val isVideo = intent.type?.startsWith("video/") == true
        when (intent.action) {
            Intent.ACTION_SEND -> if (isVideo) {
                @Suppress("DEPRECATION")
                (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let(::importFile)
            } else {
                URL.find(intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty())?.value?.let {
                    nav.home()
                    nav.openLink(it)
                }
            }
            Intent.ACTION_VIEW -> intent.data?.let(::importFile)
        }
    }

    private fun importFile(uri: Uri) {
        nav.home()
        nav.openWhenReady = Graph.imports.importLocal(uri)
    }

    private companion object {
        val URL = Regex("""https?://\S+""")
    }
}

@Composable
fun App(nav: Nav) {
    BackHandler(enabled = nav.importing != null || nav.stack.size > 1) {
        if (nav.importing != null) nav.importing = null else nav.pop()
    }
    Box(Modifier.fillMaxSize().background(Neon.Ink).windowInsetsPadding(WindowInsets.safeDrawing)) {
        when (val screen = nav.stack.last()) {
            Screen.Home -> HomeScreen(nav)
            Screen.Discover -> DiscoverScreen(nav)
            Screen.Settings -> SettingsScreen(nav)
            is Screen.Editor -> key(screen.projectId) { EditorScreen(screen.projectId, nav) }
        }
        nav.importing?.let { hit ->
            key(hit.url) { ImportSheet(hit, nav) }
        }
    }
}
