import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'modeles.dart';

class ResultatAnalyse {
  ResultatAnalyse(this.data, this.credits);
  final Map<String, dynamic> data;
  final CompteCredits? credits;
}

class ResultatPhoto {
  ResultatPhoto(this.imageBase64, this.mode, this.credits);
  final String imageBase64;
  final String mode;
  final CompteCredits? credits;
}

class SessionOuverte {
  SessionOuverte(this.jeton, this.credits);
  final String jeton;
  final CompteCredits credits;
}

abstract class ClientAnnonce {
  Future<CatalogueForfaits> forfaits();
  Future<SessionOuverte> inscrire({
    required String nom,
    required String email,
    required String motDePasse,
    required String confirmation,
    String forfait = 'free',
  });
  Future<SessionOuverte> connexion(String email, String motDePasse);
  Future<CompteCredits> moi(String jeton);
  Future<void> deconnexion(String jeton);
  Future<void> changerMotDePasse(
    String jeton, {
    required String actuel,
    required String nouveau,
    required String confirmation,
  });
  Future<void> supprimerCompte(String jeton, String motDePasse);
  Future<ResultatAnalyse> analyser(
    String jeton,
    List<String> images, {
    String precisions = '',
    String style = 'normal',
    bool hashtags = true,
    String signature = '',
  });
  Future<ResultatPhoto> ameliorer(String jeton, String image, String mode, {String consigne = ''});
}

class AnnonceApi implements ClientAnnonce {
  AnnonceApi(
    this._client, {
    required this.baseUrl,
    this.delai = const Duration(seconds: 150),
  });

  final http.Client _client;
  final String baseUrl;
  final Duration delai;

  @override
  Future<CatalogueForfaits> forfaits() async {
    final json = await _envoyer('GET', '/api/v1/plans', jeton: null);
    final liste = json['plans'];
    final items = <ForfaitOffre>[];
    if (liste is List) {
      for (final brut in liste) {
        if (brut is Map) {
          items.add(ForfaitOffre.depuisJson(Map<String, dynamic>.from(brut)));
        }
      }
    }
    return CatalogueForfaits(
      inscriptionsOuvertes: json['registration_open'] != false,
      forfaits: items.isEmpty ? ForfaitOffre.parDefaut : items,
    );
  }

  @override
  Future<SessionOuverte> inscrire({
    required String nom,
    required String email,
    required String motDePasse,
    required String confirmation,
    String forfait = 'free',
  }) async {
    final json = await _envoyer(
      'POST',
      '/api/v1/auth/register',
      jeton: null,
      corps: {
        'name': nom.trim(),
        'email': email.trim(),
        'password': motDePasse,
        'password_confirmation': confirmation,
        'plan': forfait,
        'device_name': 'android',
      },
    );
    final jeton = json['token'];
    if (jeton is! String || jeton.isEmpty) {
      throw ErreurApi('Inscription impossible.', code: 'reponse');
    }
    return SessionOuverte(
      jeton,
      CompteCredits.depuisReponse(json, emailSecours: email.trim()),
    );
  }

  @override
  Future<SessionOuverte> connexion(String email, String motDePasse) async {
    final json = await _envoyer(
      'POST',
      '/api/v1/auth/login',
      jeton: null,
      corps: {
        'email': email.trim(),
        'password': motDePasse,
        'device_name': 'android',
      },
    );
    final jeton = json['token'];
    if (jeton is! String || jeton.isEmpty) {
      throw ErreurApi('Connexion impossible.', code: 'reponse');
    }
    return SessionOuverte(
      jeton,
      CompteCredits.depuisReponse(json, emailSecours: email.trim()),
    );
  }

  @override
  Future<CompteCredits> moi(String jeton) async {
    final json = await _envoyer('GET', '/api/v1/me', jeton: jeton);
    return CompteCredits.depuisReponse(json);
  }

  @override
  Future<void> deconnexion(String jeton) async {
    await _envoyer('POST', '/api/v1/auth/logout', jeton: jeton);
  }

  @override
  Future<void> changerMotDePasse(
    String jeton, {
    required String actuel,
    required String nouveau,
    required String confirmation,
  }) async {
    await _envoyer(
      'PUT',
      '/api/v1/me/password',
      jeton: jeton,
      corps: {
        'current_password': actuel,
        'password': nouveau,
        'password_confirmation': confirmation,
      },
    );
  }

  @override
  Future<void> supprimerCompte(String jeton, String motDePasse) async {
    await _envoyer(
      'DELETE',
      '/api/v1/me',
      jeton: jeton,
      corps: {'password': motDePasse},
    );
  }

  @override
  Future<ResultatAnalyse> analyser(
    String jeton,
    List<String> images, {
    String precisions = '',
    String style = 'normal',
    bool hashtags = true,
    String signature = '',
  }) async {
    final texteSignature = signature.trim();
    final json = await _envoyer(
      'POST',
      '/api/v1/listings/analyze',
      jeton: jeton,
      corps: {
        'images': images,
        'precisions': precisions.trim(),
        'style': StylesAnnonce.normaliser(style),
        'hashtags': hashtags,
        if (texteSignature.isNotEmpty) 'signature': texteSignature,
      },
    );
    final data = json['data'];
    if (data is! Map) {
      throw ErreurApi('L\'annonce reçue est incomplète.', code: 'reponse');
    }
    return ResultatAnalyse(
      Map<String, dynamic>.from(data),
      CompteCredits.depuisReponse(json),
    );
  }

  @override
  Future<ResultatPhoto> ameliorer(
    String jeton,
    String image,
    String mode, {
    String consigne = '',
  }) async {
    final demande = consigne.trim();
    final json = await _envoyer(
      'POST',
      '/api/v1/photos/enhance',
      jeton: jeton,
      corps: {
        'image': image,
        'mode': mode,
        if (demande.isNotEmpty) 'consigne': demande,
      },
    );
    final data = json['data'];
    final photo = data is Map ? data['image'] : null;
    if (photo is! String || photo.isEmpty) {
      throw ErreurApi('Le serveur n\'a pas renvoyé d\'image.', code: 'reponse');
    }
    return ResultatPhoto(photo, mode, CompteCredits.depuisReponse(json));
  }

  Future<Map<String, dynamic>> _envoyer(
    String methode,
    String chemin, {
    required String? jeton,
    Map<String, dynamic>? corps,
  }) async {
    final uri = Uri.parse(baseUrl).replace(path: chemin);
    final entetes = <String, String>{
      'accept': 'application/json',
      'content-type': 'application/json',
    };
    if (jeton != null && jeton.isNotEmpty) {
      entetes['authorization'] = 'Bearer $jeton';
    }
    try {
      final body = corps == null ? null : jsonEncode(corps);
      final Future<http.Response> future;
      switch (methode) {
        case 'GET':
          future = _client.get(uri, headers: entetes);
        case 'PUT':
          future = _client.put(uri, headers: entetes, body: body);
        case 'DELETE':
          future = _client.delete(uri, headers: entetes, body: body);
        default:
          future = _client.post(uri, headers: entetes, body: body);
      }
      final reponse = await future.timeout(delai);
      return _lire(reponse);
    } on ErreurApi {
      rethrow;
    } on TimeoutException {
      throw ErreurApi(
        'Le serveur a mis trop de temps à répondre. Aucune nouvelle demande n\'est relancée.',
        code: 'timeout',
      );
    } on http.ClientException {
      throw ErreurApi('Serveur injoignable.', code: 'reseau');
    } catch (_) {
      throw ErreurApi('Serveur injoignable.', code: 'reseau');
    }
  }

  Map<String, dynamic> _lire(http.Response reponse) {
    Map<String, dynamic> json = {};
    if (reponse.body.isNotEmpty) {
      try {
        final decode = jsonDecode(reponse.body);
        if (decode is Map) json = Map<String, dynamic>.from(decode);
      } catch (_) {
        json = {};
      }
    }
    if (reponse.statusCode >= 200 && reponse.statusCode < 300) return json;
    throw ErreurApi(
      _message(json, reponse.statusCode),
      statut: reponse.statusCode,
      code: json['code']?.toString(),
    );
  }

  String _message(Map<String, dynamic> json, int statut) {
    final code = json['code']?.toString();
    if (code == 'client_access_closed') {
      return 'Accès fermé pour ce compte. Ce n\'est pas une panne.';
    }
    if (code == 'registration_closed') {
      return 'Les inscriptions ouvriront très bientôt. Si tu as déjà un accès, connecte-toi.';
    }
    final message = json['message'];
    if (message is String &&
        message.isNotEmpty &&
        !message.startsWith('validation.')) {
      return message;
    }
    final errors = json['errors'];
    if (errors is Map) {
      for (final valeur in errors.values) {
        if (valeur is List && valeur.isNotEmpty) return valeur.first.toString();
        if (valeur is String && valeur.isNotEmpty) return valeur;
      }
    }
    if (statut == 401) return 'Session expirée. Reconnecte-toi.';
    if (statut == 422) return 'Les informations envoyées ont été refusées.';
    return 'La demande a échoué.';
  }
}
