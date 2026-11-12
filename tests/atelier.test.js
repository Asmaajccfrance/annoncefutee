'use strict';

// Atelier photo du panneau : album toujours initialisé, photos Vinted récupérées et affichées,
// « Améliorer automatiquement » sur les photos sélectionnées, originaux jamais perdus,
// rechargement du panneau, données d'anciennes versions, erreurs jamais silencieuses.

const test = require('node:test');
const assert = require('node:assert');
const { creerPanneau, photo, attendre, jusqua, fermerTout } = require('./helpers/panneau');

test.after(fermerTout);

// Mode manuel : aucune analyse, aucun crédit, seul l'atelier est en jeu.
const MANUEL = { autoGenerer: false, consentementIA: false };

const vignettes = (p) => Array.from(p.w.document.querySelectorAll('#galerie .vignette'));
const srcs = (p) => vignettes(p).map((v) => v.querySelector('img').src);
const statut = (p) => p.$('#statut').textContent;
const info = (p) => (p.$('#galerie-info').hidden ? '' : p.$('#galerie-info').textContent);
const ouvrirPhotos = (p) => p.$('[data-section="photos"]').click();
const clic = (p, sel) => p.$(sel).click();

async function pretAvecPhotos(p, n) {
  ouvrirPhotos(p);
  assert.ok(await jusqua(() => vignettes(p).length === n), 'la galerie doit afficher ' + n + ' photo(s), elle en affiche ' + vignettes(p).length);
}

async function importer(p, n, depart = 0) {
  const input = p.$('#fichiers');
  const fichiers = Array.from({ length: n }, (_, i) => new p.w.File(['img' + (depart + i)], 'photo' + (depart + i) + '.png', { type: 'image/png' }));
  Object.defineProperty(input, 'files', { value: fichiers, configurable: true });
  input.dispatchEvent(new p.w.Event('change'));
  assert.ok(await jusqua(() => vignettes(p).length === depart + n), 'les photos importées doivent apparaître');
}

test('aucune photo : message explicite, aucune erreur JavaScript', async () => {
  const p = creerPanneau({ photos: [], stockage: MANUEL });
  ouvrirPhotos(p);
  await attendre(300);
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /Aucune photo/);
  assert.match(info(p), /Aucune photo/);
  assert.equal(vignettes(p).length, 0);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('photos Vinted récupérées automatiquement et affichées dans la galerie (avec leur origine)', async () => {
  const p = creerPanneau({ photos: [photo(1), photo(2), photo(3)], stockage: MANUEL });
  await pretAvecPhotos(p, 3);
  assert.match(vignettes(p)[0].title, /Vinted/);
  assert.match(p.$('#compteur-photos').textContent, /3 photos · 3 sélectionnées/);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('« Améliorer automatiquement » traite les photos sélectionnées seulement ; « Annuler » rend l\'original', async () => {
  const p = creerPanneau({ photos: [photo(1), photo(2)], stockage: MANUEL });
  await pretAvecPhotos(p, 2);
  const avant = srcs(p);

  // Décocher la 2e photo : elle ne doit pas être touchée.
  vignettes(p)[1].querySelector('.vignette-coche').click();
  assert.match(p.$('#compteur-photos').textContent, /1 sélectionnée/);

  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /1 photo sélectionnée : 1 améliorée/);
  const apres = srcs(p);
  assert.notEqual(apres[0], avant[0], 'la photo sélectionnée doit réellement être retouchée');
  assert.equal(apres[1], avant[1], 'la photo non sélectionnée ne doit pas changer');
  assert.ok(vignettes(p)[0].querySelector('.vignette-retouchee'));
  assert.ok(!vignettes(p)[1].querySelector('.vignette-retouchee'));

  // Deuxième clic : rien n'est refait.
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /1 déjà traitée/);
  assert.equal(srcs(p)[0], apres[0]);

  // L'original est intact : on retrouve exactement l'image de départ en annulant.
  vignettes(p)[0].click();
  clic(p, '#btn-annuler');
  assert.equal(srcs(p)[0], avant[0], 'l\'annulation doit restituer l\'original');
  assert.ok(!vignettes(p)[0].querySelector('.vignette-retouchee'));

  // Retouches annulées : la photo peut de nouveau être améliorée.
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /1 améliorée/);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('aucune photo sélectionnée : message clair, rien n\'est modifié', async () => {
  const p = creerPanneau({ photos: [photo(1)], stockage: MANUEL });
  await pretAvecPhotos(p, 1);
  const avant = srcs(p);
  vignettes(p)[0].querySelector('.vignette-coche').click();
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /Aucune photo sélectionnée/);
  assert.deepEqual(srcs(p), avant);
  p.fermer();
});

test('photo présente sur Vinted mais pas encore récupérée : dit pourquoi, puis se récupère', async () => {
  const p = creerPanneau({ photos: [photo(1), photo(2)], stockage: MANUEL });
  p.onglet.collecteEchoue = true;
  p.onglet.photos = [photo(1), photo(2)];
  ouvrirPhotos(p);
  await jusqua(() => /pas encore récupérée/.test(info(p)) || p.messageLive().includes('Impossible de lire'));
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /2 photos détectées sur Vinted mais pas encore récupérées/);

  p.onglet.collecteEchoue = false;
  clic(p, '#recuperer-vinted');
  assert.ok(await jusqua(() => vignettes(p).length === 2));
  assert.equal(info(p), '');
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('photos en cours de chargement sur Vinted : message de chargement, pas de faux « aucune photo »', async () => {
  const p = creerPanneau({ photos: [], stockage: MANUEL });
  p.onglet.enChargement = 2;
  p.notifierPhotos();
  ouvrirPhotos(p);
  assert.ok(await jusqua(() => /encore en chargement/.test(info(p))));
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /encore en chargement/);
  assert.doesNotMatch(statut(p), /Importe/);

  // Les photos arrivent : elles apparaissent sans action.
  p.onglet.photos = [photo(1), photo(2)];
  p.onglet.enChargement = 0;
  p.notifierPhotos();
  assert.ok(await jusqua(() => vignettes(p).length === 2));
  assert.equal(info(p), '');
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('photo supprimée ou remplacée sur Vinted : l\'atelier suit, l\'aperçu d\'une photo disparue se ferme', async () => {
  const p = creerPanneau({ photos: [photo(1), photo(2)], stockage: MANUEL });
  await pretAvecPhotos(p, 2);
  vignettes(p)[1].click();
  assert.equal(p.$('#apercu-container').hidden, false);

  p.onglet.photos = [photo(3)];
  p.notifierPhotos();
  assert.ok(await jusqua(() => vignettes(p).length === 1 && vignettes(p)[0].dataset.id));
  assert.equal(p.$('#apercu-container').hidden, true, 'la photo active a disparu : plus d\'aperçu fantôme');

  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /1 photo sélectionnée/);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('atelier plein : les photos Vinted en trop sont signalées, jamais ignorées en silence', async () => {
  const toutes = Array.from({ length: 9 }, (_, i) => photo(i + 1));
  const p = creerPanneau({ photos: toutes, stockage: MANUEL });
  await pretAvecPhotos(p, 8);
  assert.ok(await jusqua(() => /Atelier plein/.test(info(p))));
  assert.match(info(p), /1 photo Vinted non copiée/);
  p.fermer();
});

test('photos importées : mémorisées avec leur original, retouches comprises, relues après rechargement', async () => {
  const p1 = creerPanneau({ photos: [], stockage: MANUEL });
  ouvrirPhotos(p1);
  await importer(p1, 2);
  assert.ok(await jusqua(() => p1.stockage.atelier && p1.stockage.atelier.photos.length === 2));
  const originaux = p1.stockage.atelier.photos.map((x) => x.original);
  const avant = srcs(p1);

  clic(p1, '#ameliorer-auto');
  assert.match(statut(p1), /2 photos sélectionnées : 2 améliorées/);
  assert.ok(await jusqua(() => p1.stockage.atelier.photos.every((x) => x.operations.length > 0)));
  // L'original mémorisé n'est jamais remplacé par la version retouchée.
  assert.deepEqual(p1.stockage.atelier.photos.map((x) => x.original), originaux);
  const retouchees = srcs(p1);
  assert.notDeepEqual(retouchees, avant);
  p1.fermer();

  // Réouverture du panneau avec le même stockage : photos, retouches et état « déjà traité » reviennent.
  const p2 = creerPanneau({ photos: [], stockage: p1.stockage });
  await pretAvecPhotos(p2, 2);
  assert.deepEqual(srcs(p2), retouchees);
  clic(p2, '#ameliorer-auto');
  assert.match(statut(p2), /2 déjà traitées/);

  // Annuler dans le panneau rouvert restitue bien l'original relu.
  vignettes(p2)[0].click();
  clic(p2, '#btn-annuler');
  assert.equal(srcs(p2)[0], avant[0]);
  assert.deepEqual(p2.erreurs, []);
  p2.fermer();
});

test('rechargement : photos mémorisées et photos Vinted cohabitent sans doublon ni mélange', async () => {
  const p1 = creerPanneau({ photos: [], stockage: MANUEL });
  ouvrirPhotos(p1);
  await importer(p1, 1);
  assert.ok(await jusqua(() => p1.stockage.atelier && p1.stockage.atelier.photos.length === 1));
  p1.fermer();

  const p2 = creerPanneau({ photos: [photo(1), photo(2)], stockage: p1.stockage });
  await pretAvecPhotos(p2, 3);
  p2.notifierPhotos();
  clic(p2, '#recuperer-vinted');
  await attendre(400);
  assert.equal(vignettes(p2).length, 3, 'pas de doublon après une nouvelle synchronisation');
  const origines = vignettes(p2).map((v) => /Vinted/.test(v.title));
  assert.equal(origines.filter(Boolean).length, 2);
  // Seule la photo importée est mémorisée.
  assert.equal(p2.stockage.atelier.photos.length, 1);
  p2.fermer();
});

test('données d\'une ancienne version : le panneau démarre, signale ce qui est illisible, ne plante jamais', async () => {
  const p = creerPanneau({
    photos: [photo(1)],
    stockage: Object.assign({}, MANUEL, {
      brouillons: [
        null, 'texte', 42, [],
        { id: null, titre: null, photos: ['data:image/jpeg;base64,AAAA'], photoUrl: 'data:image/jpeg;base64,BBBB', prix: 'abc', couleurs: 'rouge' },
        { id: 'b1', titre: 'Veste', prix: '12', statut: 'pret', dateCreation: 5 }
      ],
      atelier: {
        photos: [
          { original: 'javascript:alert(1)' },
          null,
          { nom: 'ancienne', original: 'data:image/png;base64,AAAA', operations: [{ type: 'inconnue' }, { type: 'redresser', degres: 3 }], auto: true },
          { original: 'data:image/png;base64,AAAA', operations: 'pas-une-liste' }
        ]
      }
    })
  });
  ouvrirPhotos(p);
  assert.ok(await jusqua(() => vignettes(p).length === 3), 'photo Vinted + 2 photos mémorisées lisibles');
  const sections = ['dashboard', 'photos', 'creer', 'annonces', 'reglages'];
  for (const s of sections) { p.$('[data-section="' + s + '"]').click(); await attendre(30); }
  ouvrirPhotos(p);
  clic(p, '#ameliorer-auto');
  assert.doesNotMatch(statut(p), /Cannot read|undefined/);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('stockage atelier au format inconnu : ignoré avec un message, remplacé à la prochaine sauvegarde', async () => {
  const p = creerPanneau({ photos: [], stockage: Object.assign({}, MANUEL, { atelier: 'n\'importe quoi' }) });
  await attendre(300);
  assert.match(statut(p), /illisible/);
  ouvrirPhotos(p);
  await importer(p, 1);
  assert.ok(await jusqua(() => p.stockage.atelier && p.stockage.atelier.version === 2 && p.stockage.atelier.photos.length === 1));
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('une erreur pendant l\'amélioration est affichée photo par photo, les originaux restent intacts', async () => {
  const p = creerPanneau({
    photos: [photo(1), photo(2)],
    stockage: MANUEL,
    avantPanneau: (w) => {
      w.AnnonceFuteeBatch.ameliorerPhotoAuto = () => { throw new TypeError('Cannot read properties of undefined (reading \'photos\')'); };
    }
  });
  await pretAvecPhotos(p, 2);
  const avant = srcs(p);
  clic(p, '#ameliorer-auto');
  assert.match(statut(p), /2 problèmes/);
  assert.match(statut(p), /reading 'photos'/, 'l\'erreur réelle est montrée, pas masquée');
  assert.equal(p.$('#statut').className.includes('erreur'), true);
  assert.deepEqual(srcs(p), avant);
  assert.deepEqual(p.erreurs, [], 'aucune erreur non gérée');
  p.fermer();
});

test('une action d\'interface qui échoue affiche un message et ne laisse aucune erreur non gérée', async () => {
  const p = creerPanneau({
    photos: [photo(1)],
    stockage: MANUEL,
    avantPanneau: (w) => { w.AnnonceFuteeStudio.basculerSelection = () => { throw new Error('défaillance simulée'); }; }
  });
  await pretAvecPhotos(p, 1);
  vignettes(p)[0].querySelector('.vignette-coche').click();
  assert.match(statut(p), /Galerie : défaillance simulée/);
  assert.match(statut(p), /photos d'origine ne sont pas modifiées/);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});

test('retirer une photo importée demande confirmation et supprime sa copie mémorisée', async () => {
  const p = creerPanneau({ photos: [], stockage: MANUEL });
  ouvrirPhotos(p);
  await importer(p, 2);
  assert.ok(await jusqua(() => p.stockage.atelier && p.stockage.atelier.photos.length === 2));

  p.fenetre.reponseConfirm = false;
  vignettes(p)[0].querySelector('.vignette-suppr').click();
  assert.equal(vignettes(p).length, 2, 'refus : rien n\'est retiré');
  assert.equal(p.fenetre.confirmations.length, 1);

  p.fenetre.reponseConfirm = true;
  vignettes(p)[0].querySelector('.vignette-suppr').click();
  assert.equal(vignettes(p).length, 1);
  assert.ok(await jusqua(() => p.stockage.atelier.photos.length === 1));
  p.fermer();
});

test('le panneau n\'utilise plus d\'identifiant d\'album : aucun .photos lu sur un album absent, même sans photo ni onglet Vinted', async () => {
  const p = creerPanneau({ photos: [], stockage: MANUEL });
  p.onglets[7] = undefined;
  delete p.onglets[7];
  for (const s of ['photos', 'creer', 'annonces', 'dashboard', 'reglages', 'photos']) { p.$('[data-section="' + s + '"]').click(); await attendre(30); }
  clic(p, '#ameliorer-auto');
  clic(p, '#btn-annuler');
  clic(p, '#recuperer-vinted');
  await attendre(200);
  assert.deepEqual(p.erreurs, []);
  p.fermer();
});
