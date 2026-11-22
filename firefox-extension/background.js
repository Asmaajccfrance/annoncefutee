// Script d'arrière-plan Firefox Android & PC.
// Reçoit l'annonce transmise par l'application Android Annonce Futée
// ou appelle directement https://annoncefutee.fr depuis Firefox.
// Aucune clé d'IA côté client. Aucune publication automatique.

const API_BASE = 'https://annoncefutee.fr';
const ext = typeof browser !== 'undefined' ? browser : chrome;

function lireStockage(cles) {
  return new Promise((resolve) => {
    ext.storage.local.get(cles, (res) => resolve(res || {}));
  });
}

function ecrireStockage(valeurs) {
  return new Promise((resolve) => {
    ext.storage.local.set(valeurs, () => resolve());
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

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'MEMORISER_ANNONCE_APP') {
        if (message.annonce && (message.annonce.titre || message.annonce.description)) {
          await ecrireStockage({ derniereAnnonce: message.annonce });
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'OBTENIR_ANNONCE') {
        const local = await lireStockage(['derniereAnnonce']);
        sendResponse({
          ok: true,
          annonce: local.derniereAnnonce || null,
        });
        return;
      }

      if (message.type === 'CONSOMMER_DRAPEAU_AUTO') {
        const local = await lireStockage(['derniereAnnonce']);
        if (local.derniereAnnonce && local.derniereAnnonce._autoRemplir) {
          const copie = { ...local.derniereAnnonce, _autoRemplir: false };
          await ecrireStockage({ derniereAnnonce: copie });
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'EFFACER_ANNONCE') {
        await ecrireStockage({ derniereAnnonce: null });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'CONNEXION') {
        const json = await appelServeur('/api/v1/auth/login', 'POST', null, {
          email: (message.email || '').trim(),
          password: message.password || '',
          device_name: 'firefox-android',
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
          sendResponse({
            ok: true,
            connecte: false,
            annonce: stocke.derniereAnnonce || null,
          });
          return;
        }
        try {
          const me = await appelServeur('/api/v1/me', 'GET', stocke.jeton);
          await ecrireStockage({ credits: me.credits, email: me.user?.email || stocke.email });
          sendResponse({
            ok: true,
            connecte: true,
            email: me.user?.email || stocke.email,
            credits: me.credits,
            annonce: stocke.derniereAnnonce || null,
          });
        } catch (_) {
          sendResponse({
            ok: true,
            connecte: false,
            annonce: stocke.derniereAnnonce || null,
          });
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

      if (message.type === 'ANALYSER_DEPUIS_FIREFOX') {
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
          _autoRemplir: true,
          _horodatage: Date.now(),
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
