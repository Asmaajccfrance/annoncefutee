const assert = require('node:assert/strict');
const IA = require('../vinted-ia-extension/lib/core.js');

const base = process.env.CHAIN_BASE || 'http://127.0.0.1:8000';
const photo = process.env.CHAIN_PHOTO;
if (!photo) {
  throw new Error('CHAIN_PHOTO manquant');
}

assert.equal(IA.choisirMoteur({ apiKey: 'sk-ant-secret' }), 'claude');
assert.equal(IA.choisirMoteur({ backendToken: 'jeton', apiKey: 'sk-ant-secret' }), 'backend');
assert.throws(() => IA.urlApi('https://evil.example', '/api/v1/listings/analyze'), /non autorisée/);

const corps = IA.corpsAnalyse([photo, photo, photo, photo, photo], 'Coton, taille M, trou au coude.', {
  apiKey: 'sk-ant-secret',
  style: 'normal',
  hashtags: false,
  signature: ''
});
assert.equal(JSON.stringify(corps).includes('sk-ant-secret'), false);
assert.equal(corps.images.length, 5);

async function json(path, options) {
  const response = await fetch(IA.urlApi(base, path), options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = { raw: text.slice(0, 180) };
  }
  return { status: response.status, body };
}

(async () => {
  const registered = await json('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      name: 'Camille',
      email: 'chaine-p2@example.com',
      password: 'motdepasse1',
      password_confirmation: 'motdepasse1',
      device_name: 'chrome'
    })
  });
  assert.equal(registered.status, 201);
  const token = registered.body.token;
  assert.equal(typeof token, 'string');
  assert.equal(JSON.stringify(registered.body).includes('password'), false);

  const singleBody = IA.corpsAnalyse([photo], 'coton', {
    apiKey: 'sk-ant-secret',
    style: 'normal',
    hashtags: false,
    signature: ''
  });
  assert.equal(JSON.stringify(singleBody).includes('sk-ant-secret'), false);

  const single = await json('/api/v1/listings/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer ' + token
    },
    body: JSON.stringify(singleBody)
  });
  assert.equal(single.status, 200, JSON.stringify(single.body));
  assert.equal(single.body.data.titre, 'Pull marine');
  assert.equal(single.body.credits.used, 1);

  const five = await json('/api/v1/listings/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer ' + token
    },
    body: JSON.stringify(corps)
  });
  assert.equal(five.status, 200, JSON.stringify(five.body));
  const annonce = IA.preparerAnnonceServeur(five.body.data, { prixAjustement: -10, prixArrondi: 1 });
  assert.equal(annonce.titre, 'Pull marine');
  assert.equal(annonce.taille, 'M');
  assert.equal(annonce.matiere, 'Coton');
  assert.equal(annonce.marque, '');
  assert.equal(annonce.sous_categorie, 'Pulls et gilets');
  assert.equal(annonce.prix_ia, 18.2);
  assert.equal(annonce.prix_suggere, 16);
  assert.equal(five.body.data.etat, 'Bon état');

  const logout = await json('/api/v1/auth/logout', {
    method: 'POST',
    headers: { accept: 'application/json', authorization: 'Bearer ' + token }
  });
  assert.equal(logout.status, 200);
  const me = await json('/api/v1/me', {
    headers: { accept: 'application/json', authorization: 'Bearer ' + token }
  });
  assert.equal(me.status, 401);

  console.log('extension_chain=ok');
  console.log('one_photo=200');
  console.log('five_photos=200');
  console.log('logout=401');
})().catch((error) => {
  console.error(error && error.message ? error.message : 'chain_failed');
  process.exit(1);
});
