package com.cbantoine.dashcam.ui.player

import android.content.Intent
import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.recording.SpeedFormat
import com.cbantoine.dashcam.settings.SpeedUnit
import com.cbantoine.dashcam.storage.Clip
import com.cbantoine.dashcam.telemetry.EventType
import com.cbantoine.dashcam.telemetry.TelemetryTrack
import com.cbantoine.dashcam.ui.ClipActions
import com.cbantoine.dashcam.ui.DeleteClipDialog
import com.cbantoine.dashcam.ui.Formatting
import com.cbantoine.dashcam.ui.theme.DashcamPalette
import com.cbantoine.dashcam.ui.theme.HudNumbers
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@kotlin.OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerScreen(path: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val repository = graph.clipRepository
    val settings by graph.settings.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val savedText = stringResource(R.string.saved_to_gallery)
    val failedText = stringResource(R.string.save_failed)

    var clip by remember { mutableStateOf<Clip?>(null) }
    var missing by remember { mutableStateOf(false) }
    var track by remember { mutableStateOf<TelemetryTrack?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var positionMs by remember { mutableLongStateOf(0L) }

    LaunchedEffect(path) {
        val found = repository.findClip(path)
        clip = found
        missing = found == null
        track = found?.let { repository.readTelemetry(it) }
    }

    val player = remember { ExoPlayer.Builder(context).build() }
    DisposableEffect(player) { onDispose { player.release() } }
    LifecycleStartEffect(player) { onStopOrDispose { player.pause() } }

    val file = clip?.file
    LaunchedEffect(file) {
        if (file == null) return@LaunchedEffect
        val resume = player.currentPosition
        player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
        player.prepare()
        if (resume > 0) player.seekTo(resume)
        player.playWhenReady = true
    }
    LaunchedEffect(player) {
        while (true) {
            positionMs = player.currentPosition
            delay(250)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(clip?.let { Formatting.dateTime(it.startedAtMs) } ?: "", style = MaterialTheme.typography.titleMedium)
                        clip?.let {
                            Text(
                                Formatting.bytes(context, it.sizeBytes),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    val current = clip ?: return@TopAppBar
                    IconButton(onClick = {
                        scope.launch {
                            val moved = if (current.isProtected) repository.unprotect(current) else repository.protect(current)
                            clip = moved ?: current
                        }
                    }) {
                        Icon(
                            if (current.isProtected) Icons.Filled.Shield else Icons.Outlined.Shield,
                            contentDescription = stringResource(
                                if (current.isProtected) R.string.action_unprotect else R.string.action_protect,
                            ),
                            tint = if (current.isProtected) DashcamPalette.Amber else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    IconButton(onClick = { ClipActions.share(context, current) }) {
                        Icon(Icons.Filled.Share, contentDescription = stringResource(R.string.action_share))
                    }
                    IconButton(onClick = {
                        scope.launch { snackbar.showSnackbar(if (repository.saveToGallery(current)) savedText else failedText) }
                    }) {
                        Icon(Icons.Filled.PhotoLibrary, contentDescription = stringResource(R.string.action_save_to_gallery))
                    }
                    IconButton(onClick = { confirmDelete = true }) {
                        Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.action_delete))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        if (missing) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.clip_missing), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            return@Scaffold
        }
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            val landscape = maxWidth > maxHeight
            val video = @Composable { modifier: Modifier -> VideoSurface(player, modifier) }
            val panel = @Composable { modifier: Modifier ->
                TelemetryPanel(track, positionMs, settings.speedUnit, onSeek = { player.seekTo(it) }, modifier = modifier)
            }
            if (landscape) {
                Row(Modifier.fillMaxSize()) {
                    video(Modifier.weight(1.7f).fillMaxHeight())
                    panel(Modifier.weight(1f).fillMaxHeight())
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    video(Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                    panel(Modifier.fillMaxWidth().weight(1f))
                }
            }
        }
    }

    if (confirmDelete) {
        DeleteClipDialog(
            onConfirm = {
                confirmDelete = false
                val current = clip
                if (current != null) {
                    player.stop()
                    scope.launch {
                        repository.delete(current)
                        onBack()
                    }
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun VideoSurface(player: ExoPlayer, modifier: Modifier) {
    AndroidView(
        factory = { context ->
            PlayerView(context).apply {
                this.player = player
                setShowNextButton(false)
                setShowPreviousButton(false)
                setShutterBackgroundColor(android.graphics.Color.BLACK)
                keepScreenOn = true
            }
        },
        modifier = modifier.background(Color.Black),
        onRelease = { it.player = null },
    )
}

@Composable
private fun TelemetryPanel(
    track: TelemetryTrack?,
    positionMs: Long,
    unit: SpeedUnit,
    onSeek: (Long) -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    Column(
        modifier
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val sample = track?.sampleAt(positionMs)
        if (track == null || track.samples.isEmpty()) {
            Text(stringResource(R.string.no_gps_data), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.telemetry_speed), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                SpeedFormat.value(sample?.speed, unit)?.toString() ?: "--",
                                style = HudNumbers.copy(fontSize = MaterialTheme.typography.displaySmall.fontSize),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                stringResource(if (unit == SpeedUnit.MPH) R.string.unit_mph else R.string.unit_kmh),
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 6.dp),
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(stringResource(R.string.telemetry_peak), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(stringResource(R.string.g_force, track.peakG), style = MaterialTheme.typography.titleLarge)
                    }
                }
            }
            if (sample != null) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
                    Column(Modifier.padding(16.dp)) {
                        Text(stringResource(R.string.telemetry_position), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            String.format(Locale.US, "%.5f, %.5f", sample.lat, sample.lon),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.height(8.dp))
                        FilledTonalButton(onClick = {
                            val uri = "geo:${sample.lat},${sample.lon}?q=${sample.lat},${sample.lon}".toUri()
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        }) {
                            Icon(Icons.Filled.Map, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.open_in_maps))
                        }
                    }
                }
            }
        }
        if (track != null && track.events.isNotEmpty()) {
            Text(stringResource(R.string.events_title), style = MaterialTheme.typography.titleSmall)
            track.events.forEach { event ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .clickable { onSeek((event.t - 5_000).coerceAtLeast(0)) }
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val impact = event.type == EventType.IMPACT
                    Icon(
                        if (impact) Icons.Filled.Bolt else Icons.Filled.Shield,
                        contentDescription = null,
                        tint = if (impact) DashcamPalette.Rec else DashcamPalette.Amber,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        if (impact) stringResource(R.string.event_impact, event.g ?: 0f) else stringResource(R.string.event_manual),
                        modifier = Modifier.weight(1f),
                    )
                    Text(Formatting.elapsed(event.t), style = HudNumbers, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
