package app.neonclips.media

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import app.neonclips.core.Envelope
import app.neonclips.core.EnvelopeBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.nio.ByteOrder
import kotlin.coroutines.coroutineContext

object AudioScan {
    /**
     * Decodes the audio track and measures its loudness over time. Returns null when the file
     * has no audio. [onProgress] gets 0..1.
     */
    suspend fun envelope(context: Context, uri: Uri, onProgress: (Float) -> Unit = {}): Envelope? =
        withContext(Dispatchers.Default) {
            val extractor = MediaExtractor()
            var codec: MediaCodec? = null
            try {
                extractor.setDataSource(context, uri, null)
                val track = (0 until extractor.trackCount).firstOrNull {
                    extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith("audio/")
                } ?: return@withContext null
                val format = extractor.getTrackFormat(track)
                extractor.selectTrack(track)
                val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L

                codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
                codec.configure(format, null, null, 0)
                codec.start()

                var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                var isFloat = false
                var builder: EnvelopeBuilder? = null
                val info = MediaCodec.BufferInfo()
                var inputDone = false
                var outputDone = false
                var lastReport = 0L

                while (!outputDone) {
                    coroutineContext.ensureActive()
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(5_000)
                        if (i >= 0) {
                            val size = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
                            if (size < 0) {
                                codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }
                    when (val o = codec.dequeueOutputBuffer(info, 5_000)) {
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val out = codec.outputFormat
                            sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                            channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                            isFloat = out.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                                out.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                        }
                        MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                        else -> if (o >= 0) {
                            if (info.size > 0) {
                                val b = builder ?: EnvelopeBuilder(sampleRate, channels).also { builder = it }
                                val buf = codec.getOutputBuffer(o)!!
                                buf.position(info.offset).limit(info.offset + info.size)
                                buf.order(ByteOrder.nativeOrder())
                                if (isFloat) {
                                    val f = buf.asFloatBuffer()
                                    while (f.hasRemaining()) b.feed((f.get().coerceIn(-1f, 1f) * 32767f).toInt().toShort())
                                } else {
                                    val s = buf.asShortBuffer()
                                    while (s.hasRemaining()) b.feed(s.get())
                                }
                                if (durationUs > 0 && info.presentationTimeUs - lastReport > 2_000_000) {
                                    lastReport = info.presentationTimeUs
                                    onProgress((info.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f))
                                }
                            }
                            codec.releaseOutputBuffer(o, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        }
                    }
                }
                onProgress(1f)
                builder?.build() ?: Envelope(FloatArray(0), 50)
            } finally {
                runCatching { codec?.stop() }
                runCatching { codec?.release() }
                extractor.release()
            }
        }
}
