package com.cbantoine.dashcam.scanner

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.core.graphics.scale
import com.cbantoine.dashcam.recording.FrameAnalyzer
import com.cbantoine.dashcam.recording.RecorderStateHolder
import com.cbantoine.dashcam.settings.DashcamSettings
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The car scanner. While the camera screen shows it, it takes frames from the engine's analysis
 * stream and, on the phone: detects vehicles, tracks them, names their colour and reads their
 * plates. With the user's API key it asks Claude for the make and model of the vehicle in focus,
 * then looks up recalls for that model.
 *
 * Plates never leave the phone: before a photo is sent, it is read with on-device OCR and every
 * line of text in it is pixelated, along with the area where each vehicle in it carries its plate.
 * A photo that can't be checked isn't sent.
 *
 * Nothing is stored: everything lives in memory and is gone when the scan is cleared or the app
 * closes. All per-vehicle state is confined to one scanner thread.
 */
class VehicleScanner(
    private val context: Context,
    private val scope: CoroutineScope,
    private val settings: StateFlow<DashcamSettings>,
    private val recorder: RecorderStateHolder,
    val apiKeys: ApiKeyStore,
) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "dashcam-scanner").apply {
            priority = Thread.NORM_PRIORITY - 1
            // The scanner shares the recording's process: a bug here must never take it down.
            setUncaughtExceptionHandler { _, error -> Log.e(TAG, "Scanner task failed", error) }
        }
    }
    private val binding = FrameAnalyzer(executor, ImageAnalysis.Analyzer(::analyze))
    private val identifier = VehicleIdentifier(apiKeys)
    private val recalls = RecallsClient()
    private val powerManager: PowerManager? = context.getSystemService(PowerManager::class.java)

    private val _state = MutableStateFlow(ScannerState())
    val state: StateFlow<ScannerState> = _state.asStateFlow()

    /** Main thread only. */
    private var wanted = false

    @Volatile
    private var running = false

    // Everything below is confined to the scanner thread.
    private var detector: VehicleDetector? = null
    private var detectorFailed = false
    private var plateReader: PlateReader? = null
    private val frames = FrameProcessor()
    private val tracker = VehicleTracker()
    private val vehicles = LinkedHashMap<Int, VehicleInfo>()
    private val identityByPlate = HashMap<String, VehicleIdentity>()
    private val recallsByModel = HashMap<String, RecallSummary>()
    private var selectedId: Int? = null
    private var primaryId: Int? = null
    private var focusedId: Int? = null
    private var focusedSinceMs = 0L
    private var lastPassMs = 0L
    private var hot = false
    private var thermalHot = false
    private var lastThermalCheckMs = -THERMAL_CHECK_MS
    private var frameAspect = 16f / 9f
    private var ocrBusy = false
    private var identifyBusy = false
    private var lastAutoIdentifyMs = 0L
    private var autoIdentifiedThisRun = 0

    /** Starts or stops taking frames. Call from the main thread. */
    fun setActive(active: Boolean) {
        if (wanted == active) return
        wanted = active
        running = active
        recorder.frameAnalyzer.value = if (active) binding else null
        executor.execute {
            if (active) {
                autoIdentifiedThisRun = 0
            } else {
                retireAll()
            }
            publish()
        }
    }

    /** Shows [id] in the profile panel, or the closest vehicle again for null. */
    fun select(id: Int?) = executor.execute {
        selectedId = id
        updateFocus(SystemClock.elapsedRealtime())
        publish()
    }

    fun identify(id: Int) = executor.execute {
        vehicles[id]?.let { requestIdentify(it) }
        publish()
    }

    /** Forgets every vehicle seen so far. */
    fun clear() = executor.execute {
        tracker.clear()
        vehicles.values.forEach(::dropPhoto)
        vehicles.clear()
        identityByPlate.clear()
        selectedId = null
        primaryId = null
        focusedId = null
        publish()
    }

    /** A new key may fix vehicles that couldn't be identified with the old one (or without one). */
    fun onApiKeyChanged() {
        // Closing the old HTTP client closes its sockets, which is network I/O: never on the main thread.
        scope.launch(Dispatchers.IO) { identifier.reset() }
        executor.execute {
            vehicles.values.forEach { info ->
                val failed = info.identity as? IdentityState.Failed
                if (failed?.problem == IdentifyProblem.NO_KEY || failed?.problem == IdentifyProblem.INVALID_KEY) {
                    info.identity = IdentityState.None
                }
            }
            publish()
        }
    }

    // -------------------------------------------------------------------------------------------
    // Frames
    // -------------------------------------------------------------------------------------------

    private fun analyze(image: ImageProxy) {
        try {
            if (!running) return
            val now = SystemClock.elapsedRealtime()
            hot = isHot(now)
            if (now - lastPassMs < if (hot) HOT_PASS_INTERVAL_MS else PASS_INTERVAL_MS) return
            lastPassMs = now
            val detector = detector ?: loadDetector() ?: return
            val frame = frames.load(image)
            try {
                pass(detector, frame, now)
            } finally {
                frames.release(frame)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Scanner pass failed", e)
        } catch (e: OutOfMemoryError) {
            // Large frames; drop this one and let the bitmaps be collected.
            Log.w(TAG, "Out of memory in a scanner pass", e)
        } finally {
            image.close()
        }
    }

    /** Backs off earlier than recording does, and whether or not a recording is running. */
    private fun isHot(now: Long): Boolean {
        if (now - lastThermalCheckMs >= THERMAL_CHECK_MS) {
            lastThermalCheckMs = now
            thermalHot = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                (powerManager?.currentThermalStatus ?: PowerManager.THERMAL_STATUS_NONE) >= PowerManager.THERMAL_STATUS_MODERATE
        }
        return thermalHot || recorder.state.value.thermalWarning
    }

    private fun loadDetector(): VehicleDetector? {
        if (detectorFailed) return null
        return try {
            VehicleDetector.create(context).also { detector = it }
        } catch (e: Exception) {
            onDetectorFailed(e)
        } catch (e: LinkageError) {
            onDetectorFailed(e)
        }
    }

    private fun onDetectorFailed(error: Throwable): VehicleDetector? {
        Log.e(TAG, "Vehicle detector unavailable", error)
        detectorFailed = true
        publish()
        return null
    }

    private fun pass(detector: VehicleDetector, frame: Frame, now: Long) {
        frameAspect = frame.width.toFloat() / frame.height
        val width = frame.width.toFloat()
        val height = frame.height.toFloat()
        val detections = DetectionTiles.forFrame(frame.width, frame.height).flatMapIndexed { index, tile ->
            val input = frames.detectorInput(frame, tile, detector.inputSize)
            detector.detect(input, MIN_SCORE).map { it.copy(box = tile.toFrame(it.box, width, height), tile = index) }
        }
        val merged = DetectionMerge.merge(detections).filter { it.box.width >= MIN_BOX && it.box.height >= MIN_BOX }
        tracker.update(merged, now).forEach { dropped -> vehicles[dropped.id]?.let(::retire) }

        for (track in tracker.active) {
            if (!track.confirmed) continue
            val info = vehicles.getOrPut(track.id) { VehicleInfo(track.id) }
            info.kind = track.kind
            // Between sightings the box stays where the vehicle was last seen, briefly.
            info.box = if (now - track.lastSeenMs <= COAST_MS) track.box else null
            if (track.lastSeenMs == now) {
                info.lastSeenMs = now
                // Crops use the detector's own box: the smoothed one lags behind a moving car.
                info.rawBox = track.rawBox
                sampleColour(info, frame, track.rawBox, now)
                captureViews(info, frame, track.rawBox, merged, now)
            }
        }
        if (!hot) readPlate(frame, now)
        updateFocus(now)
        if (!hot) autoIdentify(now)
        evict()
        publish()
    }

    private fun sampleColour(info: VehicleInfo, frame: Frame, box: NormBox, now: Long) {
        if (now - info.lastColourMs < COLOUR_INTERVAL_MS) return
        info.lastColourMs = now
        // Doors, boot lid or bonnet: below the windows, above the wheels, away from the edges.
        val body = NormBox(
            box.left + box.width * 0.15f,
            box.top + box.height * 0.45f,
            box.right - box.width * 0.15f,
            box.top + box.height * 0.8f,
        )
        ColourNamer.dominant(frames.colourPixels(frame, body))?.let { (colour, share) -> info.colours.add(colour, share) }
    }

    /** Keeps the best (largest, least cut-off) view of each vehicle for its thumbnail and for Claude. */
    private fun captureViews(info: VehicleInfo, frame: Frame, box: NormBox, detections: List<Detection>, now: Long) {
        if (now - info.lastViewMs < VIEW_INTERVAL_MS) return
        val touchesEdge = box.left < 0.01f || box.right > 0.99f || box.top < 0.01f || box.bottom > 0.99f
        val quality = box.width * frame.width * box.height * frame.height * (if (touchesEdge) 0.5f else 1f)
        val stale = now - info.lastViewMs > VIEW_REFRESH_MS
        if (quality < info.viewQuality * (if (stale) 0.8f else 1.15f)) return
        val region = box.expanded(0.06f, 0.06f)
        val thumb = frames.crop(frame, region, maxWidth = THUMB_WIDTH) ?: return
        info.thumbnail = thumb
        info.viewQuality = quality
        info.lastViewMs = now
        if (info.identity is IdentityState.Ready) return
        val bitmap = frames.crop(frame, region, maxWidth = PHOTO_WIDTH) ?: return
        dropPhoto(info)
        info.photo = Photo(
            bitmap = bitmap,
            vehicle = box,
            region = region,
            widthPx = region.width * frame.width,
            // Every other vehicle in the shot, so its plate gets pixelated as well.
            others = detections
                .filter { it.box.iou(box) < 0.7f && it.box.intersection(region) > 0f }
                .map { it.box to it.kind },
        )
    }

    // -------------------------------------------------------------------------------------------
    // Plates (on the phone only)
    // -------------------------------------------------------------------------------------------

    private fun readPlate(frame: Frame, now: Long) {
        if (ocrBusy) return
        val target = vehicles.values
            .filter { info ->
                val box = info.rawBox
                box != null && info.box != null && info.lastSeenMs == now && !info.plates.isSettled &&
                    now - info.lastOcrMs >= OCR_INTERVAL_MS && box.width * frame.width >= MIN_PLATE_VEHICLE_PX
            }
            .maxByOrNull { it.rawBox!!.area / (1f + 0.2f * it.ocrAttempts) }
            ?: return
        val vehicleBox = target.rawBox ?: return
        // Plates are on the lower part of a vehicle, front or back.
        val region = NormBox(
            vehicleBox.left - vehicleBox.width * 0.04f,
            vehicleBox.top + vehicleBox.height * 0.3f,
            vehicleBox.right + vehicleBox.width * 0.04f,
            vehicleBox.bottom + vehicleBox.height * 0.04f,
        ).clamped()
        val crop = frames.crop(frame, region, maxWidth = OCR_MAX_WIDTH, minWidth = OCR_MIN_WIDTH, maxUpscale = 2.5f) ?: return
        val reader = plateReader ?: PlateReader().also { plateReader = it }
        ocrBusy = true
        target.lastOcrMs = now
        target.ocrAttempts++
        reader.read(crop, executor) { lines ->
            ocrBusy = false
            crop.recycle()
            onPlateText(target.id, region, vehicleBox, lines)
        }
    }

    private fun onPlateText(id: Int, region: NormBox, vehicleBox: NormBox, lines: List<TextLine>?) {
        val info = vehicles[id] ?: return
        if (lines.isNullOrEmpty()) return
        PlateText.region(lines)?.let { info.regions.merge(it, 1, Int::plus) }
        val candidate = PlateText.best(lines)
        if (candidate != null) {
            info.plates.add(candidate)
            val plate = info.plates.best()
            // Where the plate sits on the vehicle, learned only from reads that agree with the
            // voted plate, so a badge or sticker can't move it.
            if (plate != null && plate.text == candidate.text) {
                info.plateOnVehicle = vehicleBox.relative(region.absolute(candidate.box))
            }
            // The same car seen earlier this session: reuse what Claude said about it.
            if (plate != null && plate.agreeing >= 2 && info.identity !is IdentityState.Ready) {
                identityByPlate[plateKey(plate)]?.let { identity ->
                    info.identity = IdentityState.Ready(identity)
                    dropPhoto(info)
                    fetchRecalls(info, identity)
                }
            }
        }
        publish()
    }

    // -------------------------------------------------------------------------------------------
    // Identification (Claude) and recalls (NHTSA)
    // -------------------------------------------------------------------------------------------

    private fun autoIdentify(now: Long) {
        val s = settings.value
        if (!s.scannerAutoIdentify || !apiKeys.hasKey.value || identifyBusy) return
        if (autoIdentifiedThisRun >= MAX_AUTO_IDENTIFY_PER_RUN || now - lastAutoIdentifyMs < AUTO_IDENTIFY_INTERVAL_MS) return
        val target = focusedId?.let { vehicles[it] } ?: return
        // Only a vehicle that has held the focus for a moment and is close enough to recognise.
        if (target.box == null || now - focusedSinceMs < FOCUS_DWELL_MS) return
        if (target.identity != IdentityState.None || (target.photo?.widthPx ?: 0f) < MIN_IDENTIFY_PX) return
        lastAutoIdentifyMs = now
        autoIdentifiedThisRun++
        requestIdentify(target)
    }

    private fun requestIdentify(info: VehicleInfo) {
        if (identifyBusy || info.identity is IdentityState.Loading || info.identity is IdentityState.Ready) return
        if (!apiKeys.hasKey.value) {
            info.identity = IdentityState.Failed(IdentifyProblem.NO_KEY)
            return
        }
        val photo = info.photo ?: return
        val working = photo.workingCopy() ?: return
        identifyBusy = true
        info.identity = IdentityState.Loading
        val id = info.id
        val kind = info.kind
        val plateOnVehicle = info.plateOnVehicle
        val colour = info.colours.best()
        // Read the exact photo that will be sent, enlarged so small text is found too.
        val scale = min(OCR_MIN_WIDTH / working.width.toFloat(), 2.5f)
        val probe = if (scale > 1f) working.scale((working.width * scale).roundToInt(), (working.height * scale).roundToInt()) else working
        val reader = plateReader ?: PlateReader().also { plateReader = it }
        reader.read(probe, executor) { lines ->
            if (probe !== working) probe.recycle()
            val jpeg = lines?.let { redact(working, photo, kind, plateOnVehicle, it) }
            working.recycle()
            if (jpeg == null) {
                // Fail closed: a photo that couldn't be checked for plates is never sent.
                identifyBusy = false
                vehicles[id]?.identity = IdentityState.Failed(IdentifyProblem.PHOTO_UNCHECKED)
                publish()
            } else {
                send(id, jpeg, colour)
            }
        }
    }

    /**
     * Pixelates every line of text the phone can read in the photo (this vehicle's plate, any
     * other vehicle's, stickers), and the area where each vehicle in it carries a plate, in case
     * one was too small or blurred for OCR to find.
     */
    private fun redact(bitmap: Bitmap, photo: Photo, kind: VehicleKind, plateOnVehicle: NormBox?, lines: List<TextLine>): ByteArray {
        lines.forEach { bitmap.pixelate(it.box.expanded(0.2f, 0.35f)) }
        for ((vehicle, vehicleKind) in listOf(photo.vehicle to kind) + photo.others) {
            bitmap.pixelate(photo.region.relative(vehicle.absolute(plateArea(vehicleKind))))
        }
        plateOnVehicle?.let { bitmap.pixelate(photo.region.relative(photo.vehicle.absolute(it)).expanded(0.3f, 0.45f)) }
        return bitmap.toJpeg()
    }

    private fun send(id: Int, jpeg: ByteArray, colour: VehicleColour?) {
        val model = settings.value.scannerModel
        val market = Locale.getDefault().getDisplayCountry(Locale.ENGLISH).ifBlank { null }
        scope.launch(Dispatchers.IO) {
            var outcome: IdentifyOutcome = IdentifyOutcome.Failed("Something went wrong")
            try {
                outcome = identifier.identify(jpeg, model, colour, market)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.e(TAG, "Identification failed unexpectedly", e)
            } finally {
                // Always hand a result back, so the busy flag can never stay set.
                val result = outcome
                executor.execute {
                    identifyBusy = false
                    applyIdentity(id, result)
                }
            }
        }
    }

    private fun applyIdentity(id: Int, outcome: IdentifyOutcome) {
        val info = vehicles[id] ?: return
        info.identity = when (outcome) {
            is IdentifyOutcome.Success -> if (outcome.identity.isUsable) {
                IdentityState.Ready(outcome.identity)
            } else {
                IdentityState.Failed(IdentifyProblem.NOT_A_VEHICLE)
            }
            IdentifyOutcome.NoKey -> IdentityState.Failed(IdentifyProblem.NO_KEY)
            IdentifyOutcome.InvalidKey -> IdentityState.Failed(IdentifyProblem.INVALID_KEY)
            IdentifyOutcome.Offline -> IdentityState.Failed(IdentifyProblem.OFFLINE)
            IdentifyOutcome.RateLimited -> IdentityState.Failed(IdentifyProblem.RATE_LIMITED)
            IdentifyOutcome.Refused -> IdentityState.Failed(IdentifyProblem.REFUSED)
            is IdentifyOutcome.Failed -> IdentityState.Failed(IdentifyProblem.FAILED, outcome.reason)
        }
        val ready = info.identity as? IdentityState.Ready
        if (ready != null) {
            dropPhoto(info)
            info.plates.best()?.takeIf { it.agreeing >= 2 }?.let { identityByPlate[plateKey(it)] = ready.identity }
            fetchRecalls(info, ready.identity)
        }
        publish()
    }

    private fun fetchRecalls(info: VehicleInfo, identity: VehicleIdentity) {
        val years = identity.years
        if (years == null || identity.model.isBlank()) {
            info.recalls = RecallsState.None
            return
        }
        val key = "${identity.make}|${identity.model}|$years".uppercase(Locale.ROOT)
        recallsByModel[key]?.let {
            info.recalls = RecallsState.Ready(it)
            return
        }
        info.recalls = RecallsState.Loading
        scope.launch {
            val result = runCatching { recalls.fetch(identity.make, identity.model, years) }
            executor.execute {
                result.exceptionOrNull()?.let { Log.w(TAG, "Recall lookup failed", it) }
                result.getOrNull()?.let { recallsByModel[key] = it }
                vehicles[info.id]?.recalls = result.fold({ RecallsState.Ready(it) }, { RecallsState.Failed })
                publish()
            }
        }
    }

    // -------------------------------------------------------------------------------------------
    // Bookkeeping
    // -------------------------------------------------------------------------------------------

    private fun retire(info: VehicleInfo) {
        info.box = null
        info.rawBox = null
        val photo = info.photo ?: return
        val bitmap = photo.bitmap ?: return
        // A vehicle close enough to identify keeps a compressed photo, so it can still be
        // identified from the strip. It is only ever sent after redact(), like any other.
        if (photo.widthPx >= MIN_IDENTIFY_PX && info.identity !is IdentityState.Ready) {
            photo.jpeg = bitmap.toJpeg(KEPT_JPEG_QUALITY)
        } else {
            info.photo = null
        }
        photo.bitmap = null
        bitmap.recycle()
    }

    private fun retireAll() {
        tracker.clear()
        vehicles.values.forEach(::retire)
        primaryId = null
        updateFocus(SystemClock.elapsedRealtime())
    }

    private fun dropPhoto(info: VehicleInfo) {
        info.photo?.bitmap?.recycle()
        info.photo = null
    }

    /** The profile panel follows the tapped vehicle, or else the closest one (without flickering). */
    private fun updateFocus(now: Long) {
        val visible = vehicles.values.filter { it.box != null }
        val biggest = visible.maxByOrNull { it.box!!.area }
        val current = primaryId?.let { vehicles[it] }?.takeIf { it.box != null || now - it.lastSeenMs < FOCUS_LINGER_MS }
        val currentBox = current?.box
        primaryId = when {
            current == null -> biggest?.id
            currentBox != null && biggest != null && biggest.box!!.area > currentBox.area * 1.6f -> biggest.id
            currentBox == null && biggest != null -> biggest.id
            else -> current.id
        }
        val focus = selectedId?.takeIf { vehicles.containsKey(it) } ?: primaryId
        if (focus != focusedId) {
            focusedId = focus
            focusedSinceMs = now
        }
    }

    private fun evict() {
        if (vehicles.size <= MAX_TRACKED) return
        // Never a vehicle the tracker still follows, even while it is briefly out of view.
        val tracked = tracker.active.mapTo(HashSet()) { it.id }
        vehicles.values
            .filter { it.id !in tracked && it.id != selectedId && it.id != focusedId }
            .sortedBy { it.lastSeenMs }
            .take(vehicles.size - MAX_TRACKED)
            .forEach { info ->
                dropPhoto(info)
                vehicles.remove(info.id)
            }
    }

    private fun publish() {
        val views = vehicles.values.map { it.view() }
        _state.value = ScannerState(
            running = running,
            unavailable = detectorFailed,
            frameAspect = frameAspect,
            vehicles = views.filter { it.box != null }.sortedByDescending { it.box!!.area },
            tracked = views.sortedByDescending { it.lastSeenMs }.take(MAX_TRACKED),
            focusedId = focusedId,
            slowedForHeat = running && hot,
        )
    }

    private fun plateKey(plate: PlateReading) = plate.text.replace(" ", "")

    private fun plateArea(kind: VehicleKind) = when (kind) {
        VehicleKind.CAR, VehicleKind.MOTORCYCLE -> CAR_PLATE_AREA
        VehicleKind.TRUCK, VehicleKind.BUS -> LARGE_PLATE_AREA
    }

    /** The best view of a vehicle. It stays on the phone; only a redacted copy is ever sent. */
    private class Photo(
        var bitmap: Bitmap?,
        /** The vehicle's box in the frame when the photo was taken. */
        val vehicle: NormBox,
        /** The part of the frame the photo shows. */
        val region: NormBox,
        val widthPx: Float,
        /** Boxes and kinds of the other vehicles in the photo. */
        val others: List<Pair<NormBox, VehicleKind>>,
    ) {
        /** Compressed copy, once the vehicle is out of view. */
        var jpeg: ByteArray? = null

        /** A mutable copy to redact. */
        fun workingCopy(): Bitmap? =
            bitmap?.copy(Bitmap.Config.ARGB_8888, true)
                ?: jpeg?.let { BitmapFactory.decodeByteArray(it, 0, it.size, BitmapFactory.Options().apply { inMutable = true }) }
    }

    /** Everything known about one vehicle. Scanner thread only. */
    private class VehicleInfo(val id: Int) {
        /** Smoothed box for display, or null while out of view. */
        var box: NormBox? = null

        /** The detector's latest box, for crops. */
        var rawBox: NormBox? = null
        var kind = VehicleKind.CAR
        var lastSeenMs = 0L
        val plates = PlateVotes()
        val regions = HashMap<String, Int>()
        val colours = ColourVotes()
        var plateOnVehicle: NormBox? = null
        var lastOcrMs = 0L
        var ocrAttempts = 0
        var lastColourMs = 0L
        var thumbnail: Bitmap? = null
        var photo: Photo? = null
        var viewQuality = 0f
        var lastViewMs = 0L
        var identity: IdentityState = IdentityState.None
        var recalls: RecallsState = RecallsState.None

        fun view() = VehicleView(
            id = id,
            box = box,
            kind = kind,
            plate = plates.best()?.takeIf { it.isShowable },
            region = regions.maxByOrNull { it.value }?.key,
            colour = colours.best(),
            thumbnail = thumbnail,
            identity = identity,
            recalls = recalls,
            lastSeenMs = lastSeenMs,
            canIdentify = photo != null,
        )
    }

    private companion object {
        const val TAG = "VehicleScanner"
        const val PASS_INTERVAL_MS = 120L
        const val HOT_PASS_INTERVAL_MS = 1_000L
        const val THERMAL_CHECK_MS = 1_000L
        const val MIN_SCORE = 0.4f
        const val MIN_BOX = 0.02f
        const val COAST_MS = 400L
        const val COLOUR_INTERVAL_MS = 300L
        const val VIEW_INTERVAL_MS = 400L
        const val VIEW_REFRESH_MS = 4_000L
        const val THUMB_WIDTH = 240
        const val PHOTO_WIDTH = 640
        const val KEPT_JPEG_QUALITY = 90
        const val OCR_INTERVAL_MS = 350L
        const val OCR_MIN_WIDTH = 960
        const val OCR_MAX_WIDTH = 1_280

        /** Narrower than this (in camera pixels), a plate is too small to read. */
        const val MIN_PLATE_VEHICLE_PX = 300f
        const val MIN_IDENTIFY_PX = 220f
        const val FOCUS_DWELL_MS = 1_200L
        const val FOCUS_LINGER_MS = 4_000L
        const val AUTO_IDENTIFY_INTERVAL_MS = 8_000L

        /** Each identification is a paid API request: cap the automatic ones per scan. */
        const val MAX_AUTO_IDENTIFY_PER_RUN = 40
        const val MAX_TRACKED = 12

        /** Where plates can be on a car seen from the front, back or at an angle (relative to its box). */
        val CAR_PLATE_AREA = NormBox(0.2f, 0.5f, 0.8f, 0.95f)

        /** Trucks and buses carry plates anywhere along the bottom, often at a corner. */
        val LARGE_PLATE_AREA = NormBox(0f, 0.5f, 1f, 1f)
    }
}
