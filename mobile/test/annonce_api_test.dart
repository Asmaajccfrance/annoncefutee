import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart';

import 'package:annonce_futee/metier/annonce_api.dart';
import 'package:annonce_futee/metier/modeles.dart';

void main() {
  Uint8List jpeg() {
    final image = Image(width: 40, height: 40);
    image.clear(ColorRgb8(20, 40, 60));
    return encodeJpg(image);
  }

  Map<String, dynamic> credits() => {
        'unlimited': true,
        'remaining': null,
        'monthly': null,
        'used': 2,
        'analysis_cost': 1,
        'photo_cost': 5,
      };

  test('connexion, compte, analyse et photo : contrat du serveur, sans clé d\'IA', () async {
    final requetes = <http.Request>[];
    final client = MockClient((requete) async {
      requetes.add(requete);
      expect(requete.headers.values.join(' '), isNot(contains('sk-')));
      expect(requete.headers.keys, isNot(contains('x-api-key')));
      if (requete.url.path == '/api/v1/auth/login') {
        expect(requete.headers['authorization'], isNull);
        final corps = jsonDecode(requete.body) as Map<String, dynamic>;
        expect(corps['device_name'], 'android');
        return http.Response(jsonEncode({
          'token': 'jeton-test',
          'user': {'email': 'essai-chrome@annoncefutee.fr', 'name': 'Essai', 'test_account': true},
          'credits': credits(),
        }), 200);
      }
      expect(requete.headers['authorization'], 'Bearer jeton-test');
      if (requete.url.path == '/api/v1/me') {
        return http.Response(jsonEncode({
          'user': {'email': 'essai-chrome@annoncefutee.fr', 'test_account': true},
          'credits': credits(),
        }), 200);
      }
      if (requete.url.path == '/api/v1/auth/logout') {
        return http.Response(jsonEncode({'ok': true}), 200);
      }
      if (requete.url.path == '/api/v1/listings/analyze') {
        final corps = jsonDecode(requete.body) as Map<String, dynamic>;
        expect(corps['images'], hasLength(2));
        return http.Response(jsonEncode({
          'data': {
            'titre': 'Pull bleu',
            'description': 'Peu porté.',
            'categorie': 'Femmes',
            'sous_categorie': 'Pulls',
            'marque': 'Zara',
            'taille': 'M',
            'etat': 'Très bon état',
            'couleurs': ['Bleu'],
            'matiere': 'Laine',
            'prix_suggere': 18,
            'a_verifier': ['La marque'],
          },
          'credits': credits(),
        }), 200);
      }
      if (requete.url.path == '/api/v1/photos/enhance') {
        final corps = jsonDecode(requete.body) as Map<String, dynamic>;
        expect(corps['mode'], 'mannequin_femme');
        expect(corps['image'], isNotEmpty);
        expect(corps.containsKey('consigne'), isFalse);
        return http.Response(jsonEncode({
          'data': {'image': base64Encode(jpeg()), 'mode': 'mannequin_femme', 'generated_by_ai': true},
          'credits': credits(),
        }), 200);
      }
      return http.Response('{}', 404);
    });
    final api = AnnonceApi(client, baseUrl: 'https://annoncefutee.fr');
    expect(api.delai, const Duration(seconds: 150));

    final session = await api.connexion('essai-chrome@annoncefutee.fr', 'mot-de-passe');
    expect(session.jeton, 'jeton-test');
    expect(session.credits.unlimited, isTrue);
    expect(session.credits.compteTest, isTrue);
    expect(session.credits.photoCost, 5);

    final moi = await api.moi(session.jeton);
    expect(moi.libelle, 'Crédits IA : Illimités');

    final annonce = await api.analyser(session.jeton, ['aaaa', 'bbbb']);
    expect(annonce.data['titre'], 'Pull bleu');
    final photo = await api.ameliorer(session.jeton, base64Encode(jpeg()), 'mannequin_femme');
    expect(photo.mode, 'mannequin_femme');
    await api.deconnexion(session.jeton);
    expect(requetes.map((r) => r.url.path), [
      '/api/v1/auth/login',
      '/api/v1/me',
      '/api/v1/listings/analyze',
      '/api/v1/photos/enhance',
      '/api/v1/auth/logout',
    ]);
  });

  test('une demande libre part avec la photo, un texte vide ne part pas', () async {
    final requetes = <Map<String, dynamic>>[];
    final client = MockClient((requete) async {
      requetes.add(jsonDecode(requete.body) as Map<String, dynamic>);
      return http.Response(jsonEncode({
        'data': {'image': base64Encode(jpeg()), 'mode': 'studio', 'generated_by_ai': true},
        'credits': credits(),
      }), 200);
    });
    final api = AnnonceApi(client, baseUrl: 'https://annoncefutee.fr');
    await api.ameliorer('jeton', 'aaaa', 'studio', consigne: '  fond bleu ciel  ');
    await api.ameliorer('jeton', 'aaaa', 'studio', consigne: '   ');
    expect(requetes.first['consigne'], 'fond bleu ciel');
    expect(requetes.last.containsKey('consigne'), isFalse);
  });

  test('les réglages de rédaction partent avec l\'analyse', () async {
    final requetes = <Map<String, dynamic>>[];
    final client = MockClient((requete) async {
      requetes.add(jsonDecode(requete.body) as Map<String, dynamic>);
      return http.Response(jsonEncode({
        'data': {'titre': 'Veste', 'description': 'Courte'},
        'credits': credits(),
      }), 200);
    });
    final api = AnnonceApi(client, baseUrl: 'https://annoncefutee.fr');
    await api.analyser(
      'jeton',
      ['aaaa'],
      precisions: '  Taille L coupée  ',
      style: 'detaille',
      hashtags: false,
      signature: '  Envoi soigné  ',
    );
    expect(requetes.single['precisions'], 'Taille L coupée');
    expect(requetes.single['style'], 'detaille');
    expect(requetes.single['hashtags'], isFalse);
    expect(requetes.single['signature'], 'Envoi soigné');
  });

  test('changement de mot de passe et suppression du compte envoient PUT et DELETE', () async {
    final requetes = <(String, String, Map<String, dynamic>)>[];
    final client = MockClient((requete) async {
      requetes.add((
        requete.method,
        requete.url.path,
        jsonDecode(requete.body) as Map<String, dynamic>,
      ));
      return http.Response(jsonEncode({'ok': true}), 200);
    });
    final api = AnnonceApi(client, baseUrl: 'https://annoncefutee.fr');
    await api.changerMotDePasse(
      'jeton',
      actuel: 'ancienPass1',
      nouveau: 'nouveauPass2',
      confirmation: 'nouveauPass2',
    );
    await api.supprimerCompte('jeton', 'nouveauPass2');
    expect(requetes[0].$1, 'PUT');
    expect(requetes[0].$2, '/api/v1/me/password');
    expect(requetes[0].$3['current_password'], 'ancienPass1');
    expect(requetes[0].$3['password'], 'nouveauPass2');
    expect(requetes[1].$1, 'DELETE');
    expect(requetes[1].$2, '/api/v1/me');
    expect(requetes[1].$3['password'], 'nouveauPass2');
  });

  test('lecture des 4 forfaits et inscription sur l\'offre découverte', () async {
    final requetes = <http.Request>[];
    final client = MockClient((requete) async {
      requetes.add(requete);
      if (requete.url.path == '/api/v1/plans') {
        return http.Response(jsonEncode({
          'registration_open': true,
          'plans': [
            {'slug': 'free', 'name': 'Découverte', 'price_euros': 0, 'monthly_credits': 50, 'is_active': true},
            {'slug': 'essentiel', 'name': 'Essentiel', 'price_euros': 7, 'monthly_credits': 100, 'is_active': false},
            {'slug': 'vendeur', 'name': 'Vendeur', 'price_euros': 14, 'monthly_credits': 250, 'is_active': false},
            {'slug': 'boutique', 'name': 'Boutique', 'price_euros': 39, 'monthly_credits': 800, 'is_active': false},
          ],
        }), 200);
      }
      if (requete.url.path == '/api/v1/auth/register') {
        final corps = jsonDecode(requete.body) as Map<String, dynamic>;
        expect(corps['plan'], 'free');
        expect(corps['device_name'], 'android');
        return http.Response(jsonEncode({
          'token': 'jeton-neuf',
          'user': {'email': 'camille@example.com', 'name': 'Camille', 'plan_slug': 'free', 'plan_name': 'Découverte'},
          'credits': {'monthly': 30, 'remaining': 30, 'used': 0, 'unlimited': false},
        }), 201);
      }
      return http.Response('{}', 404);
    });
    final api = AnnonceApi(client, baseUrl: 'https://annoncefutee.fr');
    final catalogue = await api.forfaits();
    expect(catalogue.inscriptionsOuvertes, isTrue);
    expect(catalogue.forfaits.map((f) => f.prixEuros), [0, 7, 14, 39]);
    expect(catalogue.forfaits.map((f) => f.actif), [true, false, false, false]);

    final session = await api.inscrire(
      nom: 'Camille',
      email: 'camille@example.com',
      motDePasse: 'motdepasse1',
      confirmation: 'motdepasse1',
    );
    expect(session.jeton, 'jeton-neuf');
    expect(session.credits.forfaitNom, 'Découverte');
  });

  test('accès fermé, identifiants refusés et délai dépassé ont un message clair', () async {
    final ferme = AnnonceApi(MockClient((_) async => http.Response(jsonEncode({
      'message': 'Le service n\'est pas encore ouvert.',
      'code': 'client_access_closed',
    }), 403)), baseUrl: 'https://annoncefutee.fr');
    expect(
      () => ferme.connexion('autre@exemple.fr', 'secret'),
      throwsA(predicate((Object e) => e is ErreurApi && e.message.contains('Accès fermé') && !e.message.contains('secret'))),
    );

    final mauvais = AnnonceApi(MockClient((_) async => http.Response(jsonEncode({
      'message': 'Identifiants incorrects.',
      'errors': {'email': ['Identifiants incorrects.']},
    }), 422)), baseUrl: 'https://annoncefutee.fr');
    expect(
      () => mauvais.connexion('a@b.c', 'secret'),
      throwsA(predicate((Object e) => e is ErreurApi && e.statut == 422 && e.message == 'Identifiants incorrects.')),
    );

    final lent = AnnonceApi(
      MockClient((_) => Future.delayed(const Duration(milliseconds: 40), () => http.Response('{}', 200))),
      baseUrl: 'https://annoncefutee.fr',
      delai: const Duration(milliseconds: 5),
    );
    expect(
      () => lent.analyser('jeton', ['aaaa']),
      throwsA(predicate((Object e) => e is ErreurApi && e.code == 'timeout')),
    );
  });

  test('le résultat serveur devient des champs modifiables', () {
    final champs = ChampsAnnonce.depuisServeur({
      'titre': 'Robe',
      'description': 'Longue',
      'prix_suggere': 12.5,
      'couleurs': ['Noir', 'Blanc'],
      'a_verifier': ['La taille'],
    });
    expect(champs.prix, '12.5');
    expect(champs.couleurs, 'Noir, Blanc');
    expect(champs.aVerifier, 'La taille');
    champs.definir('titre', 'Robe noire');
    final recu = ChampsAnnonce.depuisServeur({'titre': 'Autre', 'description': 'Nouvelle'});
    champs.fusionnerSansEcraser(recu);
    expect(champs.titre, 'Robe noire');
    expect(champs.description, 'Nouvelle');
  });
}
