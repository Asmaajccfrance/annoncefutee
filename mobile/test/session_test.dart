import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart';

import 'package:annonce_futee/metier/annonce_api.dart';
import 'package:annonce_futee/metier/brouillon.dart';
import 'package:annonce_futee/metier/modeles.dart';
import 'package:annonce_futee/metier/session_annonce.dart';

class ApiFaux implements ClientAnnonce {
  int analyses = 0;
  int photosIa = 0;
  int deconnexions = 0;
  int changementsMdp = 0;
  int suppressionsCompte = 0;
  String? dernierMdpSuppression;
  List<String> dernieresImages = [];
  String dernieresPrecisions = '';
  String dernierStyle = 'normal';
  bool derniersHashtags = true;
  String derniereSignature = '';
  String? dernierMode;
  String derniereConsigne = '';
  Completer<ResultatAnalyse>? attenteAnalyse;
  Completer<ResultatPhoto>? attentePhoto;
  Map<String, dynamic> data = {
    'titre': 'Pull',
    'description': 'Doux',
    'marque': 'Zara',
    'etat': 'Bon état',
    'taille': 'M',
    'prix_suggere': 10,
    'couleurs': ['Bleu'],
    'a_verifier': ['Le prix'],
  };

  CompteCredits get credits => const CompteCredits(
        email: 'essai-chrome@annoncefutee.fr',
        nom: 'Essai',
        compteTest: true,
        unlimited: true,
        remaining: null,
        monthly: null,
        used: 1,
        analysisCost: 1,
        photoCost: 5,
      );

  @override
  Future<CatalogueForfaits> forfaits() async => CatalogueForfaits.secours;

  @override
  Future<SessionOuverte> inscrire({
    required String nom,
    required String email,
    required String motDePasse,
    required String confirmation,
    String forfait = 'free',
  }) async {
    return SessionOuverte('jeton', credits.copierAvec(email: email, nom: nom));
  }

  @override
  Future<SessionOuverte> connexion(String email, String motDePasse) async {
    return SessionOuverte('jeton', credits);
  }

  @override
  Future<CompteCredits> moi(String jeton) async => credits;

  @override
  Future<void> deconnexion(String jeton) async {
    deconnexions++;
  }

  @override
  Future<void> changerMotDePasse(
    String jeton, {
    required String actuel,
    required String nouveau,
    required String confirmation,
  }) async {
    changementsMdp++;
  }

  @override
  Future<void> supprimerCompte(String jeton, String motDePasse) async {
    suppressionsCompte++;
    dernierMdpSuppression = motDePasse;
  }

  @override
  Future<ResultatAnalyse> analyser(
    String jeton,
    List<String> images, {
    String precisions = '',
    String style = 'normal',
    bool hashtags = true,
    String signature = '',
  }) {
    analyses++;
    dernieresImages = images;
    dernieresPrecisions = precisions;
    dernierStyle = style;
    derniersHashtags = hashtags;
    derniereSignature = signature;
    expect(jeton, 'jeton');
    final attente = attenteAnalyse;
    if (attente != null) return attente.future;
    return Future.value(ResultatAnalyse(data, credits));
  }

  @override
  Future<ResultatPhoto> ameliorer(String jeton, String image, String mode, {String consigne = ''}) {
    photosIa++;
    dernierMode = mode;
    derniereConsigne = consigne;
    final attente = attentePhoto;
    if (attente != null) return attente.future;
    return Future.value(ResultatPhoto(image, mode, credits));
  }
}

void main() {
  late Directory dossier;
  late ApiFaux api;

  Uint8List jpeg(int n) {
    final image = Image(width: 48, height: 48);
    image.clear(ColorRgb8(n, 20, 40));
    return encodeJpg(image);
  }

  SessionAnnonce sessionDans(Directory racine, {FondBlancLocal? fond}) {
    return SessionAnnonce(
      api: api,
      depot: DepotBrouillon(racine),
      coffre: CoffreMemoire()..jeton = 'jeton'..email = 'essai-chrome@annoncefutee.fr',
      fondBlanc: fond ?? (String _) async => null,
      reduire: (Uint8List octets) async => octets,
    );
  }

  setUp(() async {
    dossier = await Directory.systemTemp.createTemp('annonce-futee-');
    api = ApiFaux();
  });

  tearDown(() async {
    await DepotBrouillon.attendre(dossier.path);
    for (var i = 0; i < 8; i++) {
      try {
        if (await dossier.exists()) await dossier.delete(recursive: true);
        return;
      } catch (_) {
        await Future<void>.delayed(const Duration(milliseconds: 40));
      }
    }
  });

  test('cinq premières photos, une seule analyse en parallèle, originaux intacts', () async {
    final fonds = <String>[];
    final session = sessionDans(dossier, fond: (chemin) async {
      fonds.add(chemin);
      return null;
    });
    await session.connecter('essai-chrome@annoncefutee.fr', 'x');
    final originaux = <String, List<int>>{};
    for (var i = 0; i < 7; i++) {
      await session.ajouterPhoto(jpeg(i));
    }
    for (final photo in session.photos) {
      originaux[photo.id] = await File(photo.cheminOriginal).readAsBytes();
    }
    api.attenteAnalyse = Completer<ResultatAnalyse>();
    await session.continuer();
    await _jusqua(() => api.analyses == 1);

    expect(session.etape, 'preparation');
    expect(session.analyseEtat, 'attente');
    expect(session.idsAnalyse, session.photos.take(5).map((p) => p.id).toList());
    expect(api.dernieresImages, hasLength(5));
    for (final photo in session.photos) {
      expect(await File(photo.cheminOriginal).readAsBytes(), originaux[photo.id]);
    }
    await Future<void>.delayed(const Duration(milliseconds: 30));
    await _jusqua(() => fonds.length == 7);
    expect(session.photos.every((p) => p.fondEtat == 'origine'), isTrue);

    api.attenteAnalyse!.complete(ResultatAnalyse(api.data, api.credits));
    await _jusqua(() => session.analyseEtat == 'prete');
    expect(session.champs!.titre, 'Pull');
    expect(api.analyses, 1);

    session.basculer(session.photos.first.id);
    session.basculer(session.photos[5].id);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(api.analyses, 1, reason: 'changer le choix ne relance pas l\'analyse');
    expect(session.selectionDifferente, isTrue);
  });

  test('la fermeture pendant l\'analyse ne la relance pas', () async {
    final session = sessionDans(dossier);
    await session.connecter('a@b.c', 'x');
    await session.ajouterPhoto(jpeg(1));
    api.attenteAnalyse = Completer<ResultatAnalyse>();
    await session.continuer();
    await _jusqua(() => api.analyses == 1);
    expect(api.analyses, 1);

    final reprise = sessionDans(dossier);
    await reprise.demarrer();
    expect(reprise.analyseEtat, 'interrompue');
    expect(reprise.photos, hasLength(1));
    expect(api.analyses, 1);
    expect(reprise.analyseMessage, contains('pas relancée'));
  });

  test('les champs modifiés et les photos préparées sont restaurés', () async {
    final session = sessionDans(dossier, fond: (String _) async => jpeg(9));
    await session.connecter('a@b.c', 'x');
    await session.ajouterPhoto(jpeg(4));
    await session.continuer();
    await _jusqua(() => session.analyseEtat == 'prete' && session.photos.first.fondEtat == 'pret');
    session.modifierChamp('titre', 'Mon titre');
    session.aller('fin');
    await Future<void>.delayed(const Duration(milliseconds: 20));

    final reprise = sessionDans(dossier);
    await reprise.demarrer();
    expect(reprise.etape, 'fin');
    expect(reprise.champs!.titre, 'Mon titre');
    expect(reprise.photos.first.cheminPrepare, isNotNull);
    expect(await File(reprise.photos.first.cheminPrepare!).exists(), isTrue);

    api.data = {...api.data, 'titre': 'Autre', 'description': 'Neuve'};
    await reprise.relancerAnalyse();
    expect(reprise.champs!.titre, 'Mon titre');
    expect(reprise.champs!.description, 'Neuve');
  });

  test('une photo IA n\'empêche pas le reste, et une nouvelle annonce efface le brouillon', () async {
    final session = sessionDans(dossier);
    await session.connecter('a@b.c', 'x');
    await session.ajouterPhoto(jpeg(1));
    await session.ajouterPhoto(jpeg(2));
    await session.continuer();
    await _jusqua(() => session.analyseEtat == 'prete');
    api.attentePhoto = Completer<ResultatPhoto>();
    session.noterConsigne(session.photos.first.id, 'fond bleu ciel');
    final premiere = session.photoIa(session.photos.first.id, 'studio');
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(session.photos.first.iaEnCours, isTrue);
    expect(session.etape, 'preparation');
    await session.photoIa(session.photos[1].id, 'mannequin_homme');
    expect(session.photos[1].message, contains('déjà en cours'));
    expect(api.photosIa, 1);
    expect(api.derniereConsigne, 'fond bleu ciel');
    api.attentePhoto!.complete(ResultatPhoto('YQ==', 'studio', api.credits));
    await premiere;
    expect(session.photos.first.modeIa, 'studio');

    await session.nouvelleAnnonce();
    expect(session.photos, isEmpty);
    expect(session.etape, 'photos');
    expect(await DepotBrouillon(dossier).charger(), isNull);
  });

  test('le brouillon survit à une relecture directe', () async {
    final depot = DepotBrouillon(dossier);
    await depot.ecrireOriginal('photo1', jpeg(3));
    await depot.ecrirePreparee('photo1', jpeg(4));
    await depot.enregistrer(EtatBrouillon(
      etape: 'annonce',
      analyseEtat: 'prete',
      analyseMessage: '',
      idsAnalyse: ['photo1'],
      champs: ChampsAnnonce(titre: 'Veste', modifies: {'titre'}).versJson(),
      photos: [
        PhotoPersistee(
          id: 'photo1',
          original: '',
          pourAnalyse: true,
          envoyee: true,
          fondEtat: 'pret',
          modeIa: 'studio',
        ),
      ],
    ));
    final relu = await depot.charger();
    expect(relu!.etape, 'annonce');
    expect(relu.photos.single.preparee, isNotNull);
    expect(relu.champs!['titre'], 'Veste');
    await depot.effacer();
    expect(await depot.charger(), isNull);
  });

  test('navigation retour, rétablissement de l\'originale et préférences conservées', () async {
    final session = sessionDans(dossier, fond: (String _) async => jpeg(9));
    await session.connecter('a@b.c', 'x');
    await session.ajouterPhoto(jpeg(2));
    session.noterPrecisions('Petit accroc au col');
    session.choisirStyle('detaille');
    session.basculerHashtags(false);
    session.noterSignature('Envoi sous 24h');

    await session.continuer();
    await _jusqua(() => session.analyseEtat == 'prete' && session.photos.first.aRenduPrepare);
    expect(api.dernieresPrecisions, 'Petit accroc au col');
    expect(api.dernierStyle, 'detaille');
    expect(api.derniersHashtags, isFalse);
    expect(api.derniereSignature, 'Envoi sous 24h');
    expect(api.analyses, 1);

    await session.revenirOrigine(session.photos.first.id);
    expect(session.photos.first.cheminPrepare, isNull);
    expect(session.photos.first.fondEtat, 'origine');

    session.aller('fin');
    expect(session.retourEtape(), isTrue);
    expect(session.etape, 'annonce');
    expect(session.retourEtape(), isTrue);
    expect(session.etape, 'preparation');
    expect(session.retourEtape(), isTrue);
    expect(session.etape, 'photos');
    expect(session.libelleContinuer, 'Continuer');

    await session.continuer();
    expect(session.etape, 'preparation');
    expect(api.analyses, 1, reason: 'revenir sans changer les photos ne refacture pas');

    await session.nouvelleAnnonce();
    expect(session.precisions, isEmpty);
    expect(session.style, 'detaille');
    expect(session.hashtags, isFalse);
    expect(session.signature, 'Envoi sous 24h');
    expect(await DepotBrouillon(dossier).charger(), isNull);
  });

  test('enregistrer plusieurs annonces, les rouvrir sans crédit et les supprimer', () async {
    final session = sessionDans(dossier, fond: (String _) async => jpeg(12));
    await session.connecter('a@b.c', 'x');
    await session.ajouterPhoto(jpeg(1));
    await session.continuer();
    await _jusqua(
      () => session.analyseEtat == 'prete' && session.photos.first.aRenduPrepare,
    );

    final premiere = await session.enregistrerAnnonce();
    expect(premiere, isNotNull);
    expect(session.enregistreeAJour, isTrue);
    expect(session.annoncesEnregistrees, hasLength(1));
    expect(session.annoncesEnregistrees.single.titreAffiche, 'Pull');
    expect(session.annoncesEnregistrees.single.prixAffiche, '10 €');

    await session.nouvelleAnnonce();
    expect(session.photos, isEmpty);
    expect(session.champs, isNull);
    expect(session.annoncesEnregistrees, hasLength(1));

    api.data = {...api.data, 'titre': 'Veste noire', 'prix_suggere': 35};
    await session.ajouterPhoto(jpeg(2));
    await session.continuer();
    await _jusqua(() => session.analyseEtat == 'prete');
    final seconde = await session.enregistrerAnnonce();
    expect(seconde, isNotNull);
    expect(session.annoncesEnregistrees, hasLength(2));
    expect(api.analyses, 2);

    final ouverte = await session.ouvrirAnnonceEnregistree(premiere!.id);
    expect(ouverte, isTrue);
    expect(session.etape, 'annonce');
    expect(session.champs!.titre, 'Pull');
    expect(session.photos.single.cheminPrepare, isNotNull);
    expect(await File(session.photos.single.cheminPrepare!).exists(), isTrue);
    expect(api.analyses, 2, reason: 'rouvrir une annonce ne consomme aucun crédit');

    session.modifierChamp('prix', '14');
    expect(session.enregistreeAJour, isFalse);
    await session.enregistrerAnnonce();
    expect(session.enregistreeAJour, isTrue);
    expect(session.annoncesEnregistrees, hasLength(2));
    expect(
      session.annoncesEnregistrees.firstWhere((a) => a.id == premiere.id).prixAffiche,
      '14 €',
    );

    await session.supprimerAnnonceCourante();
    expect(session.etape, 'photos');
    expect(session.champs, isNull);
    expect(session.annoncesEnregistrees.map((a) => a.id), [seconde!.id]);

    await session.supprimerAnnonceEnregistree(seconde.id);
    expect(session.annoncesEnregistrees, isEmpty);
  });

  test('genererDemandeIa choisit objet ou studio et ignore un texte vide', () async {
    final session = sessionDans(dossier);
    await session.connecter('a@b.c', 'x');
    await session.ajouterPhoto(jpeg(1));
    final id = session.photos.first.id;

    await session.genererDemandeIa(id);
    expect(api.photosIa, 0);

    session.champs = ChampsAnnonce(categorie: 'Électronique');
    session.noterConsigne(id, 'mets la TV dans une chambre d\'ado');
    await session.genererDemandeIa(id);
    expect(api.photosIa, 1);
    expect(api.dernierMode, 'objet');
    expect(api.derniereConsigne, 'mets la TV dans une chambre d\'ado');

    session.champs = ChampsAnnonce(categorie: 'Femmes', sousCategorie: 'Robes');
    session.noterConsigne(id, 'devant un mur de briques');
    await session.genererDemandeIa(id);
    expect(api.photosIa, 2);
    expect(api.dernierMode, 'studio');
  });

  test('changer le mot de passe et supprimer le compte nettoient toute la session', () async {
    final session = sessionDans(dossier);
    await session.connecter('camille@example.com', 'ancienPass1');
    await session.ajouterPhoto(jpeg(3));
    await session.continuer();
    await _jusqua(() => session.analyseEtat == 'prete');
    await session.enregistrerAnnonce();
    expect(session.annoncesEnregistrees, hasLength(1));

    await session.changerMotDePasse(
      actuel: 'ancienPass1',
      nouveau: 'nouveauPass2',
      confirmation: 'nouveauPass2',
    );
    expect(api.changementsMdp, 1);
    expect(session.connecte, isTrue);

    await session.supprimerCompte('nouveauPass2');
    expect(api.suppressionsCompte, 1);
    expect(api.dernierMdpSuppression, 'nouveauPass2');
    expect(session.connecte, isFalse);
    expect(session.photos, isEmpty);
    expect(session.champs, isNull);
    expect(session.annoncesEnregistrees, isEmpty);
    expect(await session.coffre.lire(), isNull);
    expect(await dossier.exists(), isFalse);
  });
}

Future<void> _jusqua(bool Function() condition) async {
  for (var i = 0; i < 50; i++) {
    if (condition()) return;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  fail('condition non atteinte');
}
