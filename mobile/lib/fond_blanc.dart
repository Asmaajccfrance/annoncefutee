import 'package:flutter/services.dart';

class FondBlancCanal {
  static const canal = MethodChannel('annonce_futee/fond_blanc');

  Future<Uint8List?> appliquer(String chemin) async {
    try {
      return await canal.invokeMethod<Uint8List>('appliquer', {'chemin': chemin});
    } catch (_) {
      return null;
    }
  }
}
