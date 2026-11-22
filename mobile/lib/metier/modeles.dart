class ForfaitOffre {
  const ForfaitOffre({
    required this.slug,
    required this.nom,
    required this.prixEuros,
    required this.creditsMensuels,
    required this.actif,
  });

  final String slug;
  final String nom;
  final int prixEuros;
  final int creditsMensuels;
  final bool actif;

  bool get gratuit => prixEuros == 0;

  String get prixAffiche => gratuit ? 'Gratuit' : '$prixEuros € / mois';

  String get detailCredits => '$creditsMensuels crédits / mois';

  factory ForfaitOffre.depuisJson(Map<String, dynamic> json) {
    final prix = json['price_euros'];
    final credits = json['monthly_credits'];
    return ForfaitOffre(
      slug: (json['slug'] ?? 'free').toString(),
      nom: (json['name'] ?? 'Découverte').toString(),
      prixEuros: prix is num ? prix.round() : 0,
      creditsMensuels: credits is num ? credits.round() : 50,
      actif: json['is_active'] == true,
    );
  }

  static const parDefaut = <ForfaitOffre>[
    ForfaitOffre(
      slug: 'free',
      nom: 'Découverte',
      prixEuros: 0,
      creditsMensuels: 50,
      actif: true,
    ),
    ForfaitOffre(
      slug: 'essentiel',
      nom: 'Essentiel',
      prixEuros: 7,
      creditsMensuels: 100,
      actif: false,
    ),
    ForfaitOffre(
      slug: 'vendeur',
      nom: 'Vendeur',
      prixEuros: 14,
      creditsMensuels: 250,
      actif: false,
    ),
    ForfaitOffre(
      slug: 'boutique',
      nom: 'Boutique',
      prixEuros: 39,
      creditsMensuels: 800,
      actif: false,
    ),
  ];
}

class CatalogueForfaits {
  const CatalogueForfaits({
    required this.inscriptionsOuvertes,
    required this.forfaits,
  });

  final bool inscriptionsOuvertes;
  final List<ForfaitOffre> forfaits;

  static const secours = CatalogueForfaits(
    inscriptionsOuvertes: true,
    forfaits: ForfaitOffre.parDefaut,
  );
}

class CompteCredits {
  const CompteCredits({
    required this.email,
    required this.nom,
    required this.compteTest,
    required this.unlimited,
    required this.remaining,
    required this.monthly,
    required this.used,
    required this.analysisCost,
    required this.photoCost,
    this.forfaitSlug = 'free',
    this.forfaitNom = 'Découverte',
  });

  final String email;
  final String nom;
  final bool compteTest;
  final bool unlimited;
  final int? remaining;
  final int? monthly;
  final int? used;
  final int? analysisCost;
  final int? photoCost;
  final String forfaitSlug;
  final String forfaitNom;

  static const inconnu = CompteCredits(
    email: '',
    nom: '',
    compteTest: false,
    unlimited: false,
    remaining: null,
    monthly: null,
    used: null,
    analysisCost: null,
    photoCost: null,
  );

  factory CompteCredits.depuisReponse(
    Map<String, dynamic> json, {
    String emailSecours = '',
  }) {
    final user = json['user'];
    final credits = json['credits'];
    final profil = user is Map
        ? Map<String, dynamic>.from(user)
        : <String, dynamic>{};
    final solde = credits is Map
        ? Map<String, dynamic>.from(credits)
        : <String, dynamic>{};
    final slug = (profil['plan_slug'] ?? '').toString().trim();
    final nomForfait = (profil['plan_name'] ?? '').toString().trim();
    return CompteCredits(
      email: (profil['email'] ?? emailSecours).toString(),
      nom: (profil['name'] ?? '').toString(),
      compteTest: profil['test_account'] == true,
      unlimited: solde['unlimited'] == true,
      remaining: _nombre(solde['remaining']),
      monthly: _nombre(solde['monthly']),
      used: _nombre(solde['used']),
      analysisCost: _nombre(solde['analysis_cost']),
      photoCost: _nombre(solde['photo_cost']),
      forfaitSlug: slug.isEmpty ? 'free' : slug,
      forfaitNom: nomForfait.isEmpty ? 'Découverte' : nomForfait,
    );
  }

  static int? _nombre(Object? valeur) {
    if (valeur is num) return valeur.round();
    return null;
  }

  bool get peutAnalyser {
    if (unlimited) return true;
    final solde = remaining;
    final cout = analysisCost;
    if (solde == null || cout == null) return true;
    return solde >= cout;
  }

  bool peutPhoto() {
    if (unlimited) return true;
    final solde = remaining;
    final cout = photoCost;
    if (solde == null || cout == null) return true;
    return solde >= cout;
  }

  String get texteCredits {
    if (unlimited) return 'Illimités';
    final solde = remaining;
    if (solde == null) return '--';
    return '$solde restants';
  }

  String get texteQuota {
    if (unlimited) return 'Illimités';
    final quota = monthly;
    if (quota == null) return '--';
    return '$quota';
  }

  String get texteUtilises {
    final nombre = used;
    if (nombre == null) return '--';
    return '$nombre';
  }

  String texteCout(int? cout) {
    if (cout == null) return '--';
    if (cout <= 1) return '$cout crédit';
    return '$cout crédits';
  }

  String get libelle => 'Crédits IA : $texteCredits';

  String get badgeCourt {
    if (unlimited) return '∞ cr.';
    final solde = remaining;
    if (solde == null) return '';
    return '$solde cr.';
  }

  CompteCredits copierAvec({
    String? email,
    String? nom,
    bool? compteTest,
    bool? unlimited,
    int? remaining,
    int? monthly,
    int? used,
    int? analysisCost,
    int? photoCost,
    String? forfaitSlug,
    String? forfaitNom,
    bool effacerRemaining = false,
  }) {
    return CompteCredits(
      email: email ?? this.email,
      nom: nom ?? this.nom,
      compteTest: compteTest ?? this.compteTest,
      unlimited: unlimited ?? this.unlimited,
      remaining: effacerRemaining ? remaining : (remaining ?? this.remaining),
      monthly: monthly ?? this.monthly,
      used: used ?? this.used,
      analysisCost: analysisCost ?? this.analysisCost,
      photoCost: photoCost ?? this.photoCost,
      forfaitSlug: forfaitSlug ?? this.forfaitSlug,
      forfaitNom: forfaitNom ?? this.forfaitNom,
    );
  }
}

class ChampsAnnonce {
  ChampsAnnonce({
    this.titre = '',
    this.description = '',
    this.categorie = '',
    this.sousCategorie = '',
    this.marque = '',
    this.taille = '',
    this.etat = '',
    this.couleurs = '',
    this.matiere = '',
    this.prix = '',
    this.aVerifier = '',
    Set<String>? modifies,
  }) : modifies = modifies ?? <String>{};

  String titre;
  String description;
  String categorie;
  String sousCategorie;
  String marque;
  String taille;
  String etat;
  String couleurs;
  String matiere;
  String prix;
  String aVerifier;
  final Set<String> modifies;

  static const cles = [
    'titre',
    'description',
    'categorie',
    'sousCategorie',
    'marque',
    'taille',
    'etat',
    'couleurs',
    'matiere',
    'prix',
    'aVerifier',
  ];

  String valeur(String cle) {
    switch (cle) {
      case 'titre':
        return titre;
      case 'description':
        return description;
      case 'categorie':
        return categorie;
      case 'sousCategorie':
        return sousCategorie;
      case 'marque':
        return marque;
      case 'taille':
        return taille;
      case 'etat':
        return etat;
      case 'couleurs':
        return couleurs;
      case 'matiere':
        return matiere;
      case 'prix':
        return prix;
      case 'aVerifier':
        return aVerifier;
      default:
        return '';
    }
  }

  void definir(String cle, String valeur) {
    switch (cle) {
      case 'titre':
        titre = valeur;
      case 'description':
        description = valeur;
      case 'categorie':
        categorie = valeur;
      case 'sousCategorie':
        sousCategorie = valeur;
      case 'marque':
        marque = valeur;
      case 'taille':
        taille = valeur;
      case 'etat':
        etat = valeur;
      case 'couleurs':
        couleurs = valeur;
      case 'matiere':
        matiere = valeur;
      case 'prix':
        prix = valeur;
      case 'aVerifier':
        aVerifier = valeur;
    }
    modifies.add(cle);
  }

  void fusionnerSansEcraser(ChampsAnnonce recu) {
    for (final cle in cles) {
      if (!modifies.contains(cle)) definirSansMarquer(cle, recu.valeur(cle));
    }
  }

  void definirSansMarquer(String cle, String valeur) {
    switch (cle) {
      case 'titre':
        titre = valeur;
      case 'description':
        description = valeur;
      case 'categorie':
        categorie = valeur;
      case 'sousCategorie':
        sousCategorie = valeur;
      case 'marque':
        marque = valeur;
      case 'taille':
        taille = valeur;
      case 'etat':
        etat = valeur;
      case 'couleurs':
        couleurs = valeur;
      case 'matiere':
        matiere = valeur;
      case 'prix':
        prix = valeur;
      case 'aVerifier':
        aVerifier = valeur;
    }
  }

  Map<String, dynamic> versJson() => {
    'titre': titre,
    'description': description,
    'categorie': categorie,
    'sousCategorie': sousCategorie,
    'marque': marque,
    'taille': taille,
    'etat': etat,
    'couleurs': couleurs,
    'matiere': matiere,
    'prix': prix,
    'aVerifier': aVerifier,
    'modifies': modifies.toList(),
  };

  static ChampsAnnonce depuisJson(Map<String, dynamic> json) {
    final champs = ChampsAnnonce();
    for (final cle in cles) {
      champs.definirSansMarquer(cle, (json[cle] ?? '').toString());
    }
    final marques = json['modifies'];
    if (marques is List) {
      champs.modifies.addAll(marques.map((e) => e.toString()));
    }
    return champs;
  }

  static ChampsAnnonce depuisServeur(Map<String, dynamic> data) {
    final couleurs = data['couleurs'];
    final verif = data['a_verifier'];
    final prix = data['prix_suggere'];
    return ChampsAnnonce(
      titre: (data['titre'] ?? '').toString(),
      description: (data['description'] ?? '').toString(),
      categorie: (data['categorie'] ?? '').toString(),
      sousCategorie: (data['sous_categorie'] ?? '').toString(),
      marque: (data['marque'] ?? '').toString(),
      taille: (data['taille'] ?? '').toString(),
      etat: (data['etat'] ?? '').toString(),
      couleurs: couleurs is List
          ? couleurs
                .map((e) => e.toString())
                .where((e) => e.isNotEmpty)
                .join(', ')
          : '',
      matiere: (data['matiere'] ?? '').toString(),
      prix: prix == null ? '' : prix.toString(),
      aVerifier: verif is List
          ? verif.map((e) => e.toString()).where((e) => e.isNotEmpty).join('\n')
          : '',
    );
  }
}

class StylesAnnonce {
  const StylesAnnonce._();

  static const choix = [
    ('court', 'Court'),
    ('normal', 'Normal'),
    ('detaille', 'Détaillé'),
  ];

  static String normaliser(String? valeur) {
    for (final element in choix) {
      if (element.$1 == valeur) return element.$1;
    }
    return 'normal';
  }
}

class ModesPhotoIa {
  const ModesPhotoIa._();

  static const principaux = [
    ('studio', 'Studio'),
    ('objet', 'Objet'),
    ('mannequin_femme', 'Portée femme'),
    ('mannequin_homme', 'Portée homme'),
  ];

  static const autres = [
    ('enfant', 'Portée enfant'),
    ('bebe', 'Portée bébé'),
    ('chien', 'Chien'),
    ('chat', 'Chat'),
  ];

  static String nom(String? mode) {
    switch (mode) {
      case 'fond_blanc':
        return 'Fond blanc';
      case 'studio':
        return 'Studio';
      case 'objet':
        return 'Objet';
      case 'mannequin_femme':
        return 'Portée femme';
      case 'mannequin_homme':
        return 'Portée homme';
      case 'enfant':
        return 'Portée enfant';
      case 'bebe':
        return 'Portée bébé';
      case 'chien':
        return 'Chien';
      case 'chat':
        return 'Chat';
      default:
        return 'IA';
    }
  }

  static String modePourDemandeLibre(ChampsAnnonce? champs) {
    if (champs == null) return 'studio';
    final cat = '${champs.categorie} ${champs.sousCategorie}'.toLowerCase();
    const motsNonPortes = [
      'électronique',
      'electronique',
      'maison',
      'déco',
      'deco',
      'meuble',
      'livre',
      'jouet',
      'console',
      'jeu',
      'vaisselle',
      'cuisine',
      'bricolage',
      'sport',
      'divertissement',
    ];
    for (final mot in motsNonPortes) {
      if (mot.isNotEmpty && cat.contains(mot)) return 'objet';
    }
    return 'studio';
  }
}

class PhotoAnnonce {
  PhotoAnnonce({
    required this.id,
    required this.cheminOriginal,
    this.cheminPrepare,
    this.pourAnalyse = false,
    this.envoyee = false,
    this.fondEtat = 'aucune',
    this.modeIa,
    this.iaEnCours = false,
    this.message = '',
    this.consigne = '',
    this.versionRendu = 0,
  });

  final String id;
  String cheminOriginal;
  String? cheminPrepare;
  bool pourAnalyse;
  bool envoyee;
  String fondEtat;
  String? modeIa;
  bool iaEnCours;
  String message;
  String consigne;
  int versionRendu;

  bool get aRenduPrepare => cheminPrepare != null;

  String get affichage {
    if (modeIa != null) return 'Photo IA · ${ModesPhotoIa.nom(modeIa)}';
    if (fondEtat == 'pret') return 'Détourage auto (gratuit)';
    if (fondEtat == 'attente') return 'Détourage auto en cours…';
    return 'Photo d\'origine';
  }

  String? get cheminVisible => cheminPrepare ?? cheminOriginal;
}

class AnnonceResume {
  const AnnonceResume({
    required this.id,
    required this.titre,
    required this.prix,
    required this.categorie,
    required this.nombrePhotos,
    required this.dateModification,
    this.cheminVignette,
  });

  final String id;
  final String titre;
  final String prix;
  final String categorie;
  final int nombrePhotos;
  final DateTime dateModification;
  final String? cheminVignette;

  String get titreAffiche {
    final propre = titre.trim();
    return propre.isEmpty ? 'Annonce sans titre' : propre;
  }

  String get prixAffiche {
    final propre = prix.trim();
    if (propre.isEmpty) return '';
    return propre.contains('€') ? propre : '$propre €';
  }

  String get sousTitre {
    final locale = dateModification.toLocal();
    final jour = locale.day.toString().padLeft(2, '0');
    final mois = locale.month.toString().padLeft(2, '0');
    final heure = locale.hour.toString().padLeft(2, '0');
    final minute = locale.minute.toString().padLeft(2, '0');
    final photos = nombrePhotos <= 1
        ? '$nombrePhotos photo'
        : '$nombrePhotos photos';
    final cat = categorie.trim();
    if (cat.isEmpty) return '$photos · $jour/$mois à $heure:$minute';
    return '$cat · $photos · $jour/$mois';
  }
}

class ErreurApi implements Exception {
  ErreurApi(this.message, {this.statut, this.code});

  final String message;
  final int? statut;
  final String? code;

  @override
  String toString() => message;
}

class ErreurPhoto implements Exception {
  ErreurPhoto(this.message);
  final String message;
  @override
  String toString() => message;
}
