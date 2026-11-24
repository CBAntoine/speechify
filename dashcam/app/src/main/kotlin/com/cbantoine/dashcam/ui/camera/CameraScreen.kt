package com.cbantoine.dashcam.ui.camera

import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.core.RepeatMode
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.GpsNotFixed
import androidx.compose.material.icons.filled.GpsOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.rounded.BatteryAlert
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.PowerOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.camera.compose.CameraXViewfinder
import androidx.camera.core.SurfaceRequest
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.cbantoine.dashcam.MainActivity
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.recording.ProtectReason
import com.cbantoine.dashcam.recording.RecorderIssue
import com.cbantoine.dashcam.recording.RecorderPhase
import com.cbantoine.dashcam.recording.RecorderStateHolder
import com.cbantoine.dashcam.recording.RecorderUiState
import com.cbantoine.dashcam.recording.RecordingService
import com.cbantoine.dashcam.recording.SpeedFormat
import com.cbantoine.dashcam.recording.ZoomInfo
import com.cbantoine.dashcam.scanner.ScannerState
import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.settings.MountOrientation
import com.cbantoine.dashcam.settings.SpeedUnit
import com.cbantoine.dashcam.telemetry.GpsFix
import com.cbantoine.dashcam.ui.Formatting
import com.cbantoine.dashcam.ui.SystemAccess
import com.cbantoine.dashcam.ui.rememberNow
import com.cbantoine.dashcam.ui.theme.DashcamPalette
import com.cbantoine.dashcam.ui.theme.HudNumbers
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun CameraScreen(onOpenClips: () -> Unit, onOpenSettings: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val scope = rememberCoroutineScope()
    val holder = graph.recorderState
    val state by holder.state.collectAsStateWithLifecycle()
    val settings by graph.settings.collectAsStateWithLifecycle()
    val surfaceRequest by holder.surfaceRequest.collectAsStateWithLifecycle()
    val gps by holder.gps.collectAsStateWithLifecycle()
    val gForce by holder.gForce.collectAsStateWithLifecycle()
    val inPip = rememberIsInPictureInPicture()
    val scanner = graph.vehicleScanner
    val scan by scanner.state.collectAsStateWithLifecycle()
    val hasApiKey by graph.apiKeyStore.hasKey.collectAsStateWithLifecycle()
    var panelOpen by rememberSaveable { mutableStateOf(true) }

    LockOrientation(settings.orientation)
    ReportDisplayRotation(holder, enabled = !inPip)

    // The scanner only runs while someone can see it: never in the background or in PiP.
    val scanWanted = settings.scannerEnabled && settings.scanActive
    val scanRunning = scanWanted && state.scannerAvailable && !inPip
    LifecycleStartEffect(scanRunning) {
        scanner.setActive(scanRunning)
        onStopOrDispose { scanner.setActive(false) }
    }
    val scanHud = ScanHud(
        shown = settings.scannerEnabled,
        active = scanWanted,
        state = scan,
        problem = when {
            !scanWanted -> null
            scan.unavailable -> R.string.scan_unavailable
            state.scannerBlocked -> R.string.scan_no_stream
            // Turned on in Settings during a recording: the camera picks it up next time.
            state.cameraReady && !state.scannerAvailable -> R.string.scan_pending
            scan.slowedForHeat -> R.string.scan_hot
            else -> null
        },
        hasApiKey = hasApiKey,
        panelOpen = panelOpen,
        onToggle = {
            val turningOff = settings.scanActive
            if (turningOff) {
                // Stop frames first so nothing is re-added after the clear.
                scanner.setActive(false)
                scanner.clear()
            }
            panelOpen = true
            scope.launch { graph.settingsRepository.update { it.copy(scanActive = !turningOff) } }
        },
        onSelect = { id ->
            scanner.select(id)
            panelOpen = true
        },
        onIdentify = scanner::identify,
        onClosePanel = {
            scanner.select(null)
            panelOpen = false
        },
    )

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        val activity = LocalActivity.current as? MainActivity
        Viewfinder(
            request = surfaceRequest,
            previewAvailable = !state.cameraReady || state.previewAvailable,
            modifier = Modifier
                .fillMaxSize()
                .onGloballyPositioned { coordinates ->
                    // The video is letterboxed to 16:9 inside the viewfinder.
                    val bounds = coordinates.boundsInWindow()
                    val width = minOf(bounds.width, bounds.height * 16f / 9f)
                    val height = width * 9f / 16f
                    val left = bounds.left + (bounds.width - width) / 2f
                    val top = bounds.top + (bounds.height - height) / 2f
                    activity?.setPictureInPictureSource(
                        android.graphics.Rect(left.toInt(), top.toInt(), (left + width).toInt(), (top + height).toInt()),
                    )
                },
            interactive = !inPip,
            onZoomRatioChanged = { ratio -> holder.controller?.setZoom(ratio) },
        )
        if (!inPip && scan.running) {
            ScannerOverlay(scan, onSelect = scanHud.onSelect, modifier = Modifier.fillMaxSize())
        }
        if (inPip) {
            PipBadge(state, Modifier.align(Alignment.TopStart).padding(8.dp))
        } else {
            CameraHud(
                state = state,
                settings = settings,
                gps = gps,
                gForce = gForce,
                onRecordClick = {
                    if (state.isSessionActive) RecordingService.stopRecording(context) else RecordingService.startRecording(context)
                },
                onProtect = { holder.controller?.protectCurrentClip() },
                onToggleMute = { holder.controller?.setMuted(!state.muted) },
                onZoom = { ratio -> holder.controller?.setZoom(ratio) },
                onOpenClips = onOpenClips,
                onOpenSettings = onOpenSettings,
                scan = scanHud,
            )
        }
    }
}

/** What the HUD needs to show the car scanner. */
private class ScanHud(
    /** The scanner is enabled in Settings, so the Scan chip is shown. */
    val shown: Boolean,
    /** The user switched scanning on. */
    val active: Boolean,
    val state: ScannerState,
    /** Why scanning can't run (or is slowed) right now, as a string resource. */
    val problem: Int?,
    val hasApiKey: Boolean,
    val panelOpen: Boolean,
    val onToggle: () -> Unit,
    val onSelect: (Int) -> Unit,
    val onIdentify: (Int) -> Unit,
    val onClosePanel: () -> Unit,
)

private val RailWidth = 80.dp
private val PanelWidth = 300.dp

@Composable
private fun Viewfinder(
    request: SurfaceRequest?,
    previewAvailable: Boolean,
    modifier: Modifier,
    interactive: Boolean,
    onZoomRatioChanged: (Float) -> Unit,
) {
    Box(modifier, contentAlignment = Alignment.Center) {
        if (request != null) {
            CameraXViewfinder(
                surfaceRequest = request,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
                isTapToFocusEnabled = interactive,
                isPinchToZoomEnabled = interactive,
                onZoomRatioChanged = onZoomRatioChanged,
            )
        } else if (!previewAvailable) {
            Text(
                stringResource(R.string.preview_unavailable),
                color = Color.White.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 120.dp),
            )
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Color.White.copy(alpha = 0.7f), strokeWidth = 3.dp)
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.camera_preparing), color = Color.White.copy(alpha = 0.7f))
            }
        }
    }
}

@Composable
private fun CameraHud(
    state: RecorderUiState,
    settings: DashcamSettings,
    gps: GpsFix?,
    gForce: Float,
    onRecordClick: () -> Unit,
    onProtect: () -> Unit,
    onToggleMute: () -> Unit,
    onZoom: (Float) -> Unit,
    onOpenClips: () -> Unit,
    onOpenSettings: () -> Unit,
    scan: ScanHud,
) {
    val haptics = LocalHapticFeedback.current
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(12.dp),
    ) {
        val landscape = maxWidth > maxHeight
        val controls = @Composable {
            ControlCluster(
                vertical = landscape,
                state = state,
                onRecordClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onRecordClick()
                },
                onProtect = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onProtect()
                },
                onToggleMute = onToggleMute,
                onOpenClips = onOpenClips,
                onOpenSettings = onOpenSettings,
            )
        }

        Column(Modifier.align(Alignment.TopStart), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusPill(state)
            InfoChips(state, settings, scan)
        }

        val focused = scan.state.focused
        val showPanel = scan.active && scan.state.running && scan.panelOpen && focused != null
        val showStrip = scan.active && scan.state.tracked.isNotEmpty()
        val scannerColumn = showPanel || showStrip
        // Beside the panel, banners move under the chips so they never cover it.
        val bannerModifier = if (landscape && scannerColumn) {
            Modifier
                .align(Alignment.TopStart)
                .padding(top = 100.dp)
                .widthIn(max = minOf(460.dp, maxWidth - PanelWidth - RailWidth - 36.dp))
        } else {
            Modifier
                .align(Alignment.TopCenter)
                .padding(top = if (landscape) 0.dp else 88.dp)
                .widthIn(max = 460.dp)
        }
        Banners(state = state, settings = settings, scanProblem = scan.problem, modifier = bannerModifier)

        if (scannerColumn) {
            val columnModifier = if (landscape) {
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(end = RailWidth + 12.dp)
                    .width(PanelWidth)
                    .fillMaxHeight()
            } else {
                Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 96.dp, bottom = 236.dp)
                    .fillMaxWidth()
            }
            Box(columnModifier) {
                if (showPanel) {
                    VehiclePanel(
                        vehicle = focused,
                        hasApiKey = scan.hasApiKey,
                        onIdentify = { scan.onIdentify(focused.id) },
                        onOpenSettings = onOpenSettings,
                        onClose = scan.onClosePanel,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .fillMaxWidth()
                            .padding(bottom = if (showStrip) 112.dp else 0.dp),
                    )
                }
                if (showStrip) {
                    TrackedStrip(
                        vehicles = scan.state.tracked,
                        focusedId = scan.state.focusedId,
                        onSelect = scan.onSelect,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth(),
                    )
                }
            }
        }

        ProtectToast(state, Modifier.align(Alignment.Center))

        val speedModifier = if (landscape) {
            // Sits above the date/speed text burned into the bottom-left of the video.
            Modifier
                .align(Alignment.BottomStart)
                .padding(bottom = 56.dp)
        } else {
            Modifier
                .align(Alignment.BottomStart)
                .padding(bottom = 132.dp)
        }
        SpeedCluster(gps, settings.speedUnit, gForce, speedModifier)

        state.zoom?.let { zoom ->
            ZoomChips(
                zoom = zoom,
                onZoom = onZoom,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(
                        bottom = if (landscape) 0.dp else 132.dp,
                        end = if (landscape && scannerColumn) PanelWidth + RailWidth + 24.dp else 0.dp,
                    ),
            )
        }

        Box(
            if (landscape) Modifier.align(Alignment.CenterEnd) else Modifier.align(Alignment.BottomCenter),
        ) { controls() }
    }
}

@Composable
private fun ControlCluster(
    vertical: Boolean,
    state: RecorderUiState,
    onRecordClick: () -> Unit,
    onProtect: () -> Unit,
    onToggleMute: () -> Unit,
    onOpenClips: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val recording = state.isSessionActive
    val items: List<@Composable () -> Unit> = listOf(
        {
            HudIconButton(Icons.Filled.VideoLibrary, stringResource(R.string.action_clips), onOpenClips)
        },
        {
            HudIconButton(
                icon = if (state.currentClipProtected) Icons.Filled.Shield else Icons.Outlined.Shield,
                description = stringResource(R.string.action_protect),
                onClick = onProtect,
                tint = if (state.currentClipProtected) DashcamPalette.Amber else Color.White,
                size = 58.dp,
            )
        },
        {
            RecordButton(
                recording = recording,
                busy = state.phase == RecorderPhase.STOPPING,
                onClick = onRecordClick,
            )
        },
        {
            val micAvailable = recording && state.audioEnabled
            HudIconButton(
                icon = if (!micAvailable || state.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                description = stringResource(if (state.muted) R.string.action_unmute else R.string.action_mute),
                onClick = onToggleMute,
                enabled = micAvailable,
                tint = if (micAvailable && !state.muted) Color.White else Color.White.copy(alpha = 0.45f),
            )
        },
        {
            HudIconButton(Icons.Filled.Settings, stringResource(R.string.action_settings), onOpenSettings)
        },
    )
    if (vertical) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            items.forEach { it() }
        }
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            items.forEach { it() }
        }
    }
}

@Composable
private fun RecordButton(recording: Boolean, busy: Boolean, onClick: () -> Unit) {
    val innerSize by animateDpAsState(if (recording) 30.dp else 60.dp, label = "recordInner")
    val corner by animateDpAsState(if (recording) 8.dp else 30.dp, label = "recordCorner")
    val label = stringResource(if (recording) R.string.action_stop_recording else R.string.action_start_recording)
    Box(
        Modifier
            .size(80.dp)
            .clip(CircleShape)
            .background(DashcamPalette.Hud)
            .border(4.dp, Color.White, CircleShape)
            .clickable(enabled = !busy, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(innerSize)
                .clip(RoundedCornerShape(corner))
                .background(if (busy) DashcamPalette.Rec.copy(alpha = 0.5f) else DashcamPalette.Rec),
        )
        if (busy) CircularProgressIndicator(Modifier.size(80.dp), color = Color.White, strokeWidth = 3.dp)
    }
}

@Composable
private fun HudIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    tint: Color = Color.White,
    size: Dp = 52.dp,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = DashcamPalette.Hud,
        border = BorderStroke(1.dp, DashcamPalette.HudOutline),
        modifier = Modifier.size(size),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(size * 0.46f))
        }
    }
}

@Composable
private fun StatusPill(state: RecorderUiState) {
    val now = rememberNow()
    val transition = rememberInfiniteTransition(label = "rec")
    val dotAlpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.2f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "recDot",
    )
    val (label, color) = when (state.phase) {
        RecorderPhase.RECORDING -> stringResource(R.string.status_rec) to DashcamPalette.Rec
        RecorderPhase.STARTING -> stringResource(R.string.status_starting) to DashcamPalette.Amber
        RecorderPhase.STOPPING -> stringResource(R.string.status_stopping) to DashcamPalette.Amber
        RecorderPhase.WAITING -> stringResource(R.string.status_waiting) to DashcamPalette.Amber
        RecorderPhase.COOLING_DOWN -> stringResource(R.string.status_cooling) to DashcamPalette.Amber
        RecorderPhase.IDLE -> stringResource(R.string.status_ready) to Color.White
    }
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(DashcamPalette.Hud)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(
                    color.copy(alpha = if (state.phase == RecorderPhase.RECORDING) dotAlpha else 1f),
                ),
        )
        Spacer(Modifier.width(8.dp))
        Text(label, color = color, style = HudNumbers, fontWeight = FontWeight.Black)
        val started = state.sessionStartedAtMs
        if (started != null && state.phase != RecorderPhase.IDLE) {
            Spacer(Modifier.width(10.dp))
            Text(Formatting.elapsed(now - started), color = Color.White, style = HudNumbers)
            if (state.clipsThisSession > 0) {
                Spacer(Modifier.width(10.dp))
                Text(
                    pluralStringResource(R.plurals.clips_count, state.clipsThisSession, state.clipsThisSession),
                    color = Color.White.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun InfoChips(state: RecorderUiState, settings: DashcamSettings, scan: ScanHud) {
    val quality = (state.quality ?: settings.quality).label
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        HudChip(stringResource(R.string.loop_chip, quality, settings.clipMinutes))
        HudChip(if (state.hevc) "HEVC" else "H.264")
        if (scan.shown) ScanChip(active = scan.active, slowed = scan.state.slowedForHeat, onClick = scan.onToggle)
    }
}

@Composable
private fun HudChip(text: String) {
    Text(
        text,
        color = Color.White.copy(alpha = 0.85f),
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(DashcamPalette.Hud)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun SpeedCluster(gps: GpsFix?, unit: SpeedUnit, gForce: Float, modifier: Modifier) {
    rememberNow() // re-check GPS freshness every second
    val fresh = gps?.takeIf { it.isFresh() }
    val speed = SpeedFormat.value(fresh?.speedMps, unit)
    val context = LocalContext.current
    val hasLocation = SystemAccess.hasLocation(context)
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(DashcamPalette.Hud)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                speed?.toString() ?: "--",
                color = Color.White,
                style = HudNumbers.copy(fontSize = 44.sp, lineHeight = 44.sp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                stringResource(if (unit == SpeedUnit.MPH) R.string.unit_mph else R.string.unit_kmh),
                color = Color.White.copy(alpha = 0.75f),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val (icon, tint, text) = when {
                !hasLocation -> Triple(Icons.Filled.GpsOff, Color.White.copy(alpha = 0.5f), stringResource(R.string.gps_off))
                fresh == null -> Triple(Icons.Filled.GpsNotFixed, DashcamPalette.Amber, stringResource(R.string.gps_searching))
                else -> Triple(Icons.Filled.GpsFixed, DashcamPalette.Ok, fresh.accuracyM?.let { "±${it.toInt()} m" } ?: "GPS")
            }
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(text, color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.width(10.dp))
            Text(
                stringResource(R.string.g_force, gForce),
                color = if (gForce > 1f) DashcamPalette.Amber else Color.White.copy(alpha = 0.75f),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun ZoomChips(zoom: ZoomInfo, onZoom: (Float) -> Unit, modifier: Modifier) {
    val presets = buildList {
        if (zoom.min < 0.95f) add(zoom.min)
        add(1f)
        if (zoom.max >= 2f) add(2f)
    }
    if (presets.size < 2) return
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(DashcamPalette.Hud)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        presets.forEach { preset ->
            val selected = abs(zoom.ratio - preset) < 0.05f
            Text(
                stringResource(R.string.zoom_value, Formatting.zoom((preset * 10).toInt() / 10f)),
                color = if (selected) Color.Black else Color.White,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (selected) DashcamPalette.Amber else Color.Transparent)
                    .clickable(role = Role.Button) { onZoom(preset) }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun Banners(state: RecorderUiState, settings: DashcamSettings, scanProblem: Int?, modifier: Modifier) {
    val context = LocalContext.current
    val graph = context.appGraph
    val scope = rememberCoroutineScope()
    var batteryExempt by remember { mutableStateOf(SystemAccess.isIgnoringBatteryOptimizations(context)) }
    var interrupted by rememberSaveable { mutableStateOf(graph.sessionMarker.wasInterrupted) }
    LifecycleResumeEffect(Unit) {
        batteryExempt = SystemAccess.isIgnoringBatteryOptimizations(context)
        onPauseOrDispose { }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val issue = state.issue
        if (issue != null) {
            val text = when (issue) {
                RecorderIssue.CAMERA_IN_USE -> R.string.issue_camera_in_use
                RecorderIssue.CAMERA_DISABLED -> R.string.issue_camera_disabled
                RecorderIssue.CAMERA_ERROR -> R.string.issue_camera_error
                RecorderIssue.STORAGE_FULL -> R.string.issue_storage_full
                RecorderIssue.PERMISSION_MISSING -> R.string.issue_permission
                RecorderIssue.OVERHEATING -> R.string.issue_overheating
            }
            Banner(
                icon = if (issue == RecorderIssue.OVERHEATING) Icons.Rounded.Thermostat else Icons.Rounded.ErrorOutline,
                text = stringResource(text),
                accent = MaterialTheme.colorScheme.error,
            )
        } else if (state.thermalWarning) {
            Banner(Icons.Rounded.Thermostat, stringResource(R.string.thermal_warning), DashcamPalette.Amber)
        }
        scanProblem?.let { problem ->
            Banner(
                icon = if (problem == R.string.scan_hot) Icons.Rounded.Thermostat else Icons.Rounded.ErrorOutline,
                text = stringResource(problem),
                accent = DashcamPalette.Amber,
            )
        }
        state.stopCountdownSec?.let { seconds ->
            Banner(
                icon = Icons.Rounded.PowerOff,
                text = stringResource(R.string.countdown_banner, seconds),
                accent = DashcamPalette.Amber,
                action = stringResource(R.string.keep_recording) to { graph.recorderState.controller?.cancelAutoStop() },
            )
        }
        if (interrupted && !state.isSessionActive) {
            Banner(
                icon = Icons.Rounded.BatteryAlert,
                text = stringResource(R.string.interrupted_banner),
                accent = DashcamPalette.Amber,
                action = stringResource(if (batteryExempt) R.string.dismiss else R.string.battery_banner_action) to {
                    if (!batteryExempt) SystemAccess.requestIgnoreBatteryOptimizations(context)
                    graph.sessionMarker.acknowledgeInterruption()
                    interrupted = false
                },
            )
        } else if (!batteryExempt && !settings.batteryPromptDismissed && !state.isSessionActive) {
            Banner(
                icon = Icons.Rounded.BatteryAlert,
                text = stringResource(R.string.battery_banner),
                accent = DashcamPalette.Amber,
                action = stringResource(R.string.battery_banner_action) to {
                    SystemAccess.requestIgnoreBatteryOptimizations(context)
                },
                secondaryAction = stringResource(R.string.dismiss) to {
                    scope.launch { graph.settingsRepository.update { it.copy(batteryPromptDismissed = true) } }
                },
            )
        }
    }
}

@Composable
private fun Banner(
    icon: ImageVector,
    text: String,
    accent: Color,
    action: Pair<String, () -> Unit>? = null,
    secondaryAction: Pair<String, () -> Unit>? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(DashcamPalette.HudStrong)
            .border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
            .padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(
            text,
            color = Color.White,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 6.dp),
        )
        secondaryAction?.let { (label, onClick) ->
            TextButton(onClick = onClick) { Text(label, color = Color.White.copy(alpha = 0.7f)) }
        }
        action?.let { (label, onClick) ->
            TextButton(onClick = onClick) { Text(label, color = accent, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun ProtectToast(state: RecorderUiState, modifier: Modifier) {
    val notice = state.lastProtect
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(notice) {
        if (notice == null || System.currentTimeMillis() - notice.atMs > 3_000) return@LaunchedEffect
        visible = true
        delay(2_500)
        visible = false
    }
    AnimatedVisibility(visible, modifier, enter = fadeIn() + scaleIn(initialScale = 0.9f), exit = fadeOut() + scaleOut(targetScale = 0.9f)) {
        val impact = notice?.reason == ProtectReason.IMPACT
        Row(
            Modifier
                .clip(RoundedCornerShape(50))
                .background(DashcamPalette.HudStrong)
                .border(1.dp, DashcamPalette.Amber, RoundedCornerShape(50))
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Shield, contentDescription = null, tint = DashcamPalette.Amber)
            Spacer(Modifier.width(10.dp))
            Text(
                stringResource(if (impact) R.string.notice_impact else R.string.notice_protected),
                color = Color.White,
                style = MaterialTheme.typography.titleSmall,
            )
        }
    }
}

@Composable
private fun PipBadge(state: RecorderUiState, modifier: Modifier) {
    if (state.phase != RecorderPhase.RECORDING) return
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(DashcamPalette.Hud)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(DashcamPalette.Rec),
        )
        Spacer(Modifier.width(4.dp))
        Text(stringResource(R.string.status_rec), color = Color.White, style = MaterialTheme.typography.labelSmall)
    }
}

/** Dashcams are mounted in a fixed orientation; keep the camera screen in it. */
@Composable
private fun LockOrientation(orientation: MountOrientation) {
    val activity = LocalActivity.current ?: return
    DisposableEffect(activity, orientation) {
        activity.requestedOrientation = when (orientation) {
            MountOrientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            MountOrientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
        onDispose { activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
}

/**
 * Tells the engine which way is up. Only while this screen is visible (and not in
 * picture-in-picture, where the display follows whatever app is in front). A display listener
 * is used because a 180° flip (landscape to reverse landscape) causes no configuration change.
 */
@Composable
private fun ReportDisplayRotation(holder: RecorderStateHolder, enabled: Boolean) {
    val context = LocalContext.current
    DisposableEffect(context, enabled) {
        if (!enabled) return@DisposableEffect onDispose { }
        val report = { holder.displayRotation.value = ContextCompat.getDisplayOrDefault(context).rotation }
        val displayManager = context.getSystemService(DisplayManager::class.java)
        val listener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) = Unit
            override fun onDisplayRemoved(displayId: Int) = Unit
            override fun onDisplayChanged(displayId: Int) = report()
        }
        report()
        displayManager?.registerDisplayListener(listener, Handler(Looper.getMainLooper()))
        onDispose { displayManager?.unregisterDisplayListener(listener) }
    }
}

@Composable
private fun rememberIsInPictureInPicture(): Boolean {
    val activity = LocalActivity.current as? ComponentActivity ?: return false
    var inPip by remember { mutableStateOf(activity.isInPictureInPictureMode) }
    DisposableEffect(activity) {
        val listener = Consumer<PictureInPictureModeChangedInfo> { info -> inPip = info.isInPictureInPictureMode }
        activity.addOnPictureInPictureModeChangedListener(listener)
        onDispose { activity.removeOnPictureInPictureModeChangedListener(listener) }
    }
    return inPip
}
