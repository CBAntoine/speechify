package com.cbantoine.dashcam.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cbantoine.dashcam.recording.RecorderStateHolder
import com.cbantoine.dashcam.storage.Clip
import com.cbantoine.dashcam.storage.ClipRepository
import com.cbantoine.dashcam.storage.StorageStats
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class LibraryViewModel(
    private val clips: ClipRepository,
    recorder: RecorderStateHolder,
) : ViewModel() {

    enum class Filter { ALL, PROTECTED, IMPACTS }

    data class ClipItem(val clip: Clip, val inGallery: Boolean)

    data class DayGroup(val day: LocalDate, val items: List<ClipItem>)

    data class UiState(
        val loading: Boolean = true,
        val filter: Filter = Filter.ALL,
        val groups: List<DayGroup> = emptyList(),
        val stats: StorageStats? = null,
        val totalClips: Int = 0,
    )

    sealed interface Event {
        data class SavedToGallery(val success: Boolean) : Event
    }

    private val filter = MutableStateFlow(Filter.ALL)
    private val snapshot = MutableStateFlow<Pair<List<Clip>, StorageStats>?>(null)
    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 4)
    val events: SharedFlow<Event> = _events.asSharedFlow()

    init {
        viewModelScope.launch {
            combine(clips.version, recorder.state.map { it.activeClipPath }.distinctUntilChanged()) { _, active -> active }
                .collectLatest { active ->
                    // The clip being recorded isn't playable until it is finalized.
                    val list = clips.listClips().filter { it.path != active }
                    snapshot.value = list to clips.stats(active?.let(::File))
                }
        }
    }

    val uiState: StateFlow<UiState> = combine(snapshot, filter) { data, filter ->
        if (data == null) return@combine UiState(loading = true, filter = filter)
        val (all, stats) = data
        val visible = when (filter) {
            Filter.ALL -> all
            Filter.PROTECTED -> all.filter { it.isProtected }
            Filter.IMPACTS -> all.filter { it.hasImpact }
        }
        val zone = ZoneId.systemDefault()
        val groups = visible
            .groupBy { Instant.ofEpochMilli(it.startedAtMs).atZone(zone).toLocalDate() }
            .map { (day, dayClips) -> DayGroup(day, dayClips.map { ClipItem(it, clips.isInGallery(it)) }) }
        UiState(loading = false, filter = filter, groups = groups, stats = stats, totalClips = all.size)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState())

    fun setFilter(value: Filter) {
        filter.value = value
    }

    fun protect(clip: Clip) = viewModelScope.launch { clips.protect(clip) }

    fun unprotect(clip: Clip) = viewModelScope.launch { clips.unprotect(clip) }

    fun delete(clip: Clip) = viewModelScope.launch { clips.delete(clip) }

    fun saveToGallery(clip: Clip) = viewModelScope.launch {
        _events.emit(Event.SavedToGallery(clips.saveToGallery(clip)))
    }
}
