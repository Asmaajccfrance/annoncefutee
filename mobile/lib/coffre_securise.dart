import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'metier/session_annonce.dart';

class CoffreSecurise implements CoffreJetons {
  CoffreSecurise({FlutterSecureStorage? stockage})
      : _stockage = stockage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _stockage;

  @override
  Future<void> ecrire(String jeton, String email) async {
    await _stockage.write(key: 'jeton', value: jeton);
    await _stockage.write(key: 'email', value: email);
  }

  @override
  Future<({String email, String jeton})?> lire() async {
    final jeton = await _stockage.read(key: 'jeton');
    if (jeton == null || jeton.isEmpty) return null;
    final email = await _stockage.read(key: 'email') ?? '';
    return (jeton: jeton, email: email);
  }

  @override
  Future<void> effacer() async {
    await _stockage.delete(key: 'jeton');
    await _stockage.delete(key: 'email');
  }
}
