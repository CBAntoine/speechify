package com.cbantoine.dashcam.ui

import android.content.Context
import android.text.format.Formatter
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.delay

object Formatting {
    private val timeFormatter: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM)
    private val shortTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
    private val dateTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)

    /** 0:42 / 12:03 / 1:02:03 */
    fun elapsed(ms: Long): String {
        val totalSeconds = (ms / 1000).coerceAtLeast(0)
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) {
            String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.US, "%02d:%02d", minutes, seconds)
        }
    }

    fun time(epochMs: Long): String = Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()).format(timeFormatter)

    fun shortTime(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()).format(shortTimeFormatter)

    fun dateTime(epochMs: Long): String =
        Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()).format(dateTimeFormatter)

    fun day(date: LocalDate, todayLabel: String, yesterdayLabel: String, today: LocalDate = LocalDate.now()): String =
        when (date) {
            today -> todayLabel
            today.minusDays(1) -> yesterdayLabel
            else -> date.format(
                DateTimeFormatter.ofPattern(if (date.year == today.year) "EEE, MMM d" else "EEE, MMM d, yyyy", Locale.getDefault()),
            )
        }

    fun bytes(context: Context, bytes: Long): String = Formatter.formatShortFileSize(context, bytes)

    fun zoom(ratio: Float): String =
        if (ratio % 1f == 0f) ratio.toInt().toString() else String.format(Locale.US, "%.1f", ratio)
}

/** The current time, refreshed at every wall-clock second. */
@Composable
fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000L - now % 1_000L)
        }
    }
    return now
}
