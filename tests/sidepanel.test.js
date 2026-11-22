'use strict';

// Parcours du panneau latéral (voir helpers/panneau.js pour le banc d'essai).

const test = require('node:test');
const assert = require('node:assert');
const { creerPanneau, photo, empreinte, cleDe, attendre, jusqua, ANNONCE, erreursNonGerees, fermerTout } = require('./helpers/panneau');

// Referme toute fenêtre restée ouverte (même si un test échoue) pour que le processus se termine.
test.after(fermerTout);

test('une photo ajoutée s\'affiche seule, une seule analyse, formulaire rempli, crédit constaté', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.nbPhotos() === 1), 'la photo doit apparaître sans clic');
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1 && /rempli\(s\)/.test(p.messageLive())), p.messageLive());

  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.match(p.champs(), /Titre\s*Rempli ✓/);
  assert.match(p.champs(), /Prix\s*Échec/, 'un champ non confirmé ne doit pas être annoncé comme rempli');
  assert.match(p.champs(), /Taille[^]*À choisir toi-même/);
  assert.match(p.champs(), /Catégorie\s*À choisir toi-même/);
  assert.match(p.champs(), /Marque\s*Rempli ✓/);
  assert.match(p.champs(), /Estimation de l'IA, à vérifier/);
  const lien = p.$('button.lien-similaires');
  assert.ok(lien, 'le bouton des annonces similaires est sous le prix');
  assert.strictEqual(lien.getAttribute('data-url'), 'https://www.vinted.fr/catalog?search_text=' + encodeURIComponent(ANNONCE.titre));
  assert.strictEqual(p.$('#photoFond').checked, false);
  assert.strictEqual(p.$('#photoOriginales').checked, true);
  assert.strictEqual(p.$('#photoCouverture').checked, false);
  assert.strictEqual(p.$('#photoRedresser').checked, true);
  assert.strictEqual(p.badge(), 'Prête');

  // transparence : chaque information demandée est affichée
  const bilan = p.bilan();
  assert.match(bilan, /Photos détectées\s*1/);
  assert.match(bilan, /Prêtes pour l'analyse\s*Oui/);
  assert.match(bilan, /AnalyseTerminée/);
  assert.match(bilan, /AnnonceGénérée/);
  assert.match(bilan, /CréditConsommé : 1 crédit \(29 → 28\)/);
  assert.match(bilan, /Champs remplis/);
  assert.match(bilan, /À vérifier[^]*Prix/);

  const [brouillon] = p.stockage.brouillons;
  assert.ok(brouillon.cle);
  assert.strictEqual(brouillon.photos, undefined, 'aucune photo pleine taille dans le stockage');
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});

test('plusieurs photos ajoutées d\'affilée : le délai repart à chaque changement, une seule analyse pour l\'ensemble', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && p.serveur.appelsRemplir.length === 1));

  p.onglet.photos.push(photo(2));
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 2));
  await attendre(2000);
  p.onglet.photos.push(photo(3));
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 3));
  assert.strictEqual(p.serveur.appelsGenerer, 1, 'pas d\'analyse tant que les photos continuent de changer');
  assert.match(p.bilan(), /analyse dans \d+ s/);

  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 2));
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 2, 'une seule analyse pour l\'ensemble des trois photos');
  assert.strictEqual(p.serveur.requetes[1].images.length, 3);

  // retrait puis retour à un ensemble déjà analysé : aucune nouvelle analyse
  p.onglet.photos.length = 0;
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 0));
  p.onglet.photos.push(photo(1));
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 2);
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});

test('photos en cours de chargement : aucune analyse avant qu\'elles soient prêtes', async () => {
  const p = creerPanneau({ photos: [photo(1)] });
  p.onglet.enChargement = 1;
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  p.notifierPhotos();
  assert.ok(await jusqua(() => /en cours de chargement/.test(p.messageLive())), p.messageLive());
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'rien tant qu\'une photo se charge');
  assert.match(p.bilan(), /Non : chargement en cours/);

  p.onglet.enChargement = 0;
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1));
  p.fermer();
});

test('serveur fermé (CLIENT_API=false) : message clair, crédit non consommé, aucun nouvel essai', async () => {
  const p = creerPanneau({
    generer: () => ({ ok: false, error: 'Le service n\'est pas encore ouvert.', code: 'HTTP_403', serverCode: 'client_access_closed' })
  });
  assert.ok(await jusqua(() => /Accès fermé/.test(p.messageLive())), p.messageLive());
  assert.doesNotMatch(p.messageLive(), /Serveur indisponible/, 'un accès fermé n\'est pas une panne');
  assert.match(p.messageLive(), /Ce n'est pas une panne/);
  assert.match(p.messageLive(), /Aucune annonce n'a été générée/);
  assert.strictEqual(p.badge(), 'Erreur');
  assert.match(p.bilan(), /CréditNon consommé \(refusé par le serveur\)/);
  assert.strictEqual(p.stockage.brouillons, undefined);
  assert.strictEqual(p.serveur.appelsRemplir.length, 0);

  p.notifierPhotos();
  await attendre(4500);
  assert.strictEqual(p.serveur.appelsGenerer, 1, 'pas de nouvelle tentative automatique sur les mêmes photos');
  p.fermer();
});

test('interruption pendant la stabilisation : aucune analyse, aucun crédit', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => /analyse dans/.test(p.bilan())));
  assert.strictEqual(p.$('#live-annuler').hidden, false);
  p.$('#live-annuler').click();
  assert.ok(await jusqua(() => /annulée/.test(p.messageLive())), p.messageLive());
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  assert.strictEqual(p.serveur.compte.credits.remaining, 29);

  // l'utilisateur peut relancer à la main
  p.$('#live-generer').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1));
  p.fermer();
});

test('interruption pendant l\'analyse : requête annulée, crédit constaté, rien n\'est enregistré ni rempli', async () => {
  const p = creerPanneau({ generer: () => new Promise(() => {}) });
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1), 'l\'analyse part');
  assert.match(p.badge(), /Analyse en cours/);
  assert.strictEqual(p.$('#live-annuler').hidden, false);
  p.$('#live-annuler').click();
  assert.ok(await jusqua(() => /Analyse interrompue/.test(p.messageLive())), p.messageLive());
  assert.deepStrictEqual(p.serveur.annulations.length, 1);
  assert.match(p.bilan(), /AnalyseInterrompue/);
  assert.match(p.bilan(), /CréditNon consommé \(solde inchangé : 29, à confirmer plus tard\)/);
  assert.strictEqual(p.stockage.brouillons, undefined);
  assert.strictEqual(p.serveur.appelsRemplir.length, 0);
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 1, 'pas de relance automatique après interruption');
  p.fermer();
});

test('sans compte serveur, la clé Claude n\'est jamais utilisée sans choix explicite', async () => {
  const p = creerPanneau({ stockage: { backendToken: '', apiKey: 'sk-ant-test', claudeExplicite: false } });
  assert.ok(await jusqua(() => /Claude/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  p.fermer();

  const q = creerPanneau({ stockage: { backendToken: '', apiKey: 'sk-ant-test', claudeExplicite: true } });
  assert.ok(await jusqua(() => q.serveur.appelsGenerer === 1), 'avec choix explicite, Claude est utilisé');
  assert.ok(await jusqua(() => q.serveur.appelsRemplir.length === 1));
  q.fermer();
});

test('crédits insuffisants : aucune analyse n\'est envoyée', async () => {
  const p = creerPanneau({ compte: { connected: true, email: 'a@b.c', credits: { monthly: 30, used: 30, remaining: 0, analysis_cost: 1 } } });
  assert.ok(await jusqua(() => /Crédits insuffisants/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  assert.match(p.bilan(), /CréditNon consommé/);
  p.fermer();
});

test('sans consentement, le mode automatique ne lance rien', async () => {
  const p = creerPanneau({ stockage: { autoGenerer: true, consentementIA: false } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(4500);
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  assert.strictEqual(p.$('#autoGenerer').checked, false);
  p.fermer();
});

test('mode manuel : rien sans clic, puis un clic sur « Générer » génère et remplit le formulaire', async () => {
  const p = creerPanneau({ stockage: { autoGenerer: false } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(3500);
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'rien sans clic quand le mode automatique est désactivé');
  assert.strictEqual(p.serveur.appelsRemplir.length, 0);
  assert.strictEqual(p.$('#live-generer').hidden, false);

  p.$('#live-generer').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && p.serveur.appelsRemplir.length === 1 && /rempli\(s\)/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(p.serveur.appelsRemplir.length, 1, 'un seul remplissage pour un clic');
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});

test('mode manuel, remplissage automatique décoché : le formulaire n\'est rempli que sur demande', async () => {
  const p = creerPanneau({ stockage: { autoGenerer: false, autoRemplir: false } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));

  p.$('#live-generer').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && !p.$('#live-remplir').hidden), p.messageLive());
  assert.strictEqual(p.serveur.appelsRemplir.length, 0, 'pas de remplissage tant que l\'utilisateur ne le demande pas');

  p.$('#live-remplir').click();
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1 && /rempli\(s\)/.test(p.messageLive())));
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});

test('champ saisi par l\'utilisateur : proposition de remplacement uniquement sur confirmation, champ par champ', async () => {
  const p = creerPanneau({ fait: { titre: 'conserve', description: 'rempli', prix: 'rempli' } });
  assert.ok(await jusqua(() => /Ta saisie est conservée/.test(p.champs())), p.champs());
  assert.match(p.bilan(), /À vérifier[^]*Titre/);
  const bouton = p.w.document.querySelector('.btn-remplacer');
  assert.ok(bouton, 'un bouton « Remplacer » est proposé');
  assert.strictEqual(p.serveur.appelsRemplir.length, 1);

  p.fenetre.reponseConfirm = false;
  bouton.click();
  await attendre(300);
  assert.strictEqual(p.serveur.appelsRemplir.length, 1, 'refus de confirmer : aucun écrasement');

  p.fenetre.reponseConfirm = true;
  p.w.document.querySelector('.btn-remplacer').click();
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 2));
  const demande = p.serveur.appelsRemplir[1];
  assert.deepStrictEqual(Array.from(demande.forcer), ['titre']);
  assert.deepStrictEqual(Array.from(demande.seulement), ['titre']);
  assert.ok(await jusqua(() => /Champ « titre »/.test(p.messageLive())), 'le traitement va jusqu\'au bout avant de fermer');
  p.fermer();
});

test('une annonce modifiée à la main n\'est remplacée qu\'après confirmation, sans doublon', async () => {
  const photos = [photo(1)];
  const existant = {
    id: 'bro-1', titre: 'Mon titre modifié', description: 'x', prix: 20, cle: cleDe(photos),
    statut: 'pret', modifie: true, dateCreation: 1, dateModification: 2, plateforme: 'vinted'
  };
  const p = creerPanneau({ photos: photos, stockage: { brouillons: [existant] } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'ensemble déjà analysé : rien en automatique');

  p.fenetre.reponseConfirm = false;
  p.$('#live-generer').click();
  await attendre(500);
  assert.match(p.fenetre.confirmations[0], /Tu as modifié cette annonce/);
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  assert.strictEqual(p.stockage.brouillons[0].titre, 'Mon titre modifié');

  p.fenetre.reponseConfirm = true;
  p.$('#live-generer').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1));
  assert.ok(await jusqua(() => p.stockage.brouillons[0].titre === ANNONCE.titre));
  assert.strictEqual(p.stockage.brouillons.length, 1, 'remplacé sur place, pas de doublon');
  assert.strictEqual(p.stockage.brouillons[0].id, 'bro-1');
  p.fermer();
});

test('précisions modifiées : information claire, jamais d\'analyse automatique', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1));
  const champ = p.$('#live-precisions');
  champ.value = 'Petit accroc sur la manche';
  champ.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  assert.ok(await jusqua(() => !p.$('#live-precisions-info').hidden));
  assert.match(p.$('#live-precisions-info').textContent, /aucune analyse automatique/);
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 1);

  p.$('#live-generer').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 2));
  assert.strictEqual(p.serveur.requetes[1].precisions, 'Petit accroc sur la manche');
  p.fermer();
});

test('deux formulaires Vinted en préparation restent distincts', async () => {
  const p = creerPanneau({ photos: [photo(1)], autresOnglets: { 8: [photo(8), photo(9)] } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  p.notifierPhotos(8);
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 2, 25000), 'chaque formulaire a sa propre analyse');
  assert.ok(await jusqua(() => (p.stockage.brouillons || []).length === 2));
  const [a, b] = p.stockage.brouillons;
  assert.notStrictEqual(a.cle, b.cle);
  assert.deepStrictEqual(p.serveur.requetes.map((r) => r.images.length).sort(), [1, 2]);
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 2));
  assert.deepStrictEqual(p.serveur.appelsRemplir.map((r) => r.tabId).sort(), [7, 8]);
  assert.strictEqual(p.nbPhotos(), 1, 'le panneau affiche le formulaire de l\'onglet actif');
  await attendre(4000);
  assert.strictEqual(p.serveur.appelsGenerer, 2);
  p.fermer();
});

test('création manuelle : groupes choisis par l\'utilisateur, un appel par groupe, pas de doublon', async () => {
  const p = creerPanneau({ photos: [], stockage: { autoGenerer: false } });
  const input = p.$('#fichiers');
  const fichiers = [1, 2, 3].map((n) => new p.w.File(['img' + n], 'p' + n + '.png', { type: 'image/png' }));
  Object.defineProperty(input, 'files', { value: fichiers, configurable: true });
  input.dispatchEvent(new p.w.Event('change'));
  assert.ok(await jusqua(() => p.w.document.querySelectorAll('#galerie .vignette').length === 3));

  p.w.document.querySelector('[data-section="creer"]').click();
  p.w.document.querySelector('input[name="mode-creation"][value="groupes"]').click();
  await attendre(100);
  const selects = p.w.document.querySelectorAll('#photos-selectionnees select');
  assert.strictEqual(selects.length, 3);
  selects[0].value = '1'; selects[0].dispatchEvent(new p.w.Event('change', { bubbles: true }));
  const apres = p.w.document.querySelectorAll('#photos-selectionnees select');
  apres[1].value = '2'; apres[1].dispatchEvent(new p.w.Event('change', { bubbles: true }));
  const encore = p.w.document.querySelectorAll('#photos-selectionnees select');
  encore[2].value = '2'; encore[2].dispatchEvent(new p.w.Event('change', { bubbles: true }));
  assert.match(p.$('#info-articles').textContent, /2 article\(s\)/);

  p.$('#generer-lot').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 2));
  assert.deepStrictEqual(p.serveur.requetes.map((r) => r.images.length).sort(), [1, 2]);
  assert.ok(await jusqua(() => (p.stockage.brouillons || []).length === 2));

  // même groupes : aucune nouvelle analyse
  p.w.document.querySelector('[data-section="creer"]').click();
  p.$('#generer-lot').click();
  await attendre(800);
  assert.strictEqual(p.serveur.appelsGenerer, 2, 'photos déjà analysées : pas de nouvelle facturation');
  p.fermer();
});

test('diagnostic serveur : état réel affiché sans promettre que la chaîne fonctionne', async () => {
  const p = creerPanneau();
  p.$('#diagnostic-serveur').click();
  assert.ok(await jusqua(() => /aucun compte de test configuré/.test(p.$('#diagnostic-resultat').textContent)));
  const texte = p.$('#diagnostic-resultat').textContent;
  assert.match(texte, /fonctionnement non vérifié/);
  assert.match(texte, /aucun crédit utilisé/);
  p.fermer();

  const q = creerPanneau({ ping: { url: 'https://x', joignable: true, ferme: true, accesTest: true, openaiConfigure: true } });
  q.$('#diagnostic-serveur').click();
  assert.ok(await jusqua(() => /réservé au compte de test/.test(q.$('#diagnostic-resultat').textContent)));
  assert.match(q.$('#diagnostic-resultat').textContent, /ce n'est pas une panne/);
  q.fermer();
});

function fauxDetourage(w) {
  w.createImageBitmap = async () => ({ close() {} });
  w.AnnonceFuteeDetourage = {
    disponible: () => false,
    originale() { return { toDataURL: () => 'data:image/jpeg;base64,' + Buffer.from('ORIGINE').toString('base64') }; },
    presenter: async () => ({ ok: true, canvas: { toDataURL: () => 'data:image/jpeg;base64,' + Buffer.from('BLANC').toString('base64') }, angle: 0 })
  };
}

function deposer(p, fichiers) {
  const ev = new p.w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: fichiers } });
  p.$('#depot').dispatchEvent(ev);
}

function imageFactice(p, nom) {
  return new p.w.File([Uint8Array.from([1, 2, 3])], nom, { type: 'image/jpeg' });
}

async function reglagesPrets(p) {
  assert.ok(await jusqua(() => (p.$('#signature').value || '').indexOf('Envoi') >= 0));
}

function nomsPhotos(msg) {
  return msg.images.map((img) => Buffer.from(img.b64, 'base64').toString()).join('|');
}

test('le dépôt envoie l\'originale sans fond blanc, sauf si la case est cochée', async () => {
  const p = creerPanneau({ avantPanneau: fauxDetourage });
  await reglagesPrets(p);
  deposer(p, [new p.w.File(['note'], 'note.txt', { type: 'text/plain' })]);
  await attendre(200);
  assert.strictEqual(p.serveur.appelsPhotos.length, 0, 'un fichier qui n\'est pas une image est ignoré');

  deposer(p, [imageFactice(p, 'a.jpg')]);
  assert.ok(await jusqua(() => p.serveur.appelsPhotos.length === 1));
  assert.strictEqual(nomsPhotos(p.serveur.appelsPhotos[0]), 'ORIGINE');
  p.fermer();

  const q = creerPanneau({ avantPanneau: fauxDetourage });
  await reglagesPrets(q);
  q.$('#photoFond').checked = true;
  q.$('#sauvegarder').click();
  assert.ok(await jusqua(() => q.stockage.photoFond === true && q.stockage.photoFondChoisi === true));
  deposer(q, [imageFactice(q, 'a.jpg')]);
  assert.ok(await jusqua(() => q.serveur.appelsPhotos.length === 1));
  assert.strictEqual(nomsPhotos(q.serveur.appelsPhotos[0]), 'ORIGINE|BLANC');
  q.fermer();
});

test('la couverture et l\'absence d\'originales changent l\'ordre envoyé', async () => {
  const p = creerPanneau({ avantPanneau: fauxDetourage });
  await reglagesPrets(p);
  p.$('#photoFond').checked = true;
  p.$('#photoCouverture').checked = true;
  p.$('#sauvegarder').click();
  assert.ok(await jusqua(() => p.stockage.photoCouverture === true));
  deposer(p, [imageFactice(p, 'a.jpg')]);
  assert.ok(await jusqua(() => p.serveur.appelsPhotos.length === 1));
  assert.strictEqual(nomsPhotos(p.serveur.appelsPhotos[0]), 'BLANC|ORIGINE');
  p.fermer();

  const q = creerPanneau({ avantPanneau: fauxDetourage });
  await reglagesPrets(q);
  q.$('#photoFond').checked = true;
  q.$('#photoOriginales').checked = false;
  q.$('#sauvegarder').click();
  assert.ok(await jusqua(() => q.stockage.photoOriginales === false));
  deposer(q, [imageFactice(q, 'a.jpg')]);
  assert.ok(await jusqua(() => q.serveur.appelsPhotos.length === 1));
  assert.strictEqual(nomsPhotos(q.serveur.appelsPhotos[0]), 'BLANC');
  q.fermer();
});

test('si l\'ajout au formulaire échoue, l\'erreur est affichée et l\'enregistrement proposé', async () => {
  const p = creerPanneau({
    avantPanneau: fauxDetourage,
    addPhotos: { ok: false, error: 'Le formulaire refuse les photos.' }
  });
  await reglagesPrets(p);
  deposer(p, [imageFactice(p, 'a.jpg')]);
  assert.ok(await jusqua(() => /Le formulaire refuse les photos/.test(p.$('#depot-message').textContent)));
  assert.strictEqual(p.$('#depot-enregistrer').hidden, false);
  p.fermer();
});
