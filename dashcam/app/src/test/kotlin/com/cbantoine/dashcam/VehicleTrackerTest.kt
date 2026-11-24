package com.cbantoine.dashcam

import com.cbantoine.dashcam.scanner.Detection
import com.cbantoine.dashcam.scanner.NormBox
import com.cbantoine.dashcam.scanner.VehicleKind
import com.cbantoine.dashcam.scanner.VehicleTracker
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class VehicleTrackerTest {
    private fun car(left: Float, top: Float = 0.4f, size: Float = 0.2f, kind: VehicleKind = VehicleKind.CAR) =
        Detection(NormBox(left, top, left + size, top + size * 0.6f), kind, 0.8f)

    @Test
    fun vehicleKeepsItsIdAndIsConfirmedOnTheSecondHit() {
        val tracker = VehicleTracker()
        tracker.update(listOf(car(0.30f)), nowMs = 0)
        val first = tracker.active.single()
        assertThat(first.confirmed).isFalse()
        tracker.update(listOf(car(0.32f)), nowMs = 150)
        val second = tracker.active.single()
        assertThat(second.id).isEqualTo(first.id)
        assertThat(second.confirmed).isTrue()
        // The display box is smoothed; the raw box is exactly the latest detection.
        assertThat(second.box.left).isGreaterThan(0.30f)
        assertThat(second.box.left).isLessThan(0.32f)
        assertThat(second.rawBox.left).isEqualTo(0.32f)
    }

    @Test
    fun separateVehiclesGetSeparateIds() {
        val tracker = VehicleTracker()
        tracker.update(listOf(car(0.1f), car(0.6f)), nowMs = 0)
        assertThat(tracker.active.map { it.id }.toSet()).hasSize(2)
    }

    @Test
    fun fastMoverIsMatchedByProximity() {
        val tracker = VehicleTracker()
        tracker.update(listOf(car(0.30f)), nowMs = 0)
        // Moved by most of its width between passes: the boxes barely overlap (IoU about 0.08).
        tracker.update(listOf(car(0.47f)), nowMs = 150)
        assertThat(tracker.active).hasSize(1)
        assertThat(tracker.active.single().hits).isEqualTo(2)
    }

    @Test
    fun lostVehicleIsDroppedAfterItsMaxAge() {
        val tracker = VehicleTracker(maxAgeMs = 1_500)
        tracker.update(listOf(car(0.3f)), nowMs = 0)
        tracker.update(listOf(car(0.3f)), nowMs = 100)
        assertThat(tracker.update(emptyList(), nowMs = 1_000)).isEmpty()
        val dropped = tracker.update(emptyList(), nowMs = 1_700)
        assertThat(dropped).hasSize(1)
        assertThat(tracker.active).isEmpty()
    }

    @Test
    fun oneOffFalsePositiveIsDroppedQuickly() {
        val tracker = VehicleTracker(tentativeMaxAgeMs = 500)
        tracker.update(listOf(car(0.3f)), nowMs = 0)
        assertThat(tracker.update(emptyList(), nowMs = 600)).hasSize(1)
    }

    @Test
    fun kindIsTheMajorityVote() {
        val tracker = VehicleTracker()
        tracker.update(listOf(car(0.3f, kind = VehicleKind.TRUCK)), nowMs = 0)
        tracker.update(listOf(car(0.3f)), nowMs = 100)
        tracker.update(listOf(car(0.3f)), nowMs = 200)
        assertThat(tracker.active.single().kind).isEqualTo(VehicleKind.CAR)
    }
}
