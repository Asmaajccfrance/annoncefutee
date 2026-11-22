import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart';

import 'package:annonce_futee/metier/reduire_photo.dart';
import 'package:annonce_futee/metier/selection_photos.dart';

void main() {
  test('les cinq premières photos sont retenues, le choix se change sans question', () {
    expect(SelectionPhotos.parDefaut(7), [true, true, true, true, true, false, false]);
    expect(SelectionPhotos.parDefaut(2), [true, true]);
    final suite = SelectionPhotos.basculer([true, true, true, true, true, false], 0);
    expect(suite.refuse, isFalse);
    final ajoutee = SelectionPhotos.basculer(suite.selection, 5);
    expect(ajoutee.refuse, isFalse);
    expect(ajoutee.selection.where((c) => c).length, 5);
    expect(SelectionPhotos.basculer(ajoutee.selection, 5).refuse, isFalse);
    final pleine = SelectionPhotos.basculer([true, true, true, true, true, false], 5);
    expect(pleine.refuse, isTrue);
    expect(pleine.selection[5], isFalse);
    expect(SelectionPhotos.libelleContinuer(1), 'Continuer, 1 crédit');
    expect(SelectionPhotos.libellePhoto('Studio', 5), 'Studio, 5 crédits');
  });

  test('une petite photo reste un JPEG sous la limite, l\'original n\'est pas modifié', () {
    final image = Image(width: 80, height: 60);
    image.clear(ColorRgb8(200, 10, 10));
    final original = Uint8List.fromList(encodeJpg(image));
    final copie = Uint8List.fromList(original);
    final reduit = reduirePourEnvoi(original);
    expect(original, copie);
    expect(base64Encode(reduit).length, lessThanOrEqualTo(limiteBase64));
    expect(reduit.length, lessThanOrEqualTo(octetsMax));
    expect(reduit[0], 0xFF);
    expect(reduit[1], 0xD8);
    final relu = decodeImage(reduit)!;
    expect(relu.width, inInclusiveRange(bordMin, bordMax));
    expect(relu.height, inInclusiveRange(bordMin, bordMax));
  });

  test('une grande photo bruitée est réduite sous la limite du serveur', () {
    final alea = Random(3);
    final image = Image(width: 1800, height: 1400);
    for (var y = 0; y < image.height; y += 2) {
      for (var x = 0; x < image.width; x += 2) {
        image.setPixelRgb(x, y, alea.nextInt(256), alea.nextInt(256), alea.nextInt(256));
      }
    }
    final reduit = reduirePourEnvoi(encodeJpg(image, quality: 95));
    expect(base64Encode(reduit).length, lessThanOrEqualTo(limiteBase64));
    expect(reduit.length, lessThanOrEqualTo(octetsMax));
    final relu = decodeImage(reduit)!;
    expect(relu.width, lessThanOrEqualTo(bordMax));
    expect(relu.height, lessThanOrEqualTo(bordMax));
    expect(relu.width, greaterThanOrEqualTo(bordMin));
  });

  test('une photo trop petite est refusée avant l\'envoi', () {
    final image = Image(width: 8, height: 8);
    expect(() => reduirePourEnvoi(encodeJpg(image)), throwsA(isA<Object>()));
  });
}
