import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  await integrationDriver(
    onScreenshot: (String nom, List<int> octets, [Map<String, Object?>? args]) async {
      final fichier = File('captures/$nom.png');
      await fichier.parent.create(recursive: true);
      await fichier.writeAsBytes(octets);
      return true;
    },
  );
}
