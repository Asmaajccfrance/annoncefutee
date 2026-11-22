package fr.annoncefutee.annonce_futee

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.nio.FloatBuffer
import kotlin.concurrent.thread

/**
 * Fond blanc local. En cas de doute, ou si le modèle n'est pas prêt sur l'appareil,
 * on ne renvoie rien : l'application garde alors la photo d'origine sans jamais planter.
 */
object FondBlanc {
    private val ui = Handler(Looper.getMainLooper())

    @Volatile
    private var segmenterCache: SubjectSegmenter? = null

    @Volatile
    private var indisponible: Boolean = false

    private fun obtenirSegmenter(): SubjectSegmenter? {
        if (indisponible) return null
        val existant = segmenterCache
        if (existant != null) return existant
        synchronized(this) {
            if (indisponible) return null
            segmenterCache?.let { return it }
            return try {
                val client = SubjectSegmentation.getClient(
                    SubjectSegmenterOptions.Builder()
                        .enableForegroundConfidenceMask()
                        .enableForegroundBitmap()
                        .build()
                )
                segmenterCache = client
                client
            } catch (_: Throwable) {
                indisponible = true
                null
            }
        }
    }

    fun appliquer(chemin: String, result: MethodChannel.Result) {
        thread {
            try {
                val segmenter = obtenirSegmenter() ?: return@thread rendre(result, null)
                val source = decoder(chemin) ?: return@thread rendre(result, null)
                val droit = redresser(chemin, source)
                val image = InputImage.fromBitmap(droit, 0)
                segmenter.process(image)
                    .addOnSuccessListener { sortie ->
                        try {
                            val masque = sortie.foregroundConfidenceMask
                            val devant = sortie.foregroundBitmap
                            if (masque == null || devant == null || !fiable(masque)) {
                                rendre(result, null)
                                return@addOnSuccessListener
                            }
                            val fond = Bitmap.createBitmap(devant.width, devant.height, Bitmap.Config.ARGB_8888)
                            val toile = Canvas(fond)
                            toile.drawColor(Color.WHITE)
                            toile.drawBitmap(devant, 0f, 0f, null)
                            val flux = ByteArrayOutputStream()
                            fond.compress(Bitmap.CompressFormat.JPEG, 90, flux)
                            rendre(result, flux.toByteArray())
                        } catch (_: Throwable) {
                            rendre(result, null)
                        }
                    }
                    .addOnFailureListener { rendre(result, null) }
            } catch (_: Throwable) {
                rendre(result, null)
            }
        }
    }

    private fun decoder(chemin: String): Bitmap? {
        val bornes = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(chemin, bornes)
        if (bornes.outWidth <= 0 || bornes.outHeight <= 0) return null
        var pas = 1
        while (bornes.outWidth / pas > 1280 || bornes.outHeight / pas > 1280) pas *= 2
        return BitmapFactory.decodeFile(chemin, BitmapFactory.Options().apply { inSampleSize = pas })
    }

    private fun rendre(result: MethodChannel.Result, valeur: ByteArray?) {
        ui.post {
            try {
                result.success(valeur)
            } catch (_: Throwable) {
            }
        }
    }

    private fun redresser(chemin: String, source: Bitmap): Bitmap {
        val orientation = ExifInterface(chemin).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL
        )
        val degres = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return source
        }
        val matrice = Matrix().apply { postRotate(degres) }
        return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrice, true)
    }

    private fun fiable(masque: FloatBuffer): Boolean {
        masque.rewind()
        val total = masque.remaining()
        if (total == 0) return false
        var sujet = 0
        while (masque.hasRemaining()) {
            if (masque.get() > 0.5f) sujet++
        }
        val part = sujet.toFloat() / total.toFloat()
        return part in 0.03f..0.95f
    }
}
