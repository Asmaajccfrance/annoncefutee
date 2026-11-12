'use strict';

// Album de l'atelier : originaux jamais altérés, sélection, retrait, identifiants d'album inconnus.

const test = require('node:test');
const assert = require('node:assert/strict');
const Studio = require('../vinted-ia-extension/lib/studio.js');

const blanc = (w, h) => Studio.creerImage(w, h, [200, 200, 200, 255]);

test('les retouches ne modifient jamais la photo d\'origine ; annuler la restitue exactement', () => {
  const source = Studio.peindre(blanc(16, 16), 2, 2, 8, 8, [10, 20, 30, 255]);
  const copieAvant = Uint8ClampedArray.from(source.data);
  let album = Studio.ajouterPhoto(Studio.creerAlbum(), source, 'a');
  const id = album.photos[0].id;
  const referenceSource = album.photos[0].source;

  album = Studio.avecOperation(album, id, { type: 'reglages', luminosite: 30, contraste: 10, saturation: 0 });
  album = Studio.avecOperation(album, id, { type: 'redresser', degres: 2 });
  assert.equal(album.photos[0].operations.length, 2);
  assert.equal(album.photos[0].source, referenceSource, 'la même image d\'origine est conservée');
  assert.deepEqual(Array.from(album.photos[0].source.data), Array.from(copieAvant));
  assert.notDeepEqual(Array.from(Studio.rendre(album.photos[0]).data), Array.from(copieAvant));

  album = Studio.annuler(album, id);
  album = Studio.annuler(album, id);
  assert.equal(album.photos[0].operations.length, 0);
  assert.deepEqual(Array.from(Studio.rendre(album.photos[0]).data), Array.from(copieAvant));
  // L'image fournie à l'atelier n'est pas non plus modifiée (copie défensive).
  assert.deepEqual(Array.from(source.data), Array.from(copieAvant));
});

test('une retouche échouée laisse l\'album intact', () => {
  const album = Studio.ajouterPhoto(Studio.creerAlbum(), blanc(8, 8), 'a');
  const id = album.photos[0].id;
  assert.throws(() => Studio.avecOperation(album, id, { type: 'inconnue' }), /Retouche inconnue/);
  assert.throws(() => Studio.avecOperation(album, 'absente', { type: 'redresser', degres: 2 }), /Photo introuvable/);
  assert.equal(album.photos[0].operations.length, 0);
});

test('retirerPhoto : retire la photo, sa sélection, et choisit une nouvelle photo active', () => {
  let album = Studio.creerAlbum();
  for (const nom of ['a', 'b', 'c']) album = Studio.ajouterPhoto(album, blanc(4, 4), nom);
  const [a, b, c] = album.photos.map((p) => p.id);
  assert.equal(album.active, c);
  const apres = Studio.retirerPhoto(album, c);
  assert.deepEqual(apres.photos.map((p) => p.nom), ['a', 'b']);
  assert.deepEqual(apres.selection, [a, b]);
  assert.ok([a, b].includes(apres.active));
  // Retrait d'une photo inconnue : album équivalent, aucune erreur.
  assert.deepEqual(Studio.retirerPhoto(apres, 'absente').photos.map((p) => p.nom), ['a', 'b']);
  // Retirer la dernière photo donne un album vide valide (jamais undefined).
  let vide = apres;
  vide = Studio.retirerPhoto(vide, a);
  vide = Studio.retirerPhoto(vide, b);
  assert.deepEqual(vide, { photos: [], selection: [], active: '' });
  // L'album d'origine n'a pas été modifié (fonctions pures).
  assert.equal(album.photos.length, 3);
});

test('basculerSelection coche et décoche sans toucher aux autres photos', () => {
  let album = Studio.creerAlbum();
  for (const nom of ['a', 'b']) album = Studio.ajouterPhoto(album, blanc(4, 4), nom);
  const [a, b] = album.photos.map((p) => p.id);
  album = Studio.basculerSelection(album, a);
  assert.deepEqual(album.selection, [b]);
  album = Studio.basculerSelection(album, a);
  assert.deepEqual(album.selection, [b, a]);
  assert.equal(Studio.basculerSelection(album, 'absente'), album);
});

test('un identifiant d\'album inconnu est une erreur explicite, jamais une liste vide ni une lecture de .photos sur undefined', () => {
  assert.throws(() => Studio.listerPhotos('album_inconnu'), /Album introuvable/);
  assert.equal(Studio.obtenirAlbum('album_inconnu'), null);
  assert.throws(() => Studio.ajouterPhotoParId('album_inconnu', blanc(4, 4), 'x'), /Album introuvable/);
  const { id } = Studio.creerAlbumAvecId('Atelier');
  assert.deepEqual(Studio.listerPhotos(id), []);
  Studio.ajouterPhotoParId(id, blanc(4, 4), 'x');
  assert.equal(Studio.listerPhotos(id).length, 1);
});

test('l\'atelier est limité à huit photos, avec un message clair', () => {
  let album = Studio.creerAlbum();
  for (let i = 0; i < Studio.MAX_ATELIER; i++) album = Studio.ajouterPhoto(album, blanc(4, 4), 'p' + i);
  assert.throws(() => Studio.ajouterPhoto(album, blanc(4, 4), 'de trop'), /Huit photos au maximum/);
  assert.equal(album.photos.length, Studio.MAX_ATELIER);
});
