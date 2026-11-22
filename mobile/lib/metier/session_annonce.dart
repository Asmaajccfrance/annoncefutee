import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'annonce_api.dart';
import 'brouillon.dart';
import 'modeles.dart';
import 'reduire_photo.dart';
import 'selection_photos.dart';

typedef Reducteur = Future<Uint8List> Function(Uint8List octets);
typedef FondBlancLocal = Future<Uint8List?> Function(String chemin);

class SessionAnnonce extends ChangeNotifier {
  SessionAnnonce({
    required this.api,
    required this.depot,
    required this.coffre,
    required this.fondBlanc,
    Reducteur? reduire,
  }) : reduire =
           reduire ??
           ((Uint8List octets) =>
               Isolate.run(() => reduirePourEnvoi(octets)));

  final ClientAnnonce api;
  final DepotBrouillon depot;
  final CoffreJetons coffre;
  final FondBlancLocal fondBlanc;
  final Reducteur reduire;

  String? jeton;
  CompteCredits credits = CompteCredits.inconnu;
  List<PhotoAnnonce> photos = [];
  ChampsAnnonce? champs;
  String etape = 'photos';
  String analyseEtat = 'aucune';
  String analyseMessage = '';
  List<String> idsAnalyse = [];
  bool analyseEnVol = false;
  bool selectionPersonnalisee = false;
  String precisions = '';
  String style = 'normal';
  bool hashtags = true;
  String signature = '';
  String? idAnnonceEnregistree;
  bool enregistreeAJour = false;
  List<AnnonceResume> annoncesEnregistrees = [];
  CatalogueForfaits catalogueForfaits = CatalogueForfaits.secours;
  String message = '';
  int affichageChamps = 0;
  int _cycle = 0;

  bool get connecte {
    final jetonActuel = jeton;
    return jetonActuel != null && jetonActuel.isNotEmpty;
  }

  bool get peutEnregistrerAnnonce => photos.isNotEmpty || champs != null;

  String get libelleEnregistrerAnnonce {
    if (idAnnonceEnregistree == null) return 'Enregistrer l\'annonce';
    if (enregistreeAJour) return 'Annonce enregistrée';
    return 'Mettre à jour l\'annonce';
  }

  bool get _repriseSansNouvelleAnalyse =>
      !selectionDifferente &&
      idsAnalyse.isNotEmpty &&
      (champs != null || analyseEnVol);

  String get libelleContinuer {
    if (_repriseSansNouvelleAnalyse) return 'Continuer';
    final cout = credits.analysisCost;
    if (cout == null) return 'Continuer';
    return SelectionPhotos.libelleContinuer(cout);
  }

  String get libelleRelancer {
    final cout = credits.analysisCost;
    if (cout == null) return 'Relancer l\'analyse';
    return SelectionPhotos.libelleContinuer(cout)
        .replaceFirst('Continuer', 'Relancer l\'analyse');
  }

  bool get peutContinuer {
    if (!connecte || !photos.any((p) => p.pourAnalyse)) return false;
    if (_repriseSansNouvelleAnalyse) return true;
    return credits.peutAnalyser && !analyseEnVol;
  }

  bool get selectionDifferente {
    final actuels = photos
        .where((p) => p.pourAnalyse)
        .map((p) => p.id)
        .toList();
    if (actuels.length != idsAnalyse.length) return idsAnalyse.isNotEmpty;
    for (var i = 0; i < actuels.length; i++) {
      if (actuels[i] != idsAnalyse[i]) return true;
    }
    return false;
  }

  Future<void> demarrer() async {
    final prefs = await depot.chargerPreferences();
    style = StylesAnnonce.normaliser(prefs.style);
    hashtags = prefs.hashtags;
    signature = prefs.signature;
    annoncesEnregistrees = await depot.listerAnnonces();
    final lu = await depot.charger();
    if (lu != null) {
      _appliquer(lu);
      final idLie = idAnnonceEnregistree;
      if (idLie != null &&
          !annoncesEnregistrees.any((a) => a.id == idLie)) {
        idAnnonceEnregistree = null;
        enregistreeAJour = false;
      }
    }
    final garde = await coffre.lire();
    if (garde != null) {
      jeton = garde.jeton;
      try {
        final frais = await api.moi(garde.jeton);
        credits = frais.copierAvec(
          email: frais.email.isEmpty ? garde.email : frais.email,
        );
      } catch (e) {
        credits = credits.copierAvec(email: garde.email);
        if (e is ErreurApi && e.statut == 401) {
          jeton = null;
          await coffre.effacer();
        }
      }
    }
    if (analyseEtat == 'attente') {
      analyseEtat = 'interrompue';
      analyseEnVol = false;
      analyseMessage = 'L\'analyse a été interrompue quand l\'application s\'est fermée. Elle n\'est pas relancée automatiquement.';
      await _sauver();
    }
    for (final photo in photos) {
      if (photo.iaEnCours) {
        photo.iaEnCours = false;
        photo.message = 'La photo IA a été interrompue. Elle n\'est pas relancée automatiquement.';
      }
    }
    notifyListeners();
    if (etape == 'preparation') unawaited(lancerFonds());
  }

  Future<void> rafraichirCompte() async {
    final jetonActuel = jeton;
    if (jetonActuel == null || jetonActuel.isEmpty) return;
    final frais = await api.moi(jetonActuel);
    _fusionnerCredits(frais);
    notifyListeners();
  }

  Future<void> chargerForfaits() async {
    try {
      catalogueForfaits = await api.forfaits();
      notifyListeners();
    } catch (_) {}
  }

  Future<void> inscrire({
    required String nom,
    required String email,
    required String motDePasse,
    required String confirmation,
  }) async {
    message = '';
    final session = await api.inscrire(
      nom: nom,
      email: email,
      motDePasse: motDePasse,
      confirmation: confirmation,
      forfait: 'free',
    );
    jeton = session.jeton;
    credits = session.credits;
    await coffre.ecrire(session.jeton, session.credits.email);
    notifyListeners();
  }

  Future<void> connecter(String email, String motDePasse) async {
    message = '';
    final session = await api.connexion(email, motDePasse);
    jeton = session.jeton;
    credits = session.credits;
    await coffre.ecrire(session.jeton, session.credits.email);
    notifyListeners();
  }

  Future<void> deconnecter() async {
    final jetonActuel = jeton;
    jeton = null;
    await coffre.effacer();
    notifyListeners();
    if (jetonActuel != null) {
      try {
        await api.deconnexion(jetonActuel);
      } catch (_) {}
    }
  }

  Future<void> changerMotDePasse({
    required String actuel,
    required String nouveau,
    required String confirmation,
  }) async {
    final jetonActuel = jeton;
    if (jetonActuel == null || jetonActuel.isEmpty) {
      throw ErreurApi('Session expirée. Reconnecte-toi.');
    }
    await api.changerMotDePasse(
      jetonActuel,
      actuel: actuel,
      nouveau: nouveau,
      confirmation: confirmation,
    );
  }

  Future<void> supprimerCompte(String motDePasse) async {
    final jetonActuel = jeton;
    if (jetonActuel == null || jetonActuel.isEmpty) {
      throw ErreurApi('Session expirée. Reconnecte-toi.');
    }
    await api.supprimerCompte(jetonActuel, motDePasse);
    _cycle++;
    jeton = null;
    credits = CompteCredits.inconnu;
    photos = [];
    champs = null;
    etape = 'photos';
    analyseEtat = 'aucune';
    analyseMessage = '';
    idsAnalyse = [];
    analyseEnVol = false;
    selectionPersonnalisee = false;
    precisions = '';
    style = 'normal';
    hashtags = true;
    signature = '';
    idAnnonceEnregistree = null;
    enregistreeAJour = false;
    annoncesEnregistrees = [];
    message = '';
    affichageChamps = 0;
    await coffre.effacer();
    await depot.toutEffacer();
    notifyListeners();
  }

  Future<String?> ajouterPhoto(Uint8List octets) async {
    if (photos.length >= SelectionPhotos.maxPhotos) {
      message = 'Dix photos maximum.';
      notifyListeners();
      return message;
    }
    final id = _identifiant();
    await depot.ecrireOriginal(id, octets);
    photos.add(
      PhotoAnnonce(id: id, cheminOriginal: '${depot.racine.path}/$id.jpg'),
    );
    if (!selectionPersonnalisee) _appliquerDefaut();
    enregistreeAJour = false;
    message = '';
    await _sauver();
    notifyListeners();
    return null;
  }

  Future<void> retirerPhoto(String id) async {
    photos.removeWhere((p) => p.id == id);
    if (!selectionPersonnalisee) _appliquerDefaut();
    enregistreeAJour = false;
    await _sauver();
    notifyListeners();
  }

  void basculer(String id) {
    final index = photos.indexWhere((p) => p.id == id);
    if (index < 0) return;
    final resultat = SelectionPhotos.basculer([
      for (final p in photos) p.pourAnalyse,
    ], index);
    if (resultat.refuse) {
      message = 'Cinq photos maximum pour l\'analyse.';
      notifyListeners();
      return;
    }
    selectionPersonnalisee = true;
    for (var i = 0; i < photos.length; i++) {
      photos[i].pourAnalyse = resultat.selection[i];
    }
    message = '';
    notifyListeners();
    unawaited(_sauver());
  }

  Future<void> continuer() async {
    if (!peutContinuer) return;
    if (_repriseSansNouvelleAnalyse) {
      etape = 'preparation';
      message = '';
      await _sauver();
      notifyListeners();
      unawaited(lancerFonds());
      return;
    }
    final choisies = photos.where((p) => p.pourAnalyse).toList();
    for (final photo in photos) {
      photo.envoyee = photo.pourAnalyse;
    }
    idsAnalyse = choisies.map((p) => p.id).toList();
    analyseEtat = 'attente';
    analyseMessage = '';
    etape = 'preparation';
    analyseEnVol = true;
    message = '';
    await _sauver();
    notifyListeners();
    final cycle = _cycle;
    unawaited(lancerFonds());
    unawaited(_lancerAnalyse(choisies, cycle));
  }

  Future<void> relancerAnalyse() async {
    if (!connecte || analyseEnVol || !credits.peutAnalyser) return;
    final choisies = photos.where((p) => p.pourAnalyse).toList();
    if (choisies.isEmpty || choisies.length > SelectionPhotos.maxAnalyse) {
      return;
    }
    for (final photo in photos) {
      photo.envoyee = photo.pourAnalyse;
    }
    idsAnalyse = choisies.map((p) => p.id).toList();
    analyseEtat = 'attente';
    analyseMessage = '';
    analyseEnVol = true;
    await _sauver();
    notifyListeners();
    await _lancerAnalyse(choisies, _cycle);
  }

  Future<void> _lancerAnalyse(List<PhotoAnnonce> choisies, int cycle) async {
    try {
      final images = <String>[];
      for (final photo in choisies) {
        final brut = await File(photo.cheminOriginal).readAsBytes();
        final reduit = await reduire(brut);
        images.add(base64Encode(reduit));
      }
      final jetonActuel = jeton;
      if (jetonActuel == null || jetonActuel.isEmpty) {
        throw ErreurApi('Session expirée.');
      }
      final resultat = await api.analyser(
        jetonActuel,
        images,
        precisions: precisions,
        style: style,
        hashtags: hashtags,
        signature: signature,
      );
      if (cycle != _cycle) return;
      final recu = ChampsAnnonce.depuisServeur(resultat.data);
      final actuels = champs;
      if (actuels == null) {
        champs = recu;
      } else {
        actuels.fusionnerSansEcraser(recu);
      }
      final frais = resultat.credits;
      if (frais != null) _fusionnerCredits(frais);
      analyseEtat = 'prete';
      analyseMessage = '';
      enregistreeAJour = false;
      affichageChamps++;
    } catch (e) {
      if (cycle != _cycle) return;
      analyseEtat = 'erreur';
      analyseMessage = e is ErreurApi
          ? e.message
          : 'L\'analyse a échoué. Elle n\'est pas relancée automatiquement.';
    } finally {
      if (cycle == _cycle) {
        analyseEnVol = false;
        await _sauver();
        notifyListeners();
      }
    }
  }

  Future<void> lancerFonds() async {
    final cycle = _cycle;
    for (final photo in photos) {
      if (cycle != _cycle) return;
      if (photo.modeIa != null ||
          photo.fondEtat == 'pret' ||
          photo.fondEtat == 'origine') {
        continue;
      }
      photo.fondEtat = 'attente';
      notifyListeners();
      Uint8List? rendu;
      try {
        rendu = await fondBlanc(photo.cheminOriginal);
      } catch (_) {
        rendu = null;
      }
      if (cycle != _cycle || photo.modeIa != null) continue;
      if (rendu == null || rendu.isEmpty) {
        photo.fondEtat = 'origine';
      } else {
        await depot.ecrirePreparee(photo.id, rendu);
        photo.cheminPrepare = '${depot.racine.path}/${photo.id}-preparee.jpg';
        photo.fondEtat = 'pret';
        photo.versionRendu++;
        enregistreeAJour = false;
      }
      await _sauver();
      notifyListeners();
    }
  }

  void noterPrecisions(String texte) {
    if (precisions == texte) return;
    precisions = texte;
    enregistreeAJour = false;
    unawaited(_sauver());
  }

  void choisirStyle(String nouveau) {
    final normalise = StylesAnnonce.normaliser(nouveau);
    if (style == normalise) return;
    style = normalise;
    notifyListeners();
    unawaited(_sauverPreferences());
  }

  void basculerHashtags(bool valeur) {
    if (hashtags == valeur) return;
    hashtags = valeur;
    notifyListeners();
    unawaited(_sauverPreferences());
  }

  void noterSignature(String texte) {
    if (signature == texte) return;
    signature = texte;
    notifyListeners();
    unawaited(_sauverPreferences());
  }

  Future<void> _sauverPreferences() {
    return depot.enregistrerPreferences(
      PreferencesRedaction(
        style: style,
        hashtags: hashtags,
        signature: signature,
      ),
    );
  }

  void noterConsigne(String id, String texte) {
    final photo = _trouver(id);
    if (photo == null || photo.consigne == texte) return;
    photo.consigne = texte;
    enregistreeAJour = false;
    unawaited(_sauver());
  }

  Future<void> revenirOrigine(String id) async {
    final photo = _trouver(id);
    if (photo == null || photo.iaEnCours) return;
    await depot.supprimerPreparee(id);
    photo.cheminPrepare = null;
    photo.modeIa = null;
    photo.fondEtat = 'origine';
    photo.message = '';
    photo.versionRendu++;
    enregistreeAJour = false;
    await _sauver();
    notifyListeners();
  }

  PhotoAnnonce? _trouver(String id) {
    for (final photo in photos) {
      if (photo.id == id) return photo;
    }
    return null;
  }

  Future<void> genererDemandeIa(String id) async {
    final photo = _trouver(id);
    if (photo == null || photo.consigne.trim().isEmpty) return;
    await photoIa(id, ModesPhotoIa.modePourDemandeLibre(champs));
  }

  Future<void> photoIa(String id, String mode) async {
    final photo = _trouver(id);
    if (photo == null || photo.iaEnCours) return;
    if (photos.any((p) => p.iaEnCours)) {
      photo.message = 'Une photo IA est déjà en cours.';
      notifyListeners();
      return;
    }
    if (!credits.peutPhoto()) {
      photo.message = 'Crédits insuffisants pour une photo IA.';
      notifyListeners();
      return;
    }
    photo.iaEnCours = true;
    photo.message = '';
    notifyListeners();
    final cycle = _cycle;
    try {
      final brut = await File(photo.cheminOriginal).readAsBytes();
      final reduit = await reduire(brut);
      final jetonActuel = jeton;
      if (jetonActuel == null || jetonActuel.isEmpty) {
        throw ErreurApi('Session expirée.');
      }
      final resultat = await api.ameliorer(
        jetonActuel,
        base64Encode(reduit),
        mode,
        consigne: mode == 'fond_blanc' ? '' : photo.consigne,
      );
      if (cycle != _cycle) return;
      final octets = base64Decode(resultat.imageBase64);
      await depot.ecrirePreparee(photo.id, octets);
      photo.cheminPrepare = '${depot.racine.path}/${photo.id}-preparee.jpg';
      photo.modeIa = mode;
      photo.fondEtat = 'pret';
      photo.versionRendu++;
      enregistreeAJour = false;
      final frais = resultat.credits;
      if (frais != null) _fusionnerCredits(frais);
      photo.message = '';
    } catch (e) {
      if (cycle != _cycle) return;
      photo.message = e is ErreurApi
          ? e.message
          : 'La photo IA a échoué. Elle n\'est pas relancée automatiquement.';
    } finally {
      if (cycle == _cycle) {
        photo.iaEnCours = false;
        await _sauver();
        notifyListeners();
      }
    }
  }

  void aller(String nouvelle) {
    etape = nouvelle;
    notifyListeners();
    unawaited(_sauver());
  }

  bool retourEtape() {
    switch (etape) {
      case 'fin':
        aller('annonce');
        return true;
      case 'annonce':
        aller('preparation');
        return true;
      case 'preparation':
        aller('photos');
        return true;
      default:
        return false;
    }
  }

  void modifierChamp(String cle, String valeur) {
    champs?.definir(cle, valeur);
    enregistreeAJour = false;
    notifyListeners();
    unawaited(_sauver());
  }

  Future<AnnonceResume?> enregistrerAnnonce() async {
    if (!peutEnregistrerAnnonce) return null;
    final id = idAnnonceEnregistree ?? _identifiant('a');
    idAnnonceEnregistree = id;
    final resume = await depot.sauvegarderAnnonce(
      id: id,
      etat: _construireEtat(),
    );
    enregistreeAJour = true;
    annoncesEnregistrees = await depot.listerAnnonces();
    await _sauver();
    notifyListeners();
    return resume;
  }

  Future<bool> ouvrirAnnonceEnregistree(String id) async {
    _cycle++;
    final lu = await depot.chargerAnnonceEnregistree(id);
    if (lu == null) return false;
    champs = null;
    analyseEnVol = false;
    message = '';
    _appliquer(lu);
    enregistreeAJour = true;
    affichageChamps++;
    notifyListeners();
    if (etape == 'preparation') unawaited(lancerFonds());
    return true;
  }

  Future<void> supprimerAnnonceEnregistree(String id) async {
    await depot.supprimerAnnonceEnregistree(id);
    if (idAnnonceEnregistree == id) {
      idAnnonceEnregistree = null;
      enregistreeAJour = false;
      await _sauver();
    }
    annoncesEnregistrees = await depot.listerAnnonces();
    notifyListeners();
  }

  Future<void> supprimerAnnonceCourante() async {
    final idLie = idAnnonceEnregistree;
    if (idLie != null) {
      await depot.supprimerAnnonceEnregistree(idLie);
    }
    await _reinitialiserBrouillon();
    annoncesEnregistrees = await depot.listerAnnonces();
    notifyListeners();
  }

  Future<void> nouvelleAnnonce() async {
    await _reinitialiserBrouillon();
    notifyListeners();
  }

  Future<void> _reinitialiserBrouillon() async {
    _cycle++;
    photos = [];
    champs = null;
    etape = 'photos';
    analyseEtat = 'aucune';
    analyseMessage = '';
    idsAnalyse = [];
    analyseEnVol = false;
    selectionPersonnalisee = false;
    precisions = '';
    idAnnonceEnregistree = null;
    enregistreeAJour = false;
    message = '';
    affichageChamps = 0;
    await depot.effacer();
  }

  void _fusionnerCredits(CompteCredits recu) {
    credits = recu.copierAvec(
      email: recu.email.isEmpty ? credits.email : recu.email,
      nom: recu.nom.isEmpty ? credits.nom : recu.nom,
      compteTest: recu.compteTest || credits.compteTest,
    );
  }

  void _appliquerDefaut() {
    final defaut = SelectionPhotos.parDefaut(photos.length);
    for (var i = 0; i < photos.length; i++) {
      photos[i].pourAnalyse = defaut[i];
    }
  }

  void _appliquer(EtatBrouillon etat) {
    etape = etat.etape;
    analyseEtat = etat.analyseEtat;
    analyseMessage = etat.analyseMessage;
    idsAnalyse = etat.idsAnalyse;
    precisions = etat.precisions;
    idAnnonceEnregistree = etat.idAnnonceEnregistree;
    enregistreeAJour = etat.idAnnonceEnregistree != null;
    photos = [
      for (final p in etat.photos)
        PhotoAnnonce(
          id: p.id,
          cheminOriginal: p.original,
          cheminPrepare: p.preparee,
          pourAnalyse: p.pourAnalyse,
          envoyee: p.envoyee,
          fondEtat: p.fondEtat,
          modeIa: p.modeIa,
          message: p.message,
          consigne: p.consigne,
        ),
    ];
    final champsPersistes = etat.champs;
    if (champsPersistes != null) {
      champs = ChampsAnnonce.depuisJson(champsPersistes);
    }
    selectionPersonnalisee = true;
  }

  EtatBrouillon _construireEtat() {
    return EtatBrouillon(
      etape: etape,
      analyseEtat: analyseEtat,
      analyseMessage: analyseMessage,
      idsAnalyse: idsAnalyse,
      champs: champs?.versJson(),
      precisions: precisions,
      idAnnonceEnregistree: idAnnonceEnregistree,
      photos: [
        for (final p in photos)
          PhotoPersistee(
            id: p.id,
            original: p.cheminOriginal,
            preparee: p.cheminPrepare,
            pourAnalyse: p.pourAnalyse,
            envoyee: p.envoyee,
            fondEtat: p.fondEtat,
            modeIa: p.modeIa,
            message: p.message,
            consigne: p.consigne,
          ),
      ],
    );
  }

  Future<void> _sauver() async {
    if (photos.isEmpty &&
        champs == null &&
        etape == 'photos' &&
        precisions.trim().isEmpty) {
      await depot.effacer();
      return;
    }
    await depot.enregistrer(_construireEtat());
  }

  String _identifiant([String prefixe = 'p']) {
    final alea = Random().nextInt(1 << 20).toRadixString(36);
    return '$prefixe${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}$alea';
  }
}

abstract class CoffreJetons {
  Future<void> ecrire(String jeton, String email);
  Future<({String jeton, String email})?> lire();
  Future<void> effacer();
}

class CoffreMemoire implements CoffreJetons {
  String? jeton;
  String? email;

  @override
  Future<void> ecrire(String jeton, String email) async {
    this.jeton = jeton;
    this.email = email;
  }

  @override
  Future<({String jeton, String email})?> lire() async {
    final jetonLu = jeton;
    if (jetonLu == null) return null;
    return (jeton: jetonLu, email: email ?? '');
  }

  @override
  Future<void> effacer() async {
    jeton = null;
    email = null;
  }
}
