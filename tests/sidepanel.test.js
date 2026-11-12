'use strict';

// Banc d'essai du panneau latéral : le vrai sidepanel.js, les vrais modules Studio/Batch/Core,
// dans jsdom, avec un faux navigateur (chrome.*), un faux onglet Vinted et un faux serveur.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..', 'vinted-ia-extension');
const lire = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const HTML = lire('sidepanel.html');
const SCRIPTS = ['lib/core.js', 'lib/studio.js', 'lib/batch.js', 'sidepanel.js'].map(lire);

const erreursNonGerees = [];
process.on('unhandledRejection', (e) => erreursNonGerees.push(e));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond, delai = 6000) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (cond()) return true;
    await attendre(50);
  }
  return false;
}

const photo = (n) => Buffer.from('photo-' + n + '-' + 'x'.repeat(3000) + n).toString('base64');

const ANNONCE = {
  titre: 'Pull en laine bleu marine',
  description: 'Pull très doux, peu porté.',
  categorie: 'Femmes > Vêtements > Pulls',
  sous_categorie: 'Pulls',
  marque: 'Zara',
  taille: 'M',
  etat: 'Très bon état',
  couleurs: ['Bleu'],
  matiere: 'Laine',
  prix_suggere: 18,
  a_verifier: []
};

function creerPanneau(options = {}) {
  const dom = new JSDOM(HTML, { url: 'chrome-extension://abc/sidepanel.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  const serveur = {
    appelsGenerer: 0,
    appelsRemplir: 0,
    generer: options.generer || (() => ({ ok: true, data: ANNONCE })),
    compte: options.compte || { connected: true, email: 'test@annoncefutee.fr', credits: { monthly: 30, used: 1, remaining: 29, analysis_cost: 1 } }
  };
  const onglet = { photos: options.photos || [photo(1)] };
  const stockage = Object.assign(
    { backendToken: 'jeton', backendEmail: 'test@annoncefutee.fr', autoGenerer: true, consentementIA: true, autoRemplir: true },
    options.stockage || {}
  );
  const ecouteursRuntime = [];

  w.chrome = {
    runtime: {
      id: 'abc',
      lastError: undefined,
      getManifest: () => ({ version: '9.9.9' }),
      onMessage: { addListener: (f) => ecouteursRuntime.push(f) },
      sendMessage: (msg, cb) => {
        let rep;
        if (msg.type === 'generate') {
          serveur.appelsGenerer++;
          rep = serveur.generer(msg);
        } else if (msg.type === 'getAccount') {
          rep = { ok: true, data: serveur.compte };
        } else {
          rep = { ok: false, error: 'Message inconnu : ' + msg.type };
        }
        setTimeout(() => cb(rep), 0);
      }
    },
    storage: {
      local: {
        get: async (cles) => {
          const out = {};
          for (const k of [].concat(cles)) if (k in stockage) out[k] = stockage[k];
          return out;
        },
        set: async (obj) => { Object.assign(stockage, JSON.parse(JSON.stringify(obj))); }
      }
    },
    tabs: {
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      query: async () => [{ id: 7, url: 'https://www.vinted.fr/items/new' }],
      get: async () => ({ id: 7, url: 'https://www.vinted.fr/items/new' }),
      sendMessage: async (id, msg) => {
        if (msg.type === 'getPageInfo') {
          return { ok: true, estPageVente: true, photos: onglet.photos.length, hash: onglet.photos.join('|').length + ':' + onglet.photos.length + ':' + onglet.photos.map((p) => p.slice(-12)).join(','), url: 'https://www.vinted.fr/items/new' };
        }
        if (msg.type === 'collectPhotos') return { ok: true, images: onglet.photos.slice() };
        if (msg.type === 'fillListing') {
          serveur.appelsRemplir++;
          return { ok: true, fait: { titre: 'rempli', description: 'rempli', prix: 'echec' }, menus: { etat: 'rempli', taille: 'a_choisir', couleurs: 'deja' } };
        }
        return { ok: true };
      }
    }
  };

  w.Image = function Image() {
    const img = { naturalWidth: 800, naturalHeight: 600, onload: null, onerror: null };
    Object.defineProperty(img, 'src', { set() { setTimeout(() => img.onload && img.onload(), 0); } });
    return img;
  };
  w.ImageData = function ImageData(data, largeur, hauteur) { this.data = data; this.width = largeur; this.height = hauteur; };
  w.confirm = () => true;
  w.prompt = () => null;
  w.HTMLCanvasElement.prototype.getContext = function getContext() {
    const canvas = this;
    return {
      fillRect() {}, drawImage() {}, putImageData() {}, strokeRect() {}, setLineDash() {},
      getImageData: (x, y, largeur, hauteur) => ({ width: largeur, height: hauteur, data: new Uint8ClampedArray(largeur * hauteur * 4).fill(40) }),
      canvas
    };
  };
  w.HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
    return 'data:image/jpeg;base64,' + Buffer.from('c' + this.width + 'x' + this.height).toString('base64');
  };

  for (const code of SCRIPTS) w.eval(code);

  const $ = (s) => w.document.querySelector(s);
  return {
    w, $, serveur, onglet, stockage,
    messageLive: () => $('#live-message').textContent,
    champs: () => $('#live-champs').textContent,
    badge: () => $('#live-badge').textContent,
    nbPhotos: () => w.document.querySelectorAll('#live-photos img').length,
    notifierPhotos: () => ecouteursRuntime.forEach((f) => f({ type: 'photosDetected', tabId: 7 }, { id: 'abc' })),
    fermer: () => w.close()
  };
}

test('une photo ajoutée sur Vinted s\'affiche seule, puis annonce générée une fois et formulaire rempli', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.nbPhotos() === 1), 'la photo doit apparaître sans clic');
  assert.ok(await jusqua(() => p.serveur.appelsRemplir === 1 && /rempli\(s\)/.test(p.messageLive())), 'génération puis remplissage automatiques : ' + p.messageLive());

  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.match(p.champs(), /Titre\s*Rempli ✓/);
  assert.match(p.champs(), /Prix\s*Échec/, 'un champ non confirmé ne doit pas être annoncé comme rempli');
  assert.match(p.champs(), /Taille[^]*À choisir toi-même/);
  assert.match(p.champs(), /Catégorie\s*À renseigner/);
  assert.match(p.champs(), /Marque\s*À renseigner/);
  assert.strictEqual(p.badge(), 'Prête');

  const [brouillon] = p.stockage.brouillons;
  assert.ok(brouillon.cle, 'le brouillon garde l\'empreinte de ses photos');
  assert.strictEqual(brouillon.photos, undefined, 'aucune photo pleine taille dans le stockage');
  assert.ok(brouillon.vignette.length < 2000);

  // ajout d'une deuxième photo : nouvel ensemble, une seule analyse supplémentaire
  p.onglet.photos.push(photo(2));
  p.notifierPhotos();
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 2));
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 2));
  await attendre(2500);
  assert.strictEqual(p.serveur.appelsGenerer, 2, 'jamais deux analyses pour le même événement');

  // retrait de toutes les photos
  p.onglet.photos.length = 0;
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 0));
  assert.match(p.badge(), /Aucune photo/);

  // retour à un ensemble déjà analysé : pas de nouvelle facturation
  p.onglet.photos.push(photo(1));
  p.notifierPhotos();
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(2500);
  assert.strictEqual(p.serveur.appelsGenerer, 2);
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});

test('serveur fermé (CLIENT_API=false) : message clair, aucun faux succès, aucun nouvel essai automatique', async () => {
  const p = creerPanneau({
    generer: () => ({ ok: false, error: 'Le service n\'est pas encore ouvert.', code: 'HTTP_403' })
  });
  assert.ok(await jusqua(() => /Serveur indisponible/.test(p.messageLive())), p.messageLive());
  assert.match(p.messageLive(), /Aucune annonce n'a été générée/);
  assert.strictEqual(p.badge(), 'Erreur');
  assert.strictEqual(p.stockage.brouillons, undefined);
  assert.strictEqual(p.serveur.appelsRemplir, 0);

  p.notifierPhotos();
  await attendre(2500);
  assert.strictEqual(p.serveur.appelsGenerer, 1, 'pas de nouvelle tentative automatique sur les mêmes photos');
  p.fermer();
});

test('sans compte serveur, la clé Claude n\'est jamais utilisée sans choix explicite', async () => {
  const p = creerPanneau({ stockage: { backendToken: '', apiKey: 'sk-ant-test', claudeExplicite: false } });
  assert.ok(await jusqua(() => /Claude/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  p.fermer();

  const q = creerPanneau({ stockage: { backendToken: '', apiKey: 'sk-ant-test', claudeExplicite: true } });
  assert.ok(await jusqua(() => q.serveur.appelsGenerer === 1), 'avec choix explicite, Claude est utilisé');
  assert.ok(await jusqua(() => q.serveur.appelsRemplir === 1), 'le traitement va jusqu\'au bout avant de fermer');
  q.fermer();
});

test('crédits insuffisants : aucune analyse n\'est envoyée', async () => {
  const p = creerPanneau({ compte: { connected: true, email: 'a@b.c', credits: { monthly: 30, used: 30, remaining: 0, analysis_cost: 1 } } });
  assert.ok(await jusqua(() => /Crédits insuffisants/.test(p.messageLive())), p.messageLive());
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  p.fermer();
});

test('sans consentement, le mode automatique ne lance rien', async () => {
  const p = creerPanneau({ stockage: { autoGenerer: true, consentementIA: false } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(2200);
  assert.strictEqual(p.serveur.appelsGenerer, 0);
  assert.strictEqual(p.$('#autoGenerer').checked, false);
  p.fermer();
});

test('mode manuel : photos affichées, génération et remplissage sur demande seulement', async () => {
  const p = creerPanneau({ stockage: { autoGenerer: false } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(2200);
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'rien sans clic quand le mode automatique est désactivé');
  assert.strictEqual(p.$('#live-generer').hidden, false);

  p.$('#live-generer').click();
  assert.ok(await jusqua(() => p.serveur.appelsGenerer === 1 && !p.$('#live-remplir').hidden), p.messageLive());
  assert.strictEqual(p.serveur.appelsRemplir, 0, 'pas de remplissage tant que l\'utilisateur ne le demande pas');

  p.$('#live-remplir').click();
  assert.ok(await jusqua(() => p.serveur.appelsRemplir === 1 && /rempli\(s\)/.test(p.messageLive())));
  assert.deepStrictEqual(erreursNonGerees, []);
  p.fermer();
});
