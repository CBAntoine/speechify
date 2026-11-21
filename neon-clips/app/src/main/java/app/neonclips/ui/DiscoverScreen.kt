package app.neonclips.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.neonclips.Graph
import app.neonclips.Nav
import app.neonclips.core.Discover
import app.neonclips.core.Fmt
import app.neonclips.core.Length
import app.neonclips.core.TimeWindow
import app.neonclips.core.VideoHit
import app.neonclips.source.SourceException
import coil3.compose.AsyncImage
import kotlinx.coroutines.CancellationException

private sealed interface Results {
    data object Idle : Results
    data object Loading : Results
    data class Loaded(val hits: List<VideoHit>) : Results
    data class Failed(val message: String) : Results
}

/** Keeps the last result of each search so coming back to the screen does not search again. */
private object SearchCache {
    val hits = HashMap<Triple<String, TimeWindow, Length>, List<VideoHit>>()
}

private val PRESETS = listOf(
    "GTA 6", "GTA 6 gameplay", "GTA 6 funny moments", "IShowSpeed GTA 6", "Kai Cenat GTA 6", "GTA 6 trailer reaction",
)

@Composable
fun DiscoverScreen(nav: Nav) {
    val settings = Graph.settings
    val focus = LocalFocusManager.current
    var query by remember { mutableStateOf(settings.lastQuery) }
    var searched by remember { mutableStateOf(settings.lastQuery) }
    var window by remember { mutableStateOf(TimeWindow.WEEK) }
    var length by remember { mutableStateOf(Length.ANY) }
    var sort by remember { mutableStateOf(Discover.Sort.VIEWS) }
    var results by remember { mutableStateOf<Results>(Results.Idle) }
    var attempt by remember { mutableIntStateOf(0) }

    fun search(text: String = query) {
        val q = text.trim()
        if (q.isEmpty()) return
        query = q
        searched = q
        settings.lastQuery = q
        focus.clearFocus()
        attempt++
    }

    LaunchedEffect(searched, window, length, attempt) {
        if (searched.isBlank()) return@LaunchedEffect
        val key = Triple(searched, window, length)
        SearchCache.hits[key]?.let {
            results = Results.Loaded(it)
            return@LaunchedEffect
        }
        results = Results.Loading
        results = try {
            val hits = Graph.ytDlp.search(searched, window, length)
            SearchCache.hits[key] = hits
            Results.Loaded(hits)
        } catch (e: CancellationException) {
            throw e
        } catch (e: SourceException) {
            Results.Failed(e.message ?: "Search failed.")
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("01 / Find", "Top videos", onBack = { nav.pop() })
        Column(Modifier.padding(ScreenPadding), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Field(query, { query = it }, "Search a game, streamer or topic", Modifier.weight(1f), imeAction = ImeAction.Search, onDone = { search() }, resetKey = attempt)
                HotButton("Search", { search() }, enabled = query.isNotBlank())
            }
            ScrollRow {
                PRESETS.forEach { p -> Chip(p, searched.equals(p, ignoreCase = true), { search(p) }, color = Neon.Peach) }
            }
            ScrollRow {
                TimeWindow.entries.forEach { w -> Chip(w.label, window == w, { window = w }) }
            }
            ScrollRow {
                Discover.Sort.entries.forEach { s -> Chip(s.label, sort == s, { sort = s }, color = Neon.Hot) }
                Box(Modifier.width(1.dp).height(20.dp).background(Neon.Line))
                Length.entries.forEach { l -> Chip(l.label, length == l, { length = l }, color = Neon.Lilac) }
            }
        }
        Spacer(Modifier.height(8.dp))

        when (val r = results) {
            Results.Idle -> Notice("Search for something to see what is getting views.")
            Results.Loading -> Column(Modifier.padding(ScreenPadding)) {
                ProgressLine(null)
                Spacer(Modifier.height(10.dp))
                Body("Searching. The first search after installing takes a little longer while the downloader unpacks.")
            }
            is Results.Failed -> Column(Modifier.padding(ScreenPadding), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Body(r.message, color = Neon.Peach)
                LineButton("Try again", { attempt++ })
            }
            is Results.Loaded -> {
                val now = remember(r) { System.currentTimeMillis() / 1000 }
                val ranked = remember(r, sort) { Discover.rank(r.hits, sort, now) }
                if (ranked.isEmpty()) {
                    Notice("No videos matched. Try a wider time window.")
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(ranked.size, key = { ranked[it].id }) { i ->
                            HitRow(i + 1, ranked[i], now) { nav.importing = ranked[i] }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Notice(text: String) = Body(text, Modifier.padding(ScreenPadding))

@Composable
fun ScrollRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

@Composable
private fun HitRow(rank: Int, hit: VideoHit, nowSec: Long, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Neon.Shape)
            .background(Neon.Panel)
            .border(1.dp, Neon.Line, Neon.Shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(8.dp)
    ) {
        Box(Modifier.width(132.dp).aspectRatio(16f / 9f).clip(Neon.Shape).background(Neon.Ink)) {
            AsyncImage(hit.thumbnail, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            Tag(rank.toString().padStart(2, '0'), Neon.Hot, Modifier.align(Alignment.TopStart).padding(4.dp))
            hit.durationSec?.let {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(4.dp).clip(RoundedCornerShape(3.dp))
                        .background(Color(0xCC000000)).padding(horizontal = 4.dp, vertical = 1.dp)
                ) { Label(Fmt.clock(it * 1000), color = Neon.Text, size = 9.sp) }
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Body(hit.title, color = Neon.Text, size = 13.sp, maxLines = 3)
            Spacer(Modifier.height(4.dp))
            Label(hit.channel, color = Neon.Dim)
            Spacer(Modifier.height(2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Label(Fmt.count(hit.views) + " views", color = Neon.Text, bold = true)
                Label(Fmt.age(hit.publishedAtSec, nowSec), color = Neon.Faint)
            }
            Discover.velocity(hit, nowSec)?.let { v ->
                Label("+" + Fmt.count(v.toLong()) + " / hour" + if (hit.wasLive) "  ·  stream" else "", color = Neon.Mint)
            }
        }
    }
}
