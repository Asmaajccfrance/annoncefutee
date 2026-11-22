'use strict';

// Banc d'essai partagé du panneau latéral : le vrai sidepanel.js, les vrais modules Studio/Batch/Core,
// dans jsdom, avec un faux navigateur (chrome.*), de faux onglets Vinted et un faux serveur.
// Aucun appel réseau réel : aucune dépense possible.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..', '..', 'vinted-ia-extension');
const lire = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const HTML = lire('sidepanel.html');
const SCRIPTS = ['lib/core.js', 'lib/studio.js', 'lib/batch.js', 'sidepanel.js'].map(lire);

const erreursNonGerees = [];
process.on('unhandledRejection', (e) => erreursNonGerees.push(e));

const fenetresOuvertes = [];

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
  // Toute erreur JavaScript non gérée survenue dans le panneau est enregistrée ici.
  const erreurs = [];
  w.addEventListener('error', (e) => erreurs.push(e.message));

  const serveur = {
    appelsGenerer: 0,
    requetes: [],
    appelsRemplir: [],
    appelsPhotos: [],
    annulations: [],
    resultats: options.resultats || {},
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
          // Comme le vrai service worker : le résultat est mémorisé, même si le panneau est fermé entre-temps.
          const memoriser = (r) => {
            serveur.resultats[msg.requestId] = r.ok
              ? { etat: 'termine', ok: true, data: r.data }
              : { etat: 'termine', ok: false, error: r.error, code: r.code, serverCode: r.serverCode };
          };
          const debiter = (r) => {
            const c = serveur.compte.credits;
            if (!r.ok || !c) return;
            if (c.unlimited) c.used += 1; else c.remaining -= 1;
          };
          if (rep && typeof rep.then === 'function') {
            serveur.resultats[msg.requestId] = { etat: 'en-cours' };
            serveur.enAttente = { requestId: msg.requestId, repondre: repondre };
            rep.then((r) => { if (r) { debiter(r); memoriser(r); repondre(r); } });
          } else {
            debiter(rep);
            memoriser(rep);
            repondre(rep);
          }
        } else if (msg.type === 'getAnalyseResult') {
          repondre({ ok: true, data: serveur.resultats[msg.requestId] || { etat: 'inconnu' } });
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
        set: async (obj) => { Object.assign(stockage, JSON.parse(JSON.stringify(obj))); },
        remove: async (cles) => { for (const k of [].concat(cles)) delete stockage[k]; }
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
        if (msg.type === 'collectPhotos') return o.collecteEchoue ? { ok: false } : { ok: true, images: o.photos.slice() };
        if (msg.type === 'fillListing') {
          serveur.appelsRemplir.push(Object.assign({ tabId: Number(id) }, msg));
          const fait = msg.seulement
            ? Object.fromEntries(msg.seulement.map((c) => [c, 'rempli']))
            : (options.fait || { titre: 'rempli', description: 'rempli', prix: 'echec' });
          return { ok: true, fait: fait, menus: msg.seulement ? {} : { etat: 'rempli', taille: 'a_choisir', couleurs: 'deja', marque: 'rempli' } };
        }
        if (msg.type === 'addPhotos') {
          serveur.appelsPhotos.push(msg);
          return options.addPhotos || { ok: true, nb: (msg.images || []).length };
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
  // Faux canvas : le « contenu » est résumé par une somme de contrôle des pixels, pour que deux rendus
  // différents donnent deux URL différentes (on peut ainsi vérifier qu'une retouche a bien eu lieu).
  const somme = (data) => { let s = 0; for (let i = 0; i < data.length; i += 97) s = (s * 31 + data[i]) % 1000003; return s; };
  w.HTMLCanvasElement.prototype.getContext = function getContext() {
    const canvas = this;
    return {
      fillRect() {}, strokeRect() {}, setLineDash() {},
      drawImage(source) { if (source && source.__somme !== undefined) canvas.__somme = source.__somme; },
      putImageData(image) { canvas.__somme = somme(image.data); },
      getImageData: (x, y, largeur, hauteur) => ({ width: largeur, height: hauteur, data: new Uint8ClampedArray(largeur * hauteur * 4).fill(40) })
    };
  };
  w.HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
    return 'data:image/jpeg;base64,' + Buffer.from('c' + this.width + 'x' + this.height + 's' + (this.__somme || 0)).toString('base64');
  };

  for (const code of SCRIPTS) {
    if (code === SCRIPTS[SCRIPTS.length - 1] && options.avantPanneau) options.avantPanneau(w);
    w.eval(code);
  }

  const $ = (s) => w.document.querySelector(s);
  return {
    w, $, serveur, onglets, onglet: onglets[7], stockage, fenetre, erreurs,
    messageLive: () => $('#live-message').textContent,
    champs: () => $('#live-champs').textContent,
    bilan: () => $('#live-bilan').textContent,
    badge: () => $('#live-badge').textContent,
    nbPhotos: () => w.document.querySelectorAll('#live-photos img').length,
    notifierPhotos: (tabId = 7) => ecouteursRuntime.forEach((f) => f({ type: 'photosDetected', tabId: tabId }, { id: 'abc' })),
    // Fermeture différée : les tâches de démarrage encore en vol se terminent avant la destruction de la fenêtre.
    fermer: () => { const t = setTimeout(() => { try { w.close(); } catch (e) { /* déjà fermée */ } }, 400); t.unref(); }
  };
}


function fermerTout() { fenetresOuvertes.forEach((w) => { try { w.close(); } catch (e) { /* déjà fermée */ } }); }

module.exports = { creerPanneau, photo, empreinte, cleDe, attendre, jusqua, ANNONCE, erreursNonGerees, fermerTout };
