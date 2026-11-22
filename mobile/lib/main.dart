import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'coffre_securise.dart';
import 'ecrans.dart';
import 'fond_blanc.dart';
import 'metier/annonce_api.dart';
import 'metier/brouillon.dart';
import 'metier/session_annonce.dart';
import 'theme/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final support = await getApplicationSupportDirectory();
  final session = SessionAnnonce(
    api: AnnonceApi(http.Client(), baseUrl: 'https://annoncefutee.fr'),
    depot: DepotBrouillon(Directory('${support.path}/brouillon')),
    coffre: CoffreSecurise(),
    fondBlanc: FondBlancCanal().appliquer,
  );
  await session.demarrer();
  runApp(AnnonceApp(session: session));
}

class AnnonceApp extends StatelessWidget {
  const AnnonceApp({required this.session, super.key});

  final SessionAnnonce session;

  @override
  Widget build(BuildContext context) {
    return PorteeSession(
      session: session,
      child: MaterialApp(
        title: 'Annonce Futée',
        debugShowCheckedModeBanner: false,
        theme: themeAnnonce(),
        home: const Racine(),
      ),
    );
  }
}
