package com.cbantoine.dashcam.ui.library

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.outlined.RemoveModerator
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import coil3.video.videoFrameMillis
import com.cbantoine.dashcam.R
import com.cbantoine.dashcam.appGraph
import com.cbantoine.dashcam.storage.Clip
import com.cbantoine.dashcam.storage.StorageStats
import com.cbantoine.dashcam.ui.ClipActions
import com.cbantoine.dashcam.ui.DeleteClipDialog
import com.cbantoine.dashcam.ui.Formatting
import com.cbantoine.dashcam.ui.theme.DashcamPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(onBack: () -> Unit, onOpenClip: (Clip) -> Unit) {
    val context = LocalContext.current
    val graph = context.appGraph
    val viewModel: LibraryViewModel = viewModel { LibraryViewModel(graph.clipRepository, graph.recorderState) }
    val ui by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val savedText = stringResource(R.string.saved_to_gallery)
    val failedText = stringResource(R.string.save_failed)
    var pendingDelete by remember { mutableStateOf<Clip?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is LibraryViewModel.Event.SavedToGallery ->
                    snackbar.showSnackbar(if (event.success) savedText else failedText)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.library_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 280.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = padding.calculateTopPadding() + 4.dp,
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) { StorageCard(ui.stats) }
            item(span = { GridItemSpan(maxLineSpan) }) { FilterRow(ui.filter, viewModel::setFilter) }
            when {
                ui.loading -> item(span = { GridItemSpan(maxLineSpan) }) {
                    Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
                ui.groups.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(filtered = ui.totalClips > 0)
                }
                else -> ui.groups.forEach { group ->
                    item(key = "day-${group.day}", span = { GridItemSpan(maxLineSpan) }) {
                        Text(
                            Formatting.day(group.day, stringResource(R.string.today), stringResource(R.string.yesterday)),
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                    items(group.items, key = { it.clip.path }) { item ->
                        ClipCard(
                            item = item,
                            onClick = { onOpenClip(item.clip) },
                            onProtect = { viewModel.protect(item.clip) },
                            onUnprotect = { viewModel.unprotect(item.clip) },
                            onSaveToGallery = { viewModel.saveToGallery(item.clip) },
                            onShare = { ClipActions.share(context, item.clip) },
                            onDelete = { pendingDelete = item.clip },
                        )
                    }
                }
            }
        }
    }

    pendingDelete?.let { clip ->
        DeleteClipDialog(
            onConfirm = {
                viewModel.delete(clip)
                pendingDelete = null
            },
            onDismiss = { pendingDelete = null },
        )
    }
}

@Composable
private fun StorageCard(stats: StorageStats?) {
    val context = LocalContext.current
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
        Column(Modifier.padding(16.dp)) {
            if (stats == null) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                return@Column
            }
            val loopFraction = if (stats.loopBudgetBytes > 0) {
                (stats.loopBytes.toFloat() / stats.loopBudgetBytes).coerceIn(0f, 1f)
            } else {
                0f
            }
            Text(
                stringResource(
                    R.string.storage_loop,
                    Formatting.bytes(context, stats.loopBytes),
                    Formatting.bytes(context, stats.loopBudgetBytes),
                ),
                style = MaterialTheme.typography.titleSmall,
            )
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { loopFraction },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(50)),
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    stringResource(R.string.storage_protected, Formatting.bytes(context, stats.protectedBytes)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    stringResource(R.string.storage_free, Formatting.bytes(context, stats.freeBytes)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun FilterRow(selected: LibraryViewModel.Filter, onSelect: (LibraryViewModel.Filter) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            LibraryViewModel.Filter.ALL to R.string.filter_all,
            LibraryViewModel.Filter.PROTECTED to R.string.filter_protected,
            LibraryViewModel.Filter.IMPACTS to R.string.filter_impacts,
        ).forEach { (filter, label) ->
            FilterChip(
                selected = selected == filter,
                onClick = { onSelect(filter) },
                label = { Text(stringResource(label)) },
            )
        }
    }
}

@Composable
private fun EmptyState(filtered: Boolean) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 56.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.VideocamOff,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(if (filtered) R.string.empty_filtered else R.string.empty_clips_title),
            style = MaterialTheme.typography.titleMedium,
        )
        if (!filtered) {
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.empty_clips_text),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ClipCard(
    item: LibraryViewModel.ClipItem,
    onClick: () -> Unit,
    onProtect: () -> Unit,
    onUnprotect: () -> Unit,
    onSaveToGallery: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
) {
    val clip = item.clip
    val context = LocalContext.current
    var menuOpen by remember { mutableStateOf(false) }
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(Color.Black),
        ) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(clip.file)
                    .videoFrameMillis(1_000)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Row(
                Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (clip.isProtected) Badge(Icons.Filled.Shield, stringResource(R.string.badge_protected), DashcamPalette.Amber)
                if (clip.hasImpact) Badge(Icons.Filled.Bolt, stringResource(R.string.badge_impact), DashcamPalette.Rec)
            }
            Text(
                Formatting.elapsed(clip.durationMs),
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(8.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(DashcamPalette.Hud)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        Row(
            Modifier.padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    "${Formatting.time(clip.startedAtMs)} – ${Formatting.time(clip.endedAtMs)}",
                    style = MaterialTheme.typography.titleSmall,
                )
                val inGallery = stringResource(R.string.badge_in_gallery)
                val details = buildList {
                    add(Formatting.bytes(context, clip.sizeBytes))
                    if (item.inGallery) add(inGallery)
                }.joinToString(" · ")
                Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.action_more))
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (clip.isProtected) {
                        MenuItem(Icons.Outlined.RemoveModerator, stringResource(R.string.action_unprotect)) {
                            menuOpen = false
                            onUnprotect()
                        }
                    } else {
                        MenuItem(Icons.Outlined.Shield, stringResource(R.string.action_protect)) {
                            menuOpen = false
                            onProtect()
                        }
                    }
                    MenuItem(Icons.Filled.PhotoLibrary, stringResource(R.string.action_save_to_gallery)) {
                        menuOpen = false
                        onSaveToGallery()
                    }
                    MenuItem(Icons.Filled.Share, stringResource(R.string.action_share)) {
                        menuOpen = false
                        onShare()
                    }
                    MenuItem(Icons.Filled.Delete, stringResource(R.string.action_delete)) {
                        menuOpen = false
                        onDelete()
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuItem(icon: ImageVector, label: String, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        onClick = onClick,
    )
}

@Composable
private fun Badge(icon: ImageVector, label: String, color: Color) {
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(DashcamPalette.HudStrong)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.labelSmall)
    }
}
