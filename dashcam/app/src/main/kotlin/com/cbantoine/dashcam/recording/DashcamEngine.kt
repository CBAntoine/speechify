package com.cbantoine.dashcam.recording

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.util.Log
import android.util.Size
import androidx.annotation.MainThread
import androidx.annotation.RequiresApi
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraEffect
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.DynamicRange
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.SessionConfig
import androidx.camera.core.SurfaceRequest
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.effects.OverlayEffect
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.cbantoine.dashcam.AppGraph
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.settings.VideoQuality
import com.cbantoine.dashcam.storage.ClipNaming
import com.cbantoine.dashcam.storage.StoragePolicy
import com.cbantoine.dashcam.telemetry.EventType
import com.cbantoine.dashcam.telemetry.ImpactDetector
import com.cbantoine.dashcam.telemetry.LocationTracker
import com.cbantoine.dashcam.telemetry.SegmentTelemetry
import java.io.File
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The recording engine. Owns the camera for as long as the [RecordingService] lives and records
 * an endless chain of short clips (loop recording). Each clip is a separate MP4, so a crash or a
 * dead battery can only ever cost the clip in progress.
 *
 * The camera is bound with an [OverlayEffect] targeting both preview and video. Besides burning
 * in the date and speed, that makes CameraX feed both from one shared stream, so the viewfinder
 * can come and go (app in the background, screen off, other screen) without touching the
 * recording.
 *
 * Everything here runs on the main thread.
 */
class DashcamEngine(
    private val service: LifecycleService,
    private val graph: AppGraph,
    private val callbacks: Callbacks,
) : RecorderController {

    interface Callbacks {
        /** The last clip of a session is safely on disk. */
        fun onSessionFinished()
    }

    private data class CameraConfig(
        val quality: VideoQuality,
        val hevc: Boolean,
        val stabilization: Boolean,
        /** Also bind the car scanner's analysis stream. */
        val analysis: Boolean,
    )

    private class Session(val audio: Boolean) {
        var muted = false
        var clipCount = 0
        var failures = 0
        var protectNext = false
    }

    private class Segment(val file: File) {
        val root: File = file.parentFile?.parentFile ?: file
        val baseName: String = ClipNaming.baseName(file.name)
        var recording: Recording? = null
        var startedAtMs: Long? = null
        var finalized = false
        var protectRequested = false
        var impact = false
        var bytes = 0L
        var hasFootage = false
        val telemetry = SegmentTelemetry()
    }

    private val context: Context = service.applicationContext
    private val scope = service.lifecycleScope
    private val holder = graph.recorderState
    private val clips = graph.clipRepository
    private val mainExecutor = ContextCompat.getMainExecutor(context)
    private val powerManager: PowerManager? = context.getSystemService(PowerManager::class.java)

    private val location = LocationTracker(context)
    private val impacts = ImpactDetector(context)
    private val overlay = OverlayRenderer()
    private val overlayThread = HandlerThread("dashcam-overlay").apply { start() }
    private var overlayEffect: OverlayEffect? = null

    private var provider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var preview: Preview? = null
    private var videoCapture: VideoCapture<Recorder>? = null
    private var imageAnalysis: ImageAnalysis? = null
    private var boundConfig: CameraConfig? = null

    /** A video quality at which this camera turned out unable to run the scanner stream. */
    private var analysisBlockedQuality: VideoQuality? = null
    private var appliedRotation: Int = holder.displayRotation.value

    private var session: Session? = null
    private var stopping = false
    private var current: Segment? = null
    private var previous: Segment? = null
    private var cooling = false
    private var cooldownUnbindPending = false
    private var storageRecovery = false
    private var bindFailures = 0

    /** Clips that were started but not finalized yet: at most one finishing plus one queued. */
    private val unfinalized = LinkedHashSet<Segment>()

    /** Files the storage cleanup must not delete (recording, finalizing or about to move), with use counts. */
    private val busyFiles = mutableMapOf<String, Int>()

    /** The newest clip that actually contains footage. */
    private var lastFootage: Segment? = null
    private var lastProgressAtMs = 0L
    private var hadFootageThisSession = false
    private var cameraOpen = false

    private var tickerJob: Job? = null
    private var rotationJob: Job? = null
    private var retryJob: Job? = null
    private var countdownJob: Job? = null
    private var stopTimeoutJob: Job? = null
    private var zoomSaveJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var powerReceiverRegistered = false
    private var thermalListener: Any? = null

    val isSessionActive: Boolean get() = session != null || stopping

    // ---------------------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------------------

    fun start() {
        holder.controller = this
        impacts.onImpact = ::onImpact
        impacts.onGForce = { g -> current?.telemetry?.observeG(g) }
        location.start()
        scope.launch { location.fix.collect { holder.gps.value = it } }
        scope.launch { impacts.gForce.collect { holder.gForce.value = it } }
        scope.launch { holder.displayRotation.collect(::onDisplayRotation) }
        scope.launch { graph.settings.collect(::onSettingsChanged) }
        scope.launch { holder.frameAnalyzer.collect(::applyFrameAnalyzer) }
        startTicker()
        scope.launch { bindWhenReady() }
    }

    fun release() {
        if (holder.controller === this) holder.controller = null
        session = null
        stopping = false
        unfinalized.forEach { it.recording?.stop() }
        listOf(tickerJob, rotationJob, retryJob, countdownJob, stopTimeoutJob, zoomSaveJob).forEach { it?.cancel() }
        location.stop()
        impacts.stop()
        unregisterPowerReceiver()
        unregisterThermalListener()
        releaseWakeLock()
        camera?.cameraInfo?.let {
            it.cameraState.removeObservers(service)
            it.zoomState.removeObservers(service)
        }
        imageAnalysis?.clearAnalyzer()
        provider?.unbindAll()
        overlayEffect?.close()
        overlayThread.quitSafely()
        holder.surfaceRequest.value = null
        holder.update { RecorderUiState() }
    }

    // ---------------------------------------------------------------------------------------
    // Camera binding
    // ---------------------------------------------------------------------------------------

    private suspend fun bindWhenReady() {
        if (!hasPermission(Manifest.permission.CAMERA)) {
            holder.update { it.copy(issue = RecorderIssue.PERMISSION_MISSING, cameraReady = false) }
            return
        }
        val cameraProvider = try {
            provider ?: ProcessCameraProvider.awaitInstance(context).also { provider = it }
        } catch (e: Exception) {
            Log.e(TAG, "CameraX failed to initialize", e)
            holder.update { it.copy(issue = RecorderIssue.CAMERA_ERROR) }
            onBindFailed()
            return
        }
        val settings = graph.settingsRepository.settings.first()
        if (camera == null && !cooling) bindCamera(cameraProvider, configFor(settings), settings)
    }

    @MainThread
    private fun bindCamera(cameraProvider: ProcessCameraProvider, config: CameraConfig, settings: DashcamSettings): Boolean {
        val selector = CameraSelector.DEFAULT_BACK_CAMERA
        val cameraInfo = try {
            cameraProvider.getCameraInfo(selector)
        } catch (e: Exception) {
            Log.e(TAG, "No back camera", e)
            holder.update { it.copy(issue = RecorderIssue.CAMERA_ERROR, cameraReady = false) }
            onBindFailed()
            return false
        }
        val capabilities = Recorder.getVideoCapabilities(cameraInfo)
        val supported = capabilities.getSupportedQualities(DynamicRange.SDR)
            .mapNotNull { it.toVideoQuality() }.distinct().sortedBy { it.ordinal }
        val hevcCapabilities = runCatching {
            Recorder.getVideoCapabilities(cameraInfo, MediaFormat.MIMETYPE_VIDEO_HEVC)
        }.getOrNull()
        val hevcSupported = hevcCapabilities?.getSupportedQualities(DynamicRange.SDR)?.isNotEmpty() == true
        val quality = pickQuality(config.quality, supported)
        val wantHevc = config.hevc && hevcCapabilities?.isQualitySupported(quality.toCameraX(), DynamicRange.SDR) == true
        val stabilizationSupported = capabilities.isStabilizationSupported
        val (recorder, usesHevc) = buildRecorder(quality, wantHevc)

        val rotation = holder.displayRotation.value
        val newVideo = VideoCapture.Builder(recorder)
            .setTargetRotation(rotation)
            .setVideoStabilizationEnabled(config.stabilization && stabilizationSupported)
            .build()
        val newPreview = Preview.Builder()
            .setTargetRotation(rotation)
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                    .build(),
            )
            .build()
        newPreview.setSurfaceProvider(mainExecutor, ::onSurfaceRequested)
        val effect = overlayEffect ?: OverlayEffect(
            CameraEffect.PREVIEW or CameraEffect.VIDEO_CAPTURE,
            0,
            Handler(overlayThread.looper),
        ) { error -> Log.e(TAG, "Overlay effect failed", error) }.also {
            it.setOnDrawListener(overlay::onDraw)
            overlayEffect = it
        }

        val newAnalysis = if (config.analysis) buildAnalysis(rotation, quality) else null

        camera?.cameraInfo?.let {
            it.cameraState.removeObservers(service)
            it.zoomState.removeObservers(service)
        }
        imageAnalysis?.clearAnalyzer()
        imageAnalysis = null
        // Preferred: preview + video sharing one stream through the overlay effect, so the
        // viewfinder can disappear without affecting the recording. The scanner's analysis
        // stream joins them only if the camera can run it without lowering the video quality.
        var shared: Camera? = null
        if (newAnalysis != null) {
            shared = bindShared(cameraProvider, selector, effect, newPreview, newVideo, newAnalysis)
            if (shared != null && videoDowngraded(newVideo, quality)) {
                Log.w(TAG, "The scanner stream would lower the video quality; binding without it")
                shared = null
            }
        }
        val withAnalysis = shared != null
        if (shared == null) shared = bindShared(cameraProvider, selector, effect, newPreview, newVideo, null)
        val previewAvailable = shared != null
        val bound = shared ?: try {
            // Fallback: video only. No viewfinder, but recording in the background stays reliable.
            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(service, selector, SessionConfig(listOf(newVideo)))
        } catch (e: Exception) {
            Log.e(TAG, "Camera binding failed", e)
            holder.update { it.copy(issue = RecorderIssue.CAMERA_ERROR, cameraReady = false) }
            camera = null
            videoCapture = null
            onBindFailed()
            return false
        }
        camera = bound
        preview = newPreview
        videoCapture = newVideo
        imageAnalysis = if (withAnalysis) newAnalysis else null
        applyFrameAnalyzer(holder.frameAnalyzer.value)
        boundConfig = config
        bindFailures = 0
        appliedRotation = rotation
        overlay.outputRotationDegrees = bound.cameraInfo.getSensorRotationDegrees(rotation)
        overlay.invalidate()
        bound.cameraInfo.cameraState.observe(service, ::onCameraState)
        bound.cameraInfo.zoomState.observe(service) { zoom ->
            holder.update { it.copy(zoom = ZoomInfo(zoom.zoomRatio, zoom.minZoomRatio, zoom.maxZoomRatio)) }
        }
        applyZoom(settings.zoomRatio)
        holder.update {
            it.copy(
                cameraReady = true,
                previewAvailable = previewAvailable,
                quality = quality,
                hevc = usesHevc,
                supportedQualities = supported,
                hevcSupported = hevcSupported,
                stabilizationSupported = stabilizationSupported,
                scannerAvailable = withAnalysis,
                scannerBlocked = settings.scannerEnabled && !withAnalysis,
                issue = it.issue.takeUnless { issue ->
                    issue == RecorderIssue.PERMISSION_MISSING || issue == RecorderIssue.CAMERA_ERROR
                },
            )
        }
        if (session != null && current == null && !cooling) startClip()
        return true
    }

    /** Retries a failed camera bind during a session, then gives up rather than hang in STARTING. */
    private fun onBindFailed() {
        if (session == null) return
        bindFailures++
        if (bindFailures >= MAX_BIND_FAILURES) failSession(RecorderIssue.CAMERA_ERROR) else scheduleRetry(2_000L * bindFailures)
    }

    private fun bindShared(
        cameraProvider: ProcessCameraProvider,
        selector: CameraSelector,
        effect: OverlayEffect,
        preview: Preview,
        video: VideoCapture<Recorder>,
        analysis: ImageAnalysis?,
    ): Camera? = try {
        cameraProvider.unbindAll()
        val config = SessionConfig.Builder(listOfNotNull(preview, video, analysis)).addEffect(effect).build()
        cameraProvider.bindToLifecycle(service, selector, config)
    } catch (e: Exception) {
        if (analysis != null) {
            Log.w(TAG, "The camera can't add the scanner stream", e)
        } else {
            Log.w(TAG, "Shared preview/video stream unavailable; recording without a live preview", e)
        }
        null
    }

    /**
     * The car scanner's frames. Full HD reads plates from further away; next to higher
     * resolution video a 720p stream is far more likely to fit.
     */
    private fun buildAnalysis(rotation: Int, quality: VideoQuality): ImageAnalysis {
        val size = if (quality.ordinal <= VideoQuality.FHD.ordinal) Size(1920, 1080) else Size(1280, 720)
        return ImageAnalysis.Builder()
            .setTargetRotation(rotation)
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(ResolutionStrategy(size, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                    .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            // YUV, the camera's native format: frames the scanner skips cost no conversion.
            .build()
    }

    /** True if CameraX settled for a lower video resolution than [quality] to fit another stream. */
    private fun videoDowngraded(video: VideoCapture<Recorder>, quality: VideoQuality): Boolean {
        val size = video.resolutionInfo?.resolution ?: return false
        return minOf(size.width, size.height) < quality.shortSidePx * 0.95f
    }

    private fun applyFrameAnalyzer(frameAnalyzer: FrameAnalyzer?) {
        val analysis = imageAnalysis ?: return
        if (frameAnalyzer == null) {
            analysis.clearAnalyzer()
        } else {
            analysis.setAnalyzer(frameAnalyzer.executor, frameAnalyzer.analyzer)
        }
    }

    private fun configFor(settings: DashcamSettings) = CameraConfig(
        quality = settings.quality,
        hevc = settings.useHevc,
        stabilization = settings.stabilization,
        analysis = settings.scannerEnabled && analysisBlockedQuality != settings.quality,
    )

    private fun buildRecorder(quality: VideoQuality, hevc: Boolean): Pair<Recorder, Boolean> {
        fun builder() = Recorder.Builder()
            .setQualitySelector(
                QualitySelector.from(quality.toCameraX(), FallbackStrategy.lowerQualityOrHigherThan(quality.toCameraX())),
            )
            .setAspectRatio(AspectRatio.RATIO_16_9)
        if (hevc) {
            try {
                return builder().setVideoMimeType(MediaFormat.MIMETYPE_VIDEO_HEVC).build() to true
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "HEVC isn't available, using H.264", e)
            }
        }
        return builder().build() to false
    }

    private fun releaseCamera() {
        camera?.cameraInfo?.let {
            it.cameraState.removeObservers(service)
            it.zoomState.removeObservers(service)
        }
        imageAnalysis?.clearAnalyzer()
        provider?.unbindAll()
        camera = null
        cameraOpen = false
        preview = null
        videoCapture = null
        imageAnalysis = null
        boundConfig = null
        holder.surfaceRequest.value = null
        holder.update { it.copy(cameraReady = false, scannerAvailable = false) }
    }

    private fun onSurfaceRequested(request: SurfaceRequest) {
        holder.surfaceRequest.value = request
        request.addRequestCancellationListener(mainExecutor) {
            holder.surfaceRequest.compareAndSet(request, null)
        }
    }

    private fun onCameraState(state: CameraState) {
        val error = state.error
        if (error?.code == CameraState.ERROR_STREAM_CONFIG && imageAnalysis != null) {
            // The camera accepted the scanner stream but can't actually run it: recording wins.
            Log.w(TAG, "The camera can't run the scanner stream; rebinding without it")
            val settings = graph.settings.value
            analysisBlockedQuality = boundConfig?.quality ?: settings.quality
            provider?.let { bindCamera(it, configFor(settings), settings) }
            return
        }
        val issue = if (error == null) {
            null
        } else {
            when (error.code) {
                CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE -> RecorderIssue.CAMERA_IN_USE
                CameraState.ERROR_CAMERA_DISABLED, CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> RecorderIssue.CAMERA_DISABLED
                else -> RecorderIssue.CAMERA_ERROR
            }
        }
        cameraOpen = state.type == CameraState.Type.OPEN
        holder.update { ui ->
            val cameraIssue = ui.issue in CAMERA_ISSUES
            ui.copy(issue = issue ?: ui.issue.takeUnless { cameraIssue })
        }
        if (cameraOpen && session != null && current == null && !cooling) scheduleRetry(300)
        refreshPhase()
    }

    private fun onDisplayRotation(rotation: Int) {
        // Never reconfigure the pipeline mid-clip; pending changes apply when the next clip starts.
        if (session == null) applyRotation(rotation)
    }

    private fun applyRotation(rotation: Int) {
        if (rotation == appliedRotation) return
        appliedRotation = rotation
        preview?.targetRotation = rotation
        videoCapture?.targetRotation = rotation
        imageAnalysis?.targetRotation = rotation
        camera?.let { overlay.outputRotationDegrees = it.cameraInfo.getSensorRotationDegrees(rotation) }
    }

    private fun applyZoom(ratio: Float) {
        val cam = camera ?: return
        val zoom = cam.cameraInfo.zoomState.value
        val clamped = if (zoom != null) ratio.coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio) else ratio
        cam.cameraControl.setZoomRatio(clamped)
    }

    private fun onSettingsChanged(settings: DashcamSettings) {
        impacts.setThreshold(settings.impactSensitivity.thresholdG)
        tick()
        val cameraProvider = provider ?: return
        val config = configFor(settings)
        if (session == null && !stopping && boundConfig != null && config != boundConfig) {
            bindCamera(cameraProvider, config, settings)
        }
    }

    // ---------------------------------------------------------------------------------------
    // Recording session
    // ---------------------------------------------------------------------------------------

    /** Starts a loop-recording session. Returns false if it can't start at all. */
    fun startRecording(): Boolean {
        if (session != null) return true
        if (!hasPermission(Manifest.permission.CAMERA)) {
            holder.update { it.copy(issue = RecorderIssue.PERMISSION_MISSING) }
            return false
        }
        stopping = false
        stopTimeoutJob?.cancel()
        val now = System.currentTimeMillis()
        val settings = graph.settings.value
        val newSession = Session(audio = settings.recordAudio && hasPermission(Manifest.permission.RECORD_AUDIO))
        session = newSession
        previous = null
        lastFootage = null
        hadFootageThisSession = false
        lastProgressAtMs = 0L
        bindFailures = 0
        graph.sessionMarker.markActive(true)
        holder.update {
            it.copy(
                phase = RecorderPhase.STARTING,
                sessionStartedAtMs = now,
                clipStartedAtMs = null,
                clipsThisSession = 0,
                audioEnabled = newSession.audio,
                muted = false,
                currentClipProtected = false,
                lastProtect = null,
                stopCountdownSec = null,
                issue = it.issue.takeUnless { issue -> issue == RecorderIssue.STORAGE_FULL },
            )
        }
        acquireWakeLock()
        location.start()
        impacts.start(settings.impactSensitivity.thresholdG)
        registerPowerReceiver()
        registerThermalListener()

        scope.launch {
            // Make sure the camera reflects the latest settings before the first clip.
            val latest = graph.settingsRepository.settings.first()
            val cameraProvider = provider
            // A cool-down may already have begun (hot car); it rebinds when it ends.
            if (session !== newSession || cooling) return@launch
            when {
                cameraProvider == null -> Unit // bindWhenReady() starts the first clip once bound.
                boundConfig != configFor(latest) || camera == null -> bindCamera(cameraProvider, configFor(latest), latest)
                else -> startClip()
            }
        }
        return true
    }

    override fun stopRecording() {
        if (session == null) return
        session = null
        stopping = true
        listOf(rotationJob, retryJob, countdownJob).forEach { it?.cancel() }
        impacts.stop()
        unregisterPowerReceiver()
        unregisterThermalListener()
        holder.update { it.copy(phase = RecorderPhase.STOPPING, stopCountdownSec = null) }
        // Includes a clip still finishing from the last rotation. stop() on it is a no-op.
        unfinalized.toList().forEach { it.recording?.stop() }
        if (unfinalized.isEmpty()) {
            current = null
            finishSession()
        } else {
            stopTimeoutJob = scope.launch {
                delay(STOP_TIMEOUT_MS)
                Log.w(TAG, "Clips didn't finalize in time; ending the session anyway")
                unfinalized.clear()
                current = null
                finishSession()
            }
        }
    }

    /** Ends a stopping session once every clip is safely finalized. */
    private fun finishSession() {
        if (!stopping || unfinalized.isNotEmpty()) return
        stopping = false
        stopTimeoutJob?.cancel()
        releaseWakeLock()
        graph.sessionMarker.markActive(false)
        val wasCooling = cooling
        cooling = false
        cooldownUnbindPending = false
        holder.update {
            it.copy(
                phase = RecorderPhase.IDLE,
                sessionStartedAtMs = null,
                clipStartedAtMs = null,
                activeClipPath = null,
                currentClipProtected = false,
                stopCountdownSec = null,
                muted = false,
                issue = it.issue.takeUnless { issue -> issue == RecorderIssue.OVERHEATING },
            )
        }
        applyRotation(holder.displayRotation.value)
        if (wasCooling) scope.launch { bindWhenReady() }
        callbacks.onSessionFinished()
    }

    private fun failSession(issue: RecorderIssue) {
        holder.update { it.copy(issue = issue) }
        val text = when (issue) {
            RecorderIssue.STORAGE_FULL -> context.getString(R.string.alert_storage_text)
            else -> context.getString(R.string.alert_camera_text)
        }
        RecordingNotifications.alert(context, context.getString(R.string.alert_stopped_title), text)
        stopRecording()
    }

    private fun startClip() {
        val s = session ?: return
        val capture = videoCapture ?: return
        if (current != null || cooling) return
        val settings = graph.settings.value
        val estimate = estimateClipBytes(settings, s.audio)
        if (!StoragePolicy.canStartClip(clips.freeBytes(), estimate)) {
            recoverStorageThenStart(estimate)
            return
        }
        applyRotation(holder.displayRotation.value)
        val file = clips.newClipFile(System.currentTimeMillis())
        val seg = Segment(file)
        val options = FileOutputOptions.Builder(file).apply {
            location.fix.value?.takeIf { it.isFresh() }?.let { setLocation(it.toLocation()) }
        }.build()
        var pending = capture.output.prepareRecording(context, options)
        if (s.audio && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            pending = pending.withAudioEnabled(s.muted)
        }
        try {
            seg.recording = pending.start(mainExecutor) { event -> onRecordEvent(seg, event) }
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Recorder busy, retrying", e)
            scheduleRetry(500)
            return
        } catch (e: SecurityException) {
            Log.w(TAG, "Recording permission problem", e)
            scheduleRetry(1_000)
            return
        }
        if (s.protectNext) {
            seg.protectRequested = true
            s.protectNext = false
        }
        unfinalized += seg
        markBusy(seg.file.absolutePath)
        current = seg
        holder.update { it.copy(activeClipPath = file.absolutePath, currentClipProtected = seg.protectRequested) }
    }

    private fun recoverStorageThenStart(estimate: Long) {
        if (storageRecovery) return
        storageRecovery = true
        scope.launch {
            clips.enforceBudget(busyFiles.keys.toSet(), StoragePolicy.minFreeBytes(estimate))
            storageRecovery = false
            if (session == null) return@launch
            if (StoragePolicy.canStartClip(clips.freeBytes(), estimate)) startClip() else failSession(RecorderIssue.STORAGE_FULL)
        }
    }

    private fun onRecordEvent(seg: Segment, event: VideoRecordEvent) {
        when (event) {
            // CameraX reports Start as soon as the encoders run, before any frame arrives (for
            // example while another app holds the camera), so footage is tracked from Status.
            is VideoRecordEvent.Start -> refreshWakeLock()
            is VideoRecordEvent.Status -> onClipProgress(seg, event.recordingStats.numBytesRecorded)
            is VideoRecordEvent.Finalize -> onClipFinalized(seg, event)
            else -> Unit
        }
    }

    /** Bytes only appear once the first video key frame is muxed, so this means real footage. */
    private fun onClipProgress(seg: Segment, bytes: Long) {
        if (bytes <= seg.bytes) return
        seg.bytes = bytes
        val now = System.currentTimeMillis()
        lastProgressAtMs = now
        if (!seg.hasFootage) {
            seg.hasFootage = true
            seg.startedAtMs = now
            seg.telemetry.begin(now)
            lastFootage = seg
            hadFootageThisSession = true
            val s = session
            if (s != null) {
                s.clipCount++
                s.failures = 0
            }
            if (current === seg && s != null) scheduleRotation(seg)
            holder.update {
                it.copy(
                    clipStartedAtMs = now,
                    clipsThisSession = s?.clipCount ?: it.clipsThisSession,
                    currentClipProtected = seg.protectRequested,
                    issue = it.issue.takeUnless { issue -> issue == RecorderIssue.STORAGE_FULL },
                )
            }
            launchStorageCleanup()
        }
        refreshPhase(now)
    }

    /** REC only while frames are really arriving; otherwise the session is waiting on the camera. */
    private fun refreshPhase(now: Long = System.currentTimeMillis()) {
        val phase = when {
            stopping -> RecorderPhase.STOPPING
            session == null -> return
            cooling -> RecorderPhase.COOLING_DOWN
            cameraOpen && now - lastProgressAtMs < PROGRESS_GRACE_MS -> RecorderPhase.RECORDING
            hadFootageThisSession -> RecorderPhase.WAITING
            else -> RecorderPhase.STARTING
        }
        if (holder.state.value.phase != phase) holder.update { it.copy(phase = phase) }
    }

    private fun onClipFinalized(seg: Segment, event: VideoRecordEvent.Finalize) {
        seg.finalized = true
        unfinalized -= seg
        val error = event.error
        if (error != VideoRecordEvent.Finalize.ERROR_NONE) {
            Log.w(TAG, "Clip ${seg.file.name} finalized with error $error", event.cause)
        }
        val keep = seg.startedAtMs != null &&
            error != VideoRecordEvent.Finalize.ERROR_NO_VALID_DATA &&
            error != VideoRecordEvent.Finalize.ERROR_INVALID_OUTPUT_OPTIONS
        val track = seg.telemetry.build(System.currentTimeMillis())
        val protect = seg.protectRequested
        val impact = seg.impact
        val path = seg.file.absolutePath
        // App scope: this must finish even if the service is destroyed right after the last clip.
        graph.appScope.launch {
            clips.completeClip(seg.file, track, protect, impact, keep)
            markIdle(path)
            launchStorageCleanup()
        }

        if (cooldownUnbindPending && unfinalized.isEmpty()) {
            cooldownUnbindPending = false
            if (cooling) releaseCamera()
        }
        if (current === seg) {
            current = null
            rotationJob?.cancel()
            holder.update { it.copy(activeClipPath = null) }
            val s = session
            if (s != null && !cooling) restartAfter(error, s)
        }
        if (stopping) finishSession()
        refreshPhase()
    }

    /** The clip being recorded ended on its own; start the next one or back off. */
    private fun restartAfter(error: Int, s: Session) {
        when (error) {
            VideoRecordEvent.Finalize.ERROR_NONE,
            VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED,
            VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED,
            -> startClip()
            VideoRecordEvent.Finalize.ERROR_INSUFFICIENT_STORAGE -> recoverStorageThenStart(estimateClipBytes(graph.settings.value, s.audio))
            // The camera closed (another app took it, or the system reclaimed it). The camera
            // state observer restarts us when it reopens; this is a fallback.
            VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE -> scheduleRetry(3_000)
            // Without the camera there is nothing to count against: wait for it to come back.
            else -> if (!cameraOpen) {
                scheduleRetry(3_000)
            } else {
                s.failures++
                if (s.failures >= MAX_CONSECUTIVE_FAILURES) {
                    failSession(RecorderIssue.CAMERA_ERROR)
                } else {
                    scheduleRetry(1_000L * s.failures)
                }
            }
        }
    }

    private fun scheduleRotation(seg: Segment) {
        rotationJob?.cancel()
        rotationJob = scope.launch {
            delay(graph.settings.value.clipDurationMs)
            if (current !== seg || session == null || cooling) return@launch
            previous = seg
            current = null
            seg.recording?.stop()
            // The Recorder queues this and starts it the moment the previous clip is finalized.
            startClip()
        }
    }

    private fun scheduleRetry(delayMs: Long) {
        retryJob?.cancel()
        retryJob = scope.launch {
            delay(delayMs)
            if (session != null && current == null && !cooling) {
                if (camera == null) bindWhenReady() else startClip()
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Protection & incidents
    // ---------------------------------------------------------------------------------------

    override fun protectCurrentClip() = protect(ProtectReason.MANUAL, null)

    private fun onImpact(peakG: Float) {
        if (session == null) return
        current?.telemetry?.observeG(peakG)
        protect(ProtectReason.IMPACT, peakG)
        RecordingNotifications.alert(
            context,
            context.getString(R.string.alert_impact_title),
            context.getString(R.string.alert_impact_text, peakG),
        )
    }

    /**
     * Protects the clip being recorded. If the event is close to a clip boundary, the previous or
     * next clip is protected as well so the footage around the event is never cut off.
     */
    private fun protect(reason: ProtectReason, g: Float?) {
        val now = System.currentTimeMillis()
        val s = session
        if (s == null) {
            // Stopping or idle: protect the newest clip with footage (it may still be finalizing).
            val newest = lastFootage
            if (newest != null) {
                protectSegment(newest)
            } else {
                graph.appScope.launch {
                    clips.listClips().firstOrNull { !it.isProtected && it.path !in busyFiles }?.let { clips.protect(it) }
                }
            }
            holder.update { it.copy(lastProtect = ProtectNotice(now, reason, g)) }
            return
        }
        val type = if (reason == ProtectReason.IMPACT) EventType.IMPACT else EventType.MANUAL
        val seg = current
        if (seg != null) {
            seg.protectRequested = true
            if (reason == ProtectReason.IMPACT) seg.impact = true
            seg.telemetry.addEvent(now, type, g)
            val startedAt = seg.startedAtMs ?: now
            if (now - startedAt < PRE_EVENT_MS) protectSegment(previous)
            if (startedAt + graph.settings.value.clipDurationMs - now < POST_EVENT_MS) s.protectNext = true
        } else {
            protectSegment(previous)
            s.protectNext = true
        }
        holder.update { it.copy(currentClipProtected = true, lastProtect = ProtectNotice(now, reason, g)) }
    }

    private fun protectSegment(seg: Segment?) {
        if (seg == null || seg.protectRequested) return
        seg.protectRequested = true
        // Not finalized yet: onClipFinalized() moves it. Otherwise move it now, and keep the
        // storage cleanup away from it until it has moved.
        if (!seg.finalized) return
        val path = seg.file.absolutePath
        markBusy(path)
        graph.appScope.launch {
            clips.protectByName(seg.root, seg.baseName, seg.impact)
            markIdle(path)
        }
    }

    override fun setMuted(muted: Boolean) {
        val s = session ?: return
        if (!s.audio) return
        s.muted = muted
        runCatching { current?.recording?.mute(muted) }.onFailure { Log.w(TAG, "Mute failed", it) }
        holder.update { it.copy(muted = muted) }
    }

    override fun setZoom(ratio: Float) {
        applyZoom(ratio)
        zoomSaveJob?.cancel()
        zoomSaveJob = scope.launch {
            delay(600)
            val saved = camera?.cameraInfo?.zoomState?.value?.zoomRatio ?: ratio
            graph.settingsRepository.update { it.copy(zoomRatio = saved) }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Ticker: overlay text and GPS track, aligned to wall-clock seconds
    // ---------------------------------------------------------------------------------------

    private fun startTicker() {
        tickerJob?.cancel()
        tickerJob = scope.launch {
            while (isActive) {
                tick()
                delay(1_000L - System.currentTimeMillis() % 1_000L)
            }
        }
    }

    private fun tick() {
        val now = System.currentTimeMillis()
        val fix = location.fix.value?.takeIf { it.isFresh() }
        overlay.content = OverlayText.build(now, fix, graph.settings.value)
        if (fix != null) current?.telemetry?.addFix(fix, now)
        refreshPhase(now)
    }

    // ---------------------------------------------------------------------------------------
    // Auto-stop when the charger is unplugged
    // ---------------------------------------------------------------------------------------

    private val powerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_POWER_DISCONNECTED -> if (graph.settings.value.stopOnPowerDisconnect) startAutoStopCountdown()
                Intent.ACTION_POWER_CONNECTED -> cancelAutoStop()
            }
        }
    }

    private fun registerPowerReceiver() {
        if (powerReceiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
        }
        ContextCompat.registerReceiver(context, powerReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        powerReceiverRegistered = true
    }

    private fun unregisterPowerReceiver() {
        if (!powerReceiverRegistered) return
        runCatching { context.unregisterReceiver(powerReceiver) }
        powerReceiverRegistered = false
    }

    private fun startAutoStopCountdown() {
        if (session == null || countdownJob?.isActive == true) return
        countdownJob = scope.launch {
            for (remaining in AUTO_STOP_SECONDS downTo 1) {
                holder.update { it.copy(stopCountdownSec = remaining) }
                delay(1_000)
            }
            holder.update { it.copy(stopCountdownSec = null) }
            stopRecording()
        }
    }

    override fun cancelAutoStop() {
        countdownJob?.cancel()
        countdownJob = null
        holder.update { it.copy(stopCountdownSec = null) }
    }

    // ---------------------------------------------------------------------------------------
    // Thermal protection: pause instead of letting the phone shut down in a hot car
    // ---------------------------------------------------------------------------------------

    private fun registerThermalListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || thermalListener != null) return
        val pm = powerManager ?: return
        val listener = PowerManager.OnThermalStatusChangedListener(::onThermalStatus)
        pm.addThermalStatusListener(mainExecutor, listener)
        thermalListener = listener
        onThermalStatus(pm.currentThermalStatus)
    }

    private fun unregisterThermalListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        removeThermalListener()
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun removeThermalListener() {
        val listener = thermalListener as? PowerManager.OnThermalStatusChangedListener ?: return
        powerManager?.removeThermalStatusListener(listener)
        thermalListener = null
        holder.update { it.copy(thermalWarning = false) }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun onThermalStatus(status: Int) {
        holder.update { it.copy(thermalWarning = status >= PowerManager.THERMAL_STATUS_SEVERE) }
        if (session == null) return
        if (!cooling && status >= PowerManager.THERMAL_STATUS_CRITICAL) {
            enterCooldown()
        } else if (cooling && status <= PowerManager.THERMAL_STATUS_MODERATE) {
            exitCooldown()
        }
    }

    private fun enterCooldown() {
        cooling = true
        rotationJob?.cancel()
        retryJob?.cancel()
        wakeLock?.acquire(COOLDOWN_WAKELOCK_MS)
        holder.update { it.copy(phase = RecorderPhase.COOLING_DOWN, issue = RecorderIssue.OVERHEATING) }
        current?.let { if (it.hasFootage) previous = it }
        current = null
        if (unfinalized.isEmpty()) {
            releaseCamera()
        } else {
            // Release the camera only once every clip (including one still finishing from the
            // last rotation) is finalized.
            cooldownUnbindPending = true
            unfinalized.toList().forEach { it.recording?.stop() }
        }
    }

    private fun exitCooldown() {
        cooling = false
        cooldownUnbindPending = false
        holder.update {
            it.copy(
                phase = RecorderPhase.STARTING,
                issue = it.issue.takeUnless { issue -> issue == RecorderIssue.OVERHEATING },
            )
        }
        scope.launch {
            if (camera == null) bindWhenReady() else startClip()
        }
    }

    // ---------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------

    private fun launchStorageCleanup() {
        graph.appScope.launch {
            val estimate = estimateClipBytes(graph.settings.value, session?.audio ?: false)
            clips.enforceBudget(busyFiles.keys.toSet(), StoragePolicy.minFreeBytes(estimate))
        }
    }

    private fun markBusy(path: String) {
        busyFiles[path] = (busyFiles[path] ?: 0) + 1
    }

    private fun markIdle(path: String) {
        val count = (busyFiles[path] ?: 1) - 1
        if (count <= 0) busyFiles.remove(path) else busyFiles[path] = count
    }

    private fun estimateClipBytes(settings: DashcamSettings, audio: Boolean): Long {
        val state = holder.state.value
        return StoragePolicy.estimateClipBytes(state.quality ?: settings.quality, state.hevc, settings.clipMinutes, audio)
    }

    private fun acquireWakeLock() {
        val pm = powerManager ?: return
        val lock = wakeLock ?: pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Dashcam:recording").also {
            it.setReferenceCounted(false)
            wakeLock = it
        }
        lock.acquire(wakeLockTimeoutMs())
    }

    private fun refreshWakeLock() {
        if (session != null) wakeLock?.acquire(wakeLockTimeoutMs())
    }

    private fun wakeLockTimeoutMs() = graph.settings.value.clipDurationMs + 10 * 60_000L

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
    }

    private fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun pickQuality(preferred: VideoQuality, supported: List<VideoQuality>): VideoQuality = when {
        supported.isEmpty() || preferred in supported -> preferred
        else -> supported.lastOrNull { it.ordinal < preferred.ordinal } ?: supported.first()
    }

    private companion object {
        const val TAG = "DashcamEngine"
        const val PRE_EVENT_MS = 15_000L
        const val POST_EVENT_MS = 10_000L
        const val STOP_TIMEOUT_MS = 8_000L
        const val MAX_CONSECUTIVE_FAILURES = 6
        const val MAX_BIND_FAILURES = 4
        const val PROGRESS_GRACE_MS = 3_000L
        const val AUTO_STOP_SECONDS = 60
        const val COOLDOWN_WAKELOCK_MS = 30 * 60_000L
        val CAMERA_ISSUES = setOf(
            RecorderIssue.CAMERA_IN_USE,
            RecorderIssue.CAMERA_DISABLED,
            RecorderIssue.CAMERA_ERROR,
        )
    }
}

internal fun VideoQuality.toCameraX(): Quality = when (this) {
    VideoQuality.HD -> Quality.HD
    VideoQuality.FHD -> Quality.FHD
    VideoQuality.QHD -> Quality.QHD
    VideoQuality.UHD -> Quality.UHD
}

internal fun Quality.toVideoQuality(): VideoQuality? = when (this) {
    Quality.HD -> VideoQuality.HD
    Quality.FHD -> VideoQuality.FHD
    Quality.QHD -> VideoQuality.QHD
    Quality.UHD -> VideoQuality.UHD
    else -> null
}

private val VideoQuality.shortSidePx: Int
    get() = when (this) {
        VideoQuality.HD -> 720
        VideoQuality.FHD -> 1080
        VideoQuality.QHD -> 1440
        VideoQuality.UHD -> 2160
    }
