package com.cbantoine.dashcam.scanner

import android.content.Context
import android.graphics.Bitmap
import java.io.Closeable
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.roundToInt
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter

/**
 * EfficientDet-Lite0 (COCO, int8) running on the CPU through LiteRT. The model includes its own
 * box decoding and non-maximum suppression, so it returns finished detections: up to 25 boxes
 * with classes and scores. Not thread-safe; the scanner calls it from one thread.
 */
class VehicleDetector private constructor(
    private val interpreter: Interpreter,
    val inputSize: Int,
    private val maxDetections: Int,
) : Closeable {
    private val input = ByteBuffer.allocateDirect(inputSize * inputSize * 3).order(ByteOrder.nativeOrder())
    private val pixels = IntArray(inputSize * inputSize)
    private val rgb = ByteArray(inputSize * inputSize * 3)
    private val boxes = Array(1) { Array(maxDetections) { FloatArray(4) } }
    private val classes = Array(1) { FloatArray(maxDetections) }
    private val scores = Array(1) { FloatArray(maxDetections) }
    private val count = FloatArray(1)
    private val outputs = mapOf<Int, Any>(0 to boxes, 1 to classes, 2 to scores, 3 to count)

    /** Vehicles in [bitmap] ([inputSize] square, ARGB_8888). Boxes are normalized to the bitmap. */
    fun detect(bitmap: Bitmap, minScore: Float): List<Detection> {
        bitmap.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize)
        var i = 0
        for (p in pixels) {
            rgb[i++] = (p shr 16 and 0xFF).toByte()
            rgb[i++] = (p shr 8 and 0xFF).toByte()
            rgb[i++] = (p and 0xFF).toByte()
        }
        input.rewind()
        input.put(rgb)
        input.rewind()
        interpreter.runForMultipleInputsOutputs(arrayOf(input), outputs)

        val found = count[0].toInt().coerceIn(0, maxDetections)
        return (0 until found).mapNotNull { n ->
            val score = scores[0][n]
            if (score < minScore) return@mapNotNull null
            val kind = VehicleKind.fromCocoIndex(classes[0][n].roundToInt()) ?: return@mapNotNull null
            val (yMin, xMin, yMax, xMax) = boxes[0][n]
            Detection(NormBox(xMin, yMin, xMax, yMax).clamped(), kind, score)
        }
    }

    override fun close() = interpreter.close()

    companion object {
        private const val MODEL_ASSET = "vehicle_detector.tflite"

        /** Loads the bundled model. Throws if it isn't the detector this class expects. */
        fun create(context: Context): VehicleDetector {
            val model = context.assets.openFd(MODEL_ASSET).use { fd ->
                FileInputStream(fd.fileDescriptor).channel.use { channel ->
                    channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
                }
            }
            val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)
            val interpreter = Interpreter(model, Interpreter.Options().setNumThreads(threads))
            try {
                val inputTensor = interpreter.getInputTensor(0)
                val shape = inputTensor.shape()
                check(inputTensor.dataType() == DataType.UINT8 && shape.size == 4 && shape[1] == shape[2] && shape[3] == 3) {
                    "Unexpected detector input ${shape.contentToString()}"
                }
                check(interpreter.outputTensorCount == 4) { "Unexpected detector outputs" }
                val boxShape = interpreter.getOutputTensor(0).shape()
                check(boxShape.size == 3 && boxShape[2] == 4) { "Unexpected box output ${boxShape.contentToString()}" }
                return VehicleDetector(interpreter, shape[1], boxShape[1])
            } catch (e: RuntimeException) {
                interpreter.close()
                throw e
            }
        }
    }
}
