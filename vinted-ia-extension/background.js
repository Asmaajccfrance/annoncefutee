// Service worker : c'est le seul endroit qui lit la clé API et qui parle à l'IA.
// La page Vinted (content.js) ne voit jamais la clé.

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-5-5';

const ETATS = [
  'Neuf avec étiquette',
  'Neuf sans étiquette',
  'Très bon état',
  'Bon état',
  'Satisfaisant'
];

// Couleurs proposées dans le menu "Couleur" de Vinted.
const COULEURS = [
  'Noir', 'Marron', 'Gris', 'Beige', 'Rose', 'Violet', 'Rouge', 'Jaune', 'Bleu', 'Vert',
  'Orange', 'Blanc', 'Argenté', 'Doré', 'Multicolore', 'Kaki', 'Turquoise', 'Crème',
  'Abricot', 'Corail', 'Bordeaux', 'Lila', 'Bleu clair', 'Marine', 'Vert foncé',
  'Moutarde', 'Menthe'
];

const REGLAGES_DEFAUT = {
  apiKey: '',
  model: DEFAULT_MODEL,
  signature: '',
  style: 'normal', // court | normal | detaille
  hashtags: true,
  prixAjustement: 0, // en %, ex. -10
  prixArrondi: 1, // 1 = à l'euro, 5 = au multiple de 5 €
  autoGenerer: false
};

const LONGUEURS = {
  court: '2 lignes maximum, l\'essentiel seulement',
  normal: '3 à 6 lignes',
  detaille: '6 à 10 lignes, avec les détails utiles à un acheteur (coupe, poches, fermetures, usage)'
};

function consigneDescription(r) {
  const longueur = LONGUEURS[r.style] || LONGUEURS.normal;
  const fin = r.hashtags ? 'suivie de 3 à 5 hashtags pertinents' : 'sans aucun hashtag';
  return 'Description naturelle en français, ' + longueur + ', sans emoji en excès, ' + fin + '.';
}

// Applique la règle de prix choisie dans les réglages à l'estimation de l'IA.
function appliquerReglePrix(prix, r) {
  const p = Number(prix);
  if (!isFinite(p) || p <= 0) return prix;
  const pct = Math.min(100, Math.max(-90, Number(r.prixAjustement) || 0));
  const pas = Number(r.prixArrondi) === 5 ? 5 : 1;
  const v = Math.round((p * (1 + pct / 100)) / pas) * pas;
  return Math.max(pas, v);
}

const construireOutil = (r) => ({
  name: 'annonce',
  description: "Enregistre l'annonce Vinted rédigée à partir des photos.",
  input_schema: {
    type: 'object',
    properties: {
      titre: {
        type: 'string',
        description: 'Titre court et précis (60 caractères max) : type d\'article, marque, détail clé, taille si connue.'
      },
      description: {
        type: 'string',
        description: consigneDescription(r)
      },
      categorie: {
        type: 'string',
        description: 'Chemin de catégorie Vinted le plus probable, ex. "Femmes > Vêtements > Robes > Robes d\'été".'
      },
      marque: {
        type: 'string',
        description: 'Marque visible sur les photos (logo, étiquette). Chaîne vide si non identifiable.'
      },
      taille: {
        type: 'string',
        description: 'Taille lue sur une étiquette ou donnée par le vendeur. Chaîne vide si inconnue.'
      },
      etat: { type: 'string', enum: ETATS },
      couleurs: {
        type: 'array',
        items: { type: 'string', enum: COULEURS },
        maxItems: 2,
        description: 'Une ou deux couleurs principales, la plus présente en premier, choisies dans la liste Vinted (ex. un bleu marine se dit "Marine").'
      },
      matiere: {
        type: 'string',
        description: 'Matière principale en un seul mot courant tel qu\'il figure dans un menu (ex. "Coton", "Polyester", "Cuir", "Laine"), uniquement si elle est lisible sur une étiquette ou évidente. Chaîne vide sinon.'
      },
      prix_suggere: {
        type: 'number',
        description: 'Prix de vente conseillé en euros pour de la seconde main, estimation prudente.'
      },
      a_verifier: {
        type: 'array',
        items: { type: 'string' },
        description: 'Points que les photos ne permettent pas de confirmer (taille, défauts, authenticité...).'
      }
    },
    required: ['titre', 'description', 'categorie', 'marque', 'taille', 'etat', 'couleurs', 'matiere', 'prix_suggere', 'a_verifier']
  }
});

function lireReglages() {
  return new Promise((resolve) => {
    chrome.storage.local.get(REGLAGES_DEFAUT, resolve);
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

async function appelerApi(apiKey, corps) {
  let reponse;
  try {
    reponse = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
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
    const detail = json && json.error && json.error.message ? json.error.message : '';
    if (reponse.status === 401) throw new Error('Clé API refusée. Vérifie-la dans les réglages.');
    if (reponse.status === 429) throw new Error('Trop de demandes ou crédit épuisé. Réessaie dans un instant.');
    if (reponse.status === 529 || reponse.status >= 500) throw new Error('Le service IA est surchargé. Réessaie dans un instant.');
    throw new Error('Erreur ' + reponse.status + (detail ? ' : ' + detail : ''));
  }
  return json;
}

async function generer(images, precisions) {
  const reglages = await lireReglages();
  const { apiKey, model, signature } = reglages;
  if (!apiKey) {
    const err = new Error('Ajoute ta clé API dans les réglages de l\'extension.');
    err.code = 'NO_KEY';
    throw err;
  }
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Aucune photo reçue.');
  }

  const contenu = images.map((data) => ({
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
  if (precisions) {
    consigne += '\n\nPrécisions du vendeur (prioritaires sur les photos) : ' + precisions;
  }
  consigne += '\n- Description : ' + consigneDescription(reglages);
  if (signature) {
    consigne +=
      '\n\nTermine la description' +
      (reglages.hashtags ? ', avant les hashtags,' : '') +
      ' par cette phrase telle quelle : ' +
      signature;
  }
  contenu.push({ type: 'text', text: consigne });

  const json = await appelerApi(apiKey, {
    model: model || DEFAULT_MODEL,
    max_tokens: 1500,
    tools: [construireOutil(reglages)],
    tool_choice: { type: 'tool', name: 'annonce' },
    messages: [{ role: 'user', content: contenu }]
  });

  const bloc = (json.content || []).find((b) => b.type === 'tool_use' && b.name === 'annonce');
  if (!bloc || !bloc.input) {
    throw new Error('L\'IA n\'a pas renvoyé d\'annonce exploitable. Réessaie.');
  }
  const annonce = bloc.input;
  annonce.prix_ia = annonce.prix_suggere;
  annonce.prix_suggere = appliquerReglePrix(annonce.prix_suggere, reglages);
  return annonce;
}

// Préférences non sensibles dont la page Vinted a besoin (jamais la clé).
async function lirePreferences() {
  const r = await lireReglages();
  return { autoGenerer: !!r.autoGenerer };
}

async function testerCle(apiKey, model) {
  await appelerApi(apiKey, {
    model: model || DEFAULT_MODEL,
    max_tokens: 5,
    messages: [{ role: 'user', content: 'Réponds: ok' }]
  });
  return true;
}

// Récupère une image du CDN Vinted quand la page ne peut pas la lire directement.
// Limité aux domaines Vinted pour ne pas servir de relais vers autre chose.
async function recupererImage(url) {
  const u = new URL(url);
  const hoteOk = u.protocol === 'https:' && (/(^|\.)vinted\.net$/.test(u.hostname) || /(^|\.)vinted\.fr$/.test(u.hostname));
  if (!hoteOk) throw new Error('Adresse d\'image non autorisée.');
  const r = await fetch(u.href);
  if (!r.ok) throw new Error('Image inaccessible.');
  const blob = await r.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const pas = 0x8000;
  for (let i = 0; i < buf.length; i += pas) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + pas));
  }
  return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, _sender, repondre) => {
  if (!msg || !msg.type) return false;

  const traiter = (promesse) => {
    promesse.then(
      (data) => repondre({ ok: true, data }),
      (e) => repondre({ ok: false, error: e.message || String(e), code: e.code || null })
    );
    return true; // réponse asynchrone
  };

  if (msg.type === 'generate') return traiter(generer(msg.images, msg.precisions));
  if (msg.type === 'fetchImage') return traiter(recupererImage(msg.url));
  if (msg.type === 'getPrefs') return traiter(lirePreferences());
  if (msg.type === 'testKey') return traiter(testerCle(msg.apiKey, msg.model));
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
