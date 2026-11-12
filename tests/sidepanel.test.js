'use strict';

// Banc d'essai du panneau latéral : le vrai sidepanel.js, les vrais modules Studio/Batch/Core,
// dans jsdom, avec un faux navigateur (chrome.*), de faux onglets Vinted et un faux serveur.
// Aucun appel réseau réel : aucune dépense possible.

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

const fenetresOuvertes = [];
// Referme toute fenêtre restée ouverte (même si un test échoue) pour que le processus se termine.
test.after(() => fenetresOuvertes.forEach((w) => { try { w.close(); } catch (e) { /* déjà fermée */ } }));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond, delai = 12000) {
  const debut = Date.now();
  while (Date.now() - debut < delai) {
    if (cond()) return true;
    await attendre(50);
  }
  return false;
}

const photo = (n) => Buffer.from('photo-' + n + '-' + 'x'.repeat(3000) + n).toString('base64');

// Même algorithme que le panneau (l'empreinte fait partie du contrat avec les brouillons stockés)
function empreinte(b64) {
  let h = 2166136261;
  const pas = Math.max(1, Math.floor(b64.length / 512));
  for (let i = 0; i < b64.length; i += pas) {
    h ^= b64.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36) + '-' + b64.length.toString(36);
}
const cleDe = (photos) => photos.map(empreinte).sort().join('|');

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
  fenetresOuvertes.push(w);

  const serveur = {
    appelsGenerer: 0,
    requetes: [],
    appelsRemplir: [],
    annulations: [],
    enAttente: null,
    generer: options.generer || (() => ({ ok: true, data: ANNONCE })),
    compte: options.compte || { connected: true, email: 'test@annoncefutee.fr', credits: { monthly: 30, used: 1, remaining: 29, analysis_cost: 1 } }
  };
  // Onglets Vinted simulés : le 7 est actif, les autres sont en arrière-plan.
  const onglets = { 7: { photos: (options.photos || [photo(1)]).slice(), enChargement: 0, actif: true } };
  for (const [id, photos] of Object.entries(options.autresOnglets || {})) onglets[id] = { photos: photos.slice(), enChargement: 0, actif: false };
  const stockage = Object.assign(
    { backendToken: 'jeton', backendEmail: 'test@annoncefutee.fr', autoGenerer: true, consentementIA: true, autoRemplir: true, delaiStabilisation: 3 },
    options.stockage || {}
  );
  const ecouteursRuntime = [];
  const fenetre = { confirmations: [], reponseConfirm: true };

  const urlOnglet = (id) => (onglets[id] ? 'https://www.vinted.fr/items/new' : 'https://example.com/');

  w.chrome = {
    runtime: {
      id: 'abc',
      lastError: undefined,
      getManifest: () => ({ version: '9.9.9' }),
      onMessage: { addListener: (f) => ecouteursRuntime.push(f) },
      sendMessage: (msg, cb) => {
        const repondre = (rep) => setTimeout(() => cb(rep), 0);
        if (msg.type === 'generate') {
          serveur.appelsGenerer++;
          serveur.requetes.push(msg);
          const rep = serveur.generer(msg, serveur);
          if (rep && typeof rep.then === 'function') {
            serveur.enAttente = { requestId: msg.requestId, repondre: repondre };
            rep.then((r) => { if (r) repondre(r); });
          } else {
            if (rep.ok && serveur.compte.credits) serveur.compte.credits.remaining -= 1;
            repondre(rep);
          }
        } else if (msg.type === 'cancelGenerate') {
          serveur.annulations.push(msg.requestId);
          if (serveur.enAttente && serveur.enAttente.requestId === msg.requestId) {
            serveur.enAttente.repondre({ ok: false, error: 'Analyse interrompue.', code: 'ABORTED' });
            serveur.enAttente = null;
          }
          repondre({ ok: true, data: true });
        } else if (msg.type === 'getAccount') {
          repondre({ ok: true, data: serveur.compte });
        } else if (msg.type === 'pingServeur') {
          repondre({ ok: true, data: options.ping || { url: 'https://x', joignable: true, ferme: true, openaiConfigure: true } });
        } else {
          repondre({ ok: false, error: 'Message inconnu : ' + msg.type });
        }
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
      onRemoved: { addListener() {} },
      query: async () => [{ id: 7, url: urlOnglet(7) }],
      get: async (id) => {
        if (!onglets[id]) throw new Error('onglet fermé');
        return { id: Number(id), url: urlOnglet(id) };
      },
      sendMessage: async (id, msg) => {
        const o = onglets[id];
        if (!o) throw new Error('onglet fermé');
        if (msg.type === 'getPageInfo') {
          return {
            ok: true, estPageVente: true, photos: o.photos.length, enChargement: o.enChargement,
            hash: o.photos.map((p) => p.slice(-12)).join(','), url: urlOnglet(id)
          };
        }
        if (msg.type === 'collectPhotos') return { ok: true, images: o.photos.slice() };
        if (msg.type === 'fillListing') {
          serveur.appelsRemplir.push(Object.assign({ tabId: Number(id) }, msg));
          const fait = msg.seulement
            ? Object.fromEntries(msg.seulement.map((c) => [c, 'rempli']))
            : (options.fait || { titre: 'rempli', description: 'rempli', prix: 'echec' });
          return { ok: true, fait: fait, menus: msg.seulement ? {} : { etat: 'rempli', taille: 'a_choisir', couleurs: 'deja' } };
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
  w.confirm = (texte) => { fenetre.confirmations.push(texte); return fenetre.reponseConfirm; };
  w.prompt = () => null;
  w.HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      fillRect() {}, drawImage() {}, putImageData() {}, strokeRect() {}, setLineDash() {},
      getImageData: (x, y, largeur, hauteur) => ({ width: largeur, height: hauteur, data: new Uint8ClampedArray(largeur * hauteur * 4).fill(40) })
    };
  };
  w.HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
    return 'data:image/jpeg;base64,' + Buffer.from('c' + this.width + 'x' + this.height).toString('base64');
  };

  for (const code of SCRIPTS) w.eval(code);

  const $ = (s) => w.document.querySelector(s);
  return {
    w, $, serveur, onglets, onglet: onglets[7], stockage, fenetre,
    messageLive: () => $('#live-message').textContent,
    champs: () => $('#live-champs').textContent,
    bilan: () => $('#live-bilan').textContent,
    badge: () => $('#live-badge').textContent,
    nbPhotos: () => w.document.querySelectorAll('#live-photos img').length,
    notifierPhotos: (tabId = 7) => ecouteursRuntime.forEach((f) => f({ type: 'photosDetected', tabId: tabId }, { id: 'abc' })),
    fermer: () => w.close()
  };
}

test('une photo ajoutée s\'affiche seule, une seule analyse, formulaire rempli, crédit constaté', async () => {
  const p = creerPanneau();
  assert.ok(await jusqua(() => p.nbPhotos() === 1), 'la photo doit apparaître sans clic');
  assert.ok(await jusqua(() => p.serveur.appelsRemplir.length === 1 && /rempli\(s\)/.test(p.messageLive())), p.messageLive());

  assert.strictEqual(p.serveur.appelsGenerer, 1);
  assert.match(p.champs(), /Titre\s*Rempli ✓/);
  assert.match(p.champs(), /Prix\s*Échec/, 'un champ non confirmé ne doit pas être annoncé comme rempli');
  assert.match(p.champs(), /Taille[^]*À choisir toi-même/);
  assert.match(p.champs(), /Catégorie\s*À renseigner/);
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
    generer: () => ({ ok: false, error: 'Le service n\'est pas encore ouvert.', code: 'HTTP_403' })
  });
  assert.ok(await jusqua(() => /Serveur indisponible/.test(p.messageLive())), p.messageLive());
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

test('mode manuel : photos affichées, génération et remplissage sur demande seulement', async () => {
  const p = creerPanneau({ stockage: { autoGenerer: false } });
  assert.ok(await jusqua(() => p.nbPhotos() === 1));
  await attendre(3500);
  assert.strictEqual(p.serveur.appelsGenerer, 0, 'rien sans clic quand le mode automatique est désactivé');
  assert.strictEqual(p.$('#live-generer').hidden, false);

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
  assert.ok(await jusqua(() => /FERMÉ/.test(p.$('#diagnostic-resultat').textContent)));
  const texte = p.$('#diagnostic-resultat').textContent;
  assert.match(texte, /CLIENT_API=false/);
  assert.match(texte, /fonctionnement non vérifié/);
  assert.match(texte, /aucun crédit utilisé/);
  p.fermer();
});
