const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const Studio = require('../vinted-ia-extension/lib/studio.js');

const extension = path.join(__dirname, '../vinted-ia-extension');

function blanc(w, h) {
  return Studio.creerImage(w, h, [255, 255, 255, 255]);
}

test('les photos se sélectionnent et changent d’ordre', () => {
  let album = Studio.creerAlbum();
  album = Studio.ajouterPhoto(album, blanc(4, 4), 'une');
  album = Studio.ajouterPhoto(album, blanc(4, 4), 'deux');
  album = Studio.ajouterPhoto(album, blanc(4, 4), 'trois');
  assert.deepEqual(album.photos.map((p) => p.nom), ['une', 'deux', 'trois']);
  const id = album.photos[2].id;
  album = Studio.deplacerPhoto(album, id, -1);
  assert.deepEqual(album.photos.map((p) => p.nom), ['une', 'trois', 'deux']);
  album = Studio.definirSelection(album, [album.photos[0].id, 'absent', album.photos[0].id]);
  assert.deepEqual(album.selection, [album.photos[0].id]);
});

test('le recadrage manuel et automatique garde le sujet', () => {
  const brut = Studio.peindre(blanc(16, 16), 3, 4, 6, 5, [10, 20, 30, 255]);
  let album = Studio.ajouterPhoto(Studio.creerAlbum(), brut, 'sujet');
  const id = album.photos[0].id;
  album = Studio.avecOperation(album, id, { type: 'recadrer', x: 3, y: 4, w: 6, h: 5 });
  const cadre = Studio.rendre(album.photos[0]);
  assert.equal(cadre.width, 6);
  assert.equal(cadre.height, 5);
  assert.deepEqual(Studio.lirePixel(cadre, 0, 0).slice(0, 3), [10, 20, 30]);

  album = Studio.annuler(album, id);
  album = Studio.avecOperation(album, id, { type: 'recadrerAuto' });
  const auto = Studio.rendre(album.photos[0]);
  assert.equal(auto.width, 6);
  assert.equal(auto.height, 5);
  assert.deepEqual(Studio.lirePixel(album.photos[0].source, 0, 0).slice(0, 3), [255, 255, 255]);
});

test('la lumière change les pixels et l’original reste', () => {
  let album = Studio.ajouterPhoto(Studio.creerAlbum(), Studio.creerImage(3, 3, [100, 100, 100, 255]), 'gris');
  const id = album.photos[0].id;
  album = Studio.avecOperation(album, id, { type: 'reglages', luminosite: 20, contraste: 0, saturation: 0 });
  const apres = Studio.lirePixel(Studio.rendre(album.photos[0]), 1, 1)[0];
  assert.equal(apres > 100, true);
  assert.equal(Studio.lirePixel(album.photos[0].source, 1, 1)[0], 100);
  album = Studio.annuler(album, id);
  assert.equal(Studio.lirePixel(Studio.rendre(album.photos[0]), 1, 1)[0], 100);
});

test('un bord uni part, un défaut intérieur reste', () => {
  let image = Studio.peindre(blanc(16, 16), 2, 2, 12, 12, [20, 30, 40, 255]);
  image = Studio.peindre(image, 8, 8, 1, 1, [200, 10, 10, 255]);
  let album = Studio.ajouterPhoto(Studio.creerAlbum(), image, 'vetement');
  const id = album.photos[0].id;
  album = Studio.avecOperation(album, id, { type: 'retirerFond', couleur: [240, 235, 255] });
  const apres = Studio.rendre(album.photos[0]);
  assert.deepEqual(Studio.lirePixel(apres, 0, 0).slice(0, 3), [240, 235, 255]);
  assert.deepEqual(Studio.lirePixel(apres, 3, 3).slice(0, 3), [20, 30, 40]);
  assert.deepEqual(Studio.lirePixel(apres, 8, 8).slice(0, 3), [200, 10, 10]);
  assert.deepEqual(Studio.lirePixel(album.photos[0].source, 0, 0).slice(0, 3), [255, 255, 255]);
});

test('un fond irrégulier ou trop large n’est pas effacé', () => {
  const irregulier = Studio.peindre(blanc(8, 8), 0, 0, 1, 1, [0, 0, 0, 255]);
  const large = Studio.peindre(blanc(8, 8), 3, 3, 2, 2, [0, 0, 0, 255]);
  for (const image of [irregulier, large]) {
    const album = Studio.ajouterPhoto(Studio.creerAlbum(), image, 'refus');
    assert.throws(
      () => Studio.avecOperation(album, album.photos[0].id, { type: 'retirerFond', couleur: [255, 255, 255] }),
      /effacé|fond|article|bord/i
    );
    assert.equal(album.photos[0].operations.length, 0);
  }
});

test('le redressement horizontal reste neutre et l’angle nul ne déplace rien', () => {
  const barre = Studio.peindre(blanc(12, 12), 0, 6, 12, 1, [0, 0, 0, 255]);
  assert.equal(Math.abs(Studio.angleRedressement(barre)) <= 1, true);
  assert.equal(Studio.angleRedressement(blanc(6, 6)), 0);
  let album = Studio.ajouterPhoto(Studio.creerAlbum(), barre, 'barre');
  album = Studio.avecOperation(album, album.photos[0].id, { type: 'redresser', degres: 0 });
  const apres = Studio.rendre(album.photos[0]);
  assert.equal(apres.width, 12);
  assert.deepEqual(Studio.lirePixel(apres, 1, 6).slice(0, 3), [0, 0, 0]);
});

test('le mannequin ne modifie pas la photo et n’appelle aucun service', () => {
  const album = Studio.ajouterPhoto(Studio.creerAlbum(), blanc(4, 4), 'reel');
  const photo = album.photos[0];
  const reponse = Studio.demanderMannequin(photo);
  assert.equal(reponse.ok, false);
  assert.equal(reponse.generee, false);
  assert.equal(reponse.code, 'modele_non_valide');
  assert.equal(photo.operations.length, 0);
  assert.equal(photo.generee, false);
  const source = fs.readFileSync(path.join(extension, 'lib/studio.js'), 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.toLowerCase().includes('openai'), false);
});

test('l’analyse reprend les retouches réelles et écarte une image générée', () => {
  let album = Studio.creerAlbum();
  for (let i = 0; i < 6; i++) album = Studio.ajouterPhoto(album, blanc(2, 2), 'p' + i);
  album.photos[1].generee = true;
  const choix = Studio.photosPourAnalyse(album, 5);
  assert.equal(choix.photos.length, 5);
  assert.deepEqual(choix.exclues, [album.photos[1].id]);
  assert.equal(choix.photos.some((p) => p.generee), false);
});

test('les brouillons cochés changent de prix, les autres non', () => {
  let liste = Studio.creerBrouillon({ titre: 'Pull', description: 'Trou au coude', prix: 20, photos: 2 }, []);
  liste = Studio.creerBrouillon({ titre: 'Robe', description: 'Ourlet décousu', prix: 40, photos: 1 }, liste);
  const robe = liste[0].id;
  const pull = liste[1].id;
  liste = Studio.modifierPrixMasse(liste, [robe], { mode: 'pourcent', valeur: -10 });
  assert.equal(liste.find((b) => b.id === robe).prix, 36);
  assert.equal(liste.find((b) => b.id === pull).prix, 20);
  liste = Studio.modifierPrixMasse(liste, [pull], { mode: 'ajouter', valeur: -100 });
  assert.equal(liste.find((b) => b.id === pull).prix, 1);
  liste = Studio.modifierPrixMasse(liste, [pull, robe], { mode: 'fixe', valeur: 15 });
  assert.deepEqual(liste.map((b) => b.prix), [15, 15]);
  assert.throws(() => Studio.modifierPrixMasse(liste, [], { mode: 'fixe', valeur: 10 }), /Coche/);
  assert.throws(() => Studio.creerBrouillon({ titre: ' ', description: '' }, []), /vide/);
});

test('les automatisations Vinted et Leboncoin ne sont pas proposées comme disponibles', () => {
  const etats = Object.fromEntries(Studio.FONCTIONS_PLATEFORME.map((f) => [f.id, f.etat]));
  assert.equal(etats.remplissage, 'manuel');
  assert.equal(etats.publication, 'interdit');
  assert.equal(etats.messagerie, 'non_autorise');
  assert.equal(etats.leboncoin, 'absent');
  assert.equal(Studio.FONCTIONS_PLATEFORME.some((f) => f.etat === 'automatique'), false);
});

test('le panneau n’a pas de bouton Publier et le mannequin est branché', () => {
  const html = fs.readFileSync(path.join(extension, 'sidepanel.html'), 'utf8');
  const js = fs.readFileSync(path.join(extension, 'sidepanel.js'), 'utf8');
  const contenu = fs.readFileSync(path.join(extension, 'content.js'), 'utf8');
  assert.equal(/<button[^>]*>[^<]*Publier/i.test(html), false);
  assert.equal(html.includes('id="mannequin"'), true);
  assert.equal(html.includes('id="generer"'), true);
  assert.equal(html.includes('id="ecrire"'), true);
  assert.equal(js.includes('Studio.demanderMannequin'), true);
  assert.equal(js.toLowerCase().includes('images/generations'), false);
  assert.equal(contenu.includes("msg.type === 'fillListing'"), true);
  assert.equal(contenu.includes("msg.type === 'collectPhotos'"), true);
  assert.equal(contenu.includes('Ouvrir le panneau complet'), true);
});
