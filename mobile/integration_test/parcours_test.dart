import 'dart:io';

import 'package:annonce_futee/main.dart';
import 'package:annonce_futee/metier/annonce_api.dart';
import 'package:annonce_futee/metier/brouillon.dart';
import 'package:annonce_futee/metier/modeles.dart';
import 'package:annonce_futee/metier/session_annonce.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('captures des écrans', (tester) async {
    final dossier = await Directory.systemTemp.createTemp('af-captures-');
    final photoA = await _jpeg(dossier, 'a', 214, 186, 232);
    final photoB = await _jpeg(dossier, 'b', 232, 214, 186);
    final session = SessionAnnonce(
      api: _ApiVide(),
      depot: DepotBrouillon(dossier),
      coffre: CoffreMemoire(),
      fondBlanc: (_) async => null,
    );

    await tester.pumpWidget(AnnonceApp(session: session));
    await tester.pump(const Duration(milliseconds: 400));
    await binding.convertFlutterSurfaceToImage();
    await tester.pump(const Duration(milliseconds: 200));
    await binding.takeScreenshot('01-connexion');

    session.jeton = 'jeton';
    session.credits = CompteCredits.depuisReponse({
      'user': {
        'email': 'essai-chrome@annoncefutee.fr',
        'name': 'Essai',
        'test_account': true,
      },
      'credits': {
        'monthly': null,
        'remaining': null,
        'used': 3,
        'unlimited': true,
        'analysis_cost': 1,
        'photo_cost': 5,
      },
    });
    session.photos = [
      PhotoAnnonce(
        id: 'a',
        cheminOriginal: photoA,
        pourAnalyse: true,
        fondEtat: 'pret',
      ),
      PhotoAnnonce(id: 'b', cheminOriginal: photoB, pourAnalyse: true),
    ];
    session.notifyListeners();
    await tester.pump();
    final contexte = tester.element(find.text('Étape 1 · Nouvelle annonce'));
    await tester.runAsync(() async {
      await precacheImage(FileImage(File(photoA)), contexte);
      await precacheImage(FileImage(File(photoB)), contexte);
    });
    await tester.pump();
    await binding.takeScreenshot('02-nouvelle-annonce');

    session.etape = 'preparation';
    session.notifyListeners();
    await tester.pump(const Duration(seconds: 1));
    await binding.takeScreenshot('03-preparation');

    session.etape = 'annonce';
    session.analyseEtat = 'attente';
    session.analyseEnVol = true;
    session.notifyListeners();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await binding.takeScreenshot('04-annonce-attente');

    session.analyseEnVol = false;
    session.analyseEtat = 'prete';
    session.champs = ChampsAnnonce(
      titre: 'Pull col roulé bleu',
      description: 'Peu porté, chaud, idéal pour l\'hiver.',
      categorie: 'Femmes',
      sousCategorie: 'Pulls et sweats',
      marque: 'Zara',
      taille: 'M',
      etat: 'Très bon état',
      couleurs: 'Bleu',
      matiere: 'Laine',
      prix: '18',
      aVerifier: 'Vérifier la marque sur l\'étiquette.',
    );
    session.notifyListeners();
    await tester.pump(const Duration(milliseconds: 400));
    await binding.takeScreenshot('05-annonce');

    session.etape = 'fin';
    session.notifyListeners();
    await tester.pump(const Duration(seconds: 1));
    await binding.takeScreenshot('06-terminer');

    await tester.tap(find.byTooltip('Compte'));
    await tester.pump(const Duration(milliseconds: 500));
    await binding.takeScreenshot('07-compte');
  });
}

Future<String> _jpeg(Directory dossier, String nom, int r, int g, int b) async {
  final image = img.Image(width: 240, height: 320);
  image.clear(img.ColorRgb8(r, g, b));
  final fichier = File('${dossier.path}/$nom.jpg');
  await fichier.writeAsBytes(img.encodeJpg(image, quality: 80));
  return fichier.path;
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
