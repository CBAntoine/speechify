package app.neonclips.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import app.neonclips.Graph
import app.neonclips.Nav
import app.neonclips.Screen
import app.neonclips.core.Caption
import app.neonclips.core.Clip
import app.neonclips.core.Fmt
import app.neonclips.core.ReframeMode
import app.neonclips.core.Reframing
import app.neonclips.ui.Body
import app.neonclips.ui.Chip
import app.neonclips.ui.Field
import app.neonclips.ui.Glyph
import app.neonclips.ui.HotButton
import app.neonclips.ui.Icon
import app.neonclips.ui.IconButton
import app.neonclips.ui.Label
import app.neonclips.ui.LineButton
import app.neonclips.ui.Neon
import app.neonclips.ui.ProgressLine
import app.neonclips.ui.ScrollRow
import app.neonclips.ui.Shout
import app.neonclips.ui.Tag
import app.neonclips.ui.TopBar
import kotlinx.coroutines.delay

private enum class Tab(val label: String) { CLIPS("Clips"), REFRAME("Reframe"), CAPTIONS("Captions"), AUDIO("Audio") }

@Composable
fun EditorScreen(projectId: String, nav: Nav) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val project = remember(projectId) { Graph.store.load(projectId) }
    if (project == null) {
        LaunchedEffect(Unit) { nav.pop() }
        return
    }
    val c = remember(projectId) { EditorController(context.applicationContext, project, scope) }
    DisposableEffect(c) { onDispose { c.release() } }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { c.pause() }
    LaunchedEffect(c) { while (true) withFrameNanos { c.onFrame() } }

    // The screen stays awake while a render or a face scan is running.
    val view = LocalView.current
    val busy = c.exporting?.finished == false || c.tracking != null || c.transcribing
    DisposableEffect(busy) {
        view.keepScreenOn = busy
        onDispose { view.keepScreenOn = false }
    }

    var tab by remember { mutableStateOf(Tab.CLIPS) }
    var exportOpen by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TopBar("02 / Cut", c.project.title, onBack = { nav.pop() }) {
                HotButton("Export", { c.pause(); exportOpen = true })
            }
            Viewport(c, Modifier.fillMaxWidth().weight(1f))
            Transport(c)
            Timeline(c, Modifier.fillMaxWidth().height(128.dp).padding(horizontal = 14.dp))
            Spacer(Modifier.height(6.dp))
            ScrollRow(Modifier.padding(horizontal = 14.dp)) {
                Tab.entries.forEach { t -> Chip(t.label, tab == t, { tab = t }, color = Neon.Hot) }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .height(176.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (tab) {
                    Tab.CLIPS -> ClipsTab(c)
                    Tab.REFRAME -> ReframeTab(c)
                    Tab.CAPTIONS -> CaptionsTab(c) { nav.push(Screen.Settings) }
                    Tab.AUDIO -> AudioTab(c)
                }
            }
        }

        c.message?.let { text ->
            LaunchedEffect(text) {
                delay(4200)
                if (c.message == text) c.message = null
            }
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp)
                    .clip(Neon.Shape)
                    .background(Neon.PanelHi)
                    .border(1.dp, Neon.Peach, Neon.Shape)
                    .clickable { c.message = null }
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) { Body(text, color = Neon.Text) }
        }

        if (exportOpen || c.exporting != null) {
            ExportPanel(c) {
                exportOpen = false
                c.closeExport()
            }
        }
    }
}

@Composable
private fun Transport(c: EditorController) {
    val clip = c.clip ?: return
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconButton(if (c.playing) Glyph.Pause else Glyph.Play, if (c.playing) "Pause" else "Play", { c.togglePlay() }, color = Neon.Hot)
        // Reads the playhead here so only this readout redraws each frame.
        val rel = (c.positionMs.longValue - clip.startMs).coerceIn(0, clip.durationMs)
        Column {
            Label(Fmt.timecode(rel), color = Neon.Text, size = 14.sp, bold = true)
            Label("of " + Fmt.timecode(clip.durationMs), color = Neon.Faint, size = 9.sp)
        }
        Spacer(Modifier.weight(1f))
        Chip("Snap", c.snap, { c.snap = !c.snap }, color = Neon.Hot)
        LineButton("Set in", { c.setIn() }, color = Neon.Mint)
        LineButton("Set out", { c.setOut() }, color = Neon.Mint)
        Spacer(Modifier.width(8.dp))
    }
}

// ---- tabs ----

@Composable
private fun ClipsTab(c: EditorController) {
    Overview(c, Modifier.fillMaxWidth().height(34.dp))
    ScrollRow {
        c.project.clips.forEachIndexed { i, clip -> ClipCard(i + 1, clip, c) }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LineButton("+ New clip at playhead", { c.newClipAtPlayhead() }, color = Neon.Mint)
        LineButton("Delete clip", { c.deleteClip() }, enabled = c.project.clips.size > 1, color = Neon.Peach)
    }
}

@Composable
private fun ClipCard(number: Int, clip: Clip, c: EditorController) {
    val selected = clip.id == c.clipId
    val moment = c.project.moments.firstOrNull { it.peakMs in clip.startMs..clip.endMs }
    Column(
        Modifier
            .width(132.dp)
            .clip(Neon.Shape)
            .background(if (selected) Neon.Hot.copy(alpha = 0.14f) else Neon.Panel)
            .border(1.dp, if (selected) Neon.Hot else Neon.Line, Neon.Shape)
            .clickable(role = Role.Tab) { c.select(clip.id) }
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Shout(number.toString().padStart(2, '0'), Modifier.weight(1f), size = 20.sp, color = if (selected) Neon.Hot else Neon.Text)
            if (clip.exportedUri != null) Tag("Saved", Neon.Mint)
        }
        Label(Fmt.clock(clip.startMs) + " – " + Fmt.clock(clip.endMs), color = Neon.Text)
        Label("${clip.durationMs / 1000}s" + (moment?.let { "  ·  ${it.score.toInt()}" } ?: ""), color = Neon.Dim)
        Label(moment?.reason ?: "Your pick", color = if (moment?.reason == "Most replayed") Neon.Peach else Neon.Faint)
    }
}

@Composable
private fun ReframeTab(c: EditorController) {
    val clip = c.clip ?: return
    val r = clip.reframe
    ScrollRow {
        Chip("Auto track", r.mode == ReframeMode.AUTO, { c.setMode(ReframeMode.AUTO) }, color = Neon.Lilac)
        Chip("Centre", r.mode == ReframeMode.CENTER, { c.setMode(ReframeMode.CENTER) }, color = Neon.Lilac)
        Chip("Manual", r.mode == ReframeMode.MANUAL, { c.setMode(ReframeMode.MANUAL) }, color = Neon.Lilac)
    }
    Body(
        when {
            c.tracking != null -> "Looking for faces in this clip."
            r.mode == ReframeMode.AUTO && r.follow != null && r.keys.isNotEmpty() -> "Following the person you tapped. Tap someone else in Source view to switch."
            r.mode == ReframeMode.AUTO && r.keys.isNotEmpty() -> "The crop follows the main face and switches on cuts. Wrong person? Open Source view and tap the right one."
            r.mode == ReframeMode.AUTO -> "No face large enough to follow, so the crop stays centred. Tap a face in Source view to follow it, or drag the picture to place the crop."
            r.mode == ReframeMode.MANUAL && r.keys.size >= 2 -> "Drag the picture to set the crop at the playhead. The camera glides between keyframes."
            r.mode == ReframeMode.MANUAL -> "Drag the picture to place the crop. Add a keyframe to make the camera move."
            else -> "The crop sits in the middle of the frame."
        },
        size = 12.sp,
    )
    SliderRow("Punch in", "%.2fx".format(r.zoom), r.zoom, 1f..Reframing.MAX_ZOOM, Neon.Lilac) { c.setZoom(it) }
    ScrollRow {
        LineButton("+ Keyframe at playhead", { c.addKey() }, color = Neon.Lilac)
        if (r.mode == ReframeMode.MANUAL && r.keys.size > 1) LineButton("Delete nearest", { c.deleteKeyNearPlayhead() }, color = Neon.Peach)
        if (r.mode == ReframeMode.AUTO) LineButton("Track again", { c.retrack() }, enabled = c.tracking == null, color = Neon.Dim)
    }
}

@Composable
private fun CaptionsTab(c: EditorController, openSettings: () -> Unit) {
    val clip = c.clip ?: return
    Label("Hook  ·  shows for the first seconds", color = Neon.Hot)
    Field(clip.hook, { c.setHook(it) }, "ADD A HOOK", Modifier.fillMaxWidth(), display = true, capitalize = true)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        HotButton(if (c.transcribing) "Listening" else "Auto caption", { c.autoCaption() }, enabled = !c.transcribing, color = Neon.Peach)
        LineButton("+ At playhead", { c.addCaption() }, color = Neon.Peach)
        if (Graph.settings.elevenLabsKey.isBlank()) LineButton("Add key", openSettings, color = Neon.Dim)
    }
    if (c.transcribing) ProgressLine(null, color = Neon.Peach)
    ScrollRow {
        Chip("Show", clip.captionsOn, { c.update { it.copy(captionsOn = !it.captionsOn) } }, color = Neon.Peach)
        Chip("Caps", clip.style.uppercase, { c.update { it.copy(style = it.style.copy(uppercase = !it.style.uppercase)) } }, color = Neon.Peach)
        Chip("Light spoken word", clip.style.karaoke, { c.update { it.copy(style = it.style.copy(karaoke = !it.style.karaoke)) } }, color = Neon.Peach)
    }
    SliderRow("Size", "${(clip.style.size * 1000).toInt()}", clip.style.size, 0.06f..0.16f, Neon.Peach) { v ->
        c.update { it.copy(style = it.style.copy(size = v)) }
    }
    SliderRow("Height", "${(clip.style.position * 100).toInt()}%", clip.style.position, 0.3f..0.88f, Neon.Peach) { v ->
        c.update { it.copy(style = it.style.copy(position = v)) }
    }
    if (clip.captions.isNotEmpty()) {
        val shift = clip.captionShiftMs
        SliderRow("Timing", (if (shift > 0) "+" else "") + "$shift ms", shift.toFloat(), -500f..500f, Neon.Peach) { c.setCaptionShift(it) }
    }
    if (clip.captions.isEmpty()) {
        Body("No captions yet. Auto caption transcribes the clip's speech; you can fix any word afterwards.", size = 12.sp)
    }
    clip.captions.forEach { caption -> CaptionRow(caption, clip, c) }
}

@Composable
private fun CaptionRow(caption: Caption, clip: Clip, c: EditorController) {
    Row(
        Modifier.fillMaxWidth().clip(Neon.Shape).background(Neon.Panel).border(1.dp, Neon.Line, Neon.Shape).padding(start = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Label(
            Fmt.timecode(caption.startMs - clip.startMs),
            Modifier.clickable { c.seek(caption.startMs) }.padding(vertical = 10.dp),
            color = Neon.Peach,
        )
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            value = caption.text,
            onValueChange = { c.editCaption(caption, it) },
            modifier = Modifier.weight(1f).padding(vertical = 8.dp),
            textStyle = TextStyle(color = Neon.Text, fontSize = 14.sp),
            singleLine = true,
            cursorBrush = SolidColor(Neon.Hot),
        )
        IconButton(Glyph.Close, "Delete caption", { c.deleteCaption(caption) }, color = Neon.Faint)
    }
}

@Composable
private fun AudioTab(c: EditorController) {
    val clip = c.clip ?: return
    if (!c.project.hasAudio) {
        Body("This video has no sound.")
        return
    }
    val sign = if (clip.gainDb > 0) "+" else ""
    SliderRow("Gain", "$sign%.1f dB".format(clip.gainDb), clip.gainDb, -12f..12f, Neon.Mint) { c.setGain(it) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LineButton("Level for phones", { c.normalise() }, enabled = c.envelope != null, color = Neon.Mint)
        LineButton("Reset", { c.setGain(0f) }, color = Neon.Dim)
    }
    Body("Leveling sets the gain so quiet clips are easy to hear on a phone speaker. Boosts are applied in the export; the preview only gets quieter.", size = 12.sp)
}

@Composable
private fun SliderRow(
    name: String,
    readout: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    color: Color,
    onChange: (Float) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Label(name, Modifier.width(64.dp))
        Slider(
            value = value,
            onValueChange = onChange,
            valueRange = range,
            modifier = Modifier.weight(1f).height(32.dp),
            colors = SliderDefaults.colors(
                thumbColor = color,
                activeTrackColor = color,
                inactiveTrackColor = Neon.Line,
            ),
        )
        Label(readout, Modifier.width(64.dp).padding(start = 8.dp), color = color, bold = true)
    }
}

// ---- export ----

@Composable
private fun ExportPanel(c: EditorController, onClose: () -> Unit) {
    val state = c.exporting
    val settings = Graph.settings
    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xD907030B))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                if (state == null || state.finished) onClose()
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(24.dp)
                .fillMaxWidth()
                .clip(Neon.Shape)
                .background(Neon.PanelHi)
                .border(1.dp, Neon.Line, Neon.Shape)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Label("03 / Finish", color = Neon.Hot)
            when {
                state == null -> {
                    Shout("Ready to drop", size = 30.sp)
                    val size = if (settings.exportHeight >= 1920) "1080 x 1920" else "720 x 1280"
                    Label("9:16  ·  H.264  ·  $size  ·  Video + captions")
                    HotButton("Export this clip", { c.export(all = false) }, Modifier.fillMaxWidth())
                    if (c.project.clips.size > 1) {
                        LineButton("Export all ${c.project.clips.size} clips", { c.export(all = true) }, Modifier.fillMaxWidth())
                    }
                    LineButton("Not yet", onClose, Modifier.fillMaxWidth(), color = Neon.Dim)
                }
                !state.finished -> {
                    Shout("${state.step} ${(state.progress * 100).toInt()}%", size = 30.sp)
                    if (state.total > 1) Label("Clip ${state.index + 1} of ${state.total}")
                    ProgressLine(state.progress, color = Neon.Mint)
                    Body("Keep the app open until this finishes.", size = 12.sp)
                    LineButton("Cancel", { c.cancelExport(); onClose() }, Modifier.fillMaxWidth(), color = Neon.Peach)
                }
                else -> {
                    if (state.error != null) {
                        Shout("Export failed", size = 30.sp, color = Neon.Peach)
                        Body(state.error, color = Neon.Text)
                    } else {
                        Shout("Saved", size = 30.sp, color = Neon.Mint)
                    }
                    if (state.saved.isNotEmpty()) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.size(28.dp).clip(Neon.Shape).background(Neon.Mint), contentAlignment = Alignment.Center) {
                                Icon(Glyph.Share, color = Neon.Ink, size = 16.dp)
                            }
                            Body("${state.saved.size} video${if (state.saved.size == 1) "" else "s"} in your gallery under Movies / NeonClips.", color = Neon.Text)
                        }
                        HotButton("Share", { c.share(state.saved) }, Modifier.fillMaxWidth())
                    }
                    LineButton("Done", onClose, Modifier.fillMaxWidth(), color = Neon.Dim)
                }
            }
        }
    }
}
