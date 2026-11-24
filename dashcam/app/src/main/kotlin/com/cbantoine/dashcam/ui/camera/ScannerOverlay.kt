package com.cbantoine.dashcam.ui.camera

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateValueAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.cbantoine.dashcam.scanner.ScannerState
import com.cbantoine.dashcam.scanner.VehicleView
import com.cbantoine.dashcam.ui.theme.DashcamPalette
import kotlin.math.min
import kotlin.math.roundToInt

private const val MAX_BOXES = 8

/**
 * Corner-bracket boxes over the vehicles the scanner is tracking, mapped onto the letterboxed
 * camera image. Only the small labels take taps, so tap-to-focus keeps working everywhere else.
 */
@Composable
fun ScannerOverlay(state: ScannerState, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier) {
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        val aspect = state.frameAspect.takeIf { it > 0f } ?: (16f / 9f)
        // The viewfinder fits the whole camera image inside the screen.
        val imageWidth = min(width, height * aspect)
        val imageHeight = imageWidth / aspect
        val left = (width - imageWidth) / 2f
        val top = (height - imageHeight) / 2f
        for (vehicle in state.vehicles.take(MAX_BOXES)) {
            val box = vehicle.box ?: continue
            key(vehicle.id) {
                VehicleMarker(
                    vehicle = vehicle,
                    target = Rect(
                        left + box.left * imageWidth,
                        top + box.top * imageHeight,
                        left + box.right * imageWidth,
                        top + box.bottom * imageHeight,
                    ),
                    focused = vehicle.id == state.focusedId,
                    onClick = { onSelect(vehicle.id) },
                )
            }
        }
    }
}

@Composable
private fun VehicleMarker(vehicle: VehicleView, target: Rect, focused: Boolean, onClick: () -> Unit) {
    // Detections arrive a few times a second; gliding between them reads as smooth tracking.
    val rect by animateValueAsState(target, Rect.VectorConverter, tween(160, easing = LinearEasing), label = "vehicleBox")
    val color = if (focused) DashcamPalette.Amber else Color.White.copy(alpha = 0.85f)
    Spacer(
        Modifier
            .layout { measurable, _ ->
                val r = rect
                val w = r.width.roundToInt().coerceAtLeast(1)
                val h = r.height.roundToInt().coerceAtLeast(1)
                val placeable = measurable.measure(Constraints.fixed(w, h))
                layout(placeable.width, placeable.height) {
                    placeable.place(r.left.roundToInt(), r.top.roundToInt())
                }
            }
            .drawBehind { brackets(color, filled = focused) },
    )
    Text(
        markerLabel(vehicle),
        color = if (focused) Color.Black else Color.White,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .layout { measurable, constraints ->
                val r = rect
                val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0, maxWidth = 220.dp.roundToPx()))
                val gap = 4.dp.roundToPx()
                val above = r.top.roundToInt() - placeable.height - gap
                layout(placeable.width, placeable.height) {
                    // Inside the box's top edge when there's no room above it.
                    placeable.place(r.left.roundToInt(), if (above >= 0) above else r.top.roundToInt() + gap)
                }
            }
            .clip(RoundedCornerShape(6.dp))
            .background(if (focused) DashcamPalette.Amber else DashcamPalette.HudStrong)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
private fun markerLabel(vehicle: VehicleView): String {
    vehicle.plate?.let { return it.text }
    return vehicleDescription(vehicle)
}

private fun DrawScope.brackets(color: Color, filled: Boolean) {
    val stroke = 2.5.dp.toPx()
    val arm = min(18.dp.toPx(), min(size.width, size.height) / 3f)
    if (filled) drawRect(color.copy(alpha = 0.10f))
    val w = size.width
    val h = size.height
    val path = Path().apply {
        moveTo(0f, arm); lineTo(0f, 0f); lineTo(arm, 0f)
        moveTo(w - arm, 0f); lineTo(w, 0f); lineTo(w, arm)
        moveTo(w, h - arm); lineTo(w, h); lineTo(w - arm, h)
        moveTo(arm, h); lineTo(0f, h); lineTo(0f, h - arm)
    }
    // A dark halo keeps the brackets visible against bright sky and white cars.
    drawPath(path, Color.Black.copy(alpha = 0.45f), style = Stroke(stroke * 2.2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawPath(path, color, style = Stroke(stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
    if (filled) drawCircle(color, radius = stroke, center = Offset(w / 2f, h / 2f))
}
