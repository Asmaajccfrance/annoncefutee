import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'modeles.dart';

class PhotoPersistee {
  PhotoPersistee({
    required this.id,
    required this.original,
    this.preparee,
    required this.pourAnalyse,
    required this.envoyee,
    required this.fondEtat,
    this.modeIa,
    this.message = '',
    this.consigne = '',
  });

  final String id;
  final String original;
  final String? preparee;
  final bool pourAnalyse;
  final bool envoyee;
  final String fondEtat;
  final String? modeIa;
  final String message;
  final String consigne;
}

class PreferencesRedaction {
  const PreferencesRedaction({
    this.style = 'normal',
    this.hashtags = true,
    this.signature = '',
  });

  final String style;
  final bool hashtags;
  final String signature;
}

class EtatBrouillon {
  EtatBrouillon({
    required this.etape,
    required this.analyseEtat,
    required this.analyseMessage,
    required this.idsAnalyse,
    required this.photos,
    this.champs,
    this.precisions = '',
    this.idAnnonceEnregistree,
  });

  final String etape;
  final String analyseEtat;
  final String analyseMessage;
  final List<String> idsAnalyse;
  final List<PhotoPersistee> photos;
  final Map<String, dynamic>? champs;
  final String precisions;
  final String? idAnnonceEnregistree;
}

class DepotBrouillon {
  DepotBrouillon(this.racine);

  final Directory racine;
  static final RegExp _idSain = RegExp(r'^[a-z0-9]+$');
  static final Map<String, Future<void>> _verrous = {};

  static Future<void> attendre(String chemin) {
    return _verrous[Directory(chemin).absolute.path] ?? Future<void>.value();
  }

  File get _etat => File('${racine.path}${Platform.pathSeparator}etat.json');
  File get _preferences =>
      File('${racine.path}${Platform.pathSeparator}preferences.json');
  Directory get _enregistrees =>
      Directory('${racine.path}${Platform.pathSeparator}enregistrees');

  Future<T> _exclusif<T>(Future<T> Function() action) {
    final cle = racine.absolute.path;
    final precedent = _verrous[cle] ?? Future<void>.value();
    final resultat = precedent.then((_) => action());
    _verrous[cle] = resultat.then((_) {}, onError: (_) {});
    return resultat;
  }

  Future<void> ecrireOriginal(String id, Uint8List octets) {
    return _exclusif(() async {
      final fichier = File('${racine.path}${Platform.pathSeparator}$id.jpg');
      await racine.create(recursive: true);
      await fichier.writeAsBytes(octets, flush: true);
    });
  }

  Future<void> ecrirePreparee(String id, Uint8List octets) {
    return _exclusif(() async {
      final fichier =
          File('${racine.path}${Platform.pathSeparator}$id-preparee.jpg');
      await racine.create(recursive: true);
      await fichier.writeAsBytes(octets, flush: true);
    });
  }

  Future<void> supprimerPreparee(String id) {
    return _exclusif(() async {
      final fichier =
          File('${racine.path}${Platform.pathSeparator}$id-preparee.jpg');
      if (await fichier.exists()) await fichier.delete();
    });
  }

  Future<void> enregistrer(EtatBrouillon etat) {
    return _exclusif(() async {
      await racine.create(recursive: true);
      await _etat.writeAsString(jsonEncode(_encoderEtat(etat)), flush: true);
    });
  }

  Map<String, dynamic> _encoderEtat(
    EtatBrouillon etat, {
    String? dateModification,
    String? idForce,
  }) {
    final idEnregistre = idForce ?? etat.idAnnonceEnregistree;
    return {
      'version': 1,
      'dateModification': ?dateModification,
      if (idEnregistre != null && idEnregistre.isNotEmpty)
        'idAnnonceEnregistree': idEnregistre,
      'etape': etat.etape,
      'analyseEtat': etat.analyseEtat,
      'analyseMessage': etat.analyseMessage,
      'idsAnalyse': etat.idsAnalyse,
      'champs': etat.champs,
      'precisions': etat.precisions,
      'photos': [
        for (final p in etat.photos)
          {
            'id': p.id,
            'pourAnalyse': p.pourAnalyse,
            'envoyee': p.envoyee,
            'fondEtat': p.fondEtat,
            'modeIa': p.modeIa,
            'message': p.message,
            'consigne': p.consigne,
            'preparee': p.preparee != null,
          },
      ],
    };
  }

  Future<EtatBrouillon?> charger() {
    return _exclusif(() => _lireDepuisDossier(racine, _etat));
  }

  Future<EtatBrouillon?> _lireDepuisDossier(
    Directory dossier,
    File fichierJson,
  ) async {
    if (!await fichierJson.exists()) return null;
    final Object? decode;
    try {
      decode = jsonDecode(await fichierJson.readAsString());
    } catch (_) {
      return null;
    }
    if (decode is! Map) return null;
    final photos = <PhotoPersistee>[];
    final liste = decode['photos'];
    if (liste is List) {
      for (final item in liste) {
        if (item is! Map) continue;
        final id = (item['id'] ?? '').toString();
        if (!_idSain.hasMatch(id)) continue;
        final original = File('${dossier.path}/$id.jpg');
        if (!await original.exists()) continue;
        final preparee = File('${dossier.path}/$id-preparee.jpg');
        photos.add(
          PhotoPersistee(
            id: id,
            original: original.path,
            preparee: await preparee.exists() ? preparee.path : null,
            pourAnalyse: item['pourAnalyse'] == true,
            envoyee: item['envoyee'] == true,
            fondEtat: (item['fondEtat'] ?? 'aucune').toString(),
            modeIa: item['modeIa']?.toString(),
            message: (item['message'] ?? '').toString(),
            consigne: (item['consigne'] ?? '').toString(),
          ),
        );
      }
    }
    final ids = decode['idsAnalyse'];
    final champs = decode['champs'];
    final idEnregistre = decode['idAnnonceEnregistree']?.toString();
    return EtatBrouillon(
      etape: (decode['etape'] ?? 'photos').toString(),
      analyseEtat: (decode['analyseEtat'] ?? 'aucune').toString(),
      analyseMessage: (decode['analyseMessage'] ?? '').toString(),
      idsAnalyse: ids is List ? ids.map((e) => e.toString()).toList() : [],
      photos: photos,
      champs: champs is Map ? Map<String, dynamic>.from(champs) : null,
      precisions: (decode['precisions'] ?? '').toString(),
      idAnnonceEnregistree:
          idEnregistre != null && _idSain.hasMatch(idEnregistre)
          ? idEnregistre
          : null,
    );
  }

  Future<AnnonceResume> sauvegarderAnnonce({
    required String id,
    required EtatBrouillon etat,
  }) {
    if (!_idSain.hasMatch(id)) {
      throw ArgumentError('Identifiant d\'annonce invalide.');
    }
    return _exclusif(() async {
      final dossier = Directory(
        '${_enregistrees.path}${Platform.pathSeparator}$id',
      );
      await dossier.create(recursive: true);
      final attendus = <String>{'annonce.json'};
      for (final p in etat.photos) {
        if (!_idSain.hasMatch(p.id)) continue;
        final nomOriginal = '${p.id}.jpg';
        attendus.add(nomOriginal);
        final sourceOrig = File(p.original);
        final cibleOrig = File(
          '${dossier.path}${Platform.pathSeparator}$nomOriginal',
        );
        if (await sourceOrig.exists() &&
            sourceOrig.absolute.path != cibleOrig.absolute.path) {
          await sourceOrig.copy(cibleOrig.path);
        }
        final cheminPrep = p.preparee;
        if (cheminPrep != null) {
          final sourcePrep = File(cheminPrep);
          if (await sourcePrep.exists()) {
            final nomPrep = '${p.id}-preparee.jpg';
            attendus.add(nomPrep);
            final ciblePrep = File(
              '${dossier.path}${Platform.pathSeparator}$nomPrep',
            );
            if (sourcePrep.absolute.path != ciblePrep.absolute.path) {
              await sourcePrep.copy(ciblePrep.path);
            }
          }
        }
      }
      await for (final entite in dossier.list()) {
        final nom = entite.uri.pathSegments.isEmpty
            ? ''
            : entite.uri.pathSegments.last;
        if (entite is File && !attendus.contains(nom)) {
          await entite.delete();
        }
      }
      final maintenant = DateTime.now().toUtc();
      final json = _encoderEtat(
        etat,
        dateModification: maintenant.toIso8601String(),
        idForce: id,
      );
      final fichierJson = File(
        '${dossier.path}${Platform.pathSeparator}annonce.json',
      );
      await fichierJson.writeAsString(jsonEncode(json), flush: true);
      return _resumeDepuisJson(id, dossier, json, maintenant);
    });
  }

  Future<List<AnnonceResume>> listerAnnonces() {
    return _exclusif(() async {
      if (!await _enregistrees.exists()) return <AnnonceResume>[];
      final resumes = <AnnonceResume>[];
      await for (final entite in _enregistrees.list()) {
        if (entite is! Directory) continue;
        final segments = entite.uri.pathSegments
            .where((s) => s.isNotEmpty)
            .toList();
        if (segments.isEmpty) continue;
        final id = segments.last;
        if (!_idSain.hasMatch(id)) continue;
        final fichier = File(
          '${entite.path}${Platform.pathSeparator}annonce.json',
        );
        if (!await fichier.exists()) continue;
        try {
          final decode = jsonDecode(await fichier.readAsString());
          if (decode is! Map) continue;
          final map = Map<String, dynamic>.from(decode);
          final dateBrute = map['dateModification']?.toString();
          final date =
              (dateBrute == null ? null : DateTime.tryParse(dateBrute)) ??
              await fichier.lastModified();
          resumes.add(await _resumeAvecVignette(id, entite, map, date));
        } catch (_) {
          continue;
        }
      }
      resumes.sort(
        (a, b) => b.dateModification.compareTo(a.dateModification),
      );
      return resumes;
    });
  }

  Future<AnnonceResume> _resumeAvecVignette(
    String id,
    Directory dossier,
    Map<String, dynamic> json,
    DateTime date,
  ) async {
    String? vignette;
    var nbPhotos = 0;
    final liste = json['photos'];
    if (liste is List) {
      for (final item in liste) {
        if (item is! Map) continue;
        final photoId = (item['id'] ?? '').toString();
        if (!_idSain.hasMatch(photoId)) continue;
        final orig = File('${dossier.path}/$photoId.jpg');
        if (!await orig.exists()) continue;
        nbPhotos++;
        if (vignette == null) {
          final prep = File('${dossier.path}/$photoId-preparee.jpg');
          vignette = await prep.exists() ? prep.path : orig.path;
        }
      }
    }
    final champs = json['champs'];
    final mapChamps = champs is Map
        ? Map<String, dynamic>.from(champs)
        : <String, dynamic>{};
    return AnnonceResume(
      id: id,
      titre: (mapChamps['titre'] ?? '').toString(),
      prix: (mapChamps['prix'] ?? '').toString(),
      categorie: (mapChamps['categorie'] ?? '').toString(),
      nombrePhotos: nbPhotos,
      dateModification: date,
      cheminVignette: vignette,
    );
  }

  AnnonceResume _resumeDepuisJson(
    String id,
    Directory dossier,
    Map<String, dynamic> json,
    DateTime date,
  ) {
    String? vignette;
    var nbPhotos = 0;
    final liste = json['photos'];
    if (liste is List) {
      for (final item in liste) {
        if (item is! Map) continue;
        final photoId = (item['id'] ?? '').toString();
        if (!_idSain.hasMatch(photoId)) continue;
        nbPhotos++;
        vignette ??= item['preparee'] == true
            ? '${dossier.path}/$photoId-preparee.jpg'
            : '${dossier.path}/$photoId.jpg';
      }
    }
    final champs = json['champs'];
    final mapChamps = champs is Map
        ? Map<String, dynamic>.from(champs)
        : <String, dynamic>{};
    return AnnonceResume(
      id: id,
      titre: (mapChamps['titre'] ?? '').toString(),
      prix: (mapChamps['prix'] ?? '').toString(),
      categorie: (mapChamps['categorie'] ?? '').toString(),
      nombrePhotos: nbPhotos,
      dateModification: date,
      cheminVignette: vignette,
    );
  }

  Future<EtatBrouillon?> chargerAnnonceEnregistree(String id) {
    if (!_idSain.hasMatch(id)) return Future.value(null);
    return _exclusif(() async {
      final dossier = Directory(
        '${_enregistrees.path}${Platform.pathSeparator}$id',
      );
      final fichierJson = File(
        '${dossier.path}${Platform.pathSeparator}annonce.json',
      );
      final lu = await _lireDepuisDossier(dossier, fichierJson);
      if (lu == null) return null;
      await _nettoyerBrouillonActif();
      await racine.create(recursive: true);
      final photosRestaurees = <PhotoPersistee>[];
      for (final p in lu.photos) {
        final cibleOrig = File('${racine.path}/${p.id}.jpg');
        await File(p.original).copy(cibleOrig.path);
        String? ciblePrepChemin;
        final prepSource = p.preparee;
        if (prepSource != null && await File(prepSource).exists()) {
          final ciblePrep = File('${racine.path}/${p.id}-preparee.jpg');
          await File(prepSource).copy(ciblePrep.path);
          ciblePrepChemin = ciblePrep.path;
        }
        photosRestaurees.add(
          PhotoPersistee(
            id: p.id,
            original: cibleOrig.path,
            preparee: ciblePrepChemin,
            pourAnalyse: p.pourAnalyse,
            envoyee: p.envoyee,
            fondEtat: p.fondEtat,
            modeIa: p.modeIa,
            message: '',
            consigne: p.consigne,
          ),
        );
      }
      final etapeCible = lu.champs != null
          ? 'annonce'
          : (photosRestaurees.isNotEmpty ? 'preparation' : 'photos');
      final restaure = EtatBrouillon(
        etape: etapeCible,
        analyseEtat: lu.champs != null ? 'prete' : 'aucune',
        analyseMessage: '',
        idsAnalyse: lu.idsAnalyse,
        photos: photosRestaurees,
        champs: lu.champs,
        precisions: lu.precisions,
        idAnnonceEnregistree: id,
      );
      await _etat.writeAsString(
        jsonEncode(_encoderEtat(restaure)),
        flush: true,
      );
      return restaure;
    });
  }

  Future<void> supprimerAnnonceEnregistree(String id) {
    if (!_idSain.hasMatch(id)) return Future.value();
    return _exclusif(() async {
      final dossier = Directory(
        '${_enregistrees.path}${Platform.pathSeparator}$id',
      );
      if (await dossier.exists()) {
        await dossier.delete(recursive: true);
      }
    });
  }

  Future<PreferencesRedaction> chargerPreferences() {
    return _exclusif(() async {
      if (!await _preferences.exists()) return const PreferencesRedaction();
      try {
        final decode = jsonDecode(await _preferences.readAsString());
        if (decode is! Map) return const PreferencesRedaction();
        final style = (decode['style'] ?? 'normal').toString();
        final hashtags = decode['hashtags'] is bool
            ? decode['hashtags'] as bool
            : true;
        final signature = (decode['signature'] ?? '').toString();
        return PreferencesRedaction(
          style: style,
          hashtags: hashtags,
          signature: signature,
        );
      } catch (_) {
        return const PreferencesRedaction();
      }
    });
  }

  Future<void> enregistrerPreferences(PreferencesRedaction prefs) {
    return _exclusif(() async {
      await racine.create(recursive: true);
      final json = {
        'style': prefs.style,
        'hashtags': prefs.hashtags,
        'signature': prefs.signature,
      };
      await _preferences.writeAsString(jsonEncode(json), flush: true);
    });
  }

  Future<void> effacer() {
    return _exclusif(_nettoyerBrouillonActif);
  }

  Future<void> toutEffacer() {
    return _exclusif(() async {
      if (await racine.exists()) {
        await racine.delete(recursive: true);
      }
    });
  }

  Future<void> _nettoyerBrouillonActif() async {
    if (!await racine.exists()) return;
    final garderPrefs = await _preferences.exists();
    final garderAnnonces = await _enregistrees.exists();
    if (!garderPrefs && !garderAnnonces) {
      await racine.delete(recursive: true);
      return;
    }
    await for (final entite in racine.list()) {
      if (entite is File && entite.path != _preferences.path) {
        await entite.delete();
      } else if (entite is Directory && entite.path != _enregistrees.path) {
        await entite.delete(recursive: true);
      }
    }
  }
}
