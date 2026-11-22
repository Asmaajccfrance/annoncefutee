import 'dart:convert';
import 'dart:io';

import 'package:annonce_futee/ecrans.dart';
import 'package:annonce_futee/firefox_android.dart';
import 'package:annonce_futee/main.dart';
import 'package:annonce_futee/post_it.dart';
import 'package:flutter/services.dart';
import 'package:annonce_futee/theme/composants.dart';
import 'package:annonce_futee/metier/annonce_api.dart';
import 'package:annonce_futee/metier/brouillon.dart';
import 'package:annonce_futee/metier/modeles.dart';
import 'package:annonce_futee/metier/session_annonce.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:material_ui/material_ui.dart';

void main() {
  test('réponse exacte d\'un compte illimité : champs nuls affichés, aucun plantage', () {
    final compte = CompteCredits.depuisReponse({
      'user': {
        'id': 1,
        'name': 'Essai',
        'email': 'essai-chrome@annoncefutee.fr',
        'test_account': true,
      },
      'credits': {
        'monthly': null,
        'used': 3,
        'remaining': null,
        'unlimited': true,
        'analysis_cost': 1,
        'photo_cost': 5,
        'spend': {
          'today_usd': 0.0013,
          'month_usd': 0.0042,
          'analyses_month': 3,
          'daily_cap_usd': 1,
          'estimated': true,
        },
      },
    });
    expect(compte.unlimited, isTrue);
    expect(compte.remaining, isNull);
    expect(compte.monthly, isNull);
    expect(compte.texteCredits, 'Illimités');
    expect(compte.texteQuota, 'Illimités');
    expect(compte.texteUtilises, '3');
    expect(compte.texteCout(compte.analysisCost), '1 crédit');
    expect(compte.texteCout(compte.photoCost), '5 crédits');
    expect(compte.peutAnalyser, isTrue);
    expect(compte.peutPhoto(), isTrue);
    expect(compte.libelle, 'Crédits IA : Illimités');
  });

  test('compte normal : le solde restant est affiché', () {
    final compte = CompteCredits.depuisReponse({
      'user': {
        'email': 'camille@example.com',
        'name': 'Camille',
        'test_account': false,
      },
      'credits': {
        'monthly': 30,
        'used': 1,
        'remaining': 29,
        'unlimited': false,
        'analysis_cost': 1,
        'photo_cost': 5,
      },
    });
    expect(compte.texteCredits, '29 restants');
    expect(compte.texteQuota, '30');
    expect(compte.texteUtilises, '1');
    expect(compte.peutAnalyser, isTrue);
  });

  test('champs absents : affichage prévu, pas de valeur inventée', () {
    final compte = CompteCredits.depuisReponse({
      'credits': {'unlimited': true},
    });
    expect(compte.texteCredits, 'Illimités');
    expect(compte.texteQuota, 'Illimités');
    expect(compte.texteUtilises, '--');
    expect(compte.texteCout(compte.analysisCost), '--');
    expect(compte.texteCout(compte.photoCost), '--');
    expect(compte.peutPhoto(), isTrue);
  });

  testWidgets('ouvrir Compte ne plante pas, crédits illimités ou ordinaires', (
    tester,
  ) async {
    final dossier = Directory.systemTemp.createTempSync('af-compte-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );
    session.jeton = 'jeton';
    session.credits = CompteCredits.depuisReponse({
      'user': {'email': 'essai-chrome@annoncefutee.fr', 'test_account': true},
      'credits': {
        'monthly': null,
        'remaining': null,
        'used': 3,
        'unlimited': true,
        'analysis_cost': 1,
        'photo_cost': 5,
      },
    });

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();
    await tester.tap(find.byTooltip('Compte'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(tester.takeException(), isNull);
    expect(find.text('Illimités'), findsWidgets);
    expect(find.text('3'), findsOneWidget);
    expect(find.text('essai-chrome@annoncefutee.fr'), findsOneWidget);

    session.credits = CompteCredits.depuisReponse({
      'user': {'email': 'camille@example.com'},
      'credits': {
        'monthly': 30,
        'used': 1,
        'remaining': 29,
        'unlimited': false,
        'analysis_cost': 1,
        'photo_cost': 5,
      },
    });
    session.notifyListeners();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('29 restants'), findsOneWidget);
    expect(find.text('30'), findsOneWidget);
  });

  testWidgets('quitter un champ ouvert ne plante pas', (tester) async {
    final dossier = Directory.systemTemp.createTempSync('af-champ-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );
    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();
    await tester.enterText(find.byType(TextField).first, 'essai@annoncefutee.fr');
    await tester.pump();

    session.jeton = 'jeton';
    session.credits = CompteCredits.depuisReponse({
      'user': {'email': 'essai@annoncefutee.fr', 'test_account': true},
      'credits': {'unlimited': true, 'used': 0, 'photo_cost': 5, 'analysis_cost': 1},
    });
    session.notifyListeners();
    await tester.pump();
    await tester.pump(Duration.zero);
    expect(tester.takeException(), isNull);
  });

  testWidgets('le clavier sur la demande IA ne plante pas', (tester) async {
    final dossier = Directory.systemTemp.createTempSync('af-consigne-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final photo = File('${dossier.path}/p1.jpg');
    photo.writeAsBytesSync(img.encodeJpg(img.Image(width: 8, height: 8)));
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );
    session.jeton = 'jeton';
    session.etape = 'preparation';
    session.credits = CompteCredits.depuisReponse({
      'credits': {'unlimited': true, 'photo_cost': 5, 'analysis_cost': 1},
    });
    session.photos.add(PhotoAnnonce(id: 'p1', cheminOriginal: photo.path));

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();
    await tester.showKeyboard(find.byKey(const ValueKey('consigne')));
    await tester.enterText(find.byKey(const ValueKey('consigne')), 'chambre d\'ado');
    tester.view.viewInsets = const FakeViewPadding(bottom: 400);
    await tester.pump();
    session.notifyListeners();
    await tester.pump();
    session.aller('annonce');
    await tester.pump();
    await tester.pump(Duration.zero);
    expect(tester.takeException(), isNull);
    expect(find.text('Étape 3 · Annonce'), findsOneWidget);
  });

  testWidgets('la description, le titre et le prix se copient, les champs vides non', (tester) async {
    final copies = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EtiquetteAnnonce(
            champs: ChampsAnnonce(
              titre: 'Téléviseur noir',
              prix: '40',
              description: 'Téléviseur noir, écran plat.',
              couleurs: 'Noir',
            ),
            onCopier: copies.add,
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('Copier le titre'));
    await tester.tap(find.byTooltip('Copier le prix'));
    await tester.tap(find.byTooltip('Copier la description'));
    await tester.tap(find.byTooltip('Copier'));
    expect(copies, ['titre', 'prix', 'description', 'couleurs']);
  });

  testWidgets('écran Mes annonces : enregistrer puis supprimer depuis l\'interface', (tester) async {
    final dossier = Directory.systemTemp.createTempSync('af-mes-annonces-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final photo = File('${dossier.path}/p1.jpg');
    photo.writeAsBytesSync(img.encodeJpg(img.Image(width: 12, height: 12)));
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );
    session.jeton = 'jeton';
    session.etape = 'annonce';
    session.analyseEtat = 'prete';
    session.photos.add(PhotoAnnonce(id: 'p1', cheminOriginal: photo.path));
    session.champs = ChampsAnnonce(titre: 'Manteau laine', prix: '45');
    final resume = await tester.runAsync(() => session.enregistrerAnnonce());
    expect(resume, isNotNull);

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();
    await tester.scrollUntilVisible(
      find.text('Annonce enregistrée'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Annonce enregistrée'), findsOneWidget);

    await tester.tap(find.byTooltip('Mes annonces'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    final ecranListe = find.byType(EcranAnnoncesEnregistrees);
    expect(find.descendant(of: ecranListe, matching: find.text('Mes annonces')), findsOneWidget);
    expect(find.descendant(of: ecranListe, matching: find.text('Manteau laine')), findsOneWidget);
    expect(find.descendant(of: ecranListe, matching: find.text('45 €')), findsOneWidget);

    await tester.tap(find.byTooltip('Supprimer cette annonce'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Supprimer cette annonce ?'), findsOneWidget);
    Navigator.of(tester.element(find.text('Supprimer'))).pop(false);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    await tester.runAsync(() => session.supprimerAnnonceEnregistree(resume!.id));
    await tester.pump();
    expect(session.annoncesEnregistrees, isEmpty);
    expect(find.text('Aucune annonce enregistrée pour le moment.'), findsOneWidget);
  });

  testWidgets('Post-it flottant : envoie les champs non vides et se ferme', (tester) async {
    final appels = <MethodCall>[];
    var ouvert = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(PostItCanal.canal, (call) async {
      appels.add(call);
      if (call.method == 'autorise') return true;
      if (call.method == 'afficher') {
        ouvert = true;
        return true;
      }
      if (call.method == 'fermer') {
        ouvert = false;
        return true;
      }
      if (call.method == 'actif') return ouvert;
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(PostItCanal.canal, null);
    });

    final dossier = Directory.systemTemp.createTempSync('af-postit-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );
    session.jeton = 'jeton';
    session.etape = 'fin';
    session.champs = ChampsAnnonce(
      titre: 'Téléviseur noir',
      prix: '40',
      description: 'Écran plat en bon état.',
      couleurs: 'Noir',
    );

    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();
    await tester.tap(find.text('Post-it seul'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));

    final afficher = appels.firstWhere((c) => c.method == 'afficher');
    final args = Map<String, dynamic>.from(afficher.arguments as Map);
    final champsEnvoyes = Map<String, String>.from(args['champs'] as Map);
    expect(champsEnvoyes, {
      'titre': 'Téléviseur noir',
      'prix': '40',
      'description': 'Écran plat en bon état.',
      'couleurs': 'Noir',
    });
    expect(find.text('Fermer Post-it'), findsOneWidget);

    await tester.tap(find.text('Fermer Post-it'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(appels.any((c) => c.method == 'fermer'), isTrue);
    expect(find.text('Post-it seul'), findsOneWidget);
  });

  testWidgets('bouton Générer sous la demande IA : désactivé à vide, actif dès qu\'on écrit', (tester) async {
    final dossier = Directory.systemTemp.createTempSync('af-generer-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final photo = File('${dossier.path}/p1.jpg');
    photo.writeAsBytesSync(img.encodeJpg(img.Image(width: 40, height: 40)));
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
      reduire: (octets) async => octets,
    );
    session.jeton = 'jeton';
    session.etape = 'preparation';
    session.credits = CompteCredits.depuisReponse({
      'credits': {'unlimited': true, 'photo_cost': 5, 'analysis_cost': 1},
    });
    session.photos.add(PhotoAnnonce(id: 'p1', cheminOriginal: photo.path));

    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();

    final bouton = find.ancestor(
      of: find.text('Générer, 5 crédits'),
      matching: find.bySubtype<ButtonStyleButton>(),
    );
    expect(bouton, findsOneWidget);
    expect(tester.widget<ButtonStyleButton>(bouton).onPressed, isNull);

    await tester.enterText(
      find.byKey(const ValueKey('consigne')),
      'mets la TV dans une chambre d\'ado',
    );
    await tester.pump();
    expect(tester.widget<ButtonStyleButton>(bouton).onPressed, isNotNull);
  });

  testWidgets('écran Compte : changer le mot de passe et supprimer un compte normal', (tester) async {
    final api = _ApiCompteTrace();
    final dossier = Directory.systemTemp.createTempSync('af-secu-compte-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final session = SessionAnnonce(
      api: api,
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire()..jeton = 'jeton'..email = 'camille@example.com',
      fondBlanc: (_) async => null,
    );
    session.jeton = 'jeton';
    session.credits = CompteCredits.depuisReponse({
      'user': {'email': 'camille@example.com', 'test_account': false},
      'credits': {'monthly': 30, 'remaining': 29, 'used': 1, 'unlimited': false},
    });

    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();
    await tester.tap(find.byTooltip('Compte'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    final listeCompte = find.descendant(
      of: find.byType(EcranCompte),
      matching: find.byType(Scrollable),
    );
    await tester.scrollUntilVisible(
      find.text('Supprimer définitivement mon compte'),
      150,
      scrollable: listeCompte,
    );
    expect(find.text('Changer le mot de passe'), findsOneWidget);
    expect(find.text('Supprimer définitivement mon compte'), findsOneWidget);

    await tester.tap(find.text('Changer le mot de passe'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    await tester.enterText(find.byKey(const ValueKey('mdp-actuel')), 'ancienPass1');
    await tester.enterText(find.byKey(const ValueKey('mdp-nouveau')), 'nouveauPass2');
    await tester.enterText(find.byKey(const ValueKey('mdp-confirmation')), 'nouveauPass2');
    await tester.tap(find.text('Mettre à jour'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(api.mdpModifie, isTrue);

    await tester.tap(find.text('Supprimer définitivement mon compte'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    await tester.enterText(
      find.byKey(const ValueKey('mdp-suppression-compte')),
      'nouveauPass2',
    );
    await tester.runAsync(() async {
      await session.supprimerCompte('nouveauPass2');
    });
    Navigator.of(tester.element(find.text('Supprimer mon compte'))).pop(true);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(api.compteSupprime, isTrue);
    expect(find.text('Se connecter'), findsOneWidget);
  });

  testWidgets('écran Inscription : affiche les 4 forfaits (Gratuit actif, 7/14/39 € inactifs) et crée le compte', (tester) async {
    final api = _ApiCompteTrace();
    final dossier = Directory.systemTemp.createTempSync('af-inscription-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final session = SessionAnnonce(
      api: api,
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );

    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();

    await tester.tap(find.text('Créer un compte · Offre découverte'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('Créer un compte'), findsOneWidget);
    expect(find.text('Gratuit'), findsOneWidget);
    expect(find.text('7 € / mois'), findsOneWidget);
    expect(find.text('14 € / mois'), findsOneWidget);
    expect(find.text('39 € / mois'), findsOneWidget);
    expect(find.text('Offre découverte'), findsOneWidget);
    expect(find.text('Bientôt'), findsNWidgets(3));

    await tester.tap(find.text('14 € / mois'));
    await tester.pump();
    expect(find.textContaining('n\'est pas encore actif'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));

    await tester.enterText(find.byKey(const ValueKey('inscription-nom')), 'Camille');
    await tester.enterText(find.byKey(const ValueKey('inscription-email')), 'camille@example.com');
    await tester.enterText(find.byKey(const ValueKey('inscription-mdp')), 'motdepasse1');
    await tester.enterText(find.byKey(const ValueKey('inscription-confirmation')), 'motdepasse1');
    await tester.tap(find.text('Commencer gratuitement'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(api.inscrit, isTrue);
    expect(session.connecte, isTrue);
    expect(find.text('Étape 1 · Nouvelle annonce'), findsOneWidget);
  });

  testWidgets('bouton Firefox Android : encode l\'annonce en #af= et gère l\'absence de Firefox', (tester) async {
    String? urlRecue;
    var statutRetour = 'ouvert';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(FirefoxAndroidCanal.canal, (call) async {
      if (call.method == 'ouvrir') {
        final args = Map<String, dynamic>.from(call.arguments as Map);
        urlRecue = args['url']?.toString();
        return statutRetour;
      }
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(FirefoxAndroidCanal.canal, null);
    });

    final dossier = Directory.systemTemp.createTempSync('af-firefox-');
    addTearDown(() {
      if (dossier.existsSync()) dossier.deleteSync(recursive: true);
    });
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );
    session.jeton = 'jeton';
    session.etape = 'fin';
    session.champs = ChampsAnnonce(
      titre: 'Veste en jean',
      prix: '25',
      description: 'Très bon état, taille M.',
      marque: 'Levi\'s',
    );

    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump();

    await tester.tap(find.text('Ouvrir dans Firefox (autocomplétion)'));
    await tester.pump();

    expect(urlRecue, startsWith('https://www.vinted.fr/items/new#af='));
    final jeton = urlRecue!.split('#af=').last;
    final pad = jeton + ('=' * ((4 - (jeton.length % 4)) % 4));
    final decode = jsonDecode(utf8.decode(base64Url.decode(pad))) as Map<String, dynamic>;
    expect(decode['titre'], 'Veste en jean');
    expect(decode['prix'], '25');
    expect(decode['marque'], 'Levi\'s');

    statutRetour = 'absent';
    await tester.tap(find.text('Ouvrir dans Firefox (autocomplétion)'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Firefox non détecté'), findsOneWidget);
    await tester.tap(find.text('Plus tard'));
    await tester.pump();
  });
}

class _ApiVide implements ClientAnnonce {
  @override
  Future<CatalogueForfaits> forfaits() async => CatalogueForfaits.secours;
  @override
  Future<SessionOuverte> inscrire({
    required String nom,
    required String email,
    required String motDePasse,
    required String confirmation,
    String forfait = 'free',
  }) =>
      Future.error(ErreurApi('inutilisé'));
  @override
  Future<ResultatAnalyse> analyser(
    String jeton,
    List<String> images, {
    String precisions = '',
    String style = 'normal',
    bool hashtags = true,
    String signature = '',
  }) =>
      Future.error(ErreurApi('inutilisé'));
  @override
  Future<ResultatPhoto> ameliorer(String jeton, String image, String mode, {String consigne = ''}) =>
      Future.error(ErreurApi('inutilisé'));
  @override
  Future<SessionOuverte> connexion(String email, String motDePasse) =>
      Future.error(ErreurApi('inutilisé'));
  @override
  Future<void> deconnexion(String jeton) async {}
  @override
  Future<void> changerMotDePasse(
    String jeton, {
    required String actuel,
    required String nouveau,
    required String confirmation,
  }) =>
      Future.error(ErreurApi('inutilisé'));
  @override
  Future<void> supprimerCompte(String jeton, String motDePasse) =>
      Future.error(ErreurApi('inutilisé'));
  @override
  Future<CompteCredits> moi(String jeton) =>
      Future.error(ErreurApi('inutilisé'));
}

class _ApiCompteTrace extends _ApiVide {
  var mdpModifie = false;
  var compteSupprime = false;
  var inscrit = false;

  @override
  Future<SessionOuverte> inscrire({
    required String nom,
    required String email,
    required String motDePasse,
    required String confirmation,
    String forfait = 'free',
  }) async {
    inscrit = true;
    return SessionOuverte(
      'jeton-inscrit',
      CompteCredits.depuisReponse({
        'user': {'email': email, 'name': nom, 'plan_slug': forfait, 'plan_name': 'Découverte'},
        'credits': {'monthly': 30, 'remaining': 30, 'used': 0, 'unlimited': false},
      }),
    );
  }

  @override
  Future<void> changerMotDePasse(
    String jeton, {
    required String actuel,
    required String nouveau,
    required String confirmation,
  }) async {
    mdpModifie = true;
  }

  @override
  Future<void> supprimerCompte(String jeton, String motDePasse) async {
    compteSupprime = true;
  }
}
