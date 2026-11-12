'use strict';

// Automatisation totale (compte de test illimité, une seule analyse par ensemble de photos, reprise
// après fermeture du panneau, nouveaux essais bornés). Aucun appel réseau réel : aucune dépense possible.

const test = require('node:test');
const assert = require('node:assert');
const { creerPanneau, photo, attendre, jusqua, ANNONCE, erreursNonGerees, fermerTout } = require('./helpers/panneau');

test.after(fermerTout);

const compteTest = () => ({
  connected: true,
  email: 'essai-chrome@annoncefutee.fr',
  testAccount: true,
  credits: {
    unlimited: true, monthly: null, remaining: null, used: 3, analysis_cost: 1,
    spend: { today_usd: 0.0013, month_usd: 0.0042, analyses_month: 3, daily_cap_usd: 1, estimated: true }
  }
});

const entete = (p) => (p.$('#credits-lib').textContent + ' ' + p.$('#credits-val').textContent + p.$('#credits-suite').textContent).replace(/\s+/g, ' ').trim();

test('compte de test : « Crédits IA : Illimités — Compte test », analyse jamais refusée pour quota, consommation suivie', async () => {
  const p = creerPanneau({ compte: compteTest() });
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1 && /Annonce prête/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(entete(p), 'Crédits IA : Illimités — Compte test');
  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.strictEqual(p.serveur.compte.credits.used, 4, 'la consommation réelle continue d\'être comptée');
  assert.match(p.bilan(), /Consommé/);
  assert.doesNotMatch(p.bilan(), /insuffisant/i);

  const carte = p.$('#compte-bilan').textContent;
  assert.match(carte, /essai-chrome@annoncefutee\.fr/);
  assert.match(carte, /Illimités/);
  assert.match(carte, /0[,.]0013|0[,.]0042/, 'dépense estimée affichée');
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});

test('compte normal : le décompte « restants » reste inchangé', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1));
  assert.match(entete(p), /^Crédits IA : \d+ restants$/);
  assert.doesNotMatch(entete(p), /Illimités/);
  p.fermer();
});

test('cinq photos du même vêtement ajoutées une à une : une seule analyse pour l\'ensemble', async () => {
  const p = creerPanneau({ photos: [] });
  assert.ok(await jusqua(() => /Vinted|photo/i.test(p.messageLive() || 'photo')));
  for (let n = 1; n <= 5; n++) {
    p.onglet.photos.push(photo(n));
    p.notifierPhotos();
    await attendre(700);
  }
  assert.ok(await jusqua(() => p.nbPhotos() === 5));
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'aucune analyse tant que les photos continuent d\'arriver');
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && p.serveur.appelsRemplir.length === 1));
  await attendre(4500);
  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.strictEqual(p.serveur.requetes[0].images.length, 5);
  assert.strictEqual(p.serveur.appelsRemplir.length, 1, 'le remplissage automatique ne relance pas d\'analyse');
  p.fermer();
});

test('le suivi fonctionne hors de l\'onglet Photos (autre section ouverte)', async () => {
  const p = creerPanneau({ photos: [] });
  p.$('.nav-item[data-section="reglages"]').click();
  await attendre(200);
  p.onglet.photos.push(photo(1));
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && p.serveur.appelsRemplir.length === 1));
  p.fermer();
});

test('interrupteur du tableau de bord : persistant, synchronisé, coupe l\'automatisation', async () => {
  const p = creerPanneau({ photos: [] });
  const bouton = p.$('#auto-dashboard');
  assert.ok(await jusqua(() => bouton.checked), 'activé au départ (réglage mémorisé)');
  bouton.click();
  assert.ok(await jusqua(() => p.stockage.autoGenerer === false));
  assert.ok(await jusqua(() => p.$('#autoGenerer').checked === false), 'même réglage que dans « Réglages »');

  p.onglet.photos.push(photo(1));
  p.notifierPhotos();
  await attendre(4500);
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'automatisation coupée : aucune analyse sans clic');

  p.$('#auto-dashboard').click();
  assert.ok(await jusqua(() => p.stockage.autoGenerer === true));
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1));
  p.fermer();
});

test('accès fermé ≠ serveur indisponible ; serveur injoignable ≠ accès fermé', async () => {
  const ferme = creerPanneau({
    generer: () => ({ ok: false, error: 'x', code: 'HTTP_403', serverCode: 'client_access_closed' })
  });
  assert.ok(await jusqua(() => /Accès fermé/.test(ferme.messageLive())), ferme.messageLive());
  assert.doesNotMatch(ferme.messageLive(), /Serveur indisponible|injoignable/);
  ferme.fermer();

  let appels = 0;
  const coupe = creerPanneau({
    generer: () => { appels++; return { ok: false, error: 'x', code: 'NETWORK' }; }
  });
  assert.ok(await jusqua(() => /injoignable/.test(coupe.messageLive())), coupe.messageLive());
  assert.doesNotMatch(coupe.messageLive(), /Accès fermé/);
  coupe.fermer();
});

test('erreur passagère sans consommation : un nouvel essai automatique, puis plus rien après deux', async () => {
  let appels = 0;
  const p = creerPanneau({
    generer: () => { appels++; return appels === 1 ? { ok: false, error: 'x', code: 'NETWORK' } : { ok: true, data: ANNONCE }; }
  });
  assert.ok(await jusqua(() => /nouvel essai automatique/.test(p.messageLive())), p.messageLive());
  assert.match(p.messageLive(), /Aucun crédit consommé/);
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1, 20000), p.messageLive());
  assert.strictEqual(p.serveur.appelsGenerer, 2);
  p.fermer();
});

test('erreurs répétées : au plus deux nouveaux essais, jamais d\'appels payants en boucle', async () => {
  const p = creerPanneau({ generer: () => ({ ok: false, error: 'x', code: 'HTTP_503' }) });
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 3, 40000), 'appels : ' + p.serveur.appelsGenerer);
  await attendre(6000);
  assert.strictEqual(p.serveur.appelsGenerer, 3, 'trois appels au maximum (1 + 2 nouveaux essais)');
  assert.doesNotMatch(p.messageLive(), /nouvel essai automatique dans/);
  p.fermer();
});

test('crédit consommé malgré l\'erreur : aucun nouvel essai automatique', async () => {
  const p = creerPanneau({
    generer: (msg, s) => { s.compte.credits.remaining -= 1; return { ok: false, error: 'x', code: 'HTTP_503' }; }
  });
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1));
  await attendre(9000);
  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.doesNotMatch(p.messageLive(), /nouvel essai automatique dans/);
  p.fermer();
});

test('« Interrompre » annule aussi un nouvel essai programmé', async () => {
  const p = creerPanneau({ generer: () => ({ ok: false, error: 'x', code: 'NETWORK' }) });
  assert.ok(await jusqua(() => /nouvel essai automatique dans/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(p.$('#live-annuler').hidden, false);
  p.$('#live-annuler').click();
  await attendre(8000);
  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.match(p.messageLive(), /annulée/);
  p.fermer();
});

test('panneau fermé pendant l\'analyse : à la réouverture le résultat est repris, sans seconde analyse', async () => {
  const p1 = creerPanneau({ generer: () => new Promise(() => {}) });
  assert.ok(await jusqua(() => p1.serveur.appelsGenerer === 1));
  assert.ok(p1.stockage.analysesEnvoyees, 'l\'envoi est mémorisé avant l\'appel');
  p1.fermer();
  await attendre(700);
  // Pendant que le panneau est fermé, le service worker termine l'analyse et mémorise le résultat.
  p1.serveur.resultats[p1.serveur.requetes[0].requestId] = { etat: 'termine', ok: true, data: ANNONCE };

  const p2 = creerPanneau({
    stockage: JSON.parse(JSON.stringify(p1.stockage)),
    resultats: p1.serveur.resultats
  });
  assert.ok(await jusqua(() => p2.serveur.appelsRemplir.length === 1 && /Annonce prête/.test(p2.messageLive()), 15000), p2.messageLive());
  assert.strictEqual(p2.serveur.appelsGenerer, 0, 'aucune nouvelle analyse après réouverture');
  assert.ok(p2.stockage.brouillons && p2.stockage.brouillons.length === 1);
  await attendre(4500);
  assert.strictEqual(p2.serveur.appelsGenerer, 0);
  p2.fermer();
});

test('résultat introuvable après réouverture : aucune relance automatique, message explicite', async () => {
  const p1 = creerPanneau({ generer: () => new Promise(() => {}) });
  assert.ok(await jusqua(() => p1.serveur.appelsGenerer === 1));
  p1.fermer();
  await attendre(700);

  const p2 = creerPanneau({ stockage: JSON.parse(JSON.stringify(p1.stockage)), resultats: {} });
  assert.ok(await jusqua(() => /résultat n'a pas été retrouvé/.test(p2.messageLive()), 15000), p2.messageLive());
  await attendre(4500);
  assert.strictEqual(p2.serveur.appelsGenerer, 0, 'jamais de double facturation automatique');
  assert.strictEqual(p2.serveur.appelsRemplir.length, 0);

  // la relance reste possible, à la demande
  p2.$('#live-generer').click();
  assert.ok(await jusqua(() => p2.serveur.appelsGenerer === 1));
  p2.fermer();
});

test('photo remplacée : une nouvelle analyse pour le nouvel ensemble seulement', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && p.serveur.appelsRemplir.length === 1));
  p.onglet.photos[0] = photo(9);
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 2));
  await attendre(4500);
  assert.strictEqual(p.serveur.appelsGenerer, 2);
  p.fermer();
});

test('amélioration automatique : recadrage seulement sur bords parfaitement unis, jamais autrement', () => {
  const Studio = require('../vinted-ia-extension/lib/studio.js');
  const Batch = require('../vinted-ia-extension/lib/batch.js');

  // vêtement foncé centré sur fond blanc uni : recadrage proposé
  const uni = Studio.creerImage(80, 80, [255, 255, 255, 255]);
  for (let y = 20; y < 60; y++) {
    for (let x = 20; x < 60; x++) {
      const i = (y * 80 + x) * 4;
      uni.data[i] = 30; uni.data[i + 1] = 40; uni.data[i + 2] = 90;
    }
  }
  const ops = Batch.ameliorerPhotoAuto({ source: uni }, Studio);
  assert.ok(ops.some((o) => o.type === 'recadrerAuto'));
  assert.ok(!ops.some((o) => /couleur|saturation|fond/i.test(o.type)), 'couleurs et fond jamais modifiés automatiquement');

  // photo occupant tout le cadre : rien à rogner, aucune opération de recadrage
  const plein = Studio.creerImage(80, 80, [120, 60, 60, 255]);
  for (let i = 0; i < plein.data.length; i += 4) plein.data[i] = (i * 7) % 255;
  assert.ok(!Batch.ameliorerPhotoAuto({ source: plein }, Studio).some((o) => o.type === 'recadrerAuto'));
});
