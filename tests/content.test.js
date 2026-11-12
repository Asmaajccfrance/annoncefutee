'use strict';

// Le vrai content.js, exécuté dans jsdom sur un faux formulaire « Vendre un article ».
// Vérifie : photos réellement chargées, jamais d'écrasement d'une saisie, jamais de soumission.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..', 'vinted-ia-extension');
const CORE = fs.readFileSync(path.join(DIR, 'lib', 'core.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(DIR, 'content.js'), 'utf8');

const fenetresOuvertes = [];
// Referme toute fenêtre restée ouverte (même si un test échoue) pour que le processus se termine.
test.after(() => fenetresOuvertes.forEach((w) => { try { w.close(); } catch (e) { /* déjà fermée */ } }));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function creerPage(corps) {
  const dom = new JSDOM(
    '<!doctype html><html><body><main><form id="f">' +
    '<input data-testid="title--input" id="titre" type="text">' +
    '<textarea data-testid="description--input" id="description"></textarea>' +
    '<input data-testid="price-input--input" id="prix" type="text">' +
    '<input data-testid="status-select-dropdown-input" id="etat" type="text" readonly>' +
    '<div id="photos"></div>' +
    (corps || '') +
    '</form></main></body></html>',
    { url: 'https://www.vinted.fr/items/new', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  fenetresOuvertes.push(w);
  const ecouteurs = [];
  const envoyes = [];
  w.chrome = {
    runtime: {
      id: 'abc',
      lastError: undefined,
      onMessage: { addListener: (f) => ecouteurs.push(f) },
      sendMessage: (msg, cb) => { envoyes.push(msg); if (cb) cb({ ok: true }); }
    }
  };
  w.CSS = { escape: (s) => s };
  w.Element.prototype.getBoundingClientRect = function rect() {
    return { width: 120, height: 120, top: 0, left: 0, right: 120, bottom: 120 };
  };
  w.eval(CORE);
  w.eval(CONTENT);

  const appeler = (msg) => new Promise((resolve) => ecouteurs[0](msg, { id: 'abc' }, resolve));
  const ajouterPhoto = (src, options = {}) => {
    const conteneur = w.document.createElement('div');
    const img = w.document.createElement('img');
    img.setAttribute('src', src);
    Object.defineProperty(img, 'complete', { get: () => options.chargee !== false, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { get: () => (options.chargee !== false ? 800 : 0), configurable: true });
    conteneur.appendChild(img);
    if (options.progression) {
      const barre = w.document.createElement('div');
      barre.setAttribute('role', 'progressbar');
      conteneur.appendChild(barre);
    }
    w.document.getElementById('photos').appendChild(conteneur);
    return img;
  };
  return { w, appeler, envoyes, ajouterPhoto, doc: w.document, fermer: () => w.close() };
}

const ANNONCE = { titre: 'Pull bleu', description: 'Pull doux.', prix_suggere: 18 };

test('seules les photos entièrement chargées sont prêtes, les autres sont comptées en chargement', async () => {
  const p = creerPage();
  p.ajouterPhoto('blob:https://www.vinted.fr/a');
  p.ajouterPhoto('blob:https://www.vinted.fr/b', { chargee: false });
  p.ajouterPhoto('blob:https://www.vinted.fr/c', { progression: true });
  const info = await p.appeler({ type: 'getPageInfo' });
  assert.strictEqual(info.photos, 1);
  assert.strictEqual(info.enChargement, 2);

  const collecte = await p.appeler({ type: 'getPageInfo' });
  assert.strictEqual(collecte.hash, info.hash, 'empreinte stable tant que rien ne change');
  p.fermer();
});

test('la fin du chargement est signalée une seule fois, sans bruit tant que rien ne change', async () => {
  const p = creerPage();
  const api = p.w.__annonceFutee;
  const photos = () => p.envoyes.filter((m) => m.type === 'photosChanged');

  const img = p.ajouterPhoto('blob:https://www.vinted.fr/a', { chargee: false });
  api.verifierPhotos();
  assert.strictEqual(photos().length, 1);
  assert.strictEqual(photos()[0].enChargement, 1);
  assert.strictEqual(photos()[0].count, 0);
  api.verifierPhotos();
  assert.strictEqual(photos().length, 1, 'aucune notification en double');

  Object.defineProperty(img, 'complete', { get: () => true });
  Object.defineProperty(img, 'naturalWidth', { get: () => 800 });
  api.verifierPhotos();
  assert.strictEqual(photos().length, 2);
  assert.strictEqual(photos()[1].enChargement, 0);
  assert.strictEqual(photos()[1].count, 1);

  img.parentElement.remove();
  api.verifierPhotos();
  assert.strictEqual(photos().length, 3);
  assert.strictEqual(photos()[2].count, 0, 'le retrait d\'une photo est détecté');
  p.fermer();
});

test('champs vides : remplis puis relus, états confirmés', async () => {
  const p = creerPage();
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.ok, true);
  assert.strictEqual(rep.fait.titre, 'rempli');
  assert.strictEqual(rep.fait.description, 'rempli');
  assert.strictEqual(rep.fait.prix, 'rempli');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull bleu');
  assert.strictEqual(p.doc.getElementById('prix').value, '18');
  p.fermer();
});

test('une saisie de l\'utilisateur n\'est jamais écrasée sans confirmation', async () => {
  const p = creerPage();
  p.doc.getElementById('titre').value = 'Mon titre à moi';
  p.doc.getElementById('prix').value = '18';

  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.fait.titre, 'conserve');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Mon titre à moi', 'valeur saisie intacte');
  assert.strictEqual(rep.fait.prix, 'deja', 'valeur déjà identique');
  assert.strictEqual(rep.fait.description, 'rempli');

  const force = await p.appeler({ type: 'fillListing', annonce: ANNONCE, forcer: ['titre'], seulement: ['titre'] });
  assert.strictEqual(force.fait.titre, 'rempli');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull bleu');
  assert.strictEqual(force.fait.description, undefined, 'seul le champ confirmé est touché');
  p.fermer();
});

test('une valeur posée par l\'extension peut être mise à jour, mais pas une valeur retouchée à la main ensuite', async () => {
  const p = creerPage();
  await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  const suivante = await p.appeler({ type: 'fillListing', annonce: { titre: 'Pull rouge', description: 'Autre.', prix_suggere: 25 } });
  assert.strictEqual(suivante.fait.titre, 'rempli');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull rouge');

  p.doc.getElementById('titre').value = 'Pull rouge, légère retouche perso';
  const derniere = await p.appeler({ type: 'fillListing', annonce: { titre: 'Pull vert', description: 'Encore.', prix_suggere: 30 } });
  assert.strictEqual(derniere.fait.titre, 'conserve');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull rouge, légère retouche perso');
  p.fermer();
});

test('un champ qui refuse la valeur n\'est jamais annoncé comme rempli', async () => {
  const p = creerPage();
  const titre = p.doc.getElementById('titre');
  // formulaire qui remet la valeur à zéro à chaque saisie
  titre.addEventListener('input', () => {
    Object.getOwnPropertyDescriptor(p.w.HTMLInputElement.prototype, 'value').set.call(titre, '');
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.fait.titre, 'echec');
  assert.strictEqual(rep.fait.description, 'rempli');
  p.fermer();
});

test('jamais de soumission du formulaire pendant le remplissage', async () => {
  const p = creerPage();
  let soumissions = 0;
  const form = p.doc.getElementById('f');
  form.addEventListener('submit', (e) => { soumissions++; e.preventDefault(); });
  // un champ dont la réaction à « change » tente d'envoyer le formulaire
  p.doc.getElementById('titre').addEventListener('change', () => {
    form.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(soumissions, 0);
  assert.ok(rep.soumissionsBloquees >= 1);

  // hors remplissage, le comportement normal de la page est rétabli
  form.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(soumissions, 1);
  p.fermer();
});

test('un bouton de validation ou de publication n\'est jamais cliqué, une vraie option l\'est', async () => {
  const p = creerPage();
  const etat = p.doc.getElementById('etat');
  let clicsPublier = 0;
  let clicsOption = 0;
  etat.addEventListener('click', () => {
    if (p.doc.getElementById('menu-ouvert')) return;
    const menu = p.doc.createElement('div');
    menu.id = 'menu-ouvert';
    menu.innerHTML = '<button type="submit" id="valider"><span>Très bon état</span></button>';
    p.doc.body.appendChild(menu);
    p.doc.getElementById('valider').addEventListener('click', () => { clicsPublier++; });
  });
  const annonce = Object.assign({ etat: 'Très bon état' }, ANNONCE);
  const rep = await p.appeler({ type: 'fillListing', annonce: annonce });
  assert.strictEqual(clicsPublier, 0, 'le bouton de type submit n\'est pas cliqué');
  assert.strictEqual(rep.menus.etat, 'a_choisir');

  const q = creerPage();
  const champ = q.doc.getElementById('etat');
  champ.addEventListener('click', () => {
    if (q.doc.getElementById('liste')) return;
    const liste = q.doc.createElement('div');
    liste.id = 'liste';
    liste.innerHTML = '<div id="opt">Très bon état</div>';
    q.doc.body.appendChild(liste);
    q.doc.getElementById('opt').addEventListener('click', () => { clicsOption++; });
  });
  const rep2 = await q.appeler({ type: 'fillListing', annonce: annonce });
  assert.ok(clicsOption >= 1);
  assert.strictEqual(rep2.menus.etat, 'rempli');
  p.fermer();
  q.fermer();
});

test('un menu déjà renseigné n\'est pas modifié', async () => {
  const p = creerPage();
  p.doc.getElementById('etat').value = 'Satisfaisant';
  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({ etat: 'Très bon état' }, ANNONCE) });
  assert.strictEqual(rep.menus.etat, 'conserve');
  assert.strictEqual(p.doc.getElementById('etat').value, 'Satisfaisant');

  p.doc.getElementById('etat').value = 'Très bon état';
  const rep2 = await p.appeler({ type: 'fillListing', annonce: Object.assign({ etat: 'Très bon état' }, ANNONCE) });
  assert.strictEqual(rep2.menus.etat, 'deja');
  p.fermer();
});

test('le script de page ne contient aucun moyen de soumettre ou de publier', () => {
  assert.ok(!/requestSubmit|\.submit\s*\(/.test(CONTENT), 'aucun appel de soumission');
  assert.ok(!/click\(\)[^;]*publier/i.test(CONTENT));
  assert.ok(/estBoutonValidation/.test(CONTENT));
});
