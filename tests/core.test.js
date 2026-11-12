const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const IA = require('../vinted-ia-extension/lib/core.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../vinted-ia-extension/manifest.json'), 'utf8'));

const EXT = 'abcdefghijklmnop';

test('la règle de prix reprend le calcul historique', () => {
  assert.equal(IA.appliquerReglePrix(20, { prixAjustement: 0, prixArrondi: 1 }), 20);
  assert.equal(IA.appliquerReglePrix(20, { prixAjustement: -10, prixArrondi: 1 }), 18);
  assert.equal(IA.appliquerReglePrix(20, { prixAjustement: -10, prixArrondi: 5 }), 20);
  assert.equal(IA.appliquerReglePrix(23, { prixAjustement: 0, prixArrondi: 5 }), 25);
  assert.equal(IA.appliquerReglePrix(2, { prixAjustement: 0, prixArrondi: 5 }), 5);
  assert.equal(IA.appliquerReglePrix(100, { prixAjustement: -200, prixArrondi: 1 }), 10);
  assert.equal(IA.appliquerReglePrix(10, { prixAjustement: 250, prixArrondi: 1 }), 20);
  assert.equal(IA.appliquerReglePrix(0, { prixAjustement: 10, prixArrondi: 1 }), 0);
  assert.equal(IA.appliquerReglePrix('non', { prixAjustement: 0, prixArrondi: 1 }), 'non');
});

test('le prix affiché reste un entier positif', () => {
  assert.equal(IA.formaterPrix(18.4), '18');
  assert.equal(IA.formaterPrix(0.4), '1');
  assert.equal(IA.formaterPrix(0), '');
  assert.equal(IA.formaterPrix(null), '');
  assert.equal(IA.formaterPrix('abc'), '');
});

test('les accents des menus sont ignorés', () => {
  assert.equal(IA.normaliser('Très bon état'), 'tres bon etat');
  assert.equal(IA.normaliser("  État de l'article  "), "etat de l'article");
  assert.equal(IA.MENUS.etat.motif.test(IA.normaliser('État')), true);
  assert.equal(IA.MENUS.etat.motif.test(IA.normaliser("État de l'article")), true);
  assert.equal(IA.MENUS.couleurs.motif.test(IA.normaliser('Couleurs (2)')), true);
  assert.equal(IA.MENUS.taille.motif.test(IA.normaliser('Taille')), true);
  assert.equal(IA.MENUS.matiere.motif.test(IA.normaliser('Matière')), true);
  assert.equal(IA.MENUS.etat.motif.test(IA.normaliser('Marque')), false);
});

test('les libellés du formulaire de démonstration sont reconnus', () => {
  const exemples = {
    titre: ['Titre', 'title of the item'],
    description: ['Description', 'Décris ton article'],
    prix: ['Prix', 'price']
  };
  for (const cle of Object.keys(exemples)) {
    for (const libelle of exemples[cle]) {
      assert.equal(IA.CHAMPS[cle].motif.test(libelle.toLowerCase()), true, libelle);
    }
  }
  assert.equal(IA.CHAMPS.titre.selecteurs[0], '[data-testid="title--input"]');
  assert.equal(IA.CHAMPS.description.selecteurs[0], '[data-testid="description--input"]');
  assert.equal(IA.CHAMPS.prix.selecteurs[0], '[data-testid="price-input--input"]');
});

test('seuls les hôtes image Vinted sont acceptés', () => {
  assert.equal(IA.hoteImageAutorise('https://images1.vinted.net/t/abc.jpg'), true);
  assert.equal(IA.hoteImageAutorise('https://www.vinted.fr/photo.jpg'), true);
  assert.equal(IA.hoteImageAutorise('https://vinted.net.evil.com/a.jpg'), false);
  assert.equal(IA.hoteImageAutorise('https://evil.com/images1.vinted.net/a.jpg'), false);
  assert.equal(IA.hoteImageAutorise('http://images1.vinted.net/a.jpg'), false);
  assert.equal(IA.hoteImageAutorise('blob:https://www.vinted.fr/uuid'), false);
  assert.equal(IA.hoteImageAutorise('pas une url'), false);
});

test('les photos et les précisions sont bornées', () => {
  const jpeg = Buffer.from('photo').toString('base64');
  assert.deepEqual(IA.assainirImages([jpeg, '!!!', jpeg, jpeg, jpeg, jpeg, jpeg]), [jpeg, jpeg, jpeg, jpeg, jpeg]);
  assert.throws(() => IA.assainirImages([]), /Aucune photo/);
  assert.throws(() => IA.assainirImages(['<script>']), /Aucune photo/);
  const enorme = 'A'.repeat(1500001);
  assert.throws(() => IA.assainirImages([enorme]), /trop volumineuses/);
  assert.equal(IA.assainirPrecisions('  taille M  '), 'taille M');
  assert.equal(IA.assainirPrecisions('x'.repeat(500)).length, 300);
  assert.equal(IA.assainirPrecisions(null), '');
});

test('une annonce IA est nettoyée sans inventer de champ', () => {
  const annonce = IA.assainirAnnonce({
    titre: '  Robe Zara  ',
    description: 'Robe noire, couture décousue en bas.',
    categorie: 'Femmes > Robes',
    marque: 'Zara',
    taille: '',
    etat: 'Comme neuf',
    couleurs: ['Noir', 'Or invisible', 'Blanc', 'Noir'],
    matiere: 'Coton',
    prix_suggere: 18.5,
    a_verifier: ['Taille illisible', '', 12, 'x'.repeat(300)]
  });
  assert.equal(annonce.titre, 'Robe Zara');
  assert.equal(annonce.etat, '');
  assert.deepEqual(annonce.couleurs, ['Noir', 'Blanc']);
  assert.equal(annonce.prix_suggere, 18.5);
  assert.deepEqual(annonce.a_verifier, ['Taille illisible', 'x'.repeat(200)]);
  assert.throws(() => IA.assainirAnnonce({ titre: '', description: 'x' }), /exploitable/);
});

test('les réglages restent dans les bornes connues', () => {
  const s = IA.assainirReglages({
    apiKey: '  sk-ant-test  ',
    model: 'claude-inconnu',
    style: 'detaille',
    hashtags: false,
    prixAjustement: -500,
    prixArrondi: 5,
    signature: 'y'.repeat(400),
    autoGenerer: true
  });
  assert.equal(s.apiKey, 'sk-ant-test');
  assert.equal(s.model, IA.MODELE_DEFAUT);
  assert.equal(s.style, 'detaille');
  assert.equal(s.hashtags, false);
  assert.equal(s.prixAjustement, -90);
  assert.equal(s.prixArrondi, 5);
  assert.equal(s.signature.length, 300);
  assert.equal(s.autoGenerer, true);
  assert.equal(IA.assainirReglages({}).hashtags, true);
});

test('Haiku garde l’appel forcé, Sonnet et Opus passent en outil strict', () => {
  const haiku = IA.optionsAppel('claude-haiku-5-5');
  assert.equal(haiku.max_tokens, 1500);
  assert.deepEqual(haiku.tool_choice, { type: 'tool', name: 'annonce' });
  assert.equal(haiku.strict, false);
  assert.equal(haiku.thinking, null);
  assert.equal(haiku.anthropicVersion, '2023-06-01');

  const outilHaiku = IA.construireOutil({ style: 'normal', hashtags: true }, false);
  assert.equal(outilHaiku.strict, undefined);
  assert.equal(outilHaiku.input_schema.additionalProperties, undefined);
  assert.equal(outilHaiku.input_schema.properties.couleurs.maxItems, 2);
  assert.equal(
    outilHaiku.input_schema.properties.description.description,
    'Description naturelle en français, 3 à 6 lignes, sans emoji en excès, suivie de 3 à 5 hashtags pertinents.'
  );

  const sonnet = IA.optionsAppel('claude-sonnet-5-5');
  assert.deepEqual(sonnet.tool_choice, { type: 'auto' });
  assert.deepEqual(sonnet.thinking, { type: 'between_tools' });
  assert.equal(sonnet.anthropicVersion, '2026-10-21');
  const outilSonnet = IA.construireOutil({ style: 'court', hashtags: false }, true);
  assert.equal(outilSonnet.strict, true);
  assert.equal(outilSonnet.input_schema.additionalProperties, false);
  assert.equal(outilSonnet.input_schema.properties.couleurs.maxItems, undefined);

  const opus = IA.optionsAppel('claude-opus-5-5');
  assert.deepEqual(opus.tool_choice, { type: 'auto' });
  assert.equal(opus.thinking, null);
  assert.equal(opus.strict, true);
});

test('les messages ne sont acceptés que depuis la bonne origine', () => {
  const page = { id: EXT, url: 'https://www.vinted.fr/items/new' };
  const options = { id: EXT, url: 'chrome-extension://' + EXT + '/options.html' };
  const autre = { id: 'autre', url: 'https://www.vinted.fr/items/new' };
  const piege = { id: EXT, url: 'https://www.vinted.fr.evil.com/items/new' };

  assert.equal(IA.autoriserMessage('generate', page, EXT), true);
  assert.equal(IA.autoriserMessage('fetchImage', page, EXT), true);
  assert.equal(IA.autoriserMessage('getPrefs', page, EXT), true);
  assert.equal(IA.autoriserMessage('testKey', page, EXT), false);
  assert.equal(IA.autoriserMessage('testKey', options, EXT), true);
  assert.equal(IA.autoriserMessage('generate', options, EXT), false);
  assert.equal(IA.autoriserMessage('openOptions', page, EXT), true);
  assert.equal(IA.autoriserMessage('generate', autre, EXT), false);
  assert.equal(IA.autoriserMessage('generate', piege, EXT), false);
  assert.equal(IA.autoriserMessage('generate', null, EXT), false);
  assert.equal(IA.autoriserMessage('voler', page, EXT), false);
  assert.equal(IA.autoriserMessage('authLogin', options, EXT), true);
  assert.equal(IA.autoriserMessage('authLogin', page, EXT), false);
  assert.equal(IA.autoriserMessage('authLogout', options, EXT), true);
  assert.equal(IA.autoriserMessage('getAccount', page, EXT), false);
});

test('une session serveur est prioritaire et ne transmet jamais la clé Claude', () => {
  assert.equal(IA.choisirMoteur({ backendToken: 'jeton', apiKey: 'sk-ant-test' }), 'backend');
  assert.equal(IA.choisirMoteur({ apiKey: 'sk-ant-test' }), 'claude');
  assert.equal(IA.choisirMoteur({}), 'none');

  const corps = IA.corpsAnalyse(['abcdabcdabcdabcd'], 'laine', {
    apiKey: 'sk-ant-test',
    style: 'court',
    hashtags: false,
    signature: 'Envoi soigné.'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(corps, 'apiKey'), false);
  assert.deepEqual(corps.images, ['abcdabcdabcdabcd']);
  assert.equal(corps.style, 'court');
  assert.equal(corps.hashtags, false);
  assert.equal(JSON.stringify(corps).includes('sk-ant-test'), false);
});

test('seuls le serveur local et l\'adresse officielle peuvent recevoir la session', () => {
  assert.equal(IA.API_OFFICIELLE, 'https://annoncefutee.fr');
  assert.equal(IA.REGLAGES_DEFAUT.backendUrl, 'https://annoncefutee.fr');
  assert.equal(
    IA.urlApi('https://annoncefutee.fr/autre?jeton=1', '/api/v1/listings/analyze'),
    'https://annoncefutee.fr/api/v1/listings/analyze'
  );
  assert.equal(IA.urlApi('https://AnnonceFutee.fr:443', '/api/v1/me'), 'https://annoncefutee.fr/api/v1/me');
  assert.equal(
    IA.urlApi('http://127.0.0.1:8000/autre', '/api/v1/listings/analyze'),
    'http://127.0.0.1:8000/api/v1/listings/analyze'
  );
  assert.equal(IA.urlApi('http://localhost:8000', '/api/v1/me'), 'http://localhost:8000/api/v1/me');
  assert.equal(IA.assainirReglages({}).backendUrl, 'https://annoncefutee.fr');
  assert.equal(IA.assainirReglages({ backendUrl: 'https://annoncefutee.fr/api/v1' }).backendUrl, 'https://annoncefutee.fr');

  const refus = [
    'http://annoncefutee.fr',
    'https://www.annoncefutee.fr',
    'https://api.annoncefutee.fr',
    'https://annoncefutee.fr.evil.com',
    'https://evil-annoncefutee.fr',
    'https://annoncefutee.fr:8443',
    'https://user:secret@annoncefutee.fr',
    'https://annoncefutee.fr@evil.com',
    'http://127.0.0.1:8001',
    'http://api.exemple.fr',
    'https://api.exemple.fr/ignored',
    'https://api.exemple.fr.evil.com',
    'https://user:secret@127.0.0.1:8000'
  ];
  for (const url of refus) {
    assert.throws(() => IA.urlApi(url, '/api/v1/me'), /non autorisée/, url);
  }
  assert.equal(IA.assainirReglages({ backendUrl: 'https://evil.example' }).backendUrl, '');
  assert.equal(IA.assainirReglages({ backendUrl: 'http://annoncefutee.fr' }).backendUrl, '');
  assert.equal(IA.assainirReglages({ backendUrl: 'https://www.annoncefutee.fr' }).backendUrl, '');
  assert.equal(IA.choisirMoteur({ backendToken: 'jeton', backendUrl: 'https://evil.example', apiKey: 'sk-ant-test' }), 'backend');
});

test('le jeton ne quitte pas l\'origine contrôlée', () => {
  const source = fs.readFileSync(path.join(__dirname, '../vinted-ia-extension/background.js'), 'utf8');
  const appel = source.slice(source.indexOf('async function appelerApi'), source.indexOf('async function generer'));
  assert.equal(appel.includes('backendToken'), false);
  assert.equal(appel.includes('authorization'), false);
  assert.equal((source.match(/authorization: 'Bearer ' \+ reglages\.backendToken/g) || []).length, 3);
  assert.equal((source.match(/redirect: 'error'/g) || []).length, 4);
  assert.equal((source.match(/credentials: 'omit'/g) || []).length, 5);
  assert.equal(source.includes("if (IA.choisirMoteur(reglages) === 'backend')"), true);
});

test('le manifeste n\'accorde le serveur qu\'à l\'origine officielle et au développement local', () => {
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'optional_host_permissions'), false);
  assert.deepEqual(manifest.host_permissions, [
    'https://api.anthropic.com/*',
    'https://*.vinted.net/*',
    'https://vinted.net/*',
    'https://*.vinted.fr/*',
    'https://vinted.fr/*',
    'http://127.0.0.1:8000/*',
    'http://localhost:8000/*',
    IA.API_OFFICIELLE + '/*'
  ]);
  assert.equal(manifest.host_permissions.includes('https://*/*'), false);
  assert.equal(manifest.host_permissions.includes('http://annoncefutee.fr/*'), false);
  assert.equal(manifest.host_permissions.includes('https://www.annoncefutee.fr/*'), false);
  assert.equal(manifest.host_permissions.includes('https://*.annoncefutee.fr/*'), false);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.vinted.fr/*']);
});

test('la règle de prix locale s\'applique à la réponse du serveur', () => {
  const annonce = IA.preparerAnnonceServeur({
    titre: 'Pull noir',
    description: 'Pull en laine, porté quelques fois.',
    sous_categorie: 'Pulls',
    prix_suggere: 18.2,
    couleurs: ['Noir']
  }, { prixAjustement: -10, prixArrondi: 1 });
  assert.equal(annonce.prix_ia, 18.2);
  assert.equal(annonce.prix_suggere, 16);
  assert.equal(annonce.sous_categorie, 'Pulls');
});
