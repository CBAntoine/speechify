package app.neonclips.data

import android.content.Context
import app.neonclips.core.Envelope
import app.neonclips.core.Project
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.util.UUID

/** Projects live in app storage: one folder each with the project file, loudness data and any downloaded source. */
class ProjectStore(context: Context) {
    private val root = File(context.filesDir, "projects").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val _projects = MutableStateFlow(readAll())
    val projects: StateFlow<List<Project>> = _projects

    fun newId(): String = UUID.randomUUID().toString().take(8)

    fun dir(id: String): File = File(root, id).apply { mkdirs() }

    fun load(id: String): Project? = _projects.value.firstOrNull { it.id == id } ?: read(File(root, id))

    @Synchronized
    fun save(project: Project) {
        val file = File(dir(project.id), "project.json")
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(Project.serializer(), project))
        tmp.renameTo(file)
        _projects.value = (_projects.value.filterNot { it.id == project.id } + project).sortedByDescending { it.createdAt }
    }

    @Synchronized
    fun delete(id: String) {
        File(root, id).deleteRecursively()
        _projects.value = _projects.value.filterNot { it.id == id }
    }

    fun saveEnvelope(id: String, envelope: Envelope) {
        DataOutputStream(File(dir(id), "loudness.bin").outputStream().buffered()).use { out ->
            out.writeInt(envelope.hopMs)
            out.writeInt(envelope.rms.size)
            for (v in envelope.rms) out.writeFloat(v)
        }
    }

    fun loadEnvelope(id: String): Envelope? {
        val file = File(File(root, id), "loudness.bin")
        if (!file.exists()) return null
        return runCatching {
            DataInputStream(file.inputStream().buffered()).use { input ->
                val hop = input.readInt()
                val n = input.readInt()
                Envelope(FloatArray(n) { input.readFloat() }, hop)
            }
        }.getOrNull()
    }

    private fun readAll(): List<Project> =
        root.listFiles().orEmpty().filter { it.isDirectory }.mapNotNull(::read).sortedByDescending { it.createdAt }

    private fun read(dir: File): Project? = runCatching {
        json.decodeFromString(Project.serializer(), File(dir, "project.json").readText())
    }.getOrNull()
}
