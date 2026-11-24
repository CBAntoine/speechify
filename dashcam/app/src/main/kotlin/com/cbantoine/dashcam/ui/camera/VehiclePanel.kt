package com.cbantoine.dashcam.ui.camera

import android.graphics.Bitmap
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.scanner.IdentifyProblem
import com.cbantoine.dashcam.scanner.IdentityState
import com.cbantoine.dashcam.scanner.RecallsState
import com.cbantoine.dashcam.scanner.VehicleIdentity
import com.cbantoine.dashcam.scanner.VehicleKind
import com.cbantoine.dashcam.scanner.VehicleView
import com.cbantoine.dashcam.ui.theme.DashcamPalette
import com.cbantoine.dashcam.ui.theme.HudNumbers
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.roundToInt

private val PlateInk = Color(0xFF1B3A7A)
private val Label = Color.White.copy(alpha = 0.6f)

/** The Scan toggle in the HUD. Reads "PLATE SCAN · LIVE" while the scanner runs. */
@Composable
fun ScanChip(active: Boolean, slowed: Boolean, onClick: () -> Unit) {
    val description = stringResource(if (active) R.string.action_scan_off else R.string.action_scan_on)
    val transition = rememberInfiniteTransition(label = "scan")
    val pulse by transition.animateFloat(1f, 0.25f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "scanDot")
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        color = if (active) DashcamPalette.Amber else DashcamPalette.Hud,
        border = if (active) null else BorderStroke(1.dp, DashcamPalette.HudOutline),
        modifier = Modifier.semantics { contentDescription = description },
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            val ink = if (active) Color.Black else Color.White
            if (active) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = pulse)),
                )
            } else {
                Icon(Icons.Filled.DirectionsCar, contentDescription = null, tint = ink, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.width(6.dp))
            Text(
                stringResource(
                    when {
                        !active -> R.string.scan_chip
                        slowed -> R.string.scan_chip_hot
                        else -> R.string.scan_chip_live
                    },
                ),
                color = ink,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/** Everything known about the focused vehicle, laid out like a spec sheet. */
@Composable
fun VehiclePanel(
    vehicle: VehicleView,
    hasApiKey: Boolean,
    onIdentify: () -> Unit,
    onOpenSettings: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .clip(shape)
            .background(DashcamPalette.HudStrong)
            .border(1.dp, DashcamPalette.HudOutline, shape)
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Thumbnail(vehicle.thumbnail, width = 104.dp, height = 70.dp)
            Spacer(Modifier.width(12.dp))
            PlateBlock(vehicle, Modifier.weight(1f))
            IconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.close), tint = Label)
            }
        }

        SectionTitle(R.string.profile_title)
        val identity = (vehicle.identity as? IdentityState.Ready)?.identity
        Text(
            identity?.title ?: vehicleDescription(vehicle),
            color = Color.White,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        IdentityStatus(vehicle.identity, hasApiKey, vehicle.canIdentify, onIdentify, onOpenSettings)
        Spacer(Modifier.height(6.dp))
        val unknown = stringResource(R.string.unknown_value)
        ProfileRow(R.string.profile_year, identity?.yearsLabel ?: unknown)
        identity?.generation?.takeIf { it.isNotBlank() }?.let { ProfileRow(R.string.profile_generation, it) }
        ProfileRow(R.string.profile_body, identity?.bodyStyle?.takeIf { it.isNotBlank() } ?: vehicle.kind.label())
        ProfileRow(R.string.profile_colour, vehicle.colour?.label ?: unknown, swatch = vehicle.colour?.let { Color(it.swatch) })
        ProfileRow(R.string.profile_specs, identity?.specsLabel ?: unknown)
        if (identity?.specsLabel != null) Caption(stringResource(R.string.profile_typical))

        SectionTitle(R.string.public_title)
        PublicData(identity, vehicle.recalls)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = DashcamPalette.Amber, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.vin_needed), color = Color.White, style = MaterialTheme.typography.labelLarge)
        }
        Caption(stringResource(R.string.vin_needed_detail))
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.Lock, contentDescription = null, tint = Label, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Caption(stringResource(R.string.scan_privacy))
        }
    }
}

@Composable
private fun PlateBlock(vehicle: VehicleView, modifier: Modifier) {
    Column(modifier) {
        Text(
            vehicle.region ?: stringResource(R.string.plate_label),
            color = Label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
        val plate = vehicle.plate
        if (plate != null) {
            Spacer(Modifier.height(2.dp))
            Text(
                plate.text,
                color = PlateInk,
                style = HudNumbers.copy(fontSize = 22.sp, lineHeight = 24.sp),
                fontWeight = FontWeight.Black,
                maxLines = 1,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color.White)
                    .border(2.dp, PlateInk, RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.plate_read, (plate.confidence * 100).roundToInt()),
                color = DashcamPalette.Ok,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        } else {
            Text(stringResource(R.string.plate_none), color = Color.White, style = MaterialTheme.typography.bodyMedium)
            Caption(stringResource(R.string.plate_hint))
        }
    }
}

@Composable
private fun IdentityStatus(
    state: IdentityState,
    hasApiKey: Boolean,
    canIdentify: Boolean,
    onIdentify: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    when (state) {
        IdentityState.Loading -> Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(14.dp), color = DashcamPalette.Amber, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
            Caption(stringResource(R.string.identifying))
        }
        is IdentityState.Ready -> {
            val confidence = when (state.identity.confidence) {
                "high" -> R.string.confidence_high
                "medium" -> R.string.confidence_medium
                else -> R.string.confidence_low
            }
            val evidence = state.identity.evidence.takeIf { it.isNotBlank() }
            Caption(listOfNotNull(stringResource(confidence), evidence).joinToString(" · "))
        }
        IdentityState.None -> when {
            !hasApiKey -> {
                Caption(stringResource(R.string.identify_needs_key))
                PanelAction(stringResource(R.string.action_settings), onOpenSettings)
            }
            canIdentify -> PanelAction(stringResource(R.string.identify), onIdentify)
            else -> Caption(stringResource(R.string.identify_too_far))
        }
        is IdentityState.Failed -> {
            val message = when (state.problem) {
                IdentifyProblem.NO_KEY -> stringResource(R.string.identify_needs_key)
                IdentifyProblem.INVALID_KEY -> stringResource(R.string.identify_invalid_key)
                IdentifyProblem.OFFLINE -> stringResource(R.string.identify_offline)
                IdentifyProblem.RATE_LIMITED -> stringResource(R.string.identify_rate_limited)
                IdentifyProblem.REFUSED -> stringResource(R.string.identify_refused)
                IdentifyProblem.NOT_A_VEHICLE -> stringResource(R.string.identify_not_vehicle)
                IdentifyProblem.FAILED -> stringResource(R.string.identify_failed, state.detail.orEmpty())
            }
            Caption(message, color = DashcamPalette.Amber)
            if (state.problem == IdentifyProblem.NO_KEY || state.problem == IdentifyProblem.INVALID_KEY) {
                PanelAction(stringResource(R.string.action_settings), onOpenSettings)
            } else if (canIdentify) {
                PanelAction(stringResource(R.string.identify_retry), onIdentify)
            }
        }
    }
}

@Composable
private fun PublicData(identity: VehicleIdentity?, recalls: RecallsState) {
    val uriHandler = LocalUriHandler.current
    val country = LocalConfiguration.current.locales[0].country
    val query = identity?.let { stringResource(R.string.specs_search_query, it.yearsLabel.orEmpty(), it.title).trim() }
    LinkRow(stringResource(R.string.public_specs), enabled = query != null) {
        query?.let { uriHandler.openUri("https://www.google.com/search?q=" + URLEncoder.encode(it, "UTF-8")) }
    }
    LinkRow(stringResource(R.string.public_recalls), enabled = true) {
        // Canadian recalls are Transport Canada's; elsewhere the US database is the closest match.
        uriHandler.openUri(if (country == "CA") TRANSPORT_CANADA_RECALLS else NHTSA_RECALLS)
    }
    if (identity != null) {
        val model = listOfNotNull(identity.yearsLabel, identity.title).joinToString(" ")
        when (recalls) {
            RecallsState.Loading -> Caption(stringResource(R.string.recalls_loading))
            RecallsState.Failed -> Caption(stringResource(R.string.recalls_failed))
            is RecallsState.Ready -> {
                val summary = recalls.summary
                if (summary.count == 0) {
                    Caption(stringResource(R.string.recalls_none, model))
                } else {
                    Caption(
                        pluralStringResource(R.plurals.recalls_count, summary.count, summary.count, model),
                        color = DashcamPalette.Amber,
                    )
                    summary.items.take(3).forEach { recall ->
                        Text(
                            "• " + recall.component.ifBlank { recall.campaign }.lowercase(Locale.ROOT)
                                .replaceFirstChar { it.titlecase(Locale.ROOT) },
                            color = Color.White.copy(alpha = 0.8f),
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            RecallsState.None -> Unit
        }
    }
}

/** Recently tracked vehicles; tap one to show it in the panel. */
@Composable
fun TrackedStrip(vehicles: List<VehicleView>, focusedId: Int?, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(DashcamPalette.Hud)
            .padding(8.dp),
    ) {
        Text(
            pluralStringResource(R.plurals.tracked_count, vehicles.size, vehicles.size),
            color = Label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
        )
        Spacer(Modifier.height(6.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(vehicles, key = { it.id }) { vehicle ->
                val focused = vehicle.id == focusedId
                Column(
                    Modifier
                        .width(78.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .border(
                            if (focused) 2.dp else 1.dp,
                            if (focused) DashcamPalette.Amber else DashcamPalette.HudOutline,
                            RoundedCornerShape(8.dp),
                        )
                        .clickable(role = Role.Button) { onSelect(vehicle.id) },
                ) {
                    Thumbnail(vehicle.thumbnail, width = 78.dp, height = 46.dp, rounded = false)
                    Text(
                        vehicle.plate?.text ?: vehicleDescription(vehicle),
                        color = if (vehicle.box != null) Color.White else Label,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 3.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun Thumbnail(bitmap: Bitmap?, width: Dp, height: Dp, rounded: Boolean = true) {
    val shape = RoundedCornerShape(if (rounded) 8.dp else 0.dp)
    val image = remember(bitmap) { bitmap?.asImageBitmap() }
    Box(
        Modifier
            .size(width, height)
            .clip(shape)
            .background(Color.White.copy(alpha = 0.08f)),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) {
            Image(image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(width, height))
        } else {
            Icon(Icons.Filled.DirectionsCar, contentDescription = null, tint = Label)
        }
    }
}

@Composable
private fun SectionTitle(text: Int) {
    Text(
        stringResource(text),
        color = DashcamPalette.Amber,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Black,
        letterSpacing = 1.5.sp,
        modifier = Modifier.padding(top = 14.dp, bottom = 4.dp),
    )
}

@Composable
private fun ProfileRow(label: Int, value: String, swatch: Color? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(label),
            color = Label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.width(96.dp),
        )
        if (swatch != null) {
            Box(
                Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(swatch)
                    .border(1.dp, Color.White.copy(alpha = 0.5f), CircleShape),
            )
            Spacer(Modifier.width(6.dp))
        }
        Text(value, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun LinkRow(text: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = if (enabled) Color.White else Color.White.copy(alpha = 0.4f)
        Text(text, color = color, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun PanelAction(text: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 0.dp)) {
        Text(text, color = DashcamPalette.Amber, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Caption(text: String, color: Color = Label) {
    Text(text, color = color, style = MaterialTheme.typography.bodySmall)
}

@Composable
internal fun VehicleKind.label(): String = stringResource(
    when (this) {
        VehicleKind.CAR -> R.string.vehicle_car
        VehicleKind.TRUCK -> R.string.vehicle_truck
        VehicleKind.BUS -> R.string.vehicle_bus
        VehicleKind.MOTORCYCLE -> R.string.vehicle_motorcycle
    },
)

/** "Silver car", or just "Car" before the colour is known. */
@Composable
internal fun vehicleDescription(vehicle: VehicleView): String {
    val kind = vehicle.kind.label()
    val colour = vehicle.colour ?: return kind
    return stringResource(R.string.vehicle_label, colour.label, kind.lowercase(LocalConfiguration.current.locales[0]))
}

private const val TRANSPORT_CANADA_RECALLS =
    "https://tc.canada.ca/en/road-transportation/defects-recalls-vehicles-tires-child-car-seats"
private const val NHTSA_RECALLS = "https://www.nhtsa.gov/recalls"
