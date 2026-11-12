'use strict';

// Le vrai background.js exécuté avec un faux chrome et un faux fetch : aucun accès réseau.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '..', 'vinted-ia-extension');
const lire = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const PANNEAU = { id: EXT, url: 'chrome-extension://' + EXT + '/sidepanel.html' };
const PAGE = { id: EXT, url: 'https://www.vinted.fr/items/new' };

function creerService(fetchFaux, stockage) {
  const ecouteurs = [];
  const donnees = Object.assign({ backendToken: 'jeton', backendUrl: 'http://127.0.0.1:8000' }, stockage || {});
  const contexte = {
    console, URL, AbortController, JSON, Promise, Error, Object, Array, Number, String, Math, Date, setTimeout, clearTimeout,
    fetch: fetchFaux,
    importScripts: (f) => vm.runInContext(lire(f), contexte),
    chrome: {
      runtime: { id: EXT, lastError: undefined, onMessage: { addListener: (f) => ecouteurs.push(f) }, onInstalled: { addListener() {} }, sendMessage: () => Promise.resolve() },
      storage: {
        local: {
          get: (defauts, cb) => {
            const base = defauts && typeof defauts === 'object' && !Array.isArray(defauts) ? defauts : {};
            const res = Object.assign({}, base, donnees);
            if (typeof cb === 'function') cb(res);
            return Promise.resolve(res);
          },
          set: async (o) => { Object.assign(donnees, o); },
          setAccessLevel() {}
        }
      },
      sidePanel: { setPanelBehavior() {}, open: () => Promise.resolve() }
    }
  };
  contexte.globalThis = contexte;
  vm.createContext(contexte);
  vm.runInContext(lire('background.js'), contexte);
  const appeler = (msg, sender) => new Promise((resolve) => {
    const retour = ecouteurs[0](msg, sender, resolve);
    if (retour === false) resolve({ refuse: true });
  });
  return { appeler, donnees };
}

const reponse = (statut, corps) => ({ ok: statut >= 200 && statut < 300, status: statut, json: async () => corps });

test('l\'analyse en cours est réellement interrompue par cancelGenerate', async () => {
  let appels = 0;
  let signalRecu = null;
  const fetchFaux = (url, options) => {
    appels++;
    signalRecu = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const e = new Error('annulé');
        e.name = 'AbortError';
        reject(e);
      });
    });
  };
  const service = creerService(fetchFaux);
  const generation = service.appeler({ type: 'generate', images: ['QUJD'], precisions: '', requestId: 'r1' }, PANNEAU);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(appels, 1);
  assert.ok(signalRecu && !signalRecu.aborted);

  const annulation = await service.appeler({ type: 'cancelGenerate', requestId: 'r1' }, PANNEAU);
  assert.strictEqual(annulation.data, true);
  const rep = await generation;
  assert.strictEqual(rep.ok, false);
  assert.strictEqual(rep.code, 'ABORTED');
  assert.ok(signalRecu.aborted);

  const inconnue = await service.appeler({ type: 'cancelGenerate', requestId: 'zzz' }, PANNEAU);
  assert.strictEqual(inconnue.data, false);
});

test('seul le panneau peut interrompre une analyse', async () => {
  const service = creerService(() => new Promise(() => {}));
  assert.strictEqual((await service.appeler({ type: 'cancelGenerate', requestId: 'r1' }, PAGE)).refuse, true);
  assert.strictEqual((await service.appeler({ type: 'pingServeur' }, PAGE)).refuse, true);
});

test('une erreur serveur est transmise avec un code exploitable (service fermé = HTTP_403)', async () => {
  const service = creerService(async () => reponse(403, { message: 'Le service n\'est pas encore ouvert.' }));
  const rep = await service.appeler({ type: 'generate', images: ['QUJD'], precisions: '' }, PANNEAU);
  assert.strictEqual(rep.ok, false);
  assert.strictEqual(rep.code, 'HTTP_403');
  assert.match(rep.error, /pas encore ouvert/);
});

test('diagnostic : service fermé détecté sans identifiants, sans IA, sans crédit', async () => {
  const urls = [];
  const fetchFaux = async (url, options) => {
    urls.push({ url: url, methode: (options && options.method) || 'GET', corps: options && options.body, entetes: options && options.headers });
    if (url.endsWith('/api/v1/health')) return reponse(200, { ok: true, openai_configured: true, model: 'x' });
    return reponse(403, { message: 'Le service n\'est pas encore ouvert.' });
  };
  const service = creerService(fetchFaux);
  const rep = await service.appeler({ type: 'pingServeur' }, PANNEAU);
  assert.strictEqual(rep.data.joignable, true);
  assert.strictEqual(rep.data.ferme, true);
  assert.strictEqual(rep.data.openaiConfigure, true);
  assert.strictEqual(urls.length, 2);
  assert.ok(urls.every((u) => !u.url.includes('listings/analyze')), 'aucune analyse lancée');
  assert.ok(urls.every((u) => !(u.entetes && u.entetes.authorization)), 'aucun jeton envoyé');
  assert.strictEqual(urls[1].corps, '{}', 'connexion sans identifiants');

  const ouvert = creerService(async (url) => (url.endsWith('/health') ? reponse(200, { ok: true, openai_configured: false }) : reponse(422, {})));
  const rep2 = await ouvert.appeler({ type: 'pingServeur' }, PANNEAU);
  assert.strictEqual(rep2.data.ferme, false);
  assert.strictEqual(rep2.data.openaiConfigure, false);

  const mort = creerService(async () => { throw new Error('réseau'); });
  const rep3 = await mort.appeler({ type: 'pingServeur' }, PANNEAU);
  assert.strictEqual(rep3.data.joignable, false);
});

test('le résultat d\'une analyse est mémorisé : le panneau le retrouve même s\'il a été fermé', async () => {
  const service = creerService(async () => reponse(200, {
    data: { titre: 'Pull', description: 'd', categorie: 'c', couleurs: [], a_verifier: [] },
    credits: { remaining: 28 }
  }));
  const rep = await service.appeler({ type: 'generate', images: ['QUJD'], precisions: '', requestId: 'r-ok' }, PANNEAU);
  assert.strictEqual(rep.ok, true);

  const relu = await service.appeler({ type: 'getAnalyseResult', requestId: 'r-ok' }, PANNEAU);
  assert.strictEqual(relu.data.etat, 'termine');
  assert.strictEqual(relu.data.ok, true);
  assert.strictEqual(relu.data.data.titre, 'Pull');

  const inconnu = await service.appeler({ type: 'getAnalyseResult', requestId: 'jamais-vue' }, PANNEAU);
  assert.strictEqual(inconnu.data.etat, 'inconnu');
  assert.strictEqual((await service.appeler({ type: 'getAnalyseResult', requestId: 'r-ok' }, PAGE)).refuse, true, 'réservé au panneau');
});

test('analyse en cours : état « en-cours » ; échec mémorisé avec son code serveur', async () => {
  let liberer;
  const lent = creerService(() => new Promise((resolve) => { liberer = () => resolve(reponse(200, { data: { titre: 't' } })); }));
  const generation = lent.appeler({ type: 'generate', images: ['QUJD'], precisions: '', requestId: 'r-lent' }, PANNEAU);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual((await lent.appeler({ type: 'getAnalyseResult', requestId: 'r-lent' }, PANNEAU)).data.etat, 'en-cours');
  liberer();
  await generation;

  const ferme = creerService(async () => reponse(403, { code: 'client_access_closed', message: 'Le service n\'est pas encore ouvert.' }));
  const rep = await ferme.appeler({ type: 'generate', images: ['QUJD'], precisions: '', requestId: 'r-ferme' }, PANNEAU);
  assert.strictEqual(rep.ok, false);
  assert.strictEqual(rep.serverCode, 'client_access_closed');
  const relu = await ferme.appeler({ type: 'getAnalyseResult', requestId: 'r-ferme' }, PANNEAU);
  assert.strictEqual(relu.data.ok, false);
  assert.strictEqual(relu.data.serverCode, 'client_access_closed');
});

test('compte de test : indicateur transmis au panneau, la clé OpenAI n\'apparaît jamais', async () => {
  const service = creerService(async (url) => {
    if (url.endsWith('/auth/login')) {
      return reponse(200, { token: 'jeton-sanctum', user: { email: 'essai-chrome@annoncefutee.fr', test_account: true }, credits: { unlimited: true, used: 0 } });
    }
    if (url.endsWith('/health')) return reponse(200, { ok: true, openai_configured: true, client_api: false, test_account_access: true });
    return reponse(200, { user: { email: 'essai-chrome@annoncefutee.fr', test_account: true }, credits: { unlimited: true, used: 0 } });
  });
  const connexion = await service.appeler({ type: 'connectAccount', email: 'essai-chrome@annoncefutee.fr', password: 'x' }, PANNEAU);
  const texte = JSON.stringify(connexion);
  assert.ok(!/sk-|OPENAI/i.test(texte));
  const ping = await service.appeler({ type: 'pingServeur' }, PANNEAU);
  assert.strictEqual(ping.data.clientApi, false);
  assert.strictEqual(ping.data.accesTest, true);
});
