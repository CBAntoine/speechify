package app.neonclips.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.neonclips.Graph
import app.neonclips.Nav
import app.neonclips.source.SourceException
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(nav: Nav) {
    val settings = Graph.settings
    val scope = rememberCoroutineScope()
    var key by remember { mutableStateOf(settings.elevenLabsKey) }
    var showKey by remember { mutableStateOf(false) }
    var clipSeconds by remember { mutableIntStateOf(settings.clipSeconds) }
    var exportHeight by remember { mutableIntStateOf(settings.exportHeight) }
    var updating by remember { mutableStateOf(false) }
    var updateNote by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        TopBar("Setup", "Settings", onBack = { nav.pop() })
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(ScreenPadding).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Panel("Auto captions", trailing = if (key.isBlank()) "Off" else "On", trailingColor = if (key.isBlank()) Neon.Faint else Neon.Mint) {
                Body("Captions are transcribed by ElevenLabs Scribe. Paste an API key from your ElevenLabs account. It is stored on this phone and sent only to ElevenLabs, together with the audio of the clip you caption.")
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Field(
                        key,
                        {
                            key = it
                            settings.elevenLabsKey = it
                        },
                        "ElevenLabs API key",
                        Modifier.weight(1f),
                        secret = true,
                        reveal = showKey,
                    )
                    LineButton(if (showKey) "Hide" else "Show", { showKey = !showKey })
                }
            }

            Panel("Clip length", trailing = "${clipSeconds}s") {
                Body("How long the automatically picked clips are. You can always drag the ends in the editor.")
                ScrollRow(Modifier.padding(top = 8.dp)) {
                    listOf(15, 20, 30, 45, 60).forEach { s ->
                        Chip("$s sec", clipSeconds == s, {
                            clipSeconds = s
                            settings.clipSeconds = s
                        })
                    }
                }
            }

            Panel("Export quality", trailing = if (exportHeight >= 1920) "1080 x 1920" else "720 x 1280") {
                ScrollRow {
                    Chip("1080p  ·  best", exportHeight == 1920, {
                        exportHeight = 1920
                        settings.exportHeight = 1920
                    }, color = Neon.Lilac)
                    Chip("720p  ·  smaller, faster", exportHeight == 1280, {
                        exportHeight = 1280
                        settings.exportHeight = 1280
                    }, color = Neon.Lilac)
                }
            }

            Panel("Downloader", trailing = "yt-dlp") {
                Body("Video sites change often. If searching or fetching stops working, update the downloader.")
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    LineButton(if (updating) "Updating" else "Update now", {
                        updating = true
                        updateNote = null
                        scope.launch {
                            updateNote = try {
                                "Now on " + Graph.ytDlp.update()
                            } catch (e: SourceException) {
                                e.message
                            }
                            updating = false
                        }
                    }, enabled = !updating)
                    updateNote?.let { Body(it, Modifier.weight(1f), size = 12.sp) }
                }
                if (updating) ProgressLine(null, Modifier.padding(top = 8.dp))
            }

            Panel("About", trailing = "v0.1.0", trailingColor = Neon.Faint) {
                Body(
                    "Neon Clips finds highlights from loudness and replay data, follows faces with ML Kit, and renders with Media3. " +
                        "Fetching uses yt-dlp and FFmpeg. Fonts: Anton and JetBrains Mono (SIL Open Font License).\n\n" +
                        "Clip videos you own or have permission to clip.",
                    size = 12.sp,
                )
            }
        }
    }
}
