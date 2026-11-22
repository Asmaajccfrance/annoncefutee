import 'package:flutter/services.dart';

import 'metier/modeles.dart';
import 'post_it.dart';

/// Pont vers l'Extension Web Safari iOS (via App Group `group.fr.annoncefutee.partage`).
/// Permet à Safari sur iPhone de pré-remplir automatiquement l'annonce sur `vinted.fr/items/new`.
class SafariIosCanal {
  const SafariIosCanal();

  static const canal = MethodChannel('annonce_futee/safari_partage');

  Future<bool> enregistrerPourSafari(ChampsAnnonce champs) async {
    try {
      final donnees = PostItCanal.preparerChamps(champs);
      if (donnees.isEmpty) return false;
      return await canal.invokeMethod<bool>(
            'enregistrer',
            {'champs': donnees},
          ) ??
          false;
    } catch (_) {
      return false;
    }
  }

  Future<void> effacer() async {
    try {
      await canal.invokeMethod<bool>('effacer');
    } catch (_) {}
  }
}
