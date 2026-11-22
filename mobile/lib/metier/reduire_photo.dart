import 'dart:convert';
import 'dart:typed_data';

import 'package:image/image.dart';

import 'modeles.dart';

const limiteBase64 = 1500000;
const bordMax = 2048;
const bordMin = 32;
const octetsMax = 1125000;

Uint8List reduirePourEnvoi(Uint8List original) {
  final decode = decodeImage(original);
  if (decode == null) {
    throw ErreurPhoto('Photo illisible.');
  }
  var image = bakeOrientation(decode);
  if (image.width < bordMin || image.height < bordMin) {
    throw ErreurPhoto('Photo trop petite pour le serveur.');
  }
  image = _dansLeCadre(image);

  var qualite = 85;
  var jpg = encodeJpg(image, quality: qualite);
  var tours = 0;
  while (_tropGrand(jpg) && tours < 14) {
    tours++;
    if (qualite > 55) {
      qualite -= 10;
    } else {
      final largeur = (image.width * 0.8).round();
      final hauteur = (image.height * 0.8).round();
      if (largeur < bordMin || hauteur < bordMin) {
        throw ErreurPhoto('Photo trop volumineuse pour le serveur.');
      }
      image = copyResize(image, width: largeur, height: hauteur, interpolation: Interpolation.linear);
      qualite = 75;
    }
    jpg = encodeJpg(image, quality: qualite);
  }
  if (_tropGrand(jpg)) {
    throw ErreurPhoto('Photo trop volumineuse pour le serveur.');
  }
  final relu = decodeImage(jpg);
  if (relu == null || relu.width > bordMax || relu.height > bordMax || relu.width < bordMin || relu.height < bordMin) {
    throw ErreurPhoto('Photo illisible après réduction.');
  }
  if (jpg.length < 3 || jpg[0] != 0xFF || jpg[1] != 0xD8 || jpg[2] != 0xFF) {
    throw ErreurPhoto('Photo illisible après réduction.');
  }
  return Uint8List.fromList(jpg);
}

bool _tropGrand(List<int> jpg) {
  return jpg.length > octetsMax || base64Encode(jpg).length > limiteBase64;
}

Image _dansLeCadre(Image image) {
  if (image.width <= bordMax && image.height <= bordMax) return image;
  final ratio = image.width / image.height;
  if (image.width >= image.height) {
    return copyResize(image, width: bordMax, height: (bordMax / ratio).round(), interpolation: Interpolation.linear);
  }
  return copyResize(image, width: (bordMax * ratio).round(), height: bordMax, interpolation: Interpolation.linear);
}
