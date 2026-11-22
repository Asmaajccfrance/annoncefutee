package fr.annoncefutee.annonce_futee

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "annonce_futee/fond_blanc")
            .setMethodCallHandler { call, result ->
                if (call.method == "appliquer") {
                    val chemin = call.argument<String>("chemin")
                    if (chemin.isNullOrEmpty()) result.success(null) else FondBlanc.appliquer(chemin, result)
                } else {
                    result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "annonce_futee/post_it")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "autorise" -> {
                        val ok = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                            Settings.canDrawOverlays(this)
                        result.success(ok)
                    }
                    "demanderAutorisation" -> {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                            !Settings.canDrawOverlays(this)
                        ) {
                            try {
                                val intent = Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:$packageName")
                                )
                                startActivity(intent)
                                result.success(true)
                            } catch (_: Exception) {
                                try {
                                    startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
                                    result.success(true)
                                } catch (_: Exception) {
                                    result.success(false)
                                }
                            }
                        } else {
                            result.success(true)
                        }
                    }
                    "afficher" -> {
                        val ok = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                            Settings.canDrawOverlays(this)
                        if (!ok) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        val champs = call.argument<Map<String, String>>("champs").orEmpty()
                        val intent = Intent(this, PostItService::class.java).apply {
                            action = PostItService.ACTION_AFFICHER
                            for ((cle, valeur) in champs) {
                                putExtra("champ_$cle", valeur)
                            }
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            startForegroundService(intent)
                        } else {
                            startService(intent)
                        }
                        result.success(true)
                    }
                    "fermer" -> {
                        stopService(Intent(this, PostItService::class.java))
                        result.success(true)
                    }
                    "actif" -> {
                        result.success(PostItService.actif)
                    }
                    else -> result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "annonce_futee/firefox")
            .setMethodCallHandler { call, result ->
                if (call.method == "ouvrir") {
                    val url = call.argument<String>("url").orEmpty()
                    if (url.isEmpty()) {
                        result.success("erreur")
                        return@setMethodCallHandler
                    }
                    val paquetsFirefox = listOf(
                        "org.mozilla.firefox",
                        "org.mozilla.firefox_beta",
                        "org.mozilla.fenix",
                        "io.github.forkmaintainers.iceraven"
                    )
                    var paquetTrouve: String? = null
                    for (pkg in paquetsFirefox) {
                        try {
                            packageManager.getPackageInfo(pkg, 0)
                            paquetTrouve = pkg
                            break
                        } catch (_: Exception) {
                        }
                    }
                    if (paquetTrouve == null) {
                        result.success("absent")
                        return@setMethodCallHandler
                    }
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                            setPackage(paquetTrouve)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(intent)
                        result.success("ouvert")
                    } catch (_: Exception) {
                        result.success("erreur")
                    }
                } else {
                    result.notImplemented()
                }
            }
    }
}
