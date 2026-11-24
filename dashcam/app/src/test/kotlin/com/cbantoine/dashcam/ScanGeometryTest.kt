package com.cbantoine.dashcam

import com.cbantoine.dashcam.scanner.Detection
import com.cbantoine.dashcam.scanner.DetectionMerge
import com.cbantoine.dashcam.scanner.DetectionTiles
import com.cbantoine.dashcam.scanner.NormBox
import com.cbantoine.dashcam.scanner.Tile
import com.cbantoine.dashcam.scanner.VehicleKind
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class ScanGeometryTest {
    @Test
    fun overlapMeasures() {
        val a = NormBox(0f, 0f, 0.5f, 0.5f)
        assertThat(a.iou(a)).isWithin(1e-6f).of(1f)
        assertThat(a.iou(NormBox(0.6f, 0.6f, 0.9f, 0.9f))).isEqualTo(0f)
        val inner = NormBox(0.1f, 0.1f, 0.2f, 0.2f)
        assertThat(a.overlapOfSmaller(inner)).isWithin(1e-6f).of(1f)
        assertThat(a.iou(inner)).isWithin(1e-6f).of(0.04f)
    }

    @Test
    fun relativeAndAbsoluteAreInverses() {
        val vehicle = NormBox(0.2f, 0.3f, 0.6f, 0.7f)
        val plate = NormBox(0.35f, 0.6f, 0.45f, 0.65f)
        val relative = vehicle.relative(plate)
        assertThat(relative.left).isWithin(1e-5f).of(0.375f)
        assertThat(relative.top).isWithin(1e-5f).of(0.75f)
        val back = vehicle.absolute(relative)
        assertThat(back.left).isWithin(1e-5f).of(plate.left)
        assertThat(back.bottom).isWithin(1e-5f).of(plate.bottom)
    }

    @Test
    fun wideFrameGetsTwoSquareTilesAtTheEnds() {
        val tiles = DetectionTiles.forFrame(1920, 1080)
        assertThat(tiles).containsExactly(Tile(0f, 0f, 1080f, 1080f), Tile(840f, 0f, 1080f, 1080f)).inOrder()
    }

    @Test
    fun tallFrameTilesVertically() {
        val tiles = DetectionTiles.forFrame(1080, 1920)
        assertThat(tiles.map { it.top }).containsExactly(0f, 840f).inOrder()
        assertThat(tiles.all { it.width == 1080f && it.height == 1080f }).isTrue()
    }

    @Test
    fun nearlySquareFrameIsOneTile() {
        assertThat(DetectionTiles.forFrame(1200, 1000)).containsExactly(Tile(0f, 0f, 1200f, 1000f))
    }

    @Test
    fun tileBoxesMapBackToTheFrame() {
        val box = Tile(840f, 0f, 1080f, 1080f).toFrame(NormBox(0f, 0.5f, 1f, 1f), 1920f, 1080f)
        assertThat(box.left).isWithin(1e-5f).of(840f / 1920f)
        assertThat(box.right).isWithin(1e-5f).of(1f)
        assertThat(box.top).isWithin(1e-5f).of(0.5f)
    }

    @Test
    fun carCutAtTheSeamIsMergedIntoOne() {
        // The left tile ends at x = 1080 / 1920 = 0.5625 and only sees part of the car.
        val cut = Detection(NormBox(0.48f, 0.4f, 0.5625f, 0.7f), VehicleKind.CAR, 0.7f, tile = 0)
        val whole = Detection(NormBox(0.48f, 0.4f, 0.62f, 0.7f), VehicleKind.CAR, 0.8f, tile = 1)
        val merged = DetectionMerge.merge(listOf(cut, whole))
        assertThat(merged).hasSize(1)
        assertThat(merged.single().box).isEqualTo(NormBox(0.48f, 0.4f, 0.62f, 0.7f))
    }

    @Test
    fun neighbouringCarsStaySeparate() {
        val left = Detection(NormBox(0.1f, 0.4f, 0.3f, 0.6f), VehicleKind.CAR, 0.8f)
        val right = Detection(NormBox(0.31f, 0.4f, 0.5f, 0.6f), VehicleKind.CAR, 0.7f)
        assertThat(DetectionMerge.merge(listOf(left, right))).hasSize(2)
    }

    @Test
    fun carAndTruckOnTheSameVehicleBecomeOne() {
        val car = Detection(NormBox(0.1f, 0.4f, 0.3f, 0.6f), VehicleKind.CAR, 0.8f)
        val truck = Detection(NormBox(0.11f, 0.41f, 0.3f, 0.6f), VehicleKind.TRUCK, 0.5f)
        val merged = DetectionMerge.merge(listOf(truck, car))
        assertThat(merged).hasSize(1)
        assertThat(merged.single().kind).isEqualTo(VehicleKind.CAR)
    }

    @Test
    fun cocoIndicesMapToVehicleKinds() {
        assertThat(VehicleKind.fromCocoIndex(2)).isEqualTo(VehicleKind.CAR)
        assertThat(VehicleKind.fromCocoIndex(3)).isEqualTo(VehicleKind.MOTORCYCLE)
        assertThat(VehicleKind.fromCocoIndex(5)).isEqualTo(VehicleKind.BUS)
        assertThat(VehicleKind.fromCocoIndex(7)).isEqualTo(VehicleKind.TRUCK)
        assertThat(VehicleKind.fromCocoIndex(0)).isNull() // person
    }
}
