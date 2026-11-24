package com.cbantoine.dashcam.scanner

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.Closeable
import java.util.concurrent.Executor

/** On-device OCR (ML Kit, bundled model: no network, nothing leaves the phone). */
internal class PlateReader : Closeable {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /** Reads all text lines in [image] and calls [onDone] on [executor] with them, or null on failure. */
    fun read(image: Bitmap, executor: Executor, onDone: (List<TextLine>?) -> Unit) {
        val w = image.width.toFloat()
        val h = image.height.toFloat()
        recognizer.process(InputImage.fromBitmap(image, 0)).addOnCompleteListener(executor) { task ->
            if (!task.isSuccessful) {
                onDone(null)
                return@addOnCompleteListener
            }
            val lines = task.result.textBlocks.flatMap { it.lines }.mapNotNull { line ->
                val box = line.boundingBox ?: return@mapNotNull null
                TextLine(
                    text = line.text,
                    confidence = line.confidence,
                    box = NormBox(box.left / w, box.top / h, box.right / w, box.bottom / h),
                    elements = line.elements.map { it.text },
                )
            }
            onDone(lines)
        }
    }

    override fun close() = recognizer.close()
}
