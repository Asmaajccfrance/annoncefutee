// Service worker : c'est le seul endroit qui lit la clé API et qui parle à l'IA.
// La page Vinted (content.js) ne voit jamais la clé.

importScripts('lib/core.js');

const IA = globalThis.VintedIA;
const API_URL = 'https://api.anthropic.com/v1/messages';

function lireReglages() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(IA.REGLAGES_DEFAUT, (r) => {
      if (chrome.runtime.lastError) {
        reject(new Error('Lecture des réglages impossible.'));
        return;
      }
      resolve(IA.assainirReglages(r));
    });
  });
}

// Les réglages (dont la clé) ne sont lisibles que par l'extension elle-même,
// pas par le script injecté dans la page Vinted.
try {
  if (chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
} catch (e) {
  /* navigateur plus ancien : comportement par défaut */
}

async function appelerApi(apiKey, corps, version) {
  let reponse;
  try {
    reponse = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': version || '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(corps)
    });
  } catch (e) {
    throw new Error('Connexion impossible au service IA. Vérifie ta connexion internet.');
  }

  let json = null;
  try {
    json = await reponse.json();
  } catch (e) {
    /* réponse non JSON */
  }

  if (!reponse.ok) {
    const brut = json && json.error && json.error.message ? json.error.message : '';
    const detail = String(brut).replace(/\s+/g, ' ').trim().slice(0, 180);
    if (reponse.status === 401) throw new Error('Clé API refusée. Vérifie-la dans les réglages.');
    if (reponse.status === 429) throw new Error('Trop de demandes ou crédit épuisé. Réessaie dans un instant.');
    if (reponse.status === 529 || reponse.status >= 500) throw new Error('Le service IA est surchargé. Réessaie dans un instant.');
    throw new Error('Erreur ' + reponse.status + (detail ? ' : ' + detail : ''));
  }
  return json;
}

async function generer(images, precisions) {
  const reglages = await lireReglages();
  if (IA.choisirMoteur(reglages) === 'backend') {
    return analyserViaBackend(reglages, images, precisions);
  }
  const { apiKey, model, signature } = reglages;
  if (!apiKey) {
    const err = new Error('Ajoute ta clé API dans les réglages de l\'extension.');
    err.code = 'NO_KEY';
    throw err;
  }

  const photos = IA.assainirImages(images);
  const prec = IA.assainirPrecisions(precisions);
  const contenu = photos.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data }
  }));

  let consigne =
    'Voici les photos d\'un article que je vends sur Vinted en tant que particulier. ' +
    'Rédige l\'annonce en français avec l\'outil "annonce".\n' +
    '- Décris uniquement ce qui est visible ou que je t\'indique. N\'invente ni taille, ni matière, ni marque.\n' +
    '- Si une information n\'est pas lisible, laisse le champ vide et signale-la dans "a_verifier".\n' +
    '- Signale honnêtement les défauts visibles dans la description.\n' +
    '- Ton simple et naturel, comme un vrai vendeur, sans formule publicitaire.';
  if (prec) {
    consigne += '\n\nPrécisions du vendeur (prioritaires sur les photos) : ' + prec;
  }
  consigne += '\n- Description : ' + IA.consigneDescription(reglages);
  if (signature) {
    consigne +=
      '\n\nTermine la description' +
      (reglages.hashtags ? ', avant les hashtags,' : '') +
      ' par cette phrase telle quelle : ' +
      signature;
  }
  contenu.push({ type: 'text', text: consigne });

  const appel = IA.optionsAppel(model);
  const corps = {
    model: model,
    max_tokens: appel.max_tokens,
    tools: [IA.construireOutil(reglages, appel.strict)],
    tool_choice: appel.tool_choice,
    messages: [{ role: 'user', content: contenu }]
  };
  if (appel.thinking) corps.thinking = appel.thinking;

  const json = await appelerApi(apiKey, corps, appel.anthropicVersion);
  const bloc = (json.content || []).find((b) => b.type === 'tool_use' && b.name === 'annonce');
  if (!bloc || !bloc.input || typeof bloc.input !== 'object') {
    if (json.stop_reason === 'max_tokens') throw new Error('La réponse de l\'IA a été coupée. Réessaie.');
    throw new Error('L\'IA n\'a pas renvoyé d\'annonce exploitable. Réessaie.');
  }

  const annonce = IA.assainirAnnonce(bloc.input);
  annonce.prix_ia = annonce.prix_suggere;
  annonce.prix_suggere = IA.appliquerReglePrix(annonce.prix_suggere, reglages);
  return annonce;
}

async function lireJson(reponse) {
  try {
    return await reponse.json();
  } catch (e) {
    return null;
  }
}

function messageServeur(reponse, json) {
  if (json && json.message) return String(json.message).replace(/\s+/g, ' ').trim().slice(0, 180);
  return 'Le serveur n\'a pas pu rédiger l\'annonce (' + reponse.status + ').';
}

async function analyserViaBackend(reglages, images, precisions) {
  const photos = IA.assainirImages(images);
  const url = IA.urlApi(reglages.backendUrl, '/api/v1/listings/analyze');
  let reponse;
  try {
    reponse = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Bearer ' + reglages.backendToken
      },
      body: JSON.stringify(IA.corpsAnalyse(photos, precisions, reglages))
    });
  } catch (e) {
    throw new Error('Connexion impossible au serveur. Vérifie qu\'il est démarré.');
  }
  const json = await lireJson(reponse);
  if (reponse.status === 401) {
    await chrome.storage.local.set({ backendToken: '' });
    const err = new Error('Session expirée. Reconnecte-toi dans les réglages.');
    err.code = 'NO_KEY';
    throw err;
  }
  if (!reponse.ok || !json || !json.data) throw new Error(messageServeur(reponse, json));
  return IA.preparerAnnonceServeur(json.data, reglages);
}

async function connecterCompte(email, password, backendUrl) {
  const url = IA.urlApi(backendUrl, '/api/v1/auth/login');
  let reponse;
  try {
    reponse = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: email, password: password, device_name: 'chrome' })
    });
  } catch (e) {
    throw new Error('Connexion impossible au serveur. Vérifie qu\'il est démarré.');
  }
  const json = await lireJson(reponse);
  if (!reponse.ok || !json || !json.token) throw new Error(messageServeur(reponse, json));
  const propre = IA.assainirReglages({ backendUrl: backendUrl, backendEmail: email, backendToken: json.token });
  await chrome.storage.local.set({
    backendUrl: propre.backendUrl,
    backendEmail: propre.backendEmail,
    backendToken: propre.backendToken
  });
  return { connected: true, email: propre.backendEmail, credits: json.credits || null, backendUrl: propre.backendUrl };
}

async function deconnecterCompte() {
  const reglages = await lireReglages();
  if (reglages.backendToken && reglages.backendUrl) {
    try {
      await fetch(IA.urlApi(reglages.backendUrl, '/api/v1/auth/logout'), {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: { accept: 'application/json', authorization: 'Bearer ' + reglages.backendToken }
      });
    } catch (e) {
      /* le jeton local est effacé même si le serveur ne répond pas */
    }
  }
  await chrome.storage.local.set({ backendToken: '', backendEmail: '' });
  return { connected: false };
}

async function lireCompte() {
  const reglages = await lireReglages();
  if (IA.choisirMoteur(reglages) !== 'backend') return { connected: false, email: '' };
  try {
    const reponse = await fetch(IA.urlApi(reglages.backendUrl, '/api/v1/me'), {
      credentials: 'omit',
      redirect: 'error',
      headers: { accept: 'application/json', authorization: 'Bearer ' + reglages.backendToken }
    });
    const json = await lireJson(reponse);
    if (reponse.status === 401) {
      await chrome.storage.local.set({ backendToken: '' });
      return { connected: false, email: '' };
    }
    if (!reponse.ok || !json || !json.user) return { connected: true, email: reglages.backendEmail, credits: null };
    return { connected: true, email: json.user.email, credits: json.credits || null };
  } catch (e) {
    return { connected: true, email: reglages.backendEmail, credits: null, offline: true };
  }
}

// Préférences non sensibles dont la page Vinted a besoin (jamais la clé).
async function lirePreferences() {
  const r = await lireReglages();
  return { autoGenerer: !!r.autoGenerer };
}

async function testerCle(apiKey, model) {
  const r = IA.assainirReglages({ apiKey: apiKey, model: model });
  if (!r.apiKey) throw new Error('Clé API manquante.');
  const appel = IA.optionsAppel(r.model);
  const corps = {
    model: r.model,
    max_tokens: appel.strict ? 256 : 5,
    messages: [{ role: 'user', content: 'Réponds: ok' }]
  };
  if (appel.thinking) corps.thinking = appel.thinking;
  await appelerApi(r.apiKey, corps, appel.anthropicVersion);
  return true;
}

// Récupère une image du CDN Vinted quand la page ne peut pas la lire directement.
// Cookies de session omis : ils ne quittent pas le navigateur vers un autre hôte.
async function recupererImage(url) {
  if (!IA.hoteImageAutorise(url)) throw new Error('Adresse d\'image non autorisée.');
  const r = await fetch(url, {
    redirect: 'follow',
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  if (!r.ok) throw new Error('Image inaccessible.');
  if (!IA.hoteImageAutorise(r.url)) throw new Error('Adresse d\'image non autorisée.');
  const blob = await r.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error('Image trop volumineuse.');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const pas = 0x8000;
  for (let i = 0; i < buf.length; i += pas) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + pas));
  }
  return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, sender, repondre) => {
  if (!msg || !msg.type) return false;
  if (!IA.autoriserMessage(msg.type, sender, chrome.runtime.id)) return false;

  const traiter = (promesse) => {
    promesse.then(
      (data) => repondre({ ok: true, data }),
      (e) => repondre({ ok: false, error: e.message || String(e), code: e.code || null })
    );
    return true;
  };

  if (msg.type === 'generate') return traiter(generer(msg.images, msg.precisions));
  if (msg.type === 'fetchImage') return traiter(recupererImage(msg.url));
  if (msg.type === 'getPrefs') return traiter(lirePreferences());
  if (msg.type === 'testKey') return traiter(testerCle(msg.apiKey, msg.model));
  if (msg.type === 'authLogin') return traiter(connecterCompte(msg.email, msg.password, msg.backendUrl));
  if (msg.type === 'authLogout') return traiter(deconnecterCompte());
  if (msg.type === 'getAccount') return traiter(lireCompte());
  if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  return false;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
