package app.neonclips.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.neonclips.Graph
import app.neonclips.Nav
import app.neonclips.core.Fmt
import app.neonclips.core.HeatPoint
import app.neonclips.core.Highlights
import app.neonclips.core.Moment
import app.neonclips.core.VideoHit
import app.neonclips.source.SourceException
import kotlinx.coroutines.CancellationException

private enum class Pick { MOMENTS, WHOLE, RANGE }

/** Whole-video downloads are offered up to this length; longer videos are clipped by section. */
private const val WHOLE_LIMIT_SEC = 25 * 60L

/** Extra footage fetched around a picked moment, so its start and end can be moved in the editor. */
private const val LEAD_SEC = 20L
private const val TAIL_SEC = 25L

/** Parses "1:02:03", "62:03" or "3723" into seconds. */
internal fun parseClock(text: String): Long? {
    val parts = text.trim().split(":").map { it.trim().toLongOrNull() ?: return null }
    if (parts.isEmpty() || parts.size > 3 || parts.any { it < 0 }) return null
    return parts.fold(0L) { acc, p -> acc * 60 + p }
}

/**
 * Options for bringing in a remote video: which stretch to fetch and at what quality. Long videos
 * are fetched by section, because a 20-hour stream does not belong on a phone.
 */
@Composable
fun ImportSheet(initial: VideoHit, nav: Nav) {
    var hit by remember { mutableStateOf(initial) }
    var heatmap by remember { mutableStateOf<List<HeatPoint>>(emptyList()) }
    var moments by remember { mutableStateOf<List<Moment>>(emptyList()) }
    var chosen by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var pick by remember { mutableStateOf(Pick.RANGE) }
    var from by remember { mutableStateOf("0:00") }
    var rangeSec by remember { mutableIntStateOf(120) }
    var height by remember { mutableIntStateOf(1080) }
    var attempt by remember { mutableIntStateOf(0) }

    val duration = hit.durationSec
    val wholeAllowed = duration != null && duration <= WHOLE_LIMIT_SEC

    LaunchedEffect(attempt) {
        loading = true
        error = null
        try {
            val info = Graph.ytDlp.info(initial.url)
            hit = info.hit.copy(
                thumbnail = info.hit.thumbnail ?: initial.thumbnail,
                publishedAtSec = info.hit.publishedAtSec ?: initial.publishedAtSec,
            )
            heatmap = info.heatmap
            moments = Highlights.fromHeatmap(info.heatmap, clipSec = 45, maxCount = 5).sortedBy { it.startMs }
            val best = moments.sortedByDescending { it.score }.take(3).map { moments.indexOf(it) }.toSet()
            chosen = best
            pick = when {
                moments.isNotEmpty() -> Pick.MOMENTS
                (info.hit.durationSec ?: Long.MAX_VALUE) <= WHOLE_LIMIT_SEC -> Pick.WHOLE
                else -> Pick.RANGE
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: SourceException) {
            error = e.message
            pick = if (wholeAllowed) Pick.WHOLE else Pick.RANGE
        }
        loading = false
    }

    val fromSec = parseClock(from)
    val rangeOk = fromSec != null && (duration == null || fromSec < duration)
    val ready = when (pick) {
        Pick.MOMENTS -> chosen.isNotEmpty()
        Pick.WHOLE -> wholeAllowed || duration == null
        Pick.RANGE -> rangeOk
    }

    fun start() {
        val ids = when (pick) {
            Pick.WHOLE -> listOf(Graph.imports.importRemote(hit, null, heatmap, height))
            Pick.RANGE -> {
                val a = fromSec ?: 0
                val z = (a + rangeSec).let { if (duration != null) minOf(it, duration) else it }
                listOf(Graph.imports.importRemote(hit, a..z, heatmap, height))
            }
            Pick.MOMENTS -> chosen.sorted().map { i ->
                val m = moments[i]
                val a = (m.startMs / 1000 - LEAD_SEC).coerceAtLeast(0)
                val z = (m.endMs / 1000 + TAIL_SEC).let { if (duration != null) minOf(it, duration) else it }
                Graph.imports.importRemote(hit, a..z, heatmap, height)
            }
        }
        Graph.settings.rightsNoticeSeen = true
        nav.importing = null
        nav.home()
        nav.openWhenReady = ids.singleOrNull()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xCC07030B))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { nav.importing = null },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                .background(Neon.PanelHi)
                .border(1.dp, Neon.Line, RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label("Clip this video", Modifier.weight(1f), color = Neon.Hot)
                IconButton(Glyph.Close, "Close", { nav.importing = null }, color = Neon.Dim)
            }
            Body(hit.title, color = Neon.Text, size = 15.sp, maxLines = 3)
            val facts = listOfNotNull(
                hit.channel.takeIf { it.isNotBlank() },
                hit.views?.let { Fmt.count(it) + " views" },
                duration?.let { Fmt.clock(it * 1000) },
            )
            if (facts.isNotEmpty()) Label(facts.joinToString("  ·  "))

            if (loading) {
                ProgressLine(null)
                Body("Reading the video and its most replayed moments.")
            }
            error?.let {
                Body(it, color = Neon.Peach)
                LineButton("Try again", { attempt++ })
            }

            if (!loading) {
                if (moments.isNotEmpty()) {
                    PickHeader("Most replayed", pick == Pick.MOMENTS) { pick = Pick.MOMENTS }
                    if (pick == Pick.MOMENTS) {
                        moments.forEachIndexed { i, m ->
                            MomentPick(i + 1, m, i in chosen) { chosen = if (i in chosen) chosen - i else chosen + i }
                        }
                        Body("Each pick is fetched with a little extra on both sides so you can move its start and end.", size = 12.sp)
                    }
                } else if (error == null) {
                    Body("This video has no replay data yet, so choose the part to fetch.", size = 12.sp)
                }

                if (wholeAllowed) {
                    PickHeader("Whole video  ·  ${Fmt.clock(duration * 1000)}", pick == Pick.WHOLE) { pick = Pick.WHOLE }
                }

                PickHeader("A part I choose", pick == Pick.RANGE) { pick = Pick.RANGE }
                if (pick == Pick.RANGE) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Label("From")
                        Field(from, { from = it }, "1:23:45", Modifier.width(110.dp))
                        Label("For")
                        listOf(60 to "1 min", 120 to "2 min", 300 to "5 min").forEach { (sec, label) ->
                            Chip(label, rangeSec == sec, { rangeSec = sec })
                        }
                    }
                    if (!rangeOk) Body("Enter a start time inside the video, like 12:30 or 1:05:00.", color = Neon.Peach, size = 12.sp)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label("Quality")
                    Chip("1080p", height == 1080, { height = 1080 }, color = Neon.Lilac)
                    Chip("720p  ·  faster", height == 720, { height = 720 }, color = Neon.Lilac)
                }

                Body(
                    "Clip videos you own or have the creator's permission to clip. You are responsible for what you post.",
                    color = Neon.Faint,
                    size = 11.sp,
                )
                val count = if (pick == Pick.MOMENTS) chosen.size else 1
                HotButton(
                    if (count > 1) "Fetch $count moments" else "Fetch and find clips",
                    { start() },
                    Modifier.fillMaxWidth(),
                    enabled = ready,
                )
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

@Composable
private fun PickHeader(text: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Neon.Shape)
            .border(1.dp, if (selected) Neon.Mint else Neon.Line, Neon.Shape)
            .background(if (selected) Neon.Mint.copy(alpha = 0.10f) else Color.Transparent)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.width(10.dp).height(10.dp).clip(RoundedCornerShape(5.dp))
                .background(if (selected) Neon.Mint else Color.Transparent)
                .border(1.dp, if (selected) Neon.Mint else Neon.Faint, RoundedCornerShape(5.dp))
        )
        Spacer(Modifier.width(10.dp))
        Label(text, color = if (selected) Neon.Mint else Neon.Text, size = 11.sp, bold = selected)
    }
}

@Composable
private fun MomentPick(rank: Int, moment: Moment, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Neon.Shape)
            .background(if (selected) Neon.Hot.copy(alpha = 0.14f) else Neon.Panel)
            .border(1.dp, if (selected) Neon.Hot else Neon.Line, Neon.Shape)
            .clickable(role = Role.Checkbox, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Label(rank.toString().padStart(2, '0'), color = if (selected) Neon.Hot else Neon.Faint, bold = true)
        Label(Fmt.clock(moment.startMs), Modifier.width(64.dp), color = Neon.Text, size = 12.sp, bold = true)
        Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Neon.Line)) {
            Box(Modifier.fillMaxWidth(moment.score / 100f).height(6.dp).background(if (selected) Neon.Hot else Neon.Dim))
        }
        Label(if (selected) "Picked" else "Skip", color = if (selected) Neon.Hot else Neon.Faint)
    }
}
