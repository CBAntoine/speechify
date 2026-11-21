package app.neonclips.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.neonclips.Graph
import app.neonclips.Nav
import app.neonclips.Screen
import app.neonclips.core.Fmt
import app.neonclips.core.Project
import app.neonclips.source.ImportJob
import app.neonclips.source.Stage
import coil3.compose.AsyncImage
import java.io.File

@Composable
fun HomeScreen(nav: Nav) {
    val projects by Graph.store.projects.collectAsState()
    val jobs by Graph.imports.jobs.collectAsState()
    var link by remember { mutableStateOf("") }
    var linkCleared by remember { mutableIntStateOf(0) }
    var deleting by remember { mutableStateOf<Project?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) nav.openWhenReady = Graph.imports.importLocal(uri)
    }

    // A video the user just picked opens in the editor the moment it is ready.
    LaunchedEffect(jobs, nav.openWhenReady) {
        val id = nav.openWhenReady ?: return@LaunchedEffect
        val job = jobs.firstOrNull { it.id == id }
        when {
            job == null || job.stage == Stage.FAILED -> nav.openWhenReady = null
            job.stage == Stage.DONE -> {
                nav.openWhenReady = null
                Graph.imports.dismiss(id)
                nav.push(Screen.Editor(id))
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item("header") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(Neon.Hot))
                Spacer(Modifier.width(8.dp))
                Label("Project / Neon_Clips", Modifier.weight(1f))
                IconButton(Glyph.Gear, "Settings", { nav.push(Screen.Settings) }, color = Neon.Dim)
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Shout("Neon Clips", size = 44.sp, maxLines = 1)
                        Shout("  / 9:16", size = 44.sp, color = Neon.Hot, maxLines = 1)
                    }
                    Label("Find  ·  Cut  ·  Reframe  ·  Caption  ·  Export")
                }
                Shout("Clip it.\nShip it.", size = 17.sp, color = Neon.Hot)
            }
        }

        item("find") {
            ActionPanel(
                code = "01 / Find",
                title = "Top videos right now",
                text = "Search what is getting views, then clip the moments viewers replay most.",
                glyph = Glyph.Search,
                color = Neon.Hot,
                onClick = { nav.push(Screen.Discover) },
            )
        }
        item("upload") {
            ActionPanel(
                code = "02 / Upload",
                title = "Clip your own video",
                text = "Pick a recording from this phone. Highlights are found on the device.",
                glyph = Glyph.Upload,
                color = Neon.Mint,
                onClick = { picker.launch(arrayOf("video/*")) },
            )
        }
        item("link") {
            Panel("03 / Link", trailing = "YouTube · Twitch · TikTok · more", trailingColor = Neon.Dim) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val go = {
                        val url = link.trim()
                        if (url.startsWith("http")) {
                            nav.openLink(url)
                            link = ""
                            linkCleared++
                        }
                    }
                    Field(link, { link = it }, "Paste a video link", Modifier.weight(1f), imeAction = ImeAction.Go, onDone = go, resetKey = linkCleared, maxLength = 2000)
                    HotButton("Clip", go, enabled = link.trim().startsWith("http"), color = Neon.Peach)
                }
            }
        }

        items(jobs, key = { "job-" + it.id }) { job -> JobRow(job, nav) }

        item("projects-title") {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Label("Projects", Modifier.weight(1f), color = Neon.Text)
                Label(projects.size.toString().padStart(2, '0'), color = Neon.Hot)
            }
        }
        if (projects.isEmpty()) {
            item("empty") {
                Body("Nothing here yet. Find a video or upload one and your clips will show up here.", Modifier.padding(vertical = 8.dp))
            }
        }
        items(projects, key = { it.id }) { project ->
            ProjectRow(project, onOpen = { nav.push(Screen.Editor(project.id)) }, onDelete = { deleting = project })
        }
    }

    deleting?.let { project ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = Neon.PanelHi,
            title = { Shout("Delete project?", size = 22.sp) },
            text = { Body("\"${project.title}\" and its clip settings will be removed. Exported videos in your gallery stay.") },
            confirmButton = {
                HotButton("Delete", {
                    Graph.store.delete(project.id)
                    deleting = null
                })
            },
            dismissButton = { LineButton("Keep", { deleting = null }) },
        )
    }
}

@Composable
private fun ActionPanel(code: String, title: String, text: String, glyph: Glyph, color: Color, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Neon.Shape)
            .background(Neon.Panel)
            .border(1.dp, Neon.Line, Neon.Shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Label(code, color = color)
            Spacer(Modifier.height(4.dp))
            Shout(title, size = 24.sp)
            Spacer(Modifier.height(4.dp))
            Body(text)
        }
        Spacer(Modifier.width(12.dp))
        Box(
            Modifier.size(48.dp).clip(Neon.Shape).background(color),
            contentAlignment = Alignment.Center,
        ) { Icon(glyph, color = Neon.Ink, size = 24.dp) }
    }
}

@Composable
private fun JobRow(job: ImportJob, nav: Nav) {
    val color = when (job.stage) {
        Stage.FAILED -> Neon.Peach
        Stage.DONE -> Neon.Mint
        else -> Neon.Hot
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(Neon.Shape)
            .background(Neon.PanelHi)
            .border(1.dp, color.copy(alpha = 0.5f), Neon.Shape)
            .clickable(enabled = job.stage == Stage.DONE) {
                Graph.imports.dismiss(job.id)
                nav.push(Screen.Editor(job.id))
            }
            .padding(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                val pct = job.progress?.takeIf { job.running }?.let { "  ${(it * 100).toInt()}%" }.orEmpty()
                Label(job.stage.label + pct, color = color, bold = true)
                Body(job.title, color = Neon.Text, maxLines = 1)
            }
            when {
                job.stage == Stage.DONE -> Tag("Open", Neon.Mint)
                job.running -> IconButton(Glyph.Close, "Cancel import", { Graph.imports.cancel(job.id) }, color = Neon.Dim)
                else -> IconButton(Glyph.Close, "Dismiss", { Graph.imports.dismiss(job.id) }, color = Neon.Dim)
            }
        }
        if (job.running) {
            Spacer(Modifier.height(8.dp))
            ProgressLine(job.progress)
        }
        job.error?.let {
            Spacer(Modifier.height(4.dp))
            Body(it, color = Neon.Peach, size = 12.sp)
        }
    }
}

@Composable
private fun ProjectRow(project: Project, onOpen: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Neon.Shape)
            .background(Neon.Panel)
            .border(1.dp, Neon.Line, Neon.Shape)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = File(Graph.store.dir(project.id), "poster.jpg"),
            contentDescription = null,
            modifier = Modifier.width(96.dp).aspectRatio(16f / 9f).clip(Neon.Shape).background(Neon.Ink),
            contentScale = ContentScale.Crop,
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Body(project.title, color = Neon.Text, maxLines = 2)
            Spacer(Modifier.height(4.dp))
            val exported = project.clips.count { it.exportedUri != null }
            Label(
                buildString {
                    append(Fmt.clock(project.durationMs))
                    append("  ·  ${project.clips.size} clips")
                    if (exported > 0) append("  ·  $exported exported")
                },
                color = Neon.Dim,
            )
            project.origin?.let { o ->
                Label(listOf(o.channel, o.views?.let { Fmt.count(it) + " views" }).filter { !it.isNullOrBlank() }.joinToString("  ·  "), color = Neon.Faint)
            }
        }
        IconButton(Glyph.Trash, "Delete project", onDelete, color = Neon.Faint)
    }
}
