// Service worker Safari Web Extension (iOS).
// Récupère l'annonce préparée dans l'app iPhone Annonce Futée (App Group)
// ou analyse directement les photos depuis Safari via le serveur https://annoncefutee.fr.
// Aucune clé IA côté client. Aucune soumission automatique.

const API_BASE = 'https://annoncefutee.fr';
const APP_ID = 'fr.annoncefutee.annonce_futee';
const runtime = typeof browser !== 'undefined' ? browser : chrome;

async function lireDepuisAppNative() {
  try {
    if (runtime.runtime && runtime.runtime.sendNativeMessage) {
      const rep = await runtime.runtime.sendNativeMessage(APP_ID, { action: 'lireAnnonce' });
      if (rep && rep.ok && rep.annonce) {
        return rep.annonce;
      }
    }
  } catch (_) {}
  return null;
}

async function lireStockage(cles) {
  return (await runtime.storage.local.get(cles)) || {};
}

async function ecrireStockage(valeurs) {
  await runtime.storage.local.set(valeurs);
}

// Télécharge une image (CDN Vinted) depuis le background, qui a la permission
// host, et la renvoie en data URL : le canvas de la page n'est alors plus « tainted ».
async function imageEnDataUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)vinted\.(net|fr)$/.test(u.hostname)) {
    throw new Error('Image non autorisée.');
  }
  const rep = await fetch(url);
  if (!rep.ok) throw new Error('Image inaccessible.');
  const blob = await rep.blob();
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(lecteur.result);
    lecteur.onerror = () => reject(new Error('Lecture image impossible.'));
    lecteur.readAsDataURL(blob);
  });
}

async function appelServeur(chemin, methode, jeton, corps) {
  const entetes = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (jeton) entetes.Authorization = 'Bearer ' + jeton;
  const reponse = await fetch(API_BASE + chemin, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const json = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    throw new Error(json.message || 'Demande refusée par le serveur.');
  }
  return json;
}

runtime.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'OBTENIR_ANNONCE') {
        const native = await lireDepuisAppNative();
        if (native && (native.titre || native.description)) {
          await ecrireStockage({ derniereAnnonce: native });
          sendResponse({ ok: true, annonce: native, source: 'app' });
          return;
        }
        const local = await lireStockage(['derniereAnnonce']);
        sendResponse({
          ok: true,
          annonce: local.derniereAnnonce || null,
          source: 'safari',
        });
        return;
      }

      if (message.type === 'IMAGE_EN_DATA_URL') {
        const dataUrl = await imageEnDataUrl(String(message.url || ''));
        sendResponse({ ok: true, dataUrl });
        return;
      }

      if (message.type === 'CONNEXION') {
        const json = await appelServeur('/api/v1/auth/login', 'POST', null, {
          email: (message.email || '').trim(),
          password: message.password || '',
          device_name: 'safari-ios',
        });
        await ecrireStockage({
          jeton: json.token,
          email: json.user ? json.user.email : message.email,
          credits: json.credits || null,
        });
        sendResponse({ ok: true, email: json.user?.email, credits: json.credits });
        return;
      }

      if (message.type === 'ETAT_COMPTE') {
        const stocke = await lireStockage(['jeton', 'email', 'credits', 'derniereAnnonce']);
        if (!stocke.jeton) {
          const native = await lireDepuisAppNative();
          sendResponse({
            ok: true,
            connecte: false,
            annonce: native || stocke.derniereAnnonce || null,
          });
          return;
        }
        try {
          const me = await appelServeur('/api/v1/me', 'GET', stocke.jeton);
          await ecrireStockage({ credits: me.credits, email: me.user?.email || stocke.email });
          const native = await lireDepuisAppNative();
          sendResponse({
            ok: true,
            connecte: true,
            email: me.user?.email || stocke.email,
            credits: me.credits,
            annonce: native || stocke.derniereAnnonce || null,
          });
        } catch (_) {
          sendResponse({ ok: true, connecte: false, annonce: stocke.derniereAnnonce || null });
        }
        return;
      }

      if (message.type === 'DECONNEXION') {
        const stocke = await lireStockage(['jeton']);
        if (stocke.jeton) {
          await appelServeur('/api/v1/auth/logout', 'POST', stocke.jeton).catch(() => {});
        }
        await ecrireStockage({ jeton: '', email: '', credits: null });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'ANALYSER_DEPUIS_SAFARI') {
        const stocke = await lireStockage(['jeton']);
        if (!stocke.jeton) throw new Error('Connecte-toi d\'abord dans l\'extension.');
        const json = await appelServeur('/api/v1/listings/analyze', 'POST', stocke.jeton, {
          images: message.images || [],
          precisions: message.precisions || '',
          style: 'normal',
        });
        const d = json.data || {};
        const normalisee = {
          titre: String(d.titre || ''),
          prix: d.prix_suggere != null ? String(d.prix_suggere) : '',
          description: String(d.description || ''),
          marque: String(d.marque || ''),
          etat: String(d.etat || ''),
          taille: String(d.taille || ''),
          couleurs: Array.isArray(d.couleurs) ? d.couleurs.join(', ') : String(d.couleurs || ''),
          matiere: String(d.matiere || ''),
          categorie: String(d.categorie || ''),
          sousCategorie: String(d.sous_categorie || ''),
        };
        await ecrireStockage({ derniereAnnonce: normalisee, credits: json.credits || null });
        sendResponse({ ok: true, annonce: normalisee, credits: json.credits });
        return;
      }

      sendResponse({ ok: false, error: 'Commande non gérée.' });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'Erreur inattendue.' });
    }
  })();
  return true;
});
