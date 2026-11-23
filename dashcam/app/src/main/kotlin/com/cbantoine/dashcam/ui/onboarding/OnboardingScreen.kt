package com.cbantoine.dashcam.ui.onboarding

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.ui.SystemAccess

@Composable
fun OnboardingScreen(onFinished: () -> Unit) {
    val context = LocalContext.current
    var step by rememberSaveable { mutableIntStateOf(0) }
    var cameraDenied by rememberSaveable { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (SystemAccess.hasCamera(context)) {
            cameraDenied = false
            if (SystemAccess.isIgnoringBatteryOptimizations(context)) onFinished() else step = 1
        } else {
            cameraDenied = true
        }
    }

    LifecycleResumeEffect(step) {
        // Returning from the system battery dialog or app settings.
        if (step == 1 && SystemAccess.isIgnoringBatteryOptimizations(context)) onFinished()
        if (step == 0 && cameraDenied && SystemAccess.hasCamera(context)) {
            cameraDenied = false
            step = 1
        }
        onPauseOrDispose { }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(96.dp)
                    .clip(RoundedCornerShape(28.dp))
                    .background(colorResource(R.color.ic_launcher_background)),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(96.dp))
            }
            Spacer(Modifier.height(24.dp))
            if (step == 0) {
                PermissionStep(
                    cameraDenied = cameraDenied,
                    onContinue = { launcher.launch(SystemAccess.onboardingPermissions()) },
                    onOpenSettings = { SystemAccess.openAppSettings(context) },
                )
            } else {
                BatteryStep(
                    onAllow = { SystemAccess.requestIgnoreBatteryOptimizations(context) },
                    onSkip = onFinished,
                )
            }
        }
    }
}

@Composable
private fun PermissionStep(cameraDenied: Boolean, onContinue: () -> Unit, onOpenSettings: () -> Unit) {
    Text(
        stringResource(R.string.onboarding_title),
        style = MaterialTheme.typography.headlineMedium,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(8.dp))
    Text(
        stringResource(R.string.onboarding_subtitle),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(28.dp))
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PermissionRow(Icons.Outlined.Videocam, R.string.perm_camera_title, R.string.perm_camera_text)
        PermissionRow(Icons.Outlined.Mic, R.string.perm_mic_title, R.string.perm_mic_text)
        PermissionRow(Icons.Outlined.LocationOn, R.string.perm_location_title, R.string.perm_location_text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionRow(Icons.Outlined.Notifications, R.string.perm_notifications_title, R.string.perm_notifications_text)
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            PermissionRow(Icons.Outlined.Folder, R.string.perm_storage_title, R.string.perm_storage_text)
        }
    }
    Spacer(Modifier.height(32.dp))
    if (cameraDenied) {
        Text(
            stringResource(R.string.onboarding_camera_denied),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.open_settings))
        }
        Spacer(Modifier.height(8.dp))
    }
    Button(onClick = onContinue, modifier = Modifier.fillMaxWidth().height(52.dp)) {
        Text(stringResource(R.string.onboarding_continue))
    }
}

@Composable
private fun BatteryStep(onAllow: () -> Unit, onSkip: () -> Unit) {
    Icon(
        Icons.Outlined.BatteryChargingFull,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.primary,
        modifier = Modifier.size(40.dp),
    )
    Spacer(Modifier.height(12.dp))
    Text(stringResource(R.string.onboarding_battery_title), style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
    Spacer(Modifier.height(8.dp))
    Text(
        stringResource(R.string.onboarding_battery_text),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(32.dp))
    Button(onClick = onAllow, modifier = Modifier.fillMaxWidth().height(52.dp)) {
        Text(stringResource(R.string.onboarding_battery_allow))
    }
    Spacer(Modifier.height(8.dp))
    TextButton(onClick = onSkip, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.onboarding_skip))
    }
}

@Composable
private fun PermissionRow(icon: ImageVector, title: Int, text: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.width(16.dp))
        Column {
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
