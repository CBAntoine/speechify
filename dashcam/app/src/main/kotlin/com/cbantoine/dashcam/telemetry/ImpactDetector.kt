package com.cbantoine.dashcam.telemetry

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import kotlin.math.max
import kotlin.math.sqrt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Detects collisions from linear acceleration. A hit must stay above the threshold for two
 * consecutive samples (or exceed it by 60% once) so a tap on the phone or a pothole spike does
 * not count. Pure logic, so it can be unit tested.
 */
class ImpactAnalyzer(
    @Volatile var thresholdG: Float?,
    private val cooldownNanos: Long = 8_000_000_000L,
    private val warmupNanos: Long = 2_000_000_000L,
) {
    private val gravity = FloatArray(3)
    private var hasGravity = false
    private var firstTimestamp = Long.MIN_VALUE
    private var lastTrigger = Long.MIN_VALUE
    private var aboveCount = 0
    private var runPeak = 0f

    /** Feeds one sample in m/s². Returns the peak g of a newly detected impact, or null. */
    fun onSample(x: Float, y: Float, z: Float, timestampNanos: Long, gravityRemoved: Boolean): Float? {
        if (firstTimestamp == Long.MIN_VALUE) firstTimestamp = timestampNanos
        val g = magnitudeG(x, y, z, gravityRemoved)
        lastMagnitudeG = g
        val threshold = thresholdG ?: return null
        if (timestampNanos - firstTimestamp < warmupNanos) return null
        if (lastTrigger != Long.MIN_VALUE && timestampNanos - lastTrigger < cooldownNanos) return null

        if (g >= threshold) {
            aboveCount++
            runPeak = max(runPeak, g)
        } else {
            aboveCount = 0
            runPeak = 0f
        }
        if (aboveCount >= 2 || g >= threshold * 1.6f) {
            val peak = max(runPeak, g)
            lastTrigger = timestampNanos
            aboveCount = 0
            runPeak = 0f
            return peak
        }
        return null
    }

    @Volatile
    var lastMagnitudeG: Float = 0f
        private set

    private fun magnitudeG(x: Float, y: Float, z: Float, gravityRemoved: Boolean): Float {
        var lx = x
        var ly = y
        var lz = z
        if (!gravityRemoved) {
            if (!hasGravity) {
                gravity[0] = x; gravity[1] = y; gravity[2] = z
                hasGravity = true
            } else {
                gravity[0] = ALPHA * gravity[0] + (1 - ALPHA) * x
                gravity[1] = ALPHA * gravity[1] + (1 - ALPHA) * y
                gravity[2] = ALPHA * gravity[2] + (1 - ALPHA) * z
            }
            lx = x - gravity[0]; ly = y - gravity[1]; lz = z - gravity[2]
        }
        return sqrt(lx * lx + ly * ly + lz * lz) / STANDARD_GRAVITY
    }

    private companion object {
        const val ALPHA = 0.9f
        const val STANDARD_GRAVITY = 9.80665f
    }
}

/** Listens to the accelerometer on a background thread while a recording session runs. */
class ImpactDetector(context: Context) {
    private val sensorManager: SensorManager? = context.getSystemService(SensorManager::class.java)
    private val linear: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val raw: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var thread: HandlerThread? = null
    private var analyzer: ImpactAnalyzer? = null

    private val _gForce = MutableStateFlow(0f)
    /** Smoothed g-force for the HUD meter, about ten updates per second. */
    val gForce: StateFlow<Float> = _gForce.asStateFlow()

    /** Called on the main thread with the impact's peak g. */
    var onImpact: ((Float) -> Unit)? = null

    /** Called on the main thread about ten times per second with the recent peak g. */
    var onGForce: ((Float) -> Unit)? = null

    val isAvailable: Boolean get() = linear != null || raw != null

    private val listener = object : SensorEventListener {
        private var smoothed = 0f
        private var windowPeak = 0f
        private var lastPublish = 0L

        override fun onSensorChanged(event: SensorEvent) {
            val a = analyzer ?: return
            val gravityRemoved = event.sensor.type == Sensor.TYPE_LINEAR_ACCELERATION
            val hit = a.onSample(event.values[0], event.values[1], event.values[2], event.timestamp, gravityRemoved)
            val g = a.lastMagnitudeG
            smoothed = 0.8f * smoothed + 0.2f * g
            windowPeak = max(windowPeak, g)
            if (event.timestamp - lastPublish > 100_000_000L) {
                lastPublish = event.timestamp
                _gForce.value = smoothed
                val peak = windowPeak
                windowPeak = 0f
                mainHandler.post { onGForce?.invoke(peak) }
            }
            if (hit != null) mainHandler.post { onImpact?.invoke(hit) }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    fun start(thresholdG: Float?) {
        val sm = sensorManager ?: return
        val sensor = linear ?: raw ?: return
        if (thread != null) {
            setThreshold(thresholdG)
            return
        }
        analyzer = ImpactAnalyzer(thresholdG)
        val handlerThread = HandlerThread("impact-detector").also { it.start() }
        thread = handlerThread
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME, Handler(handlerThread.looper))
    }

    fun setThreshold(thresholdG: Float?) {
        analyzer?.thresholdG = thresholdG
    }

    fun stop() {
        sensorManager?.unregisterListener(listener)
        thread?.quitSafely()
        thread = null
        analyzer = null
        _gForce.value = 0f
    }
}
