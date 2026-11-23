package com.cbantoine.dashcam.storage

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.edit
import com.cbantoine.dashcam.settings.DashcamSettings
import com.cbantoine.dashcam.telemetry.TelemetryTrack
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext

data class Clip(
    val file: File,
    val startedAtMs: Long,
    val endedAtMs: Long,
    val sizeBytes: Long,
    val isProtected: Boolean,
    val hasImpact: Boolean,
) {
    val name: String get() = file.name
    val path: String get() = file.absolutePath
    val baseName: String get() = ClipNaming.baseName(file.name)
    val durationMs: Long get() = (endedAtMs - startedAtMs).coerceAtLeast(0)
}

data class StorageStats(
    val loopBytes: Long,
    val protectedBytes: Long,
    val freeBytes: Long,
    val totalBytes: Long,
    val loopBudgetBytes: Long,
)

data class StorageVolumeInfo(val index: Int, val removable: Boolean, val freeBytes: Long, val totalBytes: Long)

/**
 * Owns the clip folders. Every volume gets `Dashcam/loop` (rolling clips, deleted oldest-first)
 * and `Dashcam/protected` (kept until the user deletes them). All file operations run on one
 * thread so moves, deletes and finalization never race each other.
 */
class ClipRepository(
    private val context: Context,
    private val settings: StateFlow<DashcamSettings>,
) {
    private val io = Dispatchers.IO.limitedParallelism(1)
    private val exported = context.getSharedPreferences("gallery_exports", Context.MODE_PRIVATE)
    private val _version = MutableStateFlow(0L)
    private val pendingGallerySaves = mutableListOf<File>()

    /** Bumped after every change so screens can refresh. */
    val version: StateFlow<Long> = _version.asStateFlow()

    private fun changed() = _version.update { it + 1 }

    private fun volumeDirs(): List<File> =
        context.getExternalFilesDirs(null).filterNotNull().filter {
            Environment.getExternalStorageState(it) == Environment.MEDIA_MOUNTED
        }.ifEmpty { listOf(File(context.filesDir, "media")) }

    private fun allRoots(): List<File> = volumeDirs().map { File(it, ROOT) }

    private fun activeRoot(): File {
        val volumes = volumeDirs()
        val dir = volumes.getOrNull(settings.value.storageVolume) ?: volumes.first()
        return File(dir, ROOT)
    }

    private fun File.loopDir() = File(this, LOOP).apply { mkdirs() }
    private fun File.protectedDir() = File(this, PROTECTED).apply { mkdirs() }

    // usableSpace is deliberately conservative: clips must fit without relying on cache eviction.
    @SuppressLint("UsableSpace")
    fun volumes(): List<StorageVolumeInfo> = volumeDirs().mapIndexed { index, dir ->
        StorageVolumeInfo(
            index = index,
            removable = runCatching { Environment.isExternalStorageRemovable(dir) }.getOrDefault(index > 0),
            freeBytes = dir.usableSpace,
            totalBytes = dir.totalSpace,
        )
    }

    @SuppressLint("UsableSpace")
    fun freeBytes(): Long = activeRoot().apply { mkdirs() }.usableSpace

    /** A fresh, unused file for the next loop clip. */
    fun newClipFile(startedAtMs: Long): File {
        val dir = activeRoot().loopDir()
        var sequence = 0
        while (true) {
            val file = File(dir, ClipNaming.segmentName(startedAtMs, sequence))
            val sidecar = File(dir, ClipNaming.sidecarName(file.name))
            if (!file.exists() && !sidecar.exists()) return file
            sequence++
        }
    }

    suspend fun listClips(): List<Clip> = withContext(io) {
        allRoots().flatMap { root -> scan(root.loopDir(), false) + scan(root.protectedDir(), true) }
            .sortedByDescending { it.startedAtMs }
    }

    suspend fun findClip(path: String): Clip? = withContext(io) {
        val file = File(path)
        val parsed = ClipNaming.parse(file.name)
        if (file.exists()) return@withContext file.toClip(file.parentFile?.name == PROTECTED)
        // The clip may have moved between folders since the path was captured.
        if (parsed == null) return@withContext null
        locate(file.parentFile?.parentFile ?: return@withContext null, parsed.baseName)
            ?.let { it.toClip(it.parentFile?.name == PROTECTED) }
    }

    /** Called once a clip has finished recording. Returns the clip's final file, or null. */
    suspend fun completeClip(
        file: File,
        track: TelemetryTrack?,
        protect: Boolean,
        impact: Boolean,
        keep: Boolean,
    ): File? {
        val result = withContext(io) {
            val root = file.parentFile?.parentFile ?: return@withContext null
            val current = locate(root, ClipNaming.baseName(file.name))
            if (!keep || current == null || current.length() == 0L) {
                current?.delete()
                sidecarOf(current ?: file).delete()
                changed()
                return@withContext null
            }
            track?.let { writeSidecar(current, it) }
            val final = if (protect) moveToProtected(current, impact) else current
            changed()
            final
        }
        flushGallerySaves()
        return result
    }

    /** Protects a clip by base name, wherever it currently is on [root]. */
    suspend fun protectByName(root: File, baseName: String, impact: Boolean): File? {
        val result = withContext(io) {
            val file = locate(root, baseName) ?: return@withContext null
            moveToProtected(file, impact).also { changed() }
        }
        flushGallerySaves()
        return result
    }

    suspend fun protect(clip: Clip): Clip? {
        val result = withContext(io) {
            val moved = moveToProtected(clip.file, clip.hasImpact)
            changed()
            moved.toClip(true)
        }
        flushGallerySaves()
        return result
    }

    suspend fun unprotect(clip: Clip): Clip? = withContext(io) {
        val root = clip.file.parentFile?.parentFile ?: return@withContext null
        val target = File(root.loopDir(), ClipNaming.videoName(clip.baseName, clip.hasImpact))
        val moved = moveWithSidecar(clip.file, target)
        changed()
        moved?.toClip(false)
    }

    suspend fun delete(clip: Clip) = withContext(io) {
        clip.file.delete()
        sidecarOf(clip.file).delete()
        exported.edit { remove(clip.baseName) }
        changed()
    }

    suspend fun readTelemetry(clip: Clip): TelemetryTrack? = withContext(Dispatchers.IO) {
        val sidecar = sidecarOf(clip.file)
        if (!sidecar.exists()) return@withContext null
        runCatching { TelemetryTrack.json.decodeFromString<TelemetryTrack>(sidecar.readText()) }
            .onFailure { Log.w(TAG, "Unreadable telemetry for ${clip.name}", it) }
            .getOrNull()
    }

    /**
     * Deletes the oldest loop clips until the loop folder fits its budget and the volume keeps
     * [minFreeBytes] free. [activeFile] (the clip being recorded) is never touched.
     */
    suspend fun enforceBudget(activeFile: File?, minFreeBytes: Long): Int = withContext(io) {
        val loopClips = allRoots().flatMap { scan(it.loopDir(), false) }
        val victims = StoragePolicy.selectForDeletion(
            loopClips = loopClips.map { StoragePolicy.LoopClip(it.path, it.sizeBytes, it.startedAtMs) },
            freeBytes = freeBytes(),
            loopBudgetBytes = settings.value.loopStorageBytes,
            minFreeBytes = minFreeBytes,
            activeId = activeFile?.absolutePath,
        )
        victims.forEach { victim ->
            val file = File(victim.id)
            file.delete()
            sidecarOf(file).delete()
        }
        if (victims.isNotEmpty()) changed()
        victims.size
    }

    @SuppressLint("UsableSpace")
    suspend fun stats(activeFile: File? = null): StorageStats = withContext(io) {
        val roots = allRoots()
        val loop = roots.flatMap { scan(it.loopDir(), false) }.filter { it.path != activeFile?.absolutePath }
        val protected = roots.flatMap { scan(it.protectedDir(), true) }
        val active = activeRoot().apply { mkdirs() }
        StorageStats(
            loopBytes = loop.sumOf { it.sizeBytes },
            protectedBytes = protected.sumOf { it.sizeBytes },
            freeBytes = active.usableSpace,
            totalBytes = active.totalSpace,
            loopBudgetBytes = settings.value.loopStorageBytes,
        )
    }

    fun isInGallery(clip: Clip): Boolean = exported.contains(clip.baseName)

    /** Copies the clip into the shared Movies/Dashcam folder so it survives an uninstall. */
    suspend fun saveToGallery(clip: Clip): Boolean = withContext(Dispatchers.IO) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, clip.name)
                    put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                    put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$ROOT")
                    put(MediaStore.Video.Media.DATE_TAKEN, clip.startedAtMs)
                    put(MediaStore.Video.Media.IS_PENDING, 1)
                }
                val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val uri = resolver.insert(collection, values) ?: return@withContext false
                try {
                    resolver.openOutputStream(uri)?.use { out -> clip.file.inputStream().use { it.copyTo(out) } }
                        ?: throw IOException("No output stream for $uri")
                    values.clear()
                    values.put(MediaStore.Video.Media.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                } catch (e: IOException) {
                    resolver.delete(uri, null, null)
                    throw e
                }
            } else {
                val granted = ContextCompat.checkSelfPermission(
                    context, Manifest.permission.WRITE_EXTERNAL_STORAGE,
                ) == PackageManager.PERMISSION_GRANTED
                if (!granted) return@withContext false
                @Suppress("DEPRECATION")
                val movies = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
                val target = File(File(movies, ROOT).apply { mkdirs() }, clip.name)
                clip.file.copyTo(target, overwrite = true)
                MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf("video/mp4"), null)
            }
            exported.edit { putLong(clip.baseName, System.currentTimeMillis()) }
            changed()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Saving ${clip.name} to the gallery failed", e)
            false
        }
    }

    fun shareUri(clip: Clip): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.files", clip.file)

    // --- internals (call on [io]) ---

    private fun scan(dir: File, isProtected: Boolean): List<Clip> =
        dir.listFiles()?.mapNotNull { file -> file.toClip(isProtected) }.orEmpty()

    private fun File.toClip(isProtected: Boolean): Clip? {
        val parsed = ClipNaming.parse(name) ?: return null
        if (!isFile) return null
        val modified = lastModified()
        return Clip(
            file = this,
            startedAtMs = parsed.startedAtMs,
            endedAtMs = if (modified > parsed.startedAtMs) modified else parsed.startedAtMs,
            sizeBytes = length(),
            isProtected = isProtected,
            hasImpact = parsed.impact,
        )
    }

    /** Finds a clip's video by base name in either folder of [root]. */
    private fun locate(root: File, baseName: String): File? =
        listOf(root.loopDir(), root.protectedDir()).firstNotNullOfOrNull { dir ->
            listOf(true, false).map { File(dir, ClipNaming.videoName(baseName, it)) }.firstOrNull { it.exists() }
        }

    private fun sidecarOf(video: File) = File(video.parentFile, ClipNaming.sidecarName(video.name))

    private fun writeSidecar(video: File, track: TelemetryTrack) {
        runCatching {
            val target = sidecarOf(video)
            val tmp = File(target.parentFile, target.name + ".tmp")
            tmp.writeText(TelemetryTrack.json.encodeToString(TelemetryTrack.serializer(), track))
            if (!tmp.renameTo(target)) {
                tmp.copyTo(target, overwrite = true)
                tmp.delete()
            }
        }.onFailure { Log.w(TAG, "Couldn't write telemetry for ${video.name}", it) }
    }

    private fun moveToProtected(file: File, impact: Boolean): File {
        val root = file.parentFile?.parentFile ?: return file
        val base = ClipNaming.baseName(file.name)
        val alreadyImpact = ClipNaming.parse(file.name)?.impact == true
        val target = File(root.protectedDir(), ClipNaming.videoName(base, impact || alreadyImpact))
        val moved = moveWithSidecar(file, target) ?: return file
        if (settings.value.autoSaveProtectedToGallery && !exported.contains(base)) {
            pendingGallerySaves += moved
        }
        return moved
    }

    private fun moveWithSidecar(file: File, target: File): File? {
        if (file.absolutePath == target.absolutePath) return file
        if (!file.exists()) return null
        target.parentFile?.mkdirs()
        val ok = file.renameTo(target) || runCatching {
            file.copyTo(target, overwrite = true)
            file.delete()
        }.isSuccess
        if (!ok) return null
        val sidecar = sidecarOf(file)
        if (sidecar.exists()) {
            val sidecarTarget = File(target.parentFile, ClipNaming.sidecarName(target.name))
            if (!sidecar.renameTo(sidecarTarget)) {
                runCatching { sidecar.copyTo(sidecarTarget, overwrite = true); sidecar.delete() }
            }
        }
        return target
    }

    /** Copies clips protected since the last call into the gallery, if that setting is on. */
    private suspend fun flushGallerySaves() {
        val files = withContext(io) { pendingGallerySaves.toList().also { pendingGallerySaves.clear() } }
        for (file in files) {
            val clip = withContext(io) { file.toClip(true) } ?: continue
            saveToGallery(clip)
        }
    }

    private companion object {
        const val TAG = "ClipRepository"
        const val ROOT = "Dashcam"
        const val LOOP = "loop"
        const val PROTECTED = "protected"
    }
}
