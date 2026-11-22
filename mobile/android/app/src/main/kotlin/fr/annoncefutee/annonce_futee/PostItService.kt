package fr.annoncefutee.annonce_futee

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs

/**
 * Post-it flottant affiché par-dessus les autres applications uniquement à la demande
 * de l'utilisateur. Il ne lit ni ne modifie aucune autre application : chaque bouton
 * copie simplement le champ correspondant dans le presse-papiers Android.
 */
class PostItService : Service() {

    companion object {
        const val ACTION_AFFICHER = "fr.annoncefutee.annonce_futee.POST_IT_AFFICHER"
        const val ACTION_FERMER = "fr.annoncefutee.annonce_futee.POST_IT_FERMER"
        const val CANAL_ID = "annonce_futee_post_it"
        const val NOTIF_ID = 4201

        @Volatile
        var actif: Boolean = false
            private set

        private val ORDRE_CHAMPS = listOf(
            "titre" to "Titre",
            "prix" to "Prix",
            "description" to "Description",
            "marque" to "Marque",
            "etat" to "État",
            "taille" to "Taille",
            "couleurs" to "Couleurs",
            "matiere" to "Matière",
            "categorie" to "Catégorie",
            "sousCategorie" to "Sous-catégorie",
        )
    }

    private val ui = Handler(Looper.getMainLooper())
    private var wm: WindowManager? = null
    private var racine: LinearLayout? = null
    private var params: WindowManager.LayoutParams? = null
    private var vueBulle: View? = null
    private var vueCarte: View? = null
    private var banniere: TextView? = null
    private var replie = false
    private var champsActuels: Map<String, String> = emptyMap()

    private val cViolet = Color.parseColor("#6D28D9")
    private val cLavande = Color.parseColor("#F0EBFF")
    private val cFondDoux = Color.parseColor("#F7F5FC")
    private val cEncre = Color.parseColor("#242037")
    private val cEncreDouce = Color.parseColor("#5F5B78")
    private val cTrait = Color.parseColor("#E8E4F3")
    private val cSucces = Color.parseColor("#116E66")
    private val cSuccesFond = Color.parseColor("#E1F3F0")
    private val cBlanc = Color.WHITE

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_FERMER) {
            fermerProprement()
            return START_NOT_STICKY
        }
        if (!peutSuperposer()) {
            fermerProprement()
            return START_NOT_STICKY
        }

        val recus = linkedMapOf<String, String>()
        for ((cle, _) in ORDRE_CHAMPS) {
            val valeur = intent?.getStringExtra("champ_$cle")?.trim().orEmpty()
            if (valeur.isNotEmpty()) {
                recus[cle] = if (cle == "prix") normaliserPrix(valeur) else valeur
            }
        }
        if (recus.isNotEmpty()) {
            champsActuels = recus
        }
        if (champsActuels.isEmpty()) {
            fermerProprement()
            return START_NOT_STICKY
        }

        demarrerPremierPlan()
        afficherOuMettreAJour()
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        retirerFenetre()
        actif = false
        super.onDestroy()
    }

    private fun peutSuperposer(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    private fun normaliserPrix(brut: String): String {
        return brut.replace("€", "").trim()
    }

    private fun demarrerPremierPlan() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(
                CANAL_ID,
                "Post-it Annonce Futée",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Garde le bloc-notes de ton annonce visible pendant le collage."
                setShowBadge(false)
            }
            nm.createNotificationChannel(canal)
        }

        val intentFermer = Intent(this, PostItService::class.java).apply {
            action = ACTION_FERMER
        }
        val flagPending = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingFermer = PendingIntent.getService(this, 1, intentFermer, flagPending)

        val intentOuvrir = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pendingOuvrir = PendingIntent.getActivity(this, 2, intentOuvrir, flagPending)

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CANAL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val notif = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Post-it Annonce Futée actif")
            .setContentText("Touche un champ sur le Post-it pour le copier.")
            .setContentIntent(pendingOuvrir)
            .setOngoing(true)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Fermer le Post-it",
                pendingFermer
            )
            .build()

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun afficherOuMettreAJour() {
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val typeFenetre = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val conteneur = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        val bulle = construireBulle()
        val carte = construireCarte()
        vueBulle = bulle
        vueCarte = carte
        replie = false
        bulle.visibility = View.GONE
        carte.visibility = View.VISIBLE

        conteneur.addView(bulle)
        conteneur.addView(carte)

        val anciensParams = params
        retirerFenetre()

        val nouveauxParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            typeFenetre,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = anciensParams?.x ?: dp(14)
            y = anciensParams?.y ?: dp(110)
        }

        wm?.addView(conteneur, nouveauxParams)
        racine = conteneur
        params = nouveauxParams
        actif = true
    }

    private fun basculerReplie(versBulle: Boolean) {
        replie = versBulle
        vueBulle?.visibility = if (versBulle) View.VISIBLE else View.GONE
        vueCarte?.visibility = if (versBulle) View.GONE else View.VISIBLE
        val r = racine ?: return
        val p = params ?: return
        try {
            wm?.updateViewLayout(r, p)
        } catch (_: Exception) {
        }
    }

    private fun construireBulle(): View {
        val bulle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(8), dp(12), dp(8))
            background = formeRonde(cViolet, dp(999), cBlanc, dp(2))
            elevation = dp(8).toFloat()
        }
        val icone = ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher)
            layoutParams = LinearLayout.LayoutParams(dp(26), dp(26))
        }
        val texte = TextView(this).apply {
            text = "Post-it"
            setTextColor(cBlanc)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(7), 0, 0, 0)
        }
        bulle.addView(icone)
        bulle.addView(texte)
        rendreDeplacable(bulle, surClic = { basculerReplie(false) })
        return bulle
    }

    private fun construireCarte(): View {
        val largeurEcran = resources.displayMetrics.widthPixels
        val hauteurEcran = resources.displayMetrics.heightPixels
        val largeurCarte = (largeurEcran * 0.86f).toInt().coerceIn(dp(260), dp(340))
        val hauteurMaxListe = (hauteurEcran * 0.36f).toInt().coerceAtLeast(dp(180))

        val carte = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                largeurCarte,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            background = formeRonde(cBlanc, dp(14), cViolet, dp(2))
            elevation = dp(10).toFloat()
        }

        // En-tête déplaçable au doigt
        val entete = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(9), dp(8), dp(9))
            background = GradientDrawable().apply {
                setColor(cViolet)
                val r = dp(12).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
        }
        val icone = ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher)
            layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
        }
        val titreEntete = TextView(this).apply {
            text = "Post-it · glisser pour bouger"
            setTextColor(cBlanc)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(8), 0, dp(4), 0)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnReduire = boutonEntete("—") { basculerReplie(true) }
        val btnFermer = boutonEntete("✕") { fermerProprement() }

        entete.addView(icone)
        entete.addView(titreEntete)
        entete.addView(btnReduire)
        entete.addView(btnFermer)
        rendreDeplacable(entete, surClic = null)
        carte.addView(entete)

        // Bandeau discret de confirmation de copie
        val etatCopie = TextView(this).apply {
            visibility = View.GONE
            setTextColor(cSucces)
            setBackgroundColor(cSuccesFond)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        banniere = etatCopie
        carte.addView(etatCopie)

        // Liste défilable des champs à copier
        val defilement = ScrollView(this).apply {
            isVerticalScrollBarEnabled = true
            layoutParams = object : LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ) {}
        }
        val liste = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(10))
        }

        for ((cle, libelle) in ORDRE_CHAMPS) {
            val valeur = champsActuels[cle] ?: continue
            liste.addView(construireLigneChamp(cle, libelle, valeur))
        }

        defilement.addView(liste)
        // Plafonne la hauteur du ScrollView pour laisser Vinted bien visible dessous
        defilement.viewTreeObserver.addOnGlobalLayoutListener {
            if (defilement.height > hauteurMaxListe) {
                val lp = defilement.layoutParams
                lp.height = hauteurMaxListe
                defilement.layoutParams = lp
            }
        }
        carte.addView(defilement)

        return carte
    }

    private fun boutonEntete(symbole: String, action: () -> Unit): TextView {
        return TextView(this).apply {
            text = symbole
            gravity = Gravity.CENTER
            setTextColor(cBlanc)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            background = formeRonde(Color.parseColor("#5620B4"), dp(8), 0, 0)
            val taille = dp(30)
            layoutParams = LinearLayout.LayoutParams(taille, taille).apply {
                marginStart = dp(4)
            }
            setOnClickListener { action() }
        }
    }

    private fun construireLigneChamp(cle: String, libelle: String, valeur: String): View {
        val estDescription = cle == "description"
        val ligne = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(8), dp(7))
            background = formeRonde(
                if (estDescription) cLavande else cFondDoux,
                dp(9),
                cTrait,
                dp(1)
            )
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(6)
            }
            setOnClickListener { copierChamp(libelle, valeur) }
        }

        val colonneTexte = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val vueLibelle = TextView(this).apply {
            text = libelle
            setTextColor(cEncreDouce)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        }
        val affichageValeur = if (cle == "prix") "$valeur €" else valeur
        val vueValeur = TextView(this).apply {
            text = affichageValeur
            setTextColor(cEncre)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            maxLines = if (estDescription) 3 else 1
            ellipsize = TextUtils.TruncateAt.END
        }
        colonneTexte.addView(vueLibelle)
        colonneTexte.addView(vueValeur)

        val badgeCopier = TextView(this).apply {
            text = "Copier"
            setTextColor(cBlanc)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(10), dp(5), dp(10), dp(5))
            background = formeRonde(cViolet, dp(7), 0, 0)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(8)
            }
            setOnClickListener { copierChamp(libelle, valeur) }
        }

        ligne.addView(colonneTexte)
        ligne.addView(badgeCopier)
        return ligne
    }

    private fun copierChamp(libelle: String, valeur: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText(libelle, valeur))
        val vue = banniere ?: return
        vue.text = "✓ $libelle copié — colle-le dans Vinted"
        vue.visibility = View.VISIBLE
        ui.removeCallbacksAndMessages(vue)
        ui.postDelayed({ vue.visibility = View.GONE }, vue, 2000L)
    }

    private fun rendreDeplacable(poignee: View, surClic: (() -> Unit)?) {
        var departX = 0
        var departY = 0
        var doigtX = 0f
        var doigtY = 0f
        var glisse = false
        val seuil = dp(6)

        poignee.setOnTouchListener { _, event ->
            val p = params ?: return@setOnTouchListener false
            val r = racine ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    departX = p.x
                    departY = p.y
                    doigtX = event.rawX
                    doigtY = event.rawY
                    glisse = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - doigtX).toInt()
                    val dy = (event.rawY - doigtY).toInt()
                    if (abs(dx) > seuil || abs(dy) > seuil) glisse = true
                    if (glisse) {
                        val maxX = (resources.displayMetrics.widthPixels - dp(64)).coerceAtLeast(0)
                        val maxY = (resources.displayMetrics.heightPixels - dp(80)).coerceAtLeast(0)
                        p.x = (departX + dx).coerceIn(0, maxX)
                        p.y = (departY + dy).coerceIn(0, maxY)
                        try {
                            wm?.updateViewLayout(r, p)
                        } catch (_: Exception) {
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!glisse) surClic?.invoke()
                    true
                }
                else -> false
            }
        }
    }

    private fun formeRonde(
        fond: Int,
        rayonPx: Int,
        bordureCouleur: Int,
        bordurePx: Int
    ): GradientDrawable {
        return GradientDrawable().apply {
            setColor(fond)
            cornerRadius = rayonPx.toFloat()
            if (bordurePx > 0) setStroke(bordurePx, bordureCouleur)
        }
    }

    private fun dp(valeur: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            valeur.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun retirerFenetre() {
        val r = racine
        racine = null
        if (r != null) {
            try {
                wm?.removeView(r)
            } catch (_: Exception) {
            }
        }
    }

    private fun fermerProprement() {
        retirerFenetre()
        actif = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }
}
