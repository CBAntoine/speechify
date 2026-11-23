package com.cbantoine.dashcam.ui.settings

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.cbantoine.dashcam.BuildConfigInfo
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.settings.ImpactSensitivity
import com.cbantoine.dashcam.settings.MountOrientation
import com.cbantoine.dashcam.settings.SpeedUnit
import com.cbantoine.dashcam.settings.VideoQuality
import com.cbantoine.dashcam.ui.SystemAccess
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val settings by graph.settings.collectAsStateWithLifecycle()
    val recorder by graph.recorderState.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val update: ((DashcamSettings) -> DashcamSettings) -> Unit = { transform ->
        scope.launch { graph.settingsRepository.update(transform) }
    }
    var batteryExempt by remember { mutableStateOf(SystemAccess.isIgnoringBatteryOptimizations(context)) }
    var micGranted by remember { mutableStateOf(SystemAccess.hasMicrophone(context)) }
    var locationGranted by remember { mutableStateOf(SystemAccess.hasLocation(context)) }
    LifecycleResumeEffect(Unit) {
        batteryExempt = SystemAccess.isIgnoringBatteryOptimizations(context)
        micGranted = SystemAccess.hasMicrophone(context)
        locationGranted = SystemAccess.hasLocation(context)
        onPauseOrDispose { }
    }
    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micGranted = granted
        if (granted) update { it.copy(recordAudio = true) }
    }
    val locationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        locationGranted = result.values.any { it }
    }
    val volumes = remember { graph.clipRepository.volumes() }
    val qualities = recorder.supportedQualities.ifEmpty { VideoQuality.entries }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                modifier = Modifier.widthIn(max = 720.dp),
                contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
            ) {
                if (recorder.isSessionActive) {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Info, contentDescription = null)
                                Spacer(Modifier.width(12.dp))
                                Text(stringResource(R.string.applies_next_recording), style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }

                section(R.string.section_video) {
                    item {
                        ChoiceSetting(
                            title = stringResource(R.string.setting_quality),
                            selected = settings.quality,
                            options = qualities,
                            label = { it.label },
                            onSelect = { quality -> update { it.copy(quality = quality) } },
                        )
                    }
                    item {
                        ChoiceSetting(
                            title = stringResource(R.string.setting_clip_length),
                            selected = settings.clipMinutes,
                            options = DashcamSettings.CLIP_LENGTH_OPTIONS,
                            label = { minutes -> pluralStringResource(R.plurals.minutes, minutes, minutes) },
                            onSelect = { minutes -> update { it.copy(clipMinutes = minutes) } },
                        )
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_audio),
                            summary = stringResource(R.string.setting_audio_summary),
                            checked = settings.recordAudio && micGranted,
                            onCheckedChange = { on ->
                                if (on && !micGranted) micLauncher.launch(Manifest.permission.RECORD_AUDIO) else update { it.copy(recordAudio = on) }
                            },
                        )
                    }
                    item {
                        val supported = recorder.hevcSupported || !recorder.cameraReady
                        SwitchSetting(
                            title = stringResource(R.string.setting_hevc),
                            summary = stringResource(if (supported) R.string.setting_hevc_summary else R.string.setting_unsupported),
                            checked = settings.useHevc && supported,
                            enabled = supported,
                            onCheckedChange = { on -> update { it.copy(useHevc = on) } },
                        )
                    }
                    item {
                        val supported = recorder.stabilizationSupported || !recorder.cameraReady
                        SwitchSetting(
                            title = stringResource(R.string.setting_stabilization),
                            summary = stringResource(if (supported) R.string.setting_stabilization_summary else R.string.setting_unsupported),
                            checked = settings.stabilization && supported,
                            enabled = supported,
                            onCheckedChange = { on -> update { it.copy(stabilization = on) } },
                        )
                    }
                    item {
                        ChoiceSetting(
                            title = stringResource(R.string.setting_orientation),
                            selected = settings.orientation,
                            options = MountOrientation.entries,
                            label = { stringResource(if (it == MountOrientation.LANDSCAPE) R.string.orientation_landscape else R.string.orientation_portrait) },
                            onSelect = { orientation -> update { it.copy(orientation = orientation) } },
                        )
                    }
                }

                section(R.string.section_overlay) {
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_overlay_time),
                            checked = settings.overlayTimestamp,
                            onCheckedChange = { on -> update { it.copy(overlayTimestamp = on) } },
                        )
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_overlay_speed),
                            checked = settings.overlaySpeed,
                            onCheckedChange = { on ->
                                if (on && !locationGranted) locationLauncher.launch(LOCATION_PERMISSIONS)
                                update { it.copy(overlaySpeed = on) }
                            },
                        )
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_overlay_coords),
                            checked = settings.overlayCoordinates,
                            onCheckedChange = { on ->
                                if (on && !locationGranted) locationLauncher.launch(LOCATION_PERMISSIONS)
                                update { it.copy(overlayCoordinates = on) }
                            },
                        )
                    }
                    item {
                        ChoiceSetting(
                            title = stringResource(R.string.setting_speed_unit),
                            selected = settings.speedUnit,
                            options = SpeedUnit.entries,
                            label = { stringResource(if (it == SpeedUnit.MPH) R.string.unit_mph else R.string.unit_kmh) },
                            onSelect = { unit -> update { it.copy(speedUnit = unit) } },
                        )
                    }
                }

                section(R.string.section_incidents) {
                    item {
                        ChoiceSetting(
                            title = stringResource(R.string.setting_sensitivity),
                            summaryOverride = stringResource(R.string.setting_sensitivity_summary),
                            selected = settings.impactSensitivity,
                            options = ImpactSensitivity.entries,
                            label = {
                                stringResource(
                                    when (it) {
                                        ImpactSensitivity.OFF -> R.string.sensitivity_off
                                        ImpactSensitivity.LOW -> R.string.sensitivity_low
                                        ImpactSensitivity.MEDIUM -> R.string.sensitivity_medium
                                        ImpactSensitivity.HIGH -> R.string.sensitivity_high
                                    },
                                )
                            },
                            onSelect = { sensitivity -> update { it.copy(impactSensitivity = sensitivity) } },
                        )
                    }
                }

                section(R.string.section_storage) {
                    item {
                        ChoiceSetting(
                            title = stringResource(R.string.setting_loop_limit),
                            selected = settings.loopStorageGb,
                            options = DashcamSettings.LOOP_LIMIT_OPTIONS,
                            label = { stringResource(R.string.gigabytes, it) },
                            onSelect = { gb -> update { it.copy(loopStorageGb = gb) } },
                        )
                    }
                    if (volumes.size > 1) {
                        item {
                            ChoiceSetting(
                                title = stringResource(R.string.setting_storage_location),
                                selected = settings.storageVolume.coerceIn(0, volumes.lastIndex),
                                options = volumes.map { it.index },
                                label = { index ->
                                    stringResource(if (volumes[index].removable) R.string.storage_sd else R.string.storage_phone)
                                },
                                onSelect = { index -> update { it.copy(storageVolume = index) } },
                            )
                        }
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_auto_gallery),
                            summary = stringResource(R.string.setting_auto_gallery_summary),
                            checked = settings.autoSaveProtectedToGallery,
                            onCheckedChange = { on -> update { it.copy(autoSaveProtectedToGallery = on) } },
                        )
                    }
                }

                section(R.string.section_behavior) {
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_auto_start),
                            checked = settings.autoStartOnLaunch,
                            onCheckedChange = { on -> update { it.copy(autoStartOnLaunch = on) } },
                        )
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_power_stop),
                            summary = stringResource(R.string.setting_power_stop_summary),
                            checked = settings.stopOnPowerDisconnect,
                            onCheckedChange = { on -> update { it.copy(stopOnPowerDisconnect = on) } },
                        )
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_keep_screen_on),
                            checked = settings.keepScreenOn,
                            onCheckedChange = { on -> update { it.copy(keepScreenOn = on) } },
                        )
                    }
                    item {
                        SwitchSetting(
                            title = stringResource(R.string.setting_pip),
                            summary = stringResource(R.string.setting_pip_summary),
                            checked = settings.pictureInPicture,
                            onCheckedChange = { on -> update { it.copy(pictureInPicture = on) } },
                        )
                    }
                }

                section(R.string.section_reliability) {
                    item {
                        ListItem(
                            onClick = { SystemAccess.requestIgnoreBatteryOptimizations(context) },
                            enabled = !batteryExempt,
                            supportingContent = {
                                Text(
                                    stringResource(if (batteryExempt) R.string.battery_unrestricted else R.string.battery_optimized),
                                    color = if (batteryExempt) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
                                )
                            },
                            colors = rowColors(),
                        ) { Text(stringResource(R.string.setting_battery)) }
                    }
                    item {
                        ListItem(
                            onClick = { SystemAccess.openAppSettings(context) },
                            supportingContent = { Text(stringResource(R.string.setting_permissions_summary)) },
                            colors = rowColors(),
                        ) { Text(stringResource(R.string.setting_permissions)) }
                    }
                }

                section(R.string.section_about) {
                    item {
                        ListItem(
                            supportingContent = { Text(BuildConfigInfo.versionName(context)) },
                            colors = rowColors(),
                        ) { Text(stringResource(R.string.setting_version)) }
                    }
                }
            }
        }
    }
}

private val LOCATION_PERMISSIONS = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
)

@Composable
private fun rowColors() = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background)

private fun LazyListScope.section(title: Int, content: LazyListScope.() -> Unit) {
    item(key = "header-$title") {
        Text(
            stringResource(title),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 4.dp),
        )
    }
    content()
}

@Composable
private fun SwitchSetting(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    summary: String? = null,
    enabled: Boolean = true,
) {
    ListItem(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        supportingContent = summary?.let { { Text(it) } },
        trailingContent = { Switch(checked = checked, onCheckedChange = null, enabled = enabled) },
        colors = rowColors(),
    ) { Text(title) }
}

@Composable
private fun <T> ChoiceSetting(
    title: String,
    selected: T,
    options: List<T>,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    summaryOverride: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    ListItem(
        onClick = { open = true },
        supportingContent = {
            Column {
                Text(label(selected), color = MaterialTheme.colorScheme.primary)
                summaryOverride?.let { Text(it) }
            }
        },
        colors = rowColors(),
    ) { Text(title) }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(title) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    options.forEach { option ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .selectable(
                                    selected = option == selected,
                                    role = Role.RadioButton,
                                    onClick = {
                                        onSelect(option)
                                        open = false
                                    },
                                )
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = option == selected, onClick = null)
                            Spacer(Modifier.width(12.dp))
                            Text(label(option), style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}
