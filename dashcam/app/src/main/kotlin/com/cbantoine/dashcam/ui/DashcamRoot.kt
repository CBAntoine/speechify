package com.cbantoine.dashcam.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.cbantoine.dashcam.MainActivity
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.recording.RecordingService
import com.cbantoine.dashcam.ui.camera.CameraScreen
import com.cbantoine.dashcam.ui.library.LibraryScreen
import com.cbantoine.dashcam.ui.onboarding.OnboardingScreen
import com.cbantoine.dashcam.ui.player.PlayerScreen
import com.cbantoine.dashcam.ui.settings.SettingsScreen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data object CameraRoute : NavKey

@Serializable
data object ClipsRoute : NavKey

@Serializable
data class PlayerRoute(val path: String) : NavKey

@Serializable
data object SettingsRoute : NavKey

@Composable
fun DashcamRoot(
    pendingAction: MutableStateFlow<String?>,
    autoStartAllowed: Boolean,
    onCameraPermissionGranted: () -> Unit,
) {
    val context = LocalContext.current
    val graph = context.appGraph
    val scope = rememberCoroutineScope()
    // Null until the settings have been read from disk, to avoid flashing onboarding.
    val loaded by graph.settingsRepository.settings.collectAsStateWithLifecycle(initialValue = null)
    var cameraGranted by remember { mutableStateOf(SystemAccess.hasCamera(context)) }
    var onboardedThisLaunch by rememberSaveable { mutableStateOf(false) }

    LifecycleResumeEffect(Unit) {
        cameraGranted = SystemAccess.hasCamera(context)
        if (cameraGranted) onCameraPermissionGranted()
        onPauseOrDispose { }
    }

    val settings = loaded
    if (settings == null) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
        return
    }
    if (!cameraGranted || !settings.onboardingDone) {
        OnboardingScreen(
            onFinished = {
                cameraGranted = SystemAccess.hasCamera(context)
                if (cameraGranted) {
                    onboardedThisLaunch = true
                    onCameraPermissionGranted()
                    scope.launch { graph.settingsRepository.update { it.copy(onboardingDone = true) } }
                }
            },
        )
        return
    }

    val backStack = rememberNavBackStack(CameraRoute)
    val action by pendingAction.collectAsStateWithLifecycle()
    var autoStartHandled by rememberSaveable { mutableStateOf(!autoStartAllowed) }

    LaunchedEffect(action) {
        when (action) {
            MainActivity.ACTION_START_RECORDING -> {
                autoStartHandled = true
                while (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
                if (!graph.recorderState.state.value.isSessionActive) RecordingService.startRecording(context)
            }
            MainActivity.ACTION_OPEN_CLIPS -> if (backStack.lastOrNull() != ClipsRoute) backStack.add(ClipsRoute)
        }
        if (action != null) pendingAction.value = null
    }

    LaunchedEffect(Unit) {
        if (autoStartHandled) return@LaunchedEffect
        autoStartHandled = true
        // Like a hardware dashcam: open the app and it's rolling. Skipped right after onboarding.
        if (settings.autoStartOnLaunch && !onboardedThisLaunch && !graph.recorderState.state.value.isSessionActive) {
            RecordingService.startRecording(context)
        }
    }

    NavDisplay(
        backStack = backStack,
        onBack = { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) },
        entryDecorators = listOf(
            rememberSaveableStateHolderNavEntryDecorator(),
            rememberViewModelStoreNavEntryDecorator(),
        ),
        entryProvider = entryProvider {
            entry<CameraRoute> {
                CameraScreen(
                    onOpenClips = { backStack.add(ClipsRoute) },
                    onOpenSettings = { backStack.add(SettingsRoute) },
                )
            }
            entry<ClipsRoute> {
                LibraryScreen(
                    onBack = { backStack.removeAt(backStack.lastIndex) },
                    onOpenClip = { clip -> backStack.add(PlayerRoute(clip.path)) },
                )
            }
            entry<PlayerRoute> { route ->
                PlayerScreen(path = route.path, onBack = { backStack.removeAt(backStack.lastIndex) })
            }
            entry<SettingsRoute> {
                SettingsScreen(onBack = { backStack.removeAt(backStack.lastIndex) })
            }
        },
    )
}
