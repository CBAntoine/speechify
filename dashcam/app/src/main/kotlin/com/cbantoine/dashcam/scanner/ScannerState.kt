package com.cbantoine.dashcam.scanner

import android.graphics.Bitmap

enum class IdentifyProblem { NO_KEY, INVALID_KEY, OFFLINE, RATE_LIMITED, REFUSED, NOT_A_VEHICLE, FAILED }

sealed interface IdentityState {
    /** Not asked yet. */
    data object None : IdentityState
    data object Loading : IdentityState
    data class Ready(val identity: VehicleIdentity) : IdentityState
    data class Failed(val problem: IdentifyProblem, val detail: String? = null) : IdentityState
}

sealed interface RecallsState {
    data object None : RecallsState
    data object Loading : RecallsState
    data class Ready(val summary: RecallSummary) : RecallsState
    data object Failed : RecallsState
}

/** A snapshot of one tracked vehicle for the UI. Never mutated once published. */
data class VehicleView(
    val id: Int,
    /** Where it is in the frame now, or null once it is out of view. */
    val box: NormBox?,
    val kind: VehicleKind,
    val plate: PlateReading?,
    val region: String?,
    val colour: VehicleColour?,
    val thumbnail: Bitmap?,
    val identity: IdentityState,
    val recalls: RecallsState,
    val lastSeenMs: Long,
    /** A photo of it was kept, so it can be sent to Claude. */
    val canIdentify: Boolean,
)

data class ScannerState(
    val running: Boolean = false,
    /** The on-device detector couldn't load on this phone. */
    val unavailable: Boolean = false,
    /** Width over height of the upright frame the boxes are normalized to. */
    val frameAspect: Float = 16f / 9f,
    /** Vehicles in view, largest (closest) first. */
    val vehicles: List<VehicleView> = emptyList(),
    /** Everything tracked this session, most recently seen first. */
    val tracked: List<VehicleView> = emptyList(),
    /** The vehicle the profile panel describes: the one tapped, or else the closest one. */
    val focusedId: Int? = null,
    /** Fewer passes and no plate reading while the phone is hot. */
    val slowedForHeat: Boolean = false,
) {
    val focused: VehicleView? get() = focusedId?.let { id -> tracked.firstOrNull { it.id == id } }
}
