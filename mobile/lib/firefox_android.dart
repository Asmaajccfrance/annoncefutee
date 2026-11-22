import 'dart:convert';

import 'package:flutter/services.dart';

import 'metier/modeles.dart';
import 'post_it.dart';

/// Ouvre `vinted.fr/items/new` directement dans Firefox Android en lui transmettant
/// l'annonce encodée dans le fragment `#af=...` (intercepté et nettoyé immédiatement
/// par l'extension Firefox Annonce Futée pour autocompléter sans copier-coller).
class FirefoxAndroidCanal {
  const FirefoxAndroidCanal();

  static const canal = MethodChannel('annonce_futee/firefox');

  static String construireUrlAutocompletion(ChampsAnnonce champs) {
    final donnees = PostItCanal.preparerChamps(champs);
    if (donnees.isEmpty) return 'https://www.vinted.fr/items/new';
    final jsonOctets = utf8.encode(jsonEncode(donnees));
    final jetonUrl = base64Url.encode(jsonOctets).replaceAll('=', '');
    return 'https://www.vinted.fr/items/new#af=$jetonUrl';
  }

  /// Retourne `'ouvert'`, `'absent'` (Firefox non installé) ou `'erreur'`.
  Future<String> ouvrir(ChampsAnnonce champs) async {
    try {
      final url = construireUrlAutocompletion(champs);
      return await canal.invokeMethod<String>('ouvrir', {'url': url}) ??
          'erreur';
    } catch (_) {
      return 'erreur';
    }
  }
}
