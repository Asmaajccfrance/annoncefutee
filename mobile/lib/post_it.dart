import 'package:flutter/services.dart';

import 'metier/modeles.dart';

class PostItCanal {
  const PostItCanal();

  static const canal = MethodChannel('annonce_futee/post_it');

  static Map<String, String> preparerChamps(ChampsAnnonce champs) {
    return {
      for (final cle in const [
        'titre',
        'prix',
        'description',
        'marque',
        'etat',
        'taille',
        'couleurs',
        'matiere',
        'categorie',
        'sousCategorie',
      ])
        if (champs.valeur(cle).trim().isNotEmpty)
          cle: champs.valeur(cle).trim(),
    };
  }

  Future<bool> autorise() async {
    try {
      return await canal.invokeMethod<bool>('autorise') ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> demanderAutorisation() async {
    try {
      return await canal.invokeMethod<bool>('demanderAutorisation') ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> afficher(ChampsAnnonce champs) async {
    try {
      final donnees = preparerChamps(champs);
      if (donnees.isEmpty) return false;
      return await canal.invokeMethod<bool>(
            'afficher',
            {'champs': donnees},
          ) ??
          false;
    } catch (_) {
      return false;
    }
  }

  Future<void> fermer() async {
    try {
      await canal.invokeMethod<bool>('fermer');
    } catch (_) {}
  }

  Future<bool> actif() async {
    try {
      return await canal.invokeMethod<bool>('actif') ?? false;
    } catch (_) {
      return false;
    }
  }
}
