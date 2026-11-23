package com.cbantoine.dashcam.telemetry

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class GpsFix(
    val latitude: Double,
    val longitude: Double,
    val speedMps: Float?,
    val bearingDeg: Float?,
    val accuracyM: Float?,
    val altitudeM: Double?,
    val timeMs: Long,
    val elapsedRealtimeNanos: Long,
) {
    fun isFresh(nowElapsedNanos: Long = SystemClock.elapsedRealtimeNanos()): Boolean =
        nowElapsedNanos - elapsedRealtimeNanos < STALE_AFTER_NANOS

    fun toLocation(): Location = Location(LocationManager.GPS_PROVIDER).also {
        it.latitude = latitude
        it.longitude = longitude
        it.time = timeMs
        it.elapsedRealtimeNanos = elapsedRealtimeNanos
        altitudeM?.let { altitude -> it.altitude = altitude }
        accuracyM?.let { accuracy -> it.accuracy = accuracy }
        speedMps?.let { speed -> it.speed = speed }
        bearingDeg?.let { bearing -> it.bearing = bearing }
    }

    companion object {
        private const val STALE_AFTER_NANOS = 5_000_000_000L

        fun from(location: Location) = GpsFix(
            latitude = location.latitude,
            longitude = location.longitude,
            speedMps = if (location.hasSpeed()) location.speed else null,
            bearingDeg = if (location.hasBearing()) location.bearing else null,
            accuracyM = if (location.hasAccuracy()) location.accuracy else null,
            altitudeM = if (location.hasAltitude()) location.altitude else null,
            timeMs = location.time,
            elapsedRealtimeNanos = location.elapsedRealtimeNanos,
        )
    }
}

/** 1 Hz GPS fixes for the speed readout, burned-in overlay and per-clip track. */
class LocationTracker(private val context: Context) {
    private val manager: LocationManager? = context.getSystemService(LocationManager::class.java)
    private val _fix = MutableStateFlow<GpsFix?>(null)
    val fix: StateFlow<GpsFix?> = _fix.asStateFlow()
    private var listener: LocationListenerCompat? = null

    val isRunning: Boolean get() = listener != null

    fun hasPermission(): Boolean = hasFine() || hasCoarse()

    private fun hasFine() = ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED

    private fun hasCoarse() = ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_COARSE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        if (listener != null) return true
        val lm = manager ?: return false
        val provider = when {
            hasFine() && lm.allProviders.contains(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            hasCoarse() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                lm.allProviders.contains(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
            hasCoarse() && lm.allProviders.contains(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> return false
        }
        val newListener = LocationListenerCompat { location -> _fix.value = GpsFix.from(location) }
        val request = LocationRequestCompat.Builder(UPDATE_INTERVAL_MS)
            .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
            .setMinUpdateIntervalMillis(UPDATE_INTERVAL_MS / 2)
            .build()
        return try {
            LocationManagerCompat.requestLocationUpdates(
                lm, provider, request, ContextCompat.getMainExecutor(context), newListener,
            )
            listener = newListener
            val last = lm.getLastKnownLocation(provider)
            if (last != null && _fix.value == null) _fix.value = GpsFix.from(last)
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "Location permission revoked", e)
            false
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Location provider $provider unavailable", e)
            false
        }
    }

    @SuppressLint("MissingPermission") // Removing updates needs no permission check of its own.
    fun stop() {
        val current = listener ?: return
        manager?.let { lm -> runCatching { LocationManagerCompat.removeUpdates(lm, current) } }
        listener = null
    }

    private companion object {
        const val TAG = "LocationTracker"
        const val UPDATE_INTERVAL_MS = 1_000L
    }
}
