// Annonce Futée — Panneau latéral Chrome.
// Détecte les photos du formulaire Vinted, prépare l'annonce et remplit les champs compatibles.
// Ne publie jamais : le clic « Publier » reste à l'utilisateur.

(async () => {
  'use strict';

  const IA = globalThis.VintedIA;
  const Studio = globalThis.AnnonceFuteeStudio;
  const Batch = globalThis.AnnonceFuteeBatch;
  if (!IA || !Studio || !Batch) {
    console.error('[AF] Modules manquants');
    return;
  }

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  // Deux situations distinctes, jamais confondues : le serveur répond mais refuse l'accès (configuration),
  // ou il ne répond pas du tout (réseau / panne).
  const MSG_FERME = 'Accès fermé : le serveur répond, mais l\'accès à l\'IA est fermé pour ce compte (ouverture du service ou compte de test non configuré côté serveur). Ce n\'est pas une panne. Aucune annonce n\'a été générée.';
  const MSG_RESEAU = 'Serveur injoignable : connexion impossible (réseau ou panne). Aucune annonce n\'a été générée.';
  const MSG_TEMPORAIRE = 'Le service IA est momentanément indisponible.';
  // Au plus deux nouveaux essais automatiques (après 2 puis 5 fois le délai de stabilisation), jamais plus.
  const FACTEURS_REESSAI = [2, 5];
  const PAGE_VENTE = /^https:\/\/www\.vinted\.fr\/items\/(new|\d+\/edit)/;
  const COTE_MAX = 1024;
  const MAX_BROUILLONS_STOCKES = 200;
  const DELAI_DEFAUT_S = 2;
  const ERREURS_REFUS_SERVEUR = ['HTTP_401', 'HTTP_402', 'HTTP_403', 'HTTP_404', 'HTTP_422', 'HTTP_429', 'NO_KEY'];
  const CHAMPS_REMPLACABLES = ['titre', 'description', 'prix'];

  // ========== ÉTAT ==========
  const etat = { photoActiveId: null, retouche: null, recadrage: null, section: 'dashboard' };

  // L'atelier est UN SEUL objet, créé au démarrage et jamais absent : `atelier.album` est toujours un album
  // valide (Studio.creerAlbum). Il n'est remplacé que par des fonctions pures de Studio, qui retournent un
  // album complet ou lèvent une erreur (l'ancien album reste alors intact). Il n'existe plus d'identifiant
  // d'album à garder synchronisé avec un registre caché : c'était la source de l'erreur « reading 'photos' ».
  const atelier = {
    album: Studio.creerAlbum(),
    pret: false,               // vrai quand les photos mémorisées ont été relues (rechargement du panneau)
    restauration: null,        // { restaurees, ignorees } après une relecture du stockage
    nonCopiees: 0              // photos Vinted que l'atelier plein n'a pas pu recevoir
  };
  let resoudrePretAtelier;
  const pretAtelier = new Promise((resolve) => { resoudrePretAtelier = resolve; });
  let brouillons = [];
  let reglages = {
    autoGenerer: false, autoRemplir: true, limiteAuto: 10, consentementIA: false, claudeExplicite: false,
    autoAmeliorer: false, delaiS: DELAI_DEFAUT_S,
    photoFond: false, photoAuto: false, photoRedresser: true, photoOriginales: true, photoCouverture: false
  };
  let compte = { connected: false, email: '', credits: null };

  // Un état par formulaire Vinted (onglet) : plusieurs articles en préparation restent distincts.
  function creerLive(tabId) {
    return {
      tabId: tabId,
      hashPage: '',
      enChargement: 0,
      detectees: 0,            // photos vues sur la page Vinted (prêtes ou non), récupérées ou non
      photos: [],              // [{ fp, b64 }] : photos prêtes du formulaire
      cle: '',                 // empreinte de l'ensemble des photos prêtes
      etapes: {},              // photos | pretes | analyse | annonce | remplissage
      message: '',
      erreur: false,
      brouillon: null,
      champs: null,
      precisions: '',
      precisionsUtilisees: null,
      analyse: 'aucune',
      credit: { etat: 'aucun', detail: '' },
      minuteur: null,
      tick: null,
      echeance: 0,
      reessais: 0,             // nouveaux essais automatiques déjà faits pour cet ensemble de photos
      activite: null,          // { heure, texte } : dernier événement affiché
      annulation: null,        // { annule, envoye, requestId } pendant une analyse
      ignoree: '',             // ensemble de photos pour lequel l'automatisme ne doit plus rien lancer
      depot: null              // { total, uniques } : photos ajoutées au formulaire depuis le panneau
    };
  }

  const lives = new Map();
  const sansOnglet = creerLive(null);
  sansOnglet.message = 'Ouvre « Vendre un article » sur Vinted et ajoute une photo : elle apparaît ici automatiquement.';
  let live = sansOnglet;

  function livePour(tabId) {
    if (!lives.has(tabId)) lives.set(tabId, creerLive(tabId));
    return lives.get(tabId);
  }

  // Suivi des photos par onglet pour le fond blanc : déjà traitées, créées par l'extension, attendues.
  const DELAI_APPARITION_MS = 8000;
  const blancs = new Map();
  function etatBlanc(tabId) {
    if (!blancs.has(tabId)) {
      blancs.set(tabId, { faites: new Set(), generees: new Set(), vues: [], resultats: [], doublons: [], plafond: 0, attente: 0, attenteConnues: 0, jusqua: 0, enCours: false, aRefaire: false });
    }
    return blancs.get(tabId);
  }

  // Deux photos recompressées par Vinted restent la même image si leurs signatures sont proches.
  const SEUIL_MEME_PHOTO = 8;

  async function signatureVisuelle(b64) {
    try {
      const image = await chargerImage('data:image/jpeg;base64,' + b64);
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      const lum = [];
      for (let i = 0; i < 64; i++) lum.push(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
      const moyenne = lum.reduce((a, b) => a + b, 0) / 64;
      let bits = '';
      for (const v of lum) bits += v >= moyenne ? '1' : '0';
      return bits;
    } catch (e) {
      return '';
    }
  }

  function distanceSignature(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }

  function vueConnue(B, signature) {
    return !!signature && B.vues.some((v) => distanceSignature(v, signature) <= SEUIL_MEME_PHOTO);
  }

  function memoriserVue(B, signature) {
    if (!signature || vueConnue(B, signature)) return;
    B.vues.push(signature);
  }
  function fondBlancEnAttente(L) {
    const B = blancs.get(L.tabId);
    return !!B && (B.enCours || ((B.attente > 0 || B.attenteConnues > 0) && Date.now() < B.jusqua));
  }

  let generationEnCours = false;
  let syncEnCours = false;
  let syncDemandee = false;
  let syncForcee = false;
  const syncCibles = new Set();
  let minuteurStatut = null;
  let compteurRequetes = 0;
  const analysesTentees = new Set();   // ensembles de photos déjà envoyés à l'IA (jamais deux fois en automatique)
  const fpParPhoto = new Map();        // id photo atelier -> { fp, tabId } (photos venant d'un formulaire Vinted)
  const groupeParPhoto = new Map();    // id photo atelier -> numéro d'article choisi par l'utilisateur
  const photosAmeliorees = new Set();
  const cacheUrl = new Map();

  // ========== OUTILS ==========
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function afficherStatut(msg, type = 'info') {
    const el = $('#statut');
    el.textContent = msg;
    el.className = 'statut ' + type;
    el.hidden = false;
    clearTimeout(minuteurStatut);
    minuteurStatut = setTimeout(() => { el.hidden = true; }, type === 'erreur' ? 8000 : 4500);
  }

  function lire(cles) {
    return chrome.storage.local.get(cles);
  }

  function envoyer(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (rep) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message, code: 'RUNTIME' });
          else resolve(rep || { ok: false, error: 'Pas de réponse.', code: 'RUNTIME' });
        });
      } catch (e) {
        resolve({ ok: false, error: 'Extension indisponible.', code: 'RUNTIME' });
      }
    });
  }

  async function versOnglet(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      return null;
    }
  }

  function empreinte(b64) {
    let h = 2166136261;
    const pas = Math.max(1, Math.floor(b64.length / 512));
    for (let i = 0; i < b64.length; i += pas) {
      h ^= b64.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36) + '-' + b64.length.toString(36);
  }

  function aujourdhui() {
    return new Date().toISOString().slice(0, 10);
  }

  // Erreur passagère : le serveur n'a pas pu répondre. Sert à décider d'un nouvel essai (sous conditions).
  function erreurTemporaire(err) {
    const code = err && err.code;
    return code === 'NETWORK' || code === 'HTTP_500' || code === 'HTTP_502' || code === 'HTTP_503' || code === 'HTTP_504';
  }

  function messageErreur(err) {
    const code = err && err.code;
    if (code === 'HTTP_403' && (!err.serverCode || err.serverCode === 'client_access_closed')) return MSG_FERME;
    if (code === 'NETWORK') return MSG_RESEAU;
    if (erreurTemporaire(err)) return MSG_TEMPORAIRE + ' Aucune annonce n\'a été générée.';
    if (code === 'ABORTED') return 'Analyse interrompue.';
    if (code === 'HTTP_402' || code === 'HTTP_429') return 'Crédits ou quota épuisés. Aucune annonce n\'a été générée.';
    const base = (err && err.message) || 'Génération impossible.';
    return /aucune annonce/i.test(base) ? base : base + ' Aucune annonce n\'a été générée.';
  }

  // ========== IMAGES (pixels <-> affichage) ==========
  function chargerImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Photo illisible.'));
      img.src = url;
    });
  }

  async function urlVersPixels(url) {
    const img = await chargerImage(url);
    const ratio = Math.min(1, COTE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: new Uint8ClampedArray(d.data) };
  }

  function pixelsVersCanvas(im) {
    const canvas = document.createElement('canvas');
    canvas.width = im.width;
    canvas.height = im.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0);
    return canvas;
  }

  function pixelsVersUrl(im, qualite = 0.85) {
    return pixelsVersCanvas(im).toDataURL('image/jpeg', qualite);
  }

  function vignetteDe(im) {
    const canvas = pixelsVersCanvas(im);
    const ratio = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
    const petit = document.createElement('canvas');
    petit.width = Math.max(1, Math.round(canvas.width * ratio));
    petit.height = Math.max(1, Math.round(canvas.height * ratio));
    petit.getContext('2d').drawImage(canvas, 0, 0, petit.width, petit.height);
    return petit.toDataURL('image/jpeg', 0.7);
  }

  function urlPhoto(photo, original = false) {
    const cle = photo.id + ':' + (original ? 'o' : JSON.stringify(photo.operations));
    if (!cacheUrl.has(cle)) {
      if (cacheUrl.size > 60) cacheUrl.clear();
      cacheUrl.set(cle, pixelsVersUrl(original ? photo.source : Studio.rendrePhoto(photo)));
    }
    return cacheUrl.get(cle);
  }

  function lireFichier(fichier) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(fichier);
    });
  }

  // ========== ATELIER (album de photos) ==========
  const MSG_ATELIER_PLEIN = 'Huit photos au maximum dans l\'atelier.';
  const photosAlbum = () => atelier.album.photos;
  const photoActive = () => photosAlbum().find((p) => p.id === etat.photoActiveId) || null;
  const estSelectionnee = (id) => atelier.album.selection.indexOf(id) >= 0;

  // Applique une retouche (non destructive : la photo d'origine `source` n'est jamais modifiée) ;
  // lève une erreur explicite si la photo n'existe plus ou si la retouche n'est pas applicable.
  function retoucherPhoto(photoId, op) {
    atelier.album = Studio.avecOperation(atelier.album, photoId, op);
  }

  function retirerPhotoDeLAtelier(photoId) {
    atelier.album = Studio.retirerPhoto(atelier.album, photoId);
    fpParPhoto.delete(photoId);
    groupeParPhoto.delete(photoId);
    photosAmeliorees.delete(photoId);
    originauxStockes.delete(photoId);
    if (etat.photoActiveId === photoId) etat.photoActiveId = null;
  }

  async function ajouterDepuisUrl(url, nom, origine) {
    if (photosAlbum().length >= Studio.MAX_ATELIER) throw new Error(MSG_ATELIER_PLEIN);
    const pixels = await urlVersPixels(url);
    // L'album peut avoir changé pendant le chargement de l'image : on repart de l'état courant.
    atelier.album = Studio.ajouterPhoto(atelier.album, pixels, nom);
    const photo = atelier.album.photos[atelier.album.photos.length - 1];
    if (origine) fpParPhoto.set(photo.id, origine);
    return photo;
  }

  const photosManuelles = () => photosAlbum().filter((p) => !fpParPhoto.has(p.id));

  // ========== ERREURS : jamais silencieuses ==========
  function signalerErreur(contexte, err) {
    console.error('[AF] ' + contexte + ' :', err);
    const detail = (err && err.message ? err.message : String(err)).replace(/\.?\s*$/, '.');
    afficherStatut(contexte + ' : ' + detail + ' Tes photos d\'origine ne sont pas modifiées.', 'erreur');
  }

  // Exécute une action d'interface ; toute exception (synchrone ou asynchrone) est affichée, jamais perdue.
  function garder(contexte, action) {
    try {
      const r = action();
      if (r && typeof r.catch === 'function') r.catch((e) => signalerErreur(contexte, e));
      return r;
    } catch (e) {
      signalerErreur(contexte, e);
      return undefined;
    }
  }

  window.addEventListener('error', (e) => signalerErreur('Erreur inattendue', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => signalerErreur('Erreur inattendue', e.reason));

  // ========== MÉMORISATION DE L'ATELIER (photos importées à la main) ==========
  // Les photos du formulaire Vinted ne sont jamais mémorisées : elles sont relues sur la page. Seules les
  // photos importées par l'utilisateur le sont (copie d'origine ≤ 1024 px + liste des retouches appliquées,
  // jamais le résultat retouché), pour survivre à la fermeture ou au rechargement du panneau.
  const VERSION_ATELIER = 2;
  const originauxStockes = new Map();   // id photo atelier -> data URL de la photo d'origine mémorisée
  let fileAtelier = Promise.resolve();

  function urlOriginale(photo) {
    if (!originauxStockes.has(photo.id)) originauxStockes.set(photo.id, pixelsVersUrl(photo.source, 0.92));
    return originauxStockes.get(photo.id);
  }

  function sauvegarderAtelier() {
    fileAtelier = fileAtelier.then(async () => {
      try {
        const donnees = {
          version: VERSION_ATELIER,
          photos: photosManuelles().map((p) => ({
            nom: p.nom,
            original: urlOriginale(p),
            operations: p.operations,
            auto: photosAmeliorees.has(p.id)
          }))
        };
        await chrome.storage.local.set({ atelier: donnees });
      } catch (e) {
        console.warn('[AF] Atelier non mémorisé :', e);
        afficherStatut('Atelier non mémorisé (espace insuffisant ?) : tes photos restent dans le panneau mais ne survivront pas à sa fermeture.', 'erreur');
      }
    });
    return fileAtelier;
  }

  const URL_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

  // Relit les photos mémorisées. Les entrées illisibles (format d'une ancienne version, données corrompues)
  // sont comptées et signalées, jamais ignorées en silence ni cause d'erreur.
  async function chargerAtelier() {
    let ignorees = 0;
    let restaurees = 0;
    try {
      const stocke = (await lire(['atelier'])).atelier;
      if (stocke !== undefined) {
        const entrees = stocke && typeof stocke === 'object' && Array.isArray(stocke.photos) ? stocke.photos : null;
        if (!entrees) ignorees = 1;
        for (const e of entrees || []) {
          if (!e || typeof e !== 'object' || typeof e.original !== 'string' || !URL_IMAGE.test(e.original)) { ignorees++; continue; }
          try {
            const photo = await ajouterDepuisUrl(e.original, typeof e.nom === 'string' ? e.nom : 'photo', null);
            originauxStockes.set(photo.id, e.original);
            let refaites = 0;
            for (const op of Array.isArray(e.operations) ? e.operations : []) {
              try { retoucherPhoto(photo.id, op); refaites++; } catch (err) { /* retouche d'une ancienne version : abandonnée */ }
            }
            if (e.auto && refaites) photosAmeliorees.add(photo.id);
            restaurees++;
          } catch (err) {
            ignorees++;
          }
        }
      }
    } catch (err) {
      console.warn('[AF] Relecture de l\'atelier :', err);
      ignorees++;
    }
    atelier.restauration = { restaurees: restaurees, ignorees: ignorees };
    atelier.pret = true;
    resoudrePretAtelier();
    if (ignorees) {
      afficherStatut(ignorees + ' photo' + (ignorees > 1 ? 's' : '') + ' mémorisée' + (ignorees > 1 ? 's' : '') + ' illisible' + (ignorees > 1 ? 's' : '') + ' (ancienne version ou données abîmées) : ignorée' + (ignorees > 1 ? 's' : '') + '. Réimporte-la' + (ignorees > 1 ? 's' : '') + ' si besoin.', 'info');
    }
  }

  // Explique précisément pourquoi l'atelier est vide (aucun message vague, aucun faux « tout va bien »).
  function explicationAucunePhoto() {
    const L = live;
    if (L.tabId !== null && L.enChargement > 0) {
      return L.enChargement + ' photo' + (L.enChargement > 1 ? 's' : '') + ' du formulaire Vinted ' + (L.enChargement > 1 ? 'sont' : 'est') + ' encore en chargement. Réessaie dans un instant.';
    }
    if (L.tabId !== null && L.detectees > 0) {
      return L.detectees + ' photo' + (L.detectees > 1 ? 's' : '') + ' détectée' + (L.detectees > 1 ? 's' : '') + ' sur Vinted mais pas encore récupérée' + (L.detectees > 1 ? 's' : '') + '. Clique sur « Depuis Vinted ».';
    }
    if (L.tabId !== null) {
      return 'Aucune photo : le formulaire Vinted n\'en contient pas encore. Ajoute une photo sur Vinted ou importe-en depuis ton ordinateur.';
    }
    return 'Aucune photo disponible. Importe des photos depuis ton ordinateur ou ouvre « Vendre un article » sur Vinted.';
  }

  // Retouches automatiques sur une liste de photos. Une photo n'est traitée qu'une fois (sauf si ses retouches
  // sont toutes annulées). Chaque retouche non applicable est rapportée, jamais avalée.
  function ameliorerPhotos(photos) {
    const bilan = { ameliorees: 0, correctes: 0, dejaTraitees: 0, echecs: [] };
    for (const demandee of photos) {
      const photo = photosAlbum().find((p) => p.id === demandee.id);
      if (!photo) { bilan.echecs.push({ nom: demandee.nom, message: 'photo retirée entre-temps' }); continue; }
      if (photosAmeliorees.has(photo.id)) { bilan.dejaTraitees++; continue; }
      let ops;
      try {
        ops = Batch.ameliorerPhotoAuto(photo, Studio);
      } catch (e) {
        bilan.echecs.push({ nom: photo.nom, message: e.message || 'analyse impossible' });
        continue;
      }
      photosAmeliorees.add(photo.id);
      let appliquees = 0;
      for (const op of ops) {
        try {
          retoucherPhoto(photo.id, op);
          appliquees++;
        } catch (e) {
          bilan.echecs.push({ nom: photo.nom, message: 'retouche « ' + op.type + ' » non applicable (' + (e.message || 'erreur') + ')' });
        }
      }
      if (appliquees) bilan.ameliorees++; else bilan.correctes++;
    }
    return bilan;
  }

  // ========== PERSISTANCE DES BROUILLONS ==========
  async function chargerBrouillons() {
    try {
      const data = await lire(['brouillons']);
      const liste = Array.isArray(data.brouillons) ? data.brouillons : [];
      brouillons = liste.map(normaliserBrouillon).filter(Boolean);
      const abandonnes = liste.length - brouillons.length;
      if (abandonnes > 0) console.warn('[AF] ' + abandonnes + ' brouillon(s) illisible(s) ignoré(s) (format inconnu).');
    } catch (e) {
      brouillons = [];
    }
  }

  // Remet à la forme actuelle un brouillon enregistré par une ancienne version : les photos intégrées
  // (data URL volumineuses) disparaissent, seule une vignette reste ; les champs manquants reçoivent
  // une valeur neutre. Une entrée qui n'est pas un brouillon est écartée (jamais une erreur).
  function normaliserBrouillon(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const { photos, photoUrl, ...reste } = b;
    const texte = (v) => (typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)));
    const out = Object.assign({}, reste);
    out.id = typeof reste.id === 'string' || typeof reste.id === 'number' ? reste.id : Batch.nouvelId();
    ['titre', 'description', 'categorie', 'sousCategorie', 'marque', 'taille', 'etat', 'matiere', 'precisions', 'cle', 'plateforme']
      .forEach((k) => { out[k] = texte(reste[k]); });
    out.couleurs = Array.isArray(reste.couleurs) ? reste.couleurs.map(texte) : [];
    out.aVerifier = Array.isArray(reste.aVerifier) ? reste.aVerifier.map(texte) : [];
    out.prix = Number.isFinite(Number(reste.prix)) && Number(reste.prix) > 0 ? Math.round(Number(reste.prix)) : null;
    out.statut = typeof reste.statut === 'string' && reste.statut ? reste.statut : 'brouillon';
    out.plateforme = out.plateforme || 'vinted';
    out.dateCreation = Number(reste.dateCreation) || 0;
    out.dateModification = Number(reste.dateModification) || out.dateCreation;
    out.nbPhotos = Number(reste.nbPhotos) || 0;
    out.vignette = typeof reste.vignette === 'string' && reste.vignette
      ? reste.vignette
      : (typeof photoUrl === 'string' && photoUrl.length < 40000 ? photoUrl : '');
    return out;
  }

  async function sauvegarderBrouillons() {
    if (brouillons.length > MAX_BROUILLONS_STOCKES) brouillons = brouillons.slice(-MAX_BROUILLONS_STOCKES);
    try {
      await chrome.storage.local.set({ brouillons: brouillons });
      return true;
    } catch (e) {
      afficherStatut('Enregistrement impossible : espace de stockage plein.', 'erreur');
      return false;
    }
  }

  const modifieManuellement = (b) => !!(b && (b.modifie || b.dateModification > b.dateCreation));

  // Remplace sur place le brouillon d'un même ensemble de photos (jamais de doublon), sinon en crée un.
  async function enregistrerBrouillon(annonce, vignette, nbPhotos, cle, precisions) {
    const aVerifier = Array.isArray(annonce.a_verifier) ? annonce.a_verifier : [];
    const maintenant = Date.now();
    const b = {
      id: Batch.nouvelId(),
      titre: annonce.titre || '',
      description: annonce.description || '',
      prix: annonce.prix_suggere ? Math.round(annonce.prix_suggere) : null,
      prix_suggere: annonce.prix_suggere || null,
      categorie: annonce.categorie || '',
      sousCategorie: annonce.sous_categorie || '',
      marque: annonce.marque || '',
      taille: annonce.taille || '',
      etat: annonce.etat || '',
      couleurs: Array.isArray(annonce.couleurs) ? annonce.couleurs : [],
      matiere: annonce.matiere || '',
      aVerifier: aVerifier,
      precisions: precisions || '',
      vignette: vignette || '',
      nbPhotos: nbPhotos || 0,
      cle: cle || '',
      statut: aVerifier.length ? 'brouillon' : 'pret',
      dateCreation: maintenant,
      dateModification: maintenant,
      plateforme: 'vinted'
    };
    const index = cle ? brouillons.findIndex((x) => x.cle === cle) : -1;
    if (index >= 0) {
      b.id = brouillons[index].id;
      brouillons[index] = b;
    } else {
      brouillons.push(b);
    }
    await sauvegarderBrouillons();
    return b;
  }

  // ========== NAVIGATION ==========
  function naviguerVers(section) {
    etat.section = section;
    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === section));
    $$('.section').forEach((sec) => { sec.hidden = sec.id !== section; });
    if (section === 'dashboard') rafraichirDashboard();
    if (section === 'photos') rafraichirGalerie();
    if (section === 'creer') rafraichirCreation();
    if (section === 'annonces') rafraichirAnnonces();
  }

  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => naviguerVers(btn.dataset.section)));

  // ========== TABLEAU DE BORD ==========
  function creditsRestants() {
    return compte.credits && typeof compte.credits.remaining === 'number' ? compte.credits.remaining : null;
  }

  function rafraichirDashboard() {
    const stats = Batch.calculerStatistiques(brouillons);
    $('#stat-brouillons').textContent = stats.brouillons;
    $('#stat-prets').textContent = stats.prets;
    $('#stat-valeur').textContent = (stats.valeurTotale || 0).toFixed(0) + ' €';
    const cr = creditsRestants();
    $('#stat-credits').textContent = creditsIllimites() ? 'Illimités' : (cr === null ? '--' : cr);
    rafraichirCompteCarte();
    rendreLive();

    // Dernière activité du formulaire courant (horodatée), en plus des dernières annonces.
    const act = $('#activite-live');
    act.hidden = !live.activite;
    act.textContent = live.activite ? live.activite.heure + ' — ' + live.activite.texte : '';

    const recents = Batch.trierBrouillons(brouillons, 'date_desc').slice(0, 3);
    const listeEl = $('#activite-liste');
    listeEl.innerHTML = '';
    $('#activite-vide').hidden = recents.length > 0;
    recents.forEach((b) => {
      const div = document.createElement('div');
      div.className = 'annonce-carte';
      div.innerHTML =
        '<img class="annonce-photo" src="' + escapeHtml(b.vignette || '') + '" alt="">' +
        '<div class="annonce-infos">' +
        '<div class="annonce-titre">' + escapeHtml(b.titre || 'Sans titre') + '</div>' +
        '<div class="annonce-meta">' + escapeHtml(b.categorie || 'Non catégorisé') + '</div>' +
        '<div class="annonce-prix">' + (b.prix ? b.prix + ' €' : '–') + '</div></div>';
      div.addEventListener('click', () => naviguerVers('annonces'));
      listeEl.appendChild(div);
    });
  }

  $('#action-importer').addEventListener('click', () => {
    naviguerVers('photos');
    $('#fichiers').click();
  });
  $('#action-vinted').addEventListener('click', () => {
    naviguerVers('dashboard');
    recupererDepuisVinted();
  });

  // ========== CARTE « FORMULAIRE VINTED » : TRANSPARENCE ==========
  const LIBELLES = {
    titre: 'Titre', description: 'Description', prix: 'Prix', categorie: 'Catégorie',
    sousCategorie: 'Sous-catégorie', marque: 'Marque', taille: 'Taille / pointure',
    etat: 'État', couleurs: 'Couleurs', matiere: 'Matière'
  };
  const TEXTE_ETAT = {
    rempli: 'Rempli ✓', deja: 'Déjà correct ✓', a_choisir: 'À choisir toi-même',
    conserve: 'Ta saisie est conservée', echec: 'Échec — à saisir', introuvable: 'Champ introuvable',
    manuel: 'À renseigner', absent: 'Non détecté par l\'IA'
  };
  const A_VERIFIER = ['a_choisir', 'manuel', 'conserve', 'echec', 'introuvable'];

  function majLive(L) {
    if (L === live) rendreLive();
  }

  function definirEtapes(L, valeurs) {
    L.etapes = Object.assign({ photos: '', pretes: '', analyse: '', annonce: '', remplissage: '' }, valeurs);
    majLive(L);
  }

  function etape(L, nom, valeur) {
    L.etapes[nom] = valeur;
    majLive(L);
  }

  function messageLive(L, texte, erreur = false) {
    L.message = texte;
    L.erreur = erreur;
    L.activite = { heure: new Date().toTimeString().slice(0, 8), texte: texte };
    majLive(L);
  }

  function echecLive(L, texte) {
    const enCours = Object.keys(L.etapes).find((k) => L.etapes[k] === 'en-cours');
    if (enCours) L.etapes[enCours] = 'erreur';
    messageLive(L, texte, true);
  }

  const TEXTE_ANALYSE = {
    aucune: 'Non lancée', 'attente-chargement': 'En attente du chargement', stabilisation: 'En attente de stabilisation',
    'en-cours': 'En cours…', terminee: 'Terminée ✓', interrompue: 'Interrompue', echec: 'Échec', 'non-lancee': 'Non lancée'
  };

  function texteCredit(c) {
    if (c.etat === 'consomme') return 'Consommé' + (c.detail ? ' : ' + c.detail : '');
    if (c.etat === 'non-consomme') return 'Non consommé' + (c.detail ? ' (' + c.detail + ')' : '');
    if (c.etat === 'inconnu') return 'À vérifier' + (c.detail ? ' : ' + c.detail : '');
    if (c.etat === 'claude') return 'Aucun crédit serveur (clé Claude)';
    return 'Aucun pour l\'instant';
  }

  function lignesBilan(L) {
    const nb = L.photos.length;
    const lignes = [];
    lignes.push(['Photos détectées', nb + (L.enChargement ? ' (+' + L.enChargement + ' en chargement)' : ''), L.enChargement ? 'attention' : (nb ? 'ok' : '')]);

    let pretes = '—';
    let classePretes = '';
    if (nb) {
      if (L.enChargement) { pretes = 'Non : chargement en cours'; classePretes = 'attention'; }
      else if (L.minuteur && L.echeance) {
        pretes = 'Oui — analyse dans ' + Math.max(0, Math.ceil((L.echeance - Date.now()) / 1000)) + ' s';
        classePretes = 'ok';
      } else {
        pretes = 'Oui' + (nb > IA.MAX_PHOTOS ? ' (' + IA.MAX_PHOTOS + ' analysées au maximum)' : '');
        classePretes = 'ok';
      }
    }
    lignes.push(['Prêtes pour l\'analyse', pretes, classePretes]);

    const classeAnalyse = L.analyse === 'terminee' ? 'ok' : (L.analyse === 'echec' || L.analyse === 'interrompue' ? 'alerte' : (L.analyse === 'en-cours' ? 'attention' : ''));
    lignes.push(['Analyse', TEXTE_ANALYSE[L.analyse] || L.analyse, classeAnalyse]);
    lignes.push(['Annonce', L.brouillon ? 'Générée ✓' : 'Pas encore', L.brouillon ? 'ok' : '']);
    lignes.push(['Crédit', texteCredit(L.credit), L.credit.etat === 'consomme' ? 'attention' : (L.credit.etat === 'inconnu' ? 'alerte' : '')]);

    if (L.champs) {
      const remplis = L.champs.filter((c) => c.etat === 'rempli' || c.etat === 'deja');
      const aVerifier = L.champs.filter((c) => A_VERIFIER.indexOf(c.etat) >= 0);
      lignes.push(['Champs remplis', remplis.length ? remplis.map((c) => c.nom).join(', ') : 'Aucun', remplis.length ? 'ok' : '']);
      lignes.push(['À vérifier', aVerifier.length ? aVerifier.map((c) => c.nom).join(', ') : 'Rien', aVerifier.length ? 'attention' : 'ok']);
    }
    if (L.brouillon && L.brouillon.aVerifier && L.brouillon.aVerifier.length) {
      lignes.push(['Incertitudes de l\'IA', L.brouillon.aVerifier.join(' ; '), 'attention']);
    }
    return lignes;
  }

  // Une zone n'est réécrite que si son contenu a changé : pas de clignotement des photos ni des listes
  // pendant les rafraîchissements (deux par seconde pendant l'attente).
  const dernierRendu = new WeakMap();
  function poser(el, html) {
    if (dernierRendu.get(el) === html) return;
    dernierRendu.set(el, html);
    el.innerHTML = html;
  }

  function etiquetteAnnonce(L, occupe) {
    const b = L.brouillon;
    if (!b) {
      if (!occupe) return '';
      return '<div class="etiquette attente" aria-hidden="true"><span class="trait t1"></span><span class="trait t2"></span>' +
        '<span class="trait t3"></span><span class="trait t4"></span></div>';
    }
    const details = [b.marque, b.taille, b.etat, (b.couleurs || []).join(', '), b.matiere].filter(Boolean);
    return '<article class="etiquette">' +
      '<div class="etiquette-haut"><h3 class="etiquette-titre">' + escapeHtml(b.titre || 'Sans titre') + '</h3>' +
      (b.prix ? '<span class="etiquette-prix">' + escapeHtml(String(b.prix)) + ' €</span>' : '') + '</div>' +
      (details.length ? '<p class="etiquette-details">' + details.map(escapeHtml).join(', ') + '</p>' : '') +
      (b.description ? '<p class="etiquette-desc">' + escapeHtml(b.description) + '</p>' : '') +
      (b.aVerifier && b.aVerifier.length
        ? '<ul class="etiquette-doutes">' + b.aVerifier.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul>' : '') +
      '</article>';
  }

  function rendreLive() {
    const L = live;
    const badge = $('#live-badge');
    const nb = L.photos.length;
    let texte = 'Aucune photo';
    let classe = 'live-badge';
    if (generationEnCours && L.annulation) { texte = 'Analyse en cours'; classe += ' actif'; }
    else if (L.erreur) { texte = 'Erreur'; classe += ' erreur'; }
    else if (L.enChargement) { texte = 'Chargement…'; classe += ' actif'; }
    else if (L.brouillon && L.champs) { texte = 'Prête'; classe += ' ok'; }
    else if (L.brouillon) { texte = 'Générée'; classe += ' ok'; }
    else if (nb > 0) { texte = nb + ' photo' + (nb > 1 ? 's' : ''); classe += ' actif'; }
    badge.textContent = texte;
    badge.className = classe;

    poser($('#live-photos'), L.photos
      .map((p) => '<img src="data:image/jpeg;base64,' + p.b64 + '" alt="Photo du formulaire">')
      .join(''));

    $('#live-etapes').hidden = !Object.values(L.etapes).some(Boolean);
    $$('#live-etapes li').forEach((li) => { li.className = L.etapes[li.dataset.etape] || ''; });

    const msgEl = $('#live-message');
    msgEl.textContent = L.message;
    msgEl.className = 'live-message' + (L.erreur ? ' erreur' : '');

    const htmlBilan = (nb || L.analyse !== 'aucune')
      ? lignesBilan(L).map((l) => '<li class="' + l[2] + '"><span>' + escapeHtml(l[0]) + '</span><span>' + escapeHtml(l[1]) + '</span></li>').join('')
      : '';
    poser($('#live-bilan'), htmlBilan);
    $('#live-details').hidden = !htmlBilan;

    const enAnalyse = generationEnCours && !!L.annulation;
    const htmlAnnonce = etiquetteAnnonce(L, enAnalyse);
    poser($('#live-annonce'), htmlAnnonce);
    $('#live-annonce').hidden = !htmlAnnonce;
    $('#card-live').classList.toggle('occupe', enAnalyse);

    const titreSimilaires = (L.brouillon && L.brouillon.titre) || '';
    poser($('#live-champs'), (L.champs || []).map((c) => {
      const ligne = '<div class="champ-ligne ' + c.etat + '"><span class="champ-nom">' + escapeHtml(c.nom) + '</span>' +
        '<span class="champ-etat">' + escapeHtml(TEXTE_ETAT[c.etat] || c.etat) +
        (c.valeur && (c.etat === 'manuel' || c.etat === 'echec' || c.etat === 'a_choisir') ? ' : ' + escapeHtml(c.valeur) : '') +
        (c.cle === 'prix' && c.valeur ? ' <span class="estimation-ia">Estimation de l\'IA, à vérifier</span>' : '') +
        (c.etat === 'conserve' && CHAMPS_REMPLACABLES.indexOf(c.cle) >= 0
          ? ' <button type="button" class="btn-remplacer" data-cle="' + c.cle + '">Remplacer</button>' : '') +
        '</span></div>';
      if (c.cle !== 'prix' || !titreSimilaires) return ligne;
      const url = 'https://www.vinted.fr/catalog?search_text=' + encodeURIComponent(titreSimilaires);
      return ligne + '<button type="button" class="btn secondaire lien-similaires" data-url="' + escapeHtml(url) + '">Voir les annonces similaires</button>';
    }).join(''));

    const champPrec = $('#live-precisions');
    if (document.activeElement !== champPrec) champPrec.value = L.precisions;
    const infoPrec = $('#live-precisions-info');
    const precisionsChangees = !!L.brouillon && L.precisionsUtilisees !== null && L.precisions !== L.precisionsUtilisees;
    infoPrec.hidden = !precisionsChangees;
    infoPrec.textContent = precisionsChangees
      ? 'Précisions modifiées : aucune analyse automatique. « Régénérer » lancerait une nouvelle analyse (crédit).'
      : '';

    const occupe = generationEnCours && !!L.annulation;
    const gen = $('#live-generer');
    gen.hidden = occupe || nb === 0 || !!L.enChargement;
    gen.textContent = L.brouillon || L.erreur ? 'Régénérer l\'annonce' : 'Générer l\'annonce';
    $('#live-remplir').hidden = occupe || !L.brouillon || L.tabId === null;
    $('#live-annuler').hidden = !(occupe || L.minuteur || L.reessai);
  }

  function annulerMinuteur(L) {
    if (L.reessai) { clearTimeout(L.reessai.minuteur); L.reessai = null; }
    clearTimeout(L.minuteur);
    clearInterval(L.tick);
    L.minuteur = null;
    L.tick = null;
    L.echeance = 0;
  }

  function reinitialiserLive(L) {
    annulerMinuteur(L);
    L.etapes = {};
    L.message = '';
    L.erreur = false;
    L.brouillon = null;
    L.champs = null;
    L.precisionsUtilisees = null;
    L.analyse = 'aucune';
    L.credit = { etat: 'aucun', detail: '' };
    L.ignoree = '';
    L.reessais = 0;
  }

  // ========== SYNCHRONISATION AVEC LES FORMULAIRES VINTED ==========
  async function ongletActifVinted() {
    try {
      const [actif] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (actif && PAGE_VENTE.test(actif.url || '')) return actif;
    } catch (e) { /* aucun onglet */ }
    return null;
  }

  // Retire de l'atelier les copies de photos Vinted disparues du formulaire (supprimées ou remplacées).
  // Ce ne sont que des copies de travail : l'original reste dans le formulaire Vinted.
  function retirerPhotosVintedDeLAtelier(tabId, aGarder) {
    for (const [photoId, origine] of Array.from(fpParPhoto.entries())) {
      if (origine.tabId !== tabId) continue;
      if (aGarder && aGarder.has(origine.fp)) continue;
      retirerPhotoDeLAtelier(photoId);
    }
  }

  function synchroniser(forcer = false, tabCible = null) {
    if (forcer) syncForcee = true;
    if (typeof tabCible === 'number') syncCibles.add(tabCible);
    if (syncEnCours) {
      syncDemandee = true;
      return Promise.resolve();
    }
    syncEnCours = true;
    return (async () => {
      try {
        // Pas de synchronisation avant que l'atelier mémorisé soit relu (sinon les photos se mélangeraient).
        await pretAtelier;
        do {
          syncDemandee = false;
          const force = syncForcee;
          const cibles = Array.from(syncCibles);
          syncForcee = false;
          syncCibles.clear();
          await synchroniserUneFois(force, cibles);
        } while (syncDemandee);
      } catch (e) {
        console.warn('[AF] Synchronisation :', e);
      } finally {
        syncEnCours = false;
      }
    })();
  }

  async function synchroniserUneFois(force, cibles) {
    const actif = await ongletActifVinted();
    const onglets = new Map();
    if (actif) onglets.set(actif.id, actif);
    for (const id of cibles) {
      if (onglets.has(id)) continue;
      try {
        const t = await chrome.tabs.get(id);
        if (t && PAGE_VENTE.test(t.url || '')) onglets.set(id, t);
      } catch (e) { /* onglet fermé */ }
    }
    for (const tab of onglets.values()) await traiterOnglet(tab, force);

    live = actif ? livePour(actif.id) : sansOnglet;
    rafraichirVues();
  }

  async function traiterOnglet(tab, force) {
    const L = livePour(tab.id);
    const info = await versOnglet(tab.id, { type: 'getPageInfo' });
    if (!info || !info.ok) {
      messageLive(L, 'Actualise la page Vinted (F5) pour activer la détection automatique.', true);
      return;
    }
    const chargement = info.enChargement || 0;
    L.detectees = (Number(info.photos) || 0) + chargement;
    const memeEnsemble = info.hash === L.hashPage;
    if (!force && memeEnsemble && chargement === L.enChargement) return;
    const etaitEnChargement = L.enChargement > 0;
    L.enChargement = chargement;

    if (!memeEnsemble || force) {
      const ok = await actualiserPhotos(L, tab.id, info);
      if (!ok) return;
    }
    if (chargement > 0) {
      annulerMinuteur(L);
      L.analyse = 'attente-chargement';
      etape(L, 'pretes', '');
      messageLive(L, chargement + ' photo' + (chargement > 1 ? 's' : '') + ' en cours de chargement… L\'analyse attend qu\'elles soient prêtes.');
    } else if (L.photos.length) {
      if (L.analyse === 'attente-chargement' || etaitEnChargement) L.analyse = 'aucune';
      if (!reglages.autoGenerer) etape(L, 'pretes', 'fait');
      planifierAuto(L);
    } else if (!L.message || etaitEnChargement) {
      messageLive(L, 'Aucune photo sur le formulaire. Ajoute une photo : elle apparaît ici automatiquement.');
    }
    majLive(L);
  }

  async function actualiserPhotos(L, tabId, info) {
    const rep = await versOnglet(tabId, { type: 'collectPhotos' });
    if (!rep || !rep.ok) {
      messageLive(L, 'Impossible de lire les photos de la page Vinted. Actualise-la (F5).', true);
      return false;
    }
    L.hashPage = info.hash;

    const images = rep.images || [];
    const fps = images.map(empreinte);
    const cle = fps.slice().sort().join('|');
    const ensembleChange = cle !== L.cle;

    retirerPhotosVintedDeLAtelier(tabId, new Set(fps));
    const connues = new Set(Array.from(fpParPhoto.values()).filter((o) => o.tabId === tabId).map((o) => o.fp));
    let nonCopiees = 0;
    for (let i = 0; i < images.length; i++) {
      if (connues.has(fps[i])) continue;
      try {
        await ajouterDepuisUrl('data:image/jpeg;base64,' + images[i], 'vinted-' + (i + 1) + '.jpg', { fp: fps[i], tabId: tabId });
        connues.add(fps[i]);
      } catch (e) {
        nonCopiees++;
        console.warn('[AF] Photo non ajoutée à l\'atelier :', e.message);
      }
    }
    // L'analyse utilise de toute façon les photos du formulaire ; seule la copie de travail manque.
    atelier.nonCopiees = nonCopiees;

    L.photos = images.map((b64, i) => ({ fp: fps[i], b64: b64 }));
    L.cle = cle;

    if (ensembleChange) {
      // Nouvelle composition de photos : tout repart de zéro, y compris le délai de stabilisation.
      reinitialiserLive(L);
      if (images.length) {
        definirEtapes(L, { photos: 'fait' });
        messageLive(L, images.length + ' photo' + (images.length > 1 ? 's' : '') + ' détectée' + (images.length > 1 ? 's' : '') +
          (reglages.autoGenerer ? '. L\'analyse démarrera quand les photos seront stables.' : '. Clique sur « Générer l\'annonce ».'));
      } else {
        messageLive(L, 'Aucune photo sur le formulaire. Ajoute une photo : elle apparaît ici automatiquement.');
      }
    }
    rafraichirVues();
    return true;
  }

  function rafraichirVues() {
    rendreLive();
    if (etat.section === 'photos') rafraichirGalerie();
    if (etat.section === 'creer') rafraichirCreation();
    if (etat.section === 'dashboard') rafraichirDashboard();
  }

  async function recupererDepuisVinted() {
    afficherStatut('Lecture du formulaire Vinted…', 'info');
    await synchroniser(true);
    afficherStatut(live.photos.length
      ? live.photos.length + ' photo(s) du formulaire Vinted.'
      : 'Aucune photo trouvée sur le formulaire Vinted.', live.photos.length ? 'succes' : 'info');
  }

  // Événements du navigateur uniquement (aucun scrutin périodique)
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || !sender || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'photosDetected') synchroniser(false, typeof msg.tabId === 'number' ? msg.tabId : null);
  });
  chrome.tabs.onActivated.addListener(() => { synchroniser(); });
  chrome.tabs.onUpdated.addListener((id, changeInfo) => {
    if (changeInfo.status === 'complete') synchroniser();
  });
  if (chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((id) => {
      const L = lives.get(id);
      if (!L) return;
      annulerMinuteur(L);
      retirerPhotosVintedDeLAtelier(id, null);
      lives.delete(id);
      if (live === L) live = sansOnglet;
      rafraichirVues();
    });
  }

  // ========== GÉNÉRATION ==========
  async function moteurDisponible() {
    const s = await lire(['backendToken', 'apiKey', 'claudeExplicite']);
    if (s.backendToken) return { moteur: 'backend' };
    if (s.apiKey && s.claudeExplicite) return { moteur: 'claude' };
    if (s.apiKey) {
      return { erreur: 'Aucun compte serveur connecté. Pour utiliser ta clé Claude, coche « Utiliser ma clé Claude » dans Réglages.' };
    }
    return { erreur: 'Connecte-toi à ton compte dans Réglages pour générer des annonces.' };
  }

  async function actualiserCompte() {
    const rep = await envoyer({ type: 'getAccount' });
    if (rep.ok && rep.data) {
      compte = {
        connected: !!rep.data.connected,
        email: rep.data.email || '',
        credits: rep.data.credits || null,
        testAccount: !!rep.data.testAccount,
        ferme: !!rep.data.ferme,
        hors_ligne: !!(rep.data.offline || rep.data.indisponible)
      };
    }
    majCompteUI();
    return rep;
  }

  // Le compte est relu pendant l'attente des photos : au moment d'envoyer, la réponse est déjà là.
  let compteAnticipe = null;
  function anticiperCompte() {
    if (compteAnticipe && Date.now() - compteAnticipe.at < 15000) return;
    compteAnticipe = { at: Date.now(), promesse: actualiserCompte() };
  }

  async function verifierCredits(nbAnalyses) {
    const anticipe = compteAnticipe && Date.now() - compteAnticipe.at < 15000 ? compteAnticipe.promesse : null;
    compteAnticipe = null;
    const rep = anticipe ? await anticipe : await actualiserCompte();
    if (!rep.ok) return { erreur: MSG_RESEAU };
    if (!compte.connected) return { erreur: 'Session expirée. Reconnecte-toi dans Réglages.' };
    if (compte.ferme) return { erreur: MSG_FERME };
    if (compte.hors_ligne) return { erreur: MSG_RESEAU };
    if (creditsIllimites()) return { ok: true, cout: 0 };
    if (compte.credits && typeof compte.credits.remaining === 'number') {
      const cout = (compte.credits.analysis_cost || 1) * nbAnalyses;
      if (compte.credits.remaining < cout) {
        return { erreur: 'Crédits insuffisants : ' + compte.credits.remaining + ' restant(s), ' + cout + ' nécessaire(s). Aucune annonce n\'a été générée.' };
      }
      return { ok: true, cout: cout };
    }
    return { ok: true, cout: nbAnalyses };
  }

  async function appelGenerer(images, precisions, requestId) {
    const rep = await envoyer({ type: 'generate', images: images, precisions: precisions || '', requestId: requestId || '' });
    if (rep && rep.ok && rep.data) return rep.data;
    const err = new Error((rep && rep.error) || 'Génération impossible.');
    err.code = rep && rep.code;
    err.serverCode = rep && rep.serverCode;
    throw err;
  }

  const creditsIllimites = () => !!(compte.credits && compte.credits.unlimited === true);

  // Mesure comparable avant/après : plus elle baisse, plus on a consommé. Pour un compte sans quota,
  // c'est le compteur de consommation du serveur (inversé) ; sinon le solde restant.
  function mesureCredit() {
    const c = compte.credits;
    if (!c) return null;
    if (c.unlimited === true) return typeof c.used === 'number' ? -c.used : null;
    return typeof c.remaining === 'number' ? c.remaining : null;
  }

  // Constate le crédit réellement consommé en comparant avant/après. Retourne true si le constat est fiable
  // (compte relu avec succès) : c'est la condition pour tout nouvel essai automatique.
  async function constaterCredit(L, moteur, avant, apresEnvoi) {
    if (moteur !== 'backend') { L.credit = { etat: 'claude', detail: '' }; return false; }
    const rep = await actualiserCompte();
    const apres = mesureCredit();
    const releve = !!(rep && rep.ok && rep.data && rep.data.connected && !rep.data.offline && !rep.data.indisponible && !rep.data.ferme);
    if (avant === null || apres === null || !releve) {
      L.credit = { etat: 'inconnu', detail: 'solde illisible, vérifie ton compte' };
      return false;
    }
    const illimite = creditsIllimites();
    if (apres < avant) {
      L.credit = {
        etat: 'consomme',
        detail: illimite ? (avant - apres) + ' analyse comptabilisée (crédits illimités)' : (avant - apres) + ' crédit (' + avant + ' → ' + apres + ')'
      };
    } else {
      L.credit = {
        etat: 'non-consomme',
        detail: illimite ? 'compteur inchangé' : 'solde inchangé : ' + apres + (apresEnvoi ? ', à confirmer plus tard' : '')
      };
    }
    return true;
  }

  async function controlesAuto() {
    if (!reglages.consentementIA) {
      return 'Active « Préparer automatiquement mes annonces » dans Réglages et accepte le traitement par IA.';
    }
    const c = (await lire(['autoCompteur'])).autoCompteur;
    const n = c && c.jour === aujourdhui() ? c.n : 0;
    if (!creditsIllimites() && reglages.limiteAuto > 0 && n >= reglages.limiteAuto) {
      return 'Limite quotidienne atteinte (' + n + '/' + reglages.limiteAuto + '). Utilise « Générer l\'annonce » pour continuer à la main.';
    }
    return null;
  }

  async function compterAnalyseAuto() {
    const c = (await lire(['autoCompteur'])).autoCompteur;
    const n = c && c.jour === aujourdhui() ? c.n : 0;
    await chrome.storage.local.set({ autoCompteur: { jour: aujourdhui(), n: n + 1 } });
  }

  // Retouches automatiques adaptées à chaque photo (une seule fois par photo)
  function ameliorerPhotosVinted(L) {
    const concernees = photosAlbum().filter((photo) => {
      const origine = fpParPhoto.get(photo.id);
      return origine && origine.tabId === L.tabId && estSelectionnee(photo.id);
    });
    const nbAvant = concernees.reduce((n, p) => n + p.operations.length, 0);
    const bilan = ameliorerPhotos(concernees);
    bilan.echecs.forEach((e) => console.warn('[AF] Retouche automatique :', e.nom, e.message));
    const nbApres = photosAlbum().filter((p) => concernees.some((c) => c.id === p.id)).reduce((n, p) => n + p.operations.length, 0);
    return nbApres - nbAvant;
  }

  async function imagesPourIA(L) {
    const parFp = new Map();
    for (const photo of photosAlbum()) {
      const origine = fpParPhoto.get(photo.id);
      if (origine && origine.tabId === L.tabId) parFp.set(origine.fp, photo);
    }
    // Photos déposées dans le panneau : l'annonce contient l'origine et la version sur fond blanc.
    // L'IA n'en reçoit qu'une de chaque, pas les doublons.
    const plafond = L.depot && L.depot.total === L.photos.length ? Math.min(IA.MAX_PHOTOS, L.depot.uniques) : IA.MAX_PHOTOS;
    const B = blancs.get(L.tabId);
    const images = [];
    for (const p of L.photos) {
      if (images.length >= plafond) break;
      if (B && B.generees.has(p.fp)) continue;
      if (B && B.doublons && B.doublons.length) {
        const signature = await signatureVisuelle(p.b64);
        if (signature && B.doublons.some((v) => distanceSignature(v, signature) <= SEUIL_MEME_PHOTO)) continue;
      }
      const photo = parFp.get(p.fp);
      images.push(photo ? urlPhoto(photo).split(',')[1] : p.b64);
    }
    return images;
  }

  function etatSousCategorie(b, menus) {
    if (!b.sousCategorie) return 'absent';
    if (menus.categorie === 'rempli' || menus.categorie === 'deja') return menus.categorie;
    return 'manuel';
  }

  function construireChamps(b, rep) {
    const fait = rep.fait || {};
    const menus = rep.menus || {};
    const menu = (cle, valeur) => {
      if (Array.isArray(valeur) ? !valeur.length : !valeur) return 'absent';
      return menus[cle] || 'a_choisir';
    };
    return [
      { cle: 'titre', nom: LIBELLES.titre, etat: fait.titre || 'absent', valeur: b.titre },
      { cle: 'description', nom: LIBELLES.description, etat: fait.description || 'absent', valeur: '' },
      { cle: 'prix', nom: LIBELLES.prix, etat: fait.prix || 'absent', valeur: b.prix ? b.prix + ' €' : '' },
      { cle: 'categorie', nom: LIBELLES.categorie, etat: menu('categorie', b.categorie || b.sousCategorie), valeur: b.categorie || b.sousCategorie },
      { cle: 'sousCategorie', nom: LIBELLES.sousCategorie, etat: etatSousCategorie(b, menus), valeur: b.sousCategorie },
      { cle: 'marque', nom: LIBELLES.marque, etat: menus.marque || 'a_choisir', valeur: b.marque },
      { cle: 'taille', nom: LIBELLES.taille, etat: menu('taille', b.taille), valeur: b.taille },
      { cle: 'etat', nom: LIBELLES.etat, etat: menu('etat', b.etat), valeur: b.etat },
      { cle: 'couleurs', nom: LIBELLES.couleurs, etat: menu('couleurs', b.couleurs), valeur: (b.couleurs || []).join(', ') },
      { cle: 'matiere', nom: LIBELLES.matiere, etat: menu('matiere', b.matiere), valeur: b.matiere }
    ];
  }

  function resumerChamps(champs) {
    const remplis = champs.filter((c) => c.etat === 'rempli' || c.etat === 'deja').length;
    const aVerifier = champs.filter((c) => A_VERIFIER.indexOf(c.etat) >= 0).map((c) => c.nom);
    return remplis + ' champ(s) rempli(s) · ' + (aVerifier.length ? aVerifier.length + ' à vérifier (' + aVerifier.join(', ') + ')' : 'rien à vérifier');
  }

  async function remplirFormulaire(tabId, brouillon) {
    const rep = await versOnglet(tabId, { type: 'fillListing', annonce: brouillon });
    if (!rep) return { erreur: 'Impossible de joindre la page Vinted. Actualise-la (F5).' };
    if (!rep.ok) return { erreur: rep.error || 'Remplissage impossible.' };
    return { champs: construireChamps(brouillon, rep) };
  }

  // Délai de stabilisation : repart à zéro à chaque changement de photos, ne part jamais pendant un chargement.
  function planifierAuto(L) {
    if (L.reessai && L.reessai.cle === L.cle) return;   // un nouvel essai est déjà programmé
    if (reprendreSiBesoin(L)) return;                  // une analyse déjà envoyée est reprise, jamais relancée
    annulerMinuteur(L);
    if (fondBlancEnAttente(L)) return;                 // les versions sur fond blanc arrivent : une seule analyse, après
    if (!reglages.autoGenerer || !L.photos.length || L.enChargement) return;
    if (L.ignoree === L.cle || analysesTentees.has(L.cle) || brouillons.some((b) => b.cle === L.cle)) return;
    const delai = reglages.delaiS * 1000;
    anticiperCompte();
    L.echeance = Date.now() + delai;
    L.analyse = 'stabilisation';
    etape(L, 'pretes', 'en-cours');
    L.tick = setInterval(() => majLive(L), 500);
    L.minuteur = setTimeout(() => {
      L.minuteur = null;
      clearInterval(L.tick);
      L.tick = null;
      L.echeance = 0;
      lancerPipeline(L, false);
    }, delai);
    majLive(L);
  }

  function reprogrammerAutomatique() {
    for (const L of lives.values()) if (!L.minuteur) planifierAuto(L);
  }

  // ========== ANALYSES ENVOYÉES : MÉMOIRE DURABLE (reprise après fermeture du panneau) ==========
  const DUREE_ENVOI_MS = 2 * 60 * 60 * 1000;
  const MAX_ENVOIS = 20;
  const INTERVALLE_REPRISE_MS = 2500;
  const envois = {};                       // empreinte des photos -> { requestId, at, tabId, nbPhotos, precisions, etat }
  const requetesSession = new Set();       // requêtes envoyées par CE panneau (jamais « reprises »)
  const reprisesEnCours = new Set();
  const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  async function ecrireEnvois() {
    try {
      await chrome.storage.local.set({ analysesEnvoyees: envois });
    } catch (e) {
      console.warn('[AF] Mémorisation des analyses impossible :', e);
    }
  }

  async function memoriserEnvoi(cle, entree) {
    envois[cle] = entree;
    const maintenant = Date.now();
    for (const [k, v] of Object.entries(envois)) if (!v || maintenant - v.at > DUREE_ENVOI_MS) delete envois[k];
    const anciens = Object.entries(envois).sort((a, b) => a[1].at - b[1].at);
    while (anciens.length > MAX_ENVOIS) delete envois[anciens.shift()[0]];
    await ecrireEnvois();
  }

  async function oublierEnvoi(cle) {
    delete envois[cle];
    await ecrireEnvois();
  }

  async function changerEtatEnvoi(cle, etatEnvoi) {
    if (envois[cle]) await memoriserEnvoi(cle, Object.assign({}, envois[cle], { etat: etatEnvoi }));
  }

  // Relit les envois récents : ils comptent comme « déjà analysés » (jamais de nouvelle analyse automatique
  // pour les mêmes photos), et ceux dont le résultat est attendu seront repris.
  async function chargerEnvois() {
    try {
      const stocke = (await lire(['analysesEnvoyees'])).analysesEnvoyees;
      if (!stocke || typeof stocke !== 'object' || Array.isArray(stocke)) return;
      for (const [cle, v] of Object.entries(stocke)) {
        if (v && typeof v === 'object' && typeof v.requestId === 'string' && typeof v.at === 'number' && Date.now() - v.at < DUREE_ENVOI_MS) {
          envois[cle] = v;
          analysesTentees.add(cle);
        }
      }
    } catch (e) {
      console.warn('[AF] Relecture des analyses envoyées :', e);
    }
  }

  // Erreur passagère sans consommation vérifiée : jusqu'à deux nouveaux essais espacés, annulables.
  function planifierReessai(L, cle, err) {
    if (L.reessais >= FACTEURS_REESSAI.length || !reglages.autoGenerer) return;
    const delai = FACTEURS_REESSAI[L.reessais] * reglages.delaiS;
    L.reessais++;
    messageLive(L, messageErreur(err) + ' Aucun crédit consommé : nouvel essai automatique dans ' + delai + ' s (' +
      L.reessais + '/' + FACTEURS_REESSAI.length + '). « Interrompre » l\'annule.', true);
    L.reessai = {
      cle: cle,
      minuteur: setTimeout(() => {
        L.reessai = null;
        if (L.cle !== cle || !reglages.autoGenerer) return;
        L.ignoree = '';
        analysesTentees.delete(cle);
        garder('Nouvel essai', () => lancerPipeline(L, false));
      }, delai * 1000)
    };
    majLive(L);
  }

  // Suite commune d'une analyse reçue (directement ou retrouvée après réouverture) :
  // brouillon, puis remplissage automatique du formulaire si le mode le demande.
  async function terminerAnalyse(L, annonce, ctx) {
    const { cle, tabId, precisions, manuel } = ctx;
    const premiere = photosAlbum().find((p) => {
      const o = fpParPhoto.get(p.id);
      return o && o.tabId === tabId && L.photos[0] && o.fp === L.photos[0].fp;
    });
    const vignette = premiere ? vignetteDe(Studio.rendrePhoto(premiere)) : '';
    const brouillon = await enregistrerBrouillon(annonce, vignette, ctx.nbImages, cle, precisions);
    await changerEtatEnvoi(cle, 'terminee');
    etape(L, 'annonce', 'fait');

    if (L.cle !== cle) {
      afficherStatut('Annonce générée pour un ensemble de photos précédent : retrouve-la dans « Mes annonces ».', 'info');
      return;
    }
    L.brouillon = brouillon;
    L.precisionsUtilisees = precisions;
    L.champs = null;

    if (ctx.interrompue) {
      messageLive(L, 'L\'analyse s\'est terminée avant l\'interruption : annonce enregistrée (' + texteCredit(L.credit).toLowerCase() +
        '). Le formulaire n\'a pas été rempli.');
      return;
    }

    // Un clic sur « Générer » remplit aussi le formulaire : pas de second clic à faire.
    const remplirAuto = reglages.autoRemplir && (manuel || reglages.autoGenerer);
    if (remplirAuto && tabId !== null) {
      etape(L, 'remplissage', 'en-cours');
      messageLive(L, 'Annonce générée. Remplissage du formulaire…');
      const res = await remplirFormulaire(tabId, brouillon);
      if (res.erreur) {
        etape(L, 'remplissage', 'erreur');
        messageLive(L, 'Annonce générée, mais le formulaire n\'a pas été rempli : ' + res.erreur, true);
      } else {
        L.champs = res.champs;
        etape(L, 'remplissage', 'fait');
        messageLive(L, 'Annonce prête : ' + resumerChamps(res.champs) + '. Vérifie, puis publie toi-même.');
      }
    } else {
      messageLive(L, 'Annonce générée : « ' + brouillon.titre + ' ». Clique sur « Remplir le formulaire ».');
    }
  }

  // Une analyse envoyée par un panneau précédent (fermé ou rechargé) : on récupère son résultat auprès du
  // service worker au lieu d'en lancer une autre. Si le résultat est perdu, aucune relance automatique.
  function reprendreSiBesoin(L) {
    const e = envois[L.cle];
    if (!e || e.etat !== 'envoyee' || requetesSession.has(e.requestId) || reprisesEnCours.has(L.cle)) return false;
    if (generationEnCours) return true;     // repris à la fin du traitement en cours (reprogrammerAutomatique)
    reprisesEnCours.add(L.cle);
    garder('Reprise de l\'analyse', () => reprendreAnalyse(L, e).finally(() => reprisesEnCours.delete(L.cle)));
    return true;
  }

  async function reprendreAnalyse(L, e) {
    const cle = L.cle;
    const tabId = L.tabId;
    generationEnCours = true;
    L.analyse = 'en-cours';
    L.precisions = e.precisions || L.precisions;
    definirEtapes(L, { photos: 'fait', pretes: 'fait', analyse: 'en-cours' });
    messageLive(L, 'Une analyse envoyée avant la fermeture du panneau est reprise : récupération du résultat…');
    try {
      let r = { etat: 'inconnu' };
      for (let i = 0; i < 80; i++) {
        const rep = await envoyer({ type: 'getAnalyseResult', requestId: e.requestId });
        r = rep.ok && rep.data ? rep.data : { etat: 'inconnu' };
        if (r.etat !== 'en-cours') break;
        await pause(INTERVALLE_REPRISE_MS);
        if (L.cle !== cle) return;
      }
      if (L.cle !== cle) return;
      await actualiserCompte();
      if (r.etat === 'termine' && r.ok && r.data) {
        L.analyse = 'terminee';
        etape(L, 'analyse', 'fait');
        L.credit = { etat: 'inconnu', detail: 'analyse envoyée avant la fermeture du panneau : vérifie la consommation du compte' };
        await terminerAnalyse(L, r.data, { cle: cle, tabId: tabId, nbImages: e.nbPhotos || 0, precisions: e.precisions || '', manuel: false, interrompue: false });
      } else if (r.etat === 'termine') {
        L.analyse = 'echec';
        L.ignoree = cle;
        L.credit = { etat: 'inconnu', detail: 'à vérifier dans le compte' };
        await changerEtatEnvoi(cle, 'abandonnee');
        echecLive(L, messageErreur({ code: r.code, serverCode: r.serverCode, message: r.error }) + ' (analyse envoyée avant la fermeture du panneau)');
      } else {
        L.analyse = 'echec';
        L.ignoree = cle;
        L.credit = { etat: 'inconnu', detail: 'à vérifier dans le compte' };
        await changerEtatEnvoi(cle, 'abandonnee');
        echecLive(L, 'Une analyse avait été envoyée pour ces photos avant la fermeture du panneau, mais son résultat n\'a pas été retrouvé. ' +
          'Pour éviter une double facturation, aucune nouvelle analyse automatique n\'est lancée. « Régénérer l\'annonce » la relancera à ta demande.');
      }
    } finally {
      generationEnCours = false;
      rafraichirVues();
      reprogrammerAutomatique();
    }
  }
  async function lancerPipeline(L, manuel) {
    if (generationEnCours || !L.photos.length) return;
    annulerMinuteur(L);
    const cle = L.cle;
    const tabId = L.tabId;

    if (L.enChargement > 0) {
      messageLive(L, 'Des photos sont encore en cours de chargement. L\'analyse démarrera quand elles seront prêtes.');
      return;
    }

    if (!manuel) {
      if (analysesTentees.has(cle) || brouillons.some((b) => b.cle === cle) || L.ignoree === cle) return;
      const refus = await controlesAuto();
      if (refus) {
        L.ignoree = cle;
        L.analyse = 'non-lancee';
        L.credit = { etat: 'non-consomme', detail: 'aucune analyse envoyée' };
        etape(L, 'pretes', '');
        echecLive(L, refus);
        return;
      }
    } else {
      const existant = brouillons.find((b) => b.cle === cle);
      if (existant) {
        const avertissement = modifieManuellement(existant)
          ? 'Tu as modifié cette annonce. La régénérer remplacera tes modifications et consommera des crédits. Continuer ?'
          : 'Une annonce existe déjà pour ces photos. La régénérer consommera des crédits. Continuer ?';
        if (!confirm(avertissement)) return;
      }
    }

    const moteur = await moteurDisponible();
    if (moteur.erreur) {
      L.ignoree = cle;
      L.analyse = 'non-lancee';
      L.credit = { etat: 'non-consomme', detail: 'aucune analyse envoyée' };
      etape(L, 'pretes', '');
      echecLive(L, moteur.erreur);
      return;
    }

    const ctl = { annule: false, envoye: false, requestId: 'r' + Date.now().toString(36) + (++compteurRequetes) };
    L.ignoree = '';
    L.annulation = ctl;
    generationEnCours = true;
    L.analyse = 'en-cours';
    L.credit = { etat: 'aucun', detail: '' };
    definirEtapes(L, { photos: 'fait', pretes: 'en-cours' });
    messageLive(L, 'Préparation des photos…');
    if (tabId !== null) versOnglet(tabId, { type: 'setAnalyseEnCours', enCours: true });

    let creditsAvant = null;
    const interrompu = () => ctl.annule;
    const sortirInterrompu = (envoye) => {
      L.analyse = 'interrompue';
      L.credit = { etat: 'non-consomme', detail: envoye ? '' : 'aucune analyse envoyée' };
      etape(L, 'pretes', L.etapes.pretes === 'fait' ? 'fait' : '');
      echecLive(L, 'Analyse interrompue avant l\'envoi : aucun crédit consommé.');
      L.ignoree = cle;
    };

    try {
      const nbRetouches = reglages.autoAmeliorer ? ameliorerPhotosVinted(L) : 0;
      const images = await imagesPourIA(L);
      etape(L, 'pretes', 'fait');
      if (interrompu()) { sortirInterrompu(false); return; }

      if (moteur.moteur === 'backend') {
        const credits = await verifierCredits(1);
        if (credits.erreur) {
          L.analyse = 'echec';
          L.credit = { etat: 'non-consomme', detail: 'aucune analyse envoyée' };
          L.ignoree = cle;
          echecLive(L, credits.erreur);
          return;
        }
        creditsAvant = mesureCredit();
      }
      if (interrompu()) { sortirInterrompu(false); return; }

      if (L.photos.length > IA.MAX_PHOTOS) {
        afficherStatut('Seules les ' + IA.MAX_PHOTOS + ' premières photos sont analysées.', 'info');
      }
      etape(L, 'analyse', 'en-cours');
      messageLive(L, 'Analyse en cours (' + images.length + ' photo' + (images.length > 1 ? 's' : '') +
        (nbRetouches ? ', ' + nbRetouches + ' retouche(s) automatique(s)' : '') + ')…');

      // À partir d'ici l'envoi est irréversible : jamais deux analyses automatiques pour le même ensemble de photos.
      analysesTentees.add(cle);
      if (!manuel) await compterAnalyseAuto();
      if (interrompu()) { sortirInterrompu(false); analysesTentees.delete(cle); return; }

      const precisions = L.precisions;
      let annonce;
      ctl.envoye = true;
      requetesSession.add(ctl.requestId);
      // L'envoi est mémorisé AVANT l'appel : si le panneau est fermé pendant l'analyse, la réouverture
      // retrouve le résultat (mémorisé par le service worker) au lieu de relancer et refacturer.
      await memoriserEnvoi(cle, { requestId: ctl.requestId, at: Date.now(), tabId: tabId, nbPhotos: images.length, precisions: precisions, etat: 'envoyee' });
      try {
        annonce = await appelGenerer(images, precisions, ctl.requestId);
      } catch (err) {
        L.analyse = err.code === 'ABORTED' ? 'interrompue' : 'echec';
        let verifie = false;
        if (ERREURS_REFUS_SERVEUR.indexOf(err.code) >= 0) {
          L.credit = { etat: 'non-consomme', detail: 'refusé par le serveur' };
          verifie = true;
        } else {
          verifie = await constaterCredit(L, moteur.moteur, creditsAvant, true);
        }
        L.ignoree = cle;
        // Un envoi sans consommation vérifiée peut être refait ; sinon on garde la trace (jamais de double facturation).
        if (L.credit.etat === 'non-consomme' && verifie) await oublierEnvoi(cle);
        else await memoriserEnvoi(cle, Object.assign({}, envois[cle], { etat: 'abandonnee' }));
        echecLive(L, messageErreur(err) + (err.code === 'ABORTED' ? ' ' + texteCredit(L.credit) + '.' : ''));
        // Erreur passagère, crédit vérifié non consommé, mode automatique : au plus deux nouveaux essais espacés.
        if (!manuel && err.code !== 'ABORTED' && erreurTemporaire(err) && verifie && L.credit.etat === 'non-consomme') {
          planifierReessai(L, cle, err);
        } else if (erreurTemporaire(err) && !verifie) {
          messageLive(L, messageErreur(err) + ' L\'état de la consommation n\'a pas pu être vérifié : aucun nouvel essai automatique pour éviter une double facturation. « Régénérer l\'annonce » relance à ta demande.', true);
        }
        return;
      }
      L.analyse = 'terminee';
      etape(L, 'analyse', 'fait');
      const constat = constaterCredit(L, moteur.moteur, creditsAvant, false).then(() => majLive(L));
      await terminerAnalyse(L, annonce, { cle: cle, tabId: tabId, nbImages: images.length, precisions: precisions, manuel: manuel, interrompue: ctl.annule });
      await constat;
    } catch (e) {
      console.error('[AF] Erreur traitement :', e);
      L.analyse = 'echec';
      echecLive(L, 'Erreur : ' + (e.message || 'inconnue') + '. Aucune annonce n\'a été générée.');
      L.ignoree = cle;
    } finally {
      generationEnCours = false;
      L.annulation = null;
      if (tabId !== null) versOnglet(tabId, { type: 'setAnalyseEnCours', enCours: false });
      rafraichirVues();
      reprogrammerAutomatique();
    }
  }

  function interrompre(L) {
    if (generationEnCours && L.annulation) {
      L.annulation.annule = true;
      if (L.annulation.envoye) envoyer({ type: 'cancelGenerate', requestId: L.annulation.requestId });
      messageLive(L, 'Interruption en cours…');
      return;
    }
    if (L.minuteur || L.reessai) {
      annulerMinuteur(L);
      L.ignoree = L.cle;
      L.analyse = 'non-lancee';
      etape(L, 'pretes', '');
      messageLive(L, 'Analyse automatique annulée pour ces photos (aucun nouvel essai). « Générer l\'annonce » la lancera à ta demande.');
    }
  }

  $('#live-generer').addEventListener('click', () => lancerPipeline(live, true));
  $('#live-annuler').addEventListener('click', () => interrompre(live));
  $('#live-precisions').addEventListener('input', (e) => {
    live.precisions = e.target.value.slice(0, 300);
    rendreLive();
  });

  $('#live-remplir').addEventListener('click', async () => {
    const L = live;
    if (!L.brouillon || L.tabId === null) return;
    etape(L, 'remplissage', 'en-cours');
    const res = await remplirFormulaire(L.tabId, L.brouillon);
    if (res.erreur) {
      etape(L, 'remplissage', 'erreur');
      messageLive(L, res.erreur, true);
      return;
    }
    L.champs = res.champs;
    etape(L, 'remplissage', 'fait');
    messageLive(L, 'Formulaire traité : ' + resumerChamps(res.champs) + '. Vérifie, puis publie toi-même.');
  });

  // Remplacement d'une saisie existante : uniquement après confirmation explicite, champ par champ
  $('#live-champs').addEventListener('click', async (e) => {
    const lien = e.target.closest ? e.target.closest('button.lien-similaires') : null;
    if (lien) {
      const url = lien.getAttribute('data-url');
      if (url && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: url, active: true });
      return;
    }
    const bouton = e.target.closest ? e.target.closest('.btn-remplacer') : null;
    const L = live;
    if (!bouton || !L.brouillon || L.tabId === null) return;
    const cle = bouton.dataset.cle;
    if (!confirm('Remplacer ce que tu as saisi dans le formulaire (' + LIBELLES[cle].toLowerCase() + ') par la proposition de l\'IA ?')) return;
    const rep = await versOnglet(L.tabId, { type: 'fillListing', annonce: L.brouillon, forcer: [cle], seulement: [cle] });
    if (!rep || !rep.ok) { afficherStatut('Remplacement impossible. Actualise la page Vinted.', 'erreur'); return; }
    const champ = (L.champs || []).find((c) => c.cle === cle);
    if (champ) champ.etat = (rep.fait && rep.fait[cle]) || 'echec';
    messageLive(L, 'Champ « ' + LIBELLES[cle].toLowerCase() + ' » : ' + (TEXTE_ETAT[champ && champ.etat] || 'traité') + '.');
  });

  // ========== PHOTOS ==========
  async function importerFichiers(fichiers) {
    const liste = Array.from(fichiers || []).filter((f) => f.type && f.type.startsWith('image/'));
    if (!liste.length) { afficherStatut('Aucune image reconnue : choisis des fichiers JPEG, PNG ou WebP.', 'info'); return; }
    await pretAtelier;
    let ok = 0;
    let derniereErreur = '';
    for (const f of liste) {
      try {
        await ajouterDepuisUrl(await lireFichier(f), f.name, null);
        ok++;
      } catch (e) {
        derniereErreur = e.message;
      }
    }
    rafraichirGalerie();
    if (ok) { afficherStatut(ok + ' photo' + (ok > 1 ? 's' : '') + ' importée' + (ok > 1 ? 's' : '') + '.', 'succes'); sauvegarderAtelier(); }
    if (derniereErreur) afficherStatut(derniereErreur, 'erreur');
  }

  // Message d'état de la galerie : toujours explicite quand rien n'est disponible ou rien n'est prêt.
  function infoGalerie() {
    const L = live;
    const nbVinted = photosAlbum().filter((p) => fpParPhoto.has(p.id)).length;
    if (!photosAlbum().length) return explicationAucunePhoto();
    if (L.tabId !== null && L.enChargement > 0) {
      return L.enChargement + ' photo' + (L.enChargement > 1 ? 's' : '') + ' Vinted en cours de chargement : elle' + (L.enChargement > 1 ? 's apparaîtront' : ' apparaîtra') + ' ici dès qu\'elle' + (L.enChargement > 1 ? 's seront prêtes.' : ' sera prête.');
    }
    if (L.tabId !== null && L.detectees > nbVinted && atelier.nonCopiees === 0) {
      return (L.detectees - nbVinted) + ' photo' + (L.detectees - nbVinted > 1 ? 's' : '') + ' de Vinted pas encore récupérée' + (L.detectees - nbVinted > 1 ? 's' : '') + ' : clique sur « Depuis Vinted ».';
    }
    if (atelier.nonCopiees > 0) {
      return 'Atelier plein (8 photos) : ' + atelier.nonCopiees + ' photo' + (atelier.nonCopiees > 1 ? 's' : '') + ' Vinted non copiée' + (atelier.nonCopiees > 1 ? 's' : '') + ' ici. Retire une photo pour les récupérer.';
    }
    return '';
  }

  function rafraichirGalerie() {
    const galerie = $('#galerie');
    galerie.innerHTML = '';
    const photos = photosAlbum();
    if (etat.photoActiveId && !photos.some((p) => p.id === etat.photoActiveId)) etat.photoActiveId = null;
    const nbSel = photos.filter((p) => estSelectionnee(p.id)).length;
    $('#compteur-photos').textContent = photos.length + ' photo' + (photos.length !== 1 ? 's' : '') +
      (photos.length ? ' · ' + nbSel + ' sélectionnée' + (nbSel > 1 ? 's' : '') : '');
    $('#vers-creation').hidden = photosManuelles().length === 0;
    $('#ameliorer-auto-nb').textContent = photos.length ? '(' + nbSel + ')' : '';
    const info = infoGalerie();
    const zoneInfo = $('#galerie-info');
    zoneInfo.textContent = info;
    zoneInfo.hidden = !info;

    photos.forEach((photo, i) => {
      const div = document.createElement('div');
      div.className = 'vignette' + (photo.id === etat.photoActiveId ? ' active' : '') + (estSelectionnee(photo.id) ? ' selectionnee' : '');
      div.dataset.id = photo.id;
      div.title = fpParPhoto.has(photo.id) ? 'Photo du formulaire Vinted' : 'Photo importée';
      div.innerHTML =
        '<img src="' + urlPhoto(photo) + '" alt="Photo ' + (i + 1) + '">' +
        '<span class="vignette-badge">' + (i + 1) + '</span>' +
        (photo.operations.length ? '<span class="vignette-retouchee" title="Retouchée (l\'original est conservé)">✎</span>' : '') +
        '<button type="button" class="vignette-coche" role="checkbox" aria-checked="' + estSelectionnee(photo.id) + '" title="Sélectionner pour l\'amélioration automatique">' + (estSelectionnee(photo.id) ? '✓' : '') + '</button>' +
        '<button type="button" class="vignette-suppr" title="Retirer de l\'atelier">×</button>';
      div.addEventListener('click', (e) => garder('Galerie', () => {
        if (e.target.classList.contains('vignette-suppr')) {
          if (!fpParPhoto.has(photo.id) && !confirm('Retirer cette photo de l\'atelier ? La copie mémorisée par l\'extension sera supprimée (ton fichier d\'origine sur ton ordinateur n\'est pas touché).')) return;
          retirerPhotoDeLAtelier(photo.id);
          if (!photoActive()) $('#apercu-container').hidden = true;
          rafraichirGalerie();
          sauvegarderAtelier();
          return;
        }
        if (e.target.classList.contains('vignette-coche')) {
          atelier.album = Studio.basculerSelection(atelier.album, photo.id);
          rafraichirGalerie();
          return;
        }
        selectionnerPhoto(photo.id);
      }));
      galerie.appendChild(div);
    });
    if (!photoActive()) $('#apercu-container').hidden = true;
  }

  function selectionnerPhoto(id) {
    etat.photoActiveId = id;
    cacherPanneauxRetouche();
    $$('.vignette').forEach((v) => v.classList.toggle('active', v.dataset.id === id));
    $('#apercu-container').hidden = false;
    const photo = photoActive();
    $('#apercu-nom').textContent = photo ? photo.nom : 'Photo';
    afficherApercu('apres');
  }

  function afficherApercu(mode) {
    const photo = photoActive();
    if (!photo) return;
    const canvas = $('#apercu');
    const im = mode === 'avant' ? photo.source : Studio.rendrePhoto(photo);
    const largeurMax = Math.max(120, canvas.parentElement.clientWidth - 24);
    const ratio = Math.min(largeurMax / im.width, 280 / im.height, 1);
    canvas.width = Math.max(1, Math.round(im.width * ratio));
    canvas.height = Math.max(1, Math.round(im.height * ratio));
    canvas.getContext('2d').drawImage(pixelsVersCanvas(im), 0, 0, canvas.width, canvas.height);
    $('#voir-avant').classList.toggle('active', mode === 'avant');
    $('#voir-apres').classList.toggle('active', mode === 'apres');
  }

  $('#voir-avant').addEventListener('click', () => afficherApercu('avant'));
  $('#voir-apres').addEventListener('click', () => afficherApercu('apres'));

  const zoneImport = $('#zone-import');
  const inputFichiers = $('#fichiers');
  zoneImport.addEventListener('click', () => inputFichiers.click());
  inputFichiers.addEventListener('change', () => { importerFichiers(inputFichiers.files); inputFichiers.value = ''; });
  zoneImport.addEventListener('dragover', (e) => { e.preventDefault(); zoneImport.classList.add('survol'); });
  zoneImport.addEventListener('dragleave', () => zoneImport.classList.remove('survol'));
  zoneImport.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneImport.classList.remove('survol');
    importerFichiers(e.dataTransfer.files);
  });
  $('#recuperer-vinted').addEventListener('click', recupererDepuisVinted);

  // Traite les photos SÉLECTIONNÉES de l'atelier (toutes le sont par défaut) et rend compte photo par photo.
  $('#ameliorer-auto').addEventListener('click', () => garder('Amélioration automatique', () => {
    const photos = photosAlbum();
    if (!photos.length) {
      afficherStatut(explicationAucunePhoto(), 'info');
      rafraichirGalerie();
      return;
    }
    const choisies = photos.filter((p) => estSelectionnee(p.id));
    if (!choisies.length) {
      afficherStatut('Aucune photo sélectionnée : coche au moins une photo (case en bas à gauche de la vignette).', 'info');
      return;
    }
    const bilan = ameliorerPhotos(choisies);
    rafraichirGalerie();
    if (photoActive()) afficherApercu('apres');
    sauvegarderAtelier();

    const parties = [];
    if (bilan.ameliorees) parties.push(bilan.ameliorees + ' améliorée' + (bilan.ameliorees > 1 ? 's' : ''));
    if (bilan.correctes) parties.push(bilan.correctes + ' déjà correcte' + (bilan.correctes > 1 ? 's' : ''));
    if (bilan.dejaTraitees) parties.push(bilan.dejaTraitees + ' déjà traitée' + (bilan.dejaTraitees > 1 ? 's' : ''));
    let texte = choisies.length + ' photo' + (choisies.length > 1 ? 's' : '') + ' sélectionnée' + (choisies.length > 1 ? 's' : '') +
      (parties.length ? ' : ' + parties.join(', ') : '') + '. Les originaux sont conservés (bouton « Annuler »).';
    if (bilan.echecs.length) {
      texte += ' ' + bilan.echecs.length + ' problème' + (bilan.echecs.length > 1 ? 's' : '') + ' : ' +
        bilan.echecs.map((e) => e.nom + ' (' + e.message + ')').join(' ; ') + '.';
    }
    afficherStatut(texte, bilan.echecs.length ? 'erreur' : (bilan.ameliorees ? 'succes' : 'info'));
  }));

  // ========== RETOUCHES MANUELLES ==========
  const PANNEAUX = { recadrer: '#btn-recadrer', redresser: '#btn-redresser', lumiere: '#btn-lumiere', fond: '#btn-fond' };

  function cacherPanneauxRetouche() {
    $('#panneau-retouche').hidden = true;
    $$('#panneau-retouche > div').forEach((d) => { d.hidden = true; });
    $$('.btn-retouche').forEach((b) => b.classList.remove('active'));
    etat.retouche = null;
    etat.recadrage = null;
  }

  function ouvrirRetouche(type) {
    if (!photoActive()) { afficherStatut('Choisis d\'abord une photo.', 'info'); return; }
    if (etat.retouche === type) { cacherPanneauxRetouche(); return; }
    cacherPanneauxRetouche();
    etat.retouche = type;
    $('#panneau-retouche').hidden = false;
    $('#retouche-' + type).hidden = false;
    $(PANNEAUX[type]).classList.add('active');
    if (type === 'redresser') { $('#angle').value = 0; $('#angle-val').textContent = '0°'; }
    if (type === 'lumiere') {
      ['lum', 'contraste', 'saturation'].forEach((id) => { $('#' + id).value = 0; });
      $('#lum-val').textContent = '0';
      $('#contraste-val').textContent = '0';
      $('#saturation-val').textContent = '0';
    }
  }

  function appliquerRetouche(op, succes) {
    const photo = photoActive();
    if (!photo) return;
    try {
      retoucherPhoto(photo.id, op);
    } catch (e) {
      afficherStatut(e.message || 'Retouche impossible.', 'erreur');
      return;
    }
    cacherPanneauxRetouche();
    rafraichirGalerie();
    afficherApercu('apres');
    sauvegarderAtelier();
    afficherStatut(succes, 'succes');
  }

  $('#btn-recadrer').addEventListener('click', () => ouvrirRetouche('recadrer'));
  $('#btn-redresser').addEventListener('click', () => ouvrirRetouche('redresser'));
  $('#btn-lumiere').addEventListener('click', () => ouvrirRetouche('lumiere'));
  $('#btn-fond').addEventListener('click', () => ouvrirRetouche('fond'));

  $('#btn-annuler').addEventListener('click', () => {
    const photo = photoActive();
    if (!photo) return;
    atelier.album = Studio.annuler(atelier.album, photo.id);
    // Toutes les retouches annulées : la photo est de nouveau celle d'origine et peut être re-traitée.
    const apres = photosAlbum().find((p) => p.id === photo.id);
    if (apres && !apres.operations.length) photosAmeliorees.delete(photo.id);
    else photosAmeliorees.add(photo.id);
    rafraichirGalerie();
    sauvegarderAtelier();
    afficherApercu('apres');
    afficherStatut('Dernière retouche annulée.', 'info');
  });

  $('#angle').addEventListener('input', (e) => { $('#angle-val').textContent = e.target.value + '°'; });
  $('#redresser-auto').addEventListener('click', () => {
    const photo = photoActive();
    if (!photo) return;
    const angle = Math.max(-15, Math.min(15, Studio.angleRedressement(Studio.rendrePhoto(photo))));
    $('#angle').value = angle;
    $('#angle-val').textContent = angle.toFixed(1) + '°';
  });
  $('#appliquer-angle').addEventListener('click', () => {
    const angle = parseFloat($('#angle').value);
    if (Math.abs(angle) < 0.1) return;
    appliquerRetouche({ type: 'redresser', degres: angle }, 'Redressement appliqué.');
  });

  ['lum', 'contraste', 'saturation'].forEach((id) => {
    $('#' + id).addEventListener('input', (e) => { $('#' + id + '-val').textContent = e.target.value; });
  });
  $('#appliquer-lumiere').addEventListener('click', () => {
    appliquerRetouche({
      type: 'reglages',
      luminosite: parseInt($('#lum').value, 10) || 0,
      contraste: parseInt($('#contraste').value, 10) || 0,
      saturation: parseInt($('#saturation').value, 10) || 0
    }, 'Lumière ajustée.');
  });

  function hexVersRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  $('#fond-blanc').addEventListener('click', () => appliquerRetouche({ type: 'retirerFond', couleur: hexVersRgb('#FFFFFF') }, 'Fond remplacé.'));
  $('#fond-lavande').addEventListener('click', () => appliquerRetouche({ type: 'retirerFond', couleur: hexVersRgb('#F0EBFF') }, 'Fond remplacé.'));

  $('#mannequin').addEventListener('click', async () => {
    const photo = photoActive();
    if (!photo) return;
    try {
      const demande = Studio.demanderMannequin(photo);
      if (!demande.ok) throw new Error(demande.message || 'Mannequin non disponible.');
    } catch (e) {
      afficherStatut(e.message || 'Mannequin non disponible.', 'erreur');
    }
  });

  // Recadrage : rectangle tracé sur l'aperçu, converti dans les pixels de la photo rendue
  const canvasApercu = $('#apercu');
  function positionCanvas(e) {
    const r = canvasApercu.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvasApercu.width, (e.clientX - r.left) * (canvasApercu.width / r.width))),
      y: Math.max(0, Math.min(canvasApercu.height, (e.clientY - r.top) * (canvasApercu.height / r.height)))
    };
  }
  canvasApercu.addEventListener('mousedown', (e) => {
    if (etat.retouche !== 'recadrer') return;
    const p = positionCanvas(e);
    etat.recadrage = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, trace: true };
  });
  canvasApercu.addEventListener('mousemove', (e) => {
    const c = etat.recadrage;
    if (!c || !c.trace) return;
    const p = positionCanvas(e);
    c.x1 = p.x;
    c.y1 = p.y;
    afficherApercu('apres');
    const ctx = canvasApercu.getContext('2d');
    ctx.strokeStyle = '#6D28D9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0);
    ctx.setLineDash([]);
  });
  window.addEventListener('mouseup', () => { if (etat.recadrage) etat.recadrage.trace = false; });

  $('#appliquer-cadre').addEventListener('click', () => {
    const photo = photoActive();
    const c = etat.recadrage;
    if (!photo || !c) { afficherStatut('Trace un rectangle sur la photo.', 'info'); return; }
    const im = Studio.rendrePhoto(photo);
    const sx = im.width / canvasApercu.width;
    const sy = im.height / canvasApercu.height;
    const w = Math.abs(c.x1 - c.x0) * sx;
    const h = Math.abs(c.y1 - c.y0) * sy;
    if (w < 20 || h < 20) { afficherStatut('Zone trop petite.', 'erreur'); return; }
    appliquerRetouche({ type: 'recadrer', x: Math.min(c.x0, c.x1) * sx, y: Math.min(c.y0, c.y1) * sy, w: w, h: h }, 'Recadrage appliqué.');
  });

  $('#vers-creation').addEventListener('click', () => naviguerVers('creer'));

  // ========== CRÉATION (un ou plusieurs articles, regroupements choisis par l'utilisateur) ==========
  const modeCreation = () => $('input[name="mode-creation"]:checked').value;

  function groupesCreation() {
    const photos = photosManuelles();
    const mode = modeCreation();
    if (mode === 'unique') return [photos.slice(0, IA.MAX_PHOTOS)].filter((g) => g.length);
    if (mode === 'multiple') return photos.map((p) => [p]);
    const parNumero = new Map();
    for (const p of photos) {
      const n = groupeParPhoto.get(p.id) || 1;
      if (!parNumero.has(n)) parNumero.set(n, []);
      parNumero.get(n).push(p);
    }
    return Array.from(parNumero.keys()).sort((a, b) => a - b).map((n) => parNumero.get(n).slice(0, IA.MAX_PHOTOS));
  }

  function rafraichirCreation() {
    const photos = photosManuelles();
    const el = $('#photos-selectionnees');
    if (!photos.length) {
      el.innerHTML = '<p class="texte-vide">Importe des photos dans l\'onglet Photos. Les photos du formulaire Vinted ont leur propre analyse.</p>';
      $('#info-articles').textContent = '';
      return;
    }
    const mode = modeCreation();
    el.innerHTML = photos.map((p) => {
      const img = '<img src="' + urlPhoto(p) + '" alt="' + escapeHtml(p.nom) + '">';
      if (mode !== 'groupes') return img;
      const courant = groupeParPhoto.get(p.id) || 1;
      const options = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => '<option value="' + n + '"' + (n === courant ? ' selected' : '') + '>Article ' + n + '</option>').join('');
      return '<figure class="photo-groupe">' + img + '<select data-photo="' + escapeHtml(p.id) + '" aria-label="Article de cette photo">' + options + '</select></figure>';
    }).join('');
    const groupes = groupesCreation();
    $('#info-articles').textContent =
      mode === 'unique' ? photos.length + ' photo(s) pour 1 article (' + IA.MAX_PHOTOS + ' analysées au maximum)'
        : mode === 'multiple' ? photos.length + ' article(s), 1 photo chacun'
          : groupes.length + ' article(s) : ' + groupes.map((g, i) => (i + 1) + ' → ' + g.length + ' photo(s)').join(', ');
  }
  $$('input[name="mode-creation"]').forEach((r) => r.addEventListener('change', rafraichirCreation));
  $('#photos-selectionnees').addEventListener('change', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.photo) {
      groupeParPhoto.set(e.target.dataset.photo, parseInt(e.target.value, 10) || 1);
      rafraichirCreation();
    }
  });

  // Empreinte d'un groupe de photos importées : même ensemble = même analyse
  function cleGroupe(groupe) {
    return 'm:' + groupe.map((p) => empreinte(urlPhoto(p, true).split(',')[1])).sort().join('|');
  }

  $('#generer-lot').addEventListener('click', async () => {
    if (generationEnCours) return;
    const groupes = groupesCreation();
    if (!groupes.length) { afficherStatut('Importe des photos d\'abord.', 'erreur'); return; }
    const precisions = $('#precisions').value.trim();

    const dejaFaits = [];
    const aAnalyser = [];
    for (const g of groupes) {
      const cle = cleGroupe(g);
      const existant = brouillons.find((b) => b.cle === cle);
      if (existant || analysesTentees.has(cle)) dejaFaits.push(existant ? existant.titre : 'article déjà analysé');
      else aAnalyser.push({ groupe: g, cle: cle });
    }
    if (!aAnalyser.length) {
      afficherStatut('Ces photos ont déjà été analysées : aucune nouvelle analyse, aucun crédit consommé.', 'info');
      naviguerVers('annonces');
      return;
    }

    const moteur = await moteurDisponible();
    if (moteur.erreur) { afficherStatut(moteur.erreur, 'erreur'); return; }
    let cout = aAnalyser.length;
    let creditsAvant = null;
    if (moteur.moteur === 'backend') {
      const credits = await verifierCredits(aAnalyser.length);
      if (credits.erreur) { afficherStatut(credits.erreur, 'erreur'); return; }
      cout = credits.cout;
      creditsAvant = creditsRestants();
    }
    if (!confirm(aAnalyser.length + ' analyse(s) IA vont être lancées (' + cout + ' crédit(s))' +
      (dejaFaits.length ? ' ; ' + dejaFaits.length + ' groupe(s) déjà analysé(s) ignoré(s)' : '') + '. Continuer ?')) return;

    generationEnCours = true;
    rendreLive();
    $('#progression').hidden = false;
    $('#resultats-creation').hidden = true;
    const resultats = dejaFaits.map((t) => ({ ok: true, texte: 'Déjà analysé : ' + t + ' (aucun crédit)' }));
    let arret = false;

    for (let i = 0; i < aAnalyser.length && !arret; i++) {
      $('#progression-fill').style.width = Math.round((i / aAnalyser.length) * 100) + '%';
      $('#progression-texte').textContent = 'Article ' + (i + 1) + '/' + aAnalyser.length + '…';
      const { groupe, cle } = aAnalyser[i];
      try {
        const images = groupe.map((p) => urlPhoto(p).split(',')[1]);
        analysesTentees.add(cle);
        const annonce = await appelGenerer(images, precisions, 'lot' + Date.now().toString(36) + i);
        const b = await enregistrerBrouillon(annonce, vignetteDe(Studio.rendrePhoto(groupe[0])), images.length, cle, precisions);
        resultats.push({ ok: true, texte: b.titre });
      } catch (err) {
        resultats.push({ ok: false, texte: messageErreur(err) });
        if (['HTTP_403', 'NETWORK', 'NO_KEY', 'HTTP_401', 'HTTP_402', 'HTTP_429'].includes(err.code)) arret = true;
      }
    }

    generationEnCours = false;
    $('#progression').hidden = true;
    $('#liste-resultats').innerHTML = resultats.map((r) =>
      '<div class="champ-ligne ' + (r.ok ? 'rempli' : 'echec') + '"><span class="champ-nom">' + (r.ok ? '✓' : '✗') +
      '</span><span class="champ-etat">' + escapeHtml(r.texte) + '</span></div>').join('');
    $('#resultats-creation').hidden = false;

    let creditTexte = '';
    if (moteur.moteur === 'backend') {
      await actualiserCompte();
      const apres = creditsRestants();
      if (creditsAvant !== null && apres !== null) {
        creditTexte = apres < creditsAvant ? ' Crédits consommés : ' + (creditsAvant - apres) + ' (' + creditsAvant + ' → ' + apres + ').' : ' Aucun crédit consommé.';
      }
    }
    const reussies = resultats.filter((r) => r.ok).length - dejaFaits.length;
    if (reussies > 0) {
      afficherStatut(reussies + ' annonce(s) créée(s)' + (reussies < aAnalyser.length ? ', ' + (aAnalyser.length - reussies) + ' en échec.' : '.') + creditTexte, 'succes');
      if (reussies === aAnalyser.length) naviguerVers('annonces');
    } else {
      afficherStatut('Aucune annonce générée.' + creditTexte, 'erreur');
    }
    rafraichirVues();
    reprogrammerAutomatique();
  });

  // ========== MES ANNONCES ==========
  function rafraichirAnnonces() {
    let liste = brouillons;
    const filtre = $('#filtre-statut').value;
    const recherche = $('#recherche').value.trim();
    if (filtre) liste = Batch.filtrerBrouillons(liste, { statut: filtre });
    if (recherche) liste = Batch.filtrerBrouillons(liste, { recherche: recherche });
    liste = Batch.trierBrouillons(liste, 'date_desc');

    const listeEl = $('#liste-annonces');
    $('#actions-masse').hidden = true;
    if (!liste.length) {
      listeEl.innerHTML = '<p class="texte-vide">Aucune annonce trouvée.</p>';
      return;
    }
    listeEl.innerHTML = liste.map((b) =>
      '<div class="annonce-carte" data-id="' + escapeHtml(b.id) + '">' +
      '<input type="checkbox" class="annonce-select" data-id="' + escapeHtml(b.id) + '">' +
      '<img class="annonce-photo" src="' + escapeHtml(b.vignette || '') + '" alt="">' +
      '<div class="annonce-infos"><div class="annonce-titre">' + escapeHtml(b.titre || 'Sans titre') +
      '<span class="annonce-badge badge-' + escapeHtml(b.statut) + '">' + escapeHtml(b.statut) + '</span></div>' +
      '<div class="annonce-meta">' + escapeHtml(b.categorie || '') + (b.marque ? ' · ' + escapeHtml(b.marque) : '') +
      (b.aVerifier && b.aVerifier.length ? ' · ' + b.aVerifier.length + ' à vérifier' : '') + '</div>' +
      '<div class="annonce-prix">' + (b.prix ? b.prix + ' €' : '–') + '</div></div>' +
      '<div class="annonce-actions"><button type="button" class="btn-remplir" data-id="' + escapeHtml(b.id) + '">Remplir</button>' +
      '<button type="button" class="btn-editer" data-id="' + escapeHtml(b.id) + '">Éditer</button></div></div>'
    ).join('');

    $$('.annonce-select', listeEl).forEach((cb) => cb.addEventListener('change', majSelectionMasse));
    $$('.btn-remplir', listeEl).forEach((btn) => btn.addEventListener('click', () => remplirDepuisListe(btn.dataset.id)));
    $$('.btn-editer', listeEl).forEach((btn) => btn.addEventListener('click', () => editerBrouillon(btn.dataset.id)));
  }

  function majSelectionMasse() {
    const n = $$('.annonce-select:checked').length;
    $('#actions-masse').hidden = n === 0;
    $('#selection-count').textContent = n + ' sélectionné' + (n > 1 ? 's' : '');
  }

  $('#filtre-statut').addEventListener('change', rafraichirAnnonces);
  $('#recherche').addEventListener('input', rafraichirAnnonces);

  $('#appliquer-prix').addEventListener('click', async () => {
    const ids = $$('.annonce-select:checked').map((cb) => cb.dataset.id);
    if (!ids.length) return;
    const mode = $('#action-prix-mode').value;
    const type = mode === 'fixe' ? 'prix_fixe' : mode === 'ajouter' ? 'prix_ajouter' : 'prix_pourcentage';
    brouillons = Batch.modifierBrouillonsEnMasse(brouillons, ids, { type: type, valeur: parseFloat($('#action-prix-val').value) || 0 })
      .map((b) => (ids.indexOf(b.id) >= 0 ? Object.assign({}, b, { modifie: true }) : b));
    await sauvegarderBrouillons();
    rafraichirAnnonces();
    afficherStatut('Prix modifiés.', 'succes');
  });

  $('#supprimer-selection').addEventListener('click', async () => {
    const ids = new Set($$('.annonce-select:checked').map((cb) => cb.dataset.id));
    if (!ids.size || !confirm('Supprimer ' + ids.size + ' annonce(s) ?')) return;
    brouillons = brouillons.filter((b) => !ids.has(b.id));
    await sauvegarderBrouillons();
    rafraichirAnnonces();
    afficherStatut('Annonces supprimées.', 'succes');
  });

  async function editerBrouillon(id) {
    const b = brouillons.find((x) => x.id === id);
    if (!b) return;
    const titre = prompt('Titre', b.titre);
    if (titre === null) return;
    const prix = prompt('Prix (€)', b.prix || '');
    if (prix === null) return;
    b.titre = titre.trim().slice(0, 150) || b.titre;
    const p = Math.round(Number(String(prix).replace(',', '.')));
    if (isFinite(p) && p > 0) { b.prix = p; b.prix_suggere = p; }
    b.modifie = true;
    b.dateModification = Date.now();
    await sauvegarderBrouillons();
    rafraichirAnnonces();
  }

  async function remplirDepuisListe(id) {
    const b = brouillons.find((x) => x.id === id);
    if (!b) { afficherStatut('Annonce introuvable.', 'erreur'); return; }
    const tab = await ongletActifVinted();
    if (!tab) { afficherStatut('Ouvre la page Vinted « Vendre un article ».', 'erreur'); return; }
    const res = await remplirFormulaire(tab.id, b);
    if (res.erreur) { afficherStatut(res.erreur, 'erreur'); return; }
    const L = livePour(tab.id);
    L.brouillon = b;
    L.champs = res.champs;
    afficherStatut('Formulaire traité : ' + resumerChamps(res.champs) + '. Vérifie, puis publie toi-même.', 'succes');
  }

  // ========== RÉGLAGES ET COMPTE ==========
  const bornerDelai = (v) => Math.max(1, Math.min(60, parseInt(v, 10) || DELAI_DEFAUT_S));

  const CLES_PHOTO = ['photoFond', 'photoRedresser', 'photoOriginales', 'photoCouverture'];

  async function chargerReglages() {
    const d = await lire([
      'backendUrl', 'backendEmail', 'style', 'hashtags', 'signature', 'prixAjustement', 'prixArrondi', 'apiKey',
      'autoGenerer', 'autoRemplir', 'limiteAuto', 'consentementIA', 'claudeExplicite', 'delaiStabilisation', 'autoAmeliorer',
      'photoFond', 'photoRedresser', 'photoOriginales', 'photoCouverture'
    ]);
    const autoJamaisRegle = d.autoGenerer == null && d.consentementIA == null;
    const formule = (typeof d.signature === 'string' && d.signature.trim()) ? d.signature.trim() : IA.FORMULE_EXPEDITION;
    reglages = {
      autoGenerer: autoJamaisRegle ? true : (!!d.autoGenerer && !!d.consentementIA),
      autoRemplir: d.autoRemplir !== false,
      limiteAuto: Math.max(1, Math.min(100, parseInt(d.limiteAuto, 10) || 10)),
      consentementIA: autoJamaisRegle ? true : !!d.consentementIA,
      claudeExplicite: !!d.claudeExplicite,
      autoAmeliorer: d.autoAmeliorer === true,
      delaiS: bornerDelai(d.delaiStabilisation),
      photoFond: d.photoFond === true && d.photoFondChoisi === true,
      photoAuto: false,
      photoRedresser: d.photoRedresser !== false,
      photoOriginales: d.photoOriginales !== false,
      photoCouverture: d.photoCouverture === true
    };
    $('#backendUrl').value = d.backendUrl || IA.API_OFFICIELLE || '';
    $('#email').value = d.backendEmail || '';
    $('#style').value = d.style || 'normal';
    $('#hashtags').checked = d.hashtags !== false;
    $('#signature').value = formule;
    if (autoJamaisRegle || d.signature == null || !String(d.signature).trim()) {
      const memoire = {};
      if (autoJamaisRegle) {
        memoire.autoGenerer = true;
        memoire.consentementIA = true;
      }
      if (d.signature == null || !String(d.signature).trim()) memoire.signature = formule;
      chrome.storage.local.set(memoire);
    }
    $('#prixAjustement').value = d.prixAjustement || 0;
    $('#prixArrondi').value = d.prixArrondi || 1;
    $('#apiKey').value = d.apiKey || '';
    $('#autoGenerer').checked = reglages.autoGenerer;
    majAffichageAuto();
    $('#autoRemplir').checked = reglages.autoRemplir;
    $('#autoAmeliorer').checked = reglages.autoAmeliorer;
    for (const cle of CLES_PHOTO) $('#' + cle).checked = reglages[cle];
    $('#limiteAuto').value = reglages.limiteAuto;
    $('#delaiStabilisation').value = reglages.delaiS;
    $('#claudeExplicite').checked = reglages.claudeExplicite;
  }

  function majCompteUI() {
    const el = $('#compte-statut');
    const illimite = creditsIllimites();
    if (compte.connected) {
      const cr = creditsRestants();
      el.textContent = 'Connecté' + (compte.email ? ' : ' + compte.email : '') +
        (illimite ? ' — crédits illimités' : (cr !== null ? ' — ' + cr + ' crédit(s)' : '')) +
        (compte.testAccount ? ' (compte test)' : '') +
        (compte.ferme ? ' — accès fermé' : '');
      el.className = 'compte-statut connecte';
    } else {
      el.textContent = 'Non connecté';
      el.className = 'compte-statut deconnecte';
    }
    $('#deconnecter').hidden = !compte.connected;
    const header = $('#credits');
    header.hidden = !illimite && creditsRestants() === null;
    $('#credits-val').textContent = illimite ? 'Illimités' : creditsRestants();
    $('#credits-suite').textContent = illimite ? (compte.testAccount ? ' — Compte test' : '') : ' restants';
    $('#stat-credits').textContent = illimite ? 'Illimités' : (creditsRestants() === null ? '--' : creditsRestants());
    rafraichirCompteCarte();
  }

  function formaterUsd(v) {
    return String(Math.round((Number(v) || 0) * 10000) / 10000).replace('.', ',') + ' $';
  }

  // Carte « Compte et consommation » du tableau de bord : état réel, jamais plus optimiste que le serveur.
  function rafraichirCompteCarte() {
    const lignes = [];
    if (!compte.connected) {
      lignes.push(['Compte', 'Non connecté : connecte-toi dans Réglages', 'attention']);
    } else {
      lignes.push(['Compte', (compte.testAccount ? 'Compte test connecté : ' : 'Connecté : ') + (compte.email || ''), 'ok']);
      if (compte.ferme) lignes.push(['Accès à l\'IA', 'Fermé pour ce compte (configuration du serveur)', 'alerte']);
      else if (compte.hors_ligne) lignes.push(['Serveur', 'Injoignable ou indisponible', 'alerte']);
      if (creditsIllimites()) {
        lignes.push(['Crédits IA', 'Illimités' + (compte.testAccount ? ' — Compte test' : ''), 'ok']);
        const s = compte.credits.spend;
        if (s) {
          lignes.push(['Dépense estimée aujourd\'hui', formaterUsd(s.today_usd) + ' / plafond ' + formaterUsd(s.daily_cap_usd), 'ok']);
          lignes.push(['Dépense estimée ce mois', formaterUsd(s.month_usd) + ' · ' + s.analyses_month + ' analyse(s)', 'ok']);
        }
      } else if (creditsRestants() !== null) {
        lignes.push(['Crédits IA', creditsRestants() + ' restant(s)', creditsRestants() > 0 ? 'ok' : 'alerte']);
      }
    }
    $('#compte-bilan').innerHTML = lignes
      .map((l) => '<li class="' + l[2] + '"><span>' + escapeHtml(l[0]) + '</span><span>' + escapeHtml(l[1]) + '</span></li>')
      .join('');
  }

  function reautoriserAutomatique() {
    lives.forEach((L) => { L.ignoree = ''; });
    reprogrammerAutomatique();
  }

  $('#connecter').addEventListener('click', async () => {
    const url = $('#backendUrl').value.trim();
    const email = $('#email').value.trim();
    const mdp = $('#password').value;
    if (!url || !email || !mdp) { afficherStatut('Remplis tous les champs.', 'erreur'); return; }
    const rep = await envoyer({ type: 'authLogin', email: email, password: mdp, backendUrl: url });
    $('#password').value = '';
    if (!rep.ok) {
      afficherStatut(messageErreur({ code: rep.code, serverCode: rep.serverCode, message: rep.error }).replace(' Aucune annonce n\'a été générée.', ''), 'erreur');
      return;
    }
    compte = { connected: true, email: rep.data.email, credits: rep.data.credits || null, testAccount: !!rep.data.testAccount };
    majCompteUI();
    afficherStatut('Connecté.', 'succes');
    reautoriserAutomatique();
  });

  $('#deconnecter').addEventListener('click', async () => {
    await envoyer({ type: 'authLogout' });
    compte = { connected: false, email: '', credits: null };
    majCompteUI();
    afficherStatut('Déconnecté.', 'info');
  });

  // Diagnostic : aucune identification, aucune IA, aucun crédit
  $('#diagnostic-serveur').addEventListener('click', async () => {
    const zone = $('#diagnostic-resultat');
    zone.hidden = false;
    zone.textContent = 'Diagnostic en cours…';
    const rep = await envoyer({ type: 'pingServeur' });
    if (!rep.ok || !rep.data) { zone.textContent = 'Diagnostic impossible : ' + (rep.error || 'erreur inconnue'); return; }
    const r = rep.data;
    if (!r.joignable) { zone.textContent = 'Serveur injoignable (' + r.url + '). Aucune analyse n\'est possible.'; return; }
    const ouverture = r.ferme === true
      ? (r.accesTest === true
        ? 'service fermé au public, accès réservé au compte de test (c\'est voulu : le serveur répond, ce n\'est pas une panne)'
        : 'service fermé aux connexions et aucun compte de test configuré côté serveur : aucune génération possible depuis Chrome')
      : r.ferme === false ? 'service ouvert aux connexions'
        : 'ouverture du service indéterminée';
    const openai = r.openaiConfigure === true ? 'clé OpenAI présente côté serveur (fonctionnement non vérifié)'
      : r.openaiConfigure === false ? 'clé OpenAI absente côté serveur' : 'état OpenAI inconnu';
    zone.textContent = 'Serveur joignable · ' + ouverture + ' · ' + openai + '. Aucune analyse lancée, aucun crédit utilisé.';
  });

  $('#tester-cle').addEventListener('click', async () => {
    const cle = $('#apiKey').value.trim();
    if (!cle) { afficherStatut('Entre une clé API.', 'erreur'); return; }
    const rep = await envoyer({ type: 'testKey', apiKey: cle });
    afficherStatut(rep.ok ? 'Clé valide.' : (rep.error || 'Clé invalide.'), rep.ok ? 'succes' : 'erreur');
  });

  $('#sauvegarder').addEventListener('click', async () => {
    reglages.autoRemplir = $('#autoRemplir').checked;
    reglages.autoAmeliorer = $('#autoAmeliorer').checked;
    for (const cle of CLES_PHOTO) reglages[cle] = $('#' + cle).checked;
    reglages.limiteAuto = Math.max(1, Math.min(100, parseInt($('#limiteAuto').value, 10) || 10));
    reglages.delaiS = bornerDelai($('#delaiStabilisation').value);
    reglages.claudeExplicite = $('#claudeExplicite').checked;
    await chrome.storage.local.set({
      style: $('#style').value,
      hashtags: $('#hashtags').checked,
      signature: $('#signature').value.trim(),
      prixAjustement: parseInt($('#prixAjustement').value, 10) || 0,
      prixArrondi: parseInt($('#prixArrondi').value, 10) || 1,
      apiKey: $('#apiKey').value.trim(),
      autoRemplir: reglages.autoRemplir,
      autoAmeliorer: reglages.autoAmeliorer,
      photoFond: reglages.photoFond,
      photoFondChoisi: true,
      photoAuto: false,
      photoRedresser: reglages.photoRedresser,
      photoOriginales: reglages.photoOriginales,
      photoCouverture: reglages.photoCouverture,
      limiteAuto: reglages.limiteAuto,
      delaiStabilisation: reglages.delaiS,
      claudeExplicite: reglages.claudeExplicite
    });
    afficherStatut('Réglages enregistrés.', 'succes');
    reautoriserAutomatique();
  });

  // Mode automatique : activé volontairement, avec information claire sur l'envoi des photos et les crédits
  // Un seul interrupteur logique, deux cases (tableau de bord et Réglages) toujours synchronisées.
  function majAffichageAuto() {
    $('#autoGenerer').checked = reglages.autoGenerer;
    $('#auto-dashboard').checked = reglages.autoGenerer;
    $('#auto-etat').textContent = reglages.autoGenerer
      ? 'Activée : déposer des photos sur Vinted lance seul l\'analyse, puis remplit le formulaire (jamais de publication).'
      : 'Désactivée : les photos ne sont pas envoyées à l\'IA.';
  }

  async function changerModeAuto(active) {
    if (active) {
      const limite = Math.max(1, Math.min(100, parseInt($('#limiteAuto').value, 10) || reglages.limiteAuto || 10));
      const delai = bornerDelai($('#delaiStabilisation').value);
      const cout = creditsIllimites()
        ? '• Compte de test : analyses automatiques illimitées, sans quota de crédits\n'
        : '• Chaque analyse consomme des crédits\n';
      const accord = confirm(
        'Mode automatique\n\n' +
        'Quand les photos de ton formulaire Vinted ne changent plus pendant ' + delai + ' s, Annonce Futée les ENVOIE ' +
        'à notre service d\'IA (OpenAI via ton serveur Annonce Futée) pour rédiger l\'annonce, une seule fois par ensemble de photos.\n\n' +
        cout +
        (creditsIllimites() ? '' : '• Maximum ' + limite + ' analyses automatiques par jour\n') +
        '• Tu peux interrompre à tout moment depuis le panneau, et désactiver ce mode quand tu veux\n' +
        '• Tes saisies manuelles ne sont jamais écrasées sans ta confirmation\n' +
        '• Rien n\'est jamais publié automatiquement\n\nActiver ?');
      if (!accord) { majAffichageAuto(); return; }
      reglages.autoGenerer = true;
      reglages.consentementIA = true;
      reglages.limiteAuto = limite;
      reglages.delaiS = delai;
      await chrome.storage.local.set({ autoGenerer: true, consentementIA: true, limiteAuto: limite, delaiStabilisation: delai });
      majAffichageAuto();
      afficherStatut('Mode automatique activé.', 'succes');
      await synchroniser(true);
      reautoriserAutomatique();
    } else {
      reglages.autoGenerer = false;
      reglages.consentementIA = false;
      lives.forEach(annulerMinuteur);
      await chrome.storage.local.set({ autoGenerer: false, consentementIA: false });
      majAffichageAuto();
      afficherStatut('Mode automatique désactivé.', 'info');
    }
    rendreLive();
  }

  $('#autoGenerer').addEventListener('change', (e) => garder('Mode automatique', () => changerModeAuto(e.target.checked)));
  $('#auto-dashboard').addEventListener('change', (e) => garder('Mode automatique', () => changerModeAuto(e.target.checked)));

  $('#autoRemplir').addEventListener('change', async (e) => {
    reglages.autoRemplir = e.target.checked;
    await chrome.storage.local.set({ autoRemplir: reglages.autoRemplir });
  });

  // ========== PRÉSENTATION DES PHOTOS (fond blanc, redressement, ajout au formulaire) ==========
  const Detourage = globalThis.AnnonceFuteeDetourage || null;
  const MAX_DEPOT = 10;
  const depot = { enCours: false, elements: [], message: '', erreur: false, choix: 0 };

  function rendreDepot() {
    if (depot.choix >= depot.elements.length || !sourcePhotoIA(depot.choix)) {
      depot.choix = Math.max(0, depot.elements.findIndex((el) => el.avant));
    }
    poser($('#depot-liste'), depot.elements.map((el, i) => {
      const image = el.apres || el.avant || el.vue;
      return '<figure class="depot-photo' + (el.etat === 'en-cours' ? ' en-cours' : '') +
        (i === depot.choix && el.avant ? ' choisie' : '') + (el.avant ? ' cliquable' : '') + '" data-i="' + i + '">' +
        (image ? '<img src="' + image + '" alt="">' : '<span class="depot-vide"></span>') +
        '<figcaption>' + escapeHtml(el.note) + '</figcaption></figure>';
    }).join(''));
    rendrePhotoIA();
    const msg = $('#depot-message');
    msg.hidden = !depot.message;
    msg.textContent = depot.message;
    msg.className = 'depot-message' + (depot.erreur ? ' erreur' : '');
    $('#depot-zone').disabled = depot.enCours;
    const demandeFond = $('#fond-blanc-demande');
    if (demandeFond) demandeFond.disabled = depot.enCours;
    const aEnregistrer = depot.elements.some((el) => el.avant || el.apres);
    $('#depot-enregistrer').hidden = depot.enCours || !aEnregistrer || (!depot.erreur && !depot.elements.some((el) => el.apres));
  }

  function direDepot(texte, erreur = false) {
    depot.message = texte;
    depot.erreur = erreur;
    rendreDepot();
  }

  function listeDepot() {
    const origines = depot.elements.map((el) => el.avant).filter(Boolean);
    const blanches = depot.elements.map((el) => el.apres).filter(Boolean);
    if (!blanches.length) return origines;
    if (!reglages.photoOriginales) return depot.elements.map((el) => el.apres || el.avant).filter(Boolean);
    return reglages.photoCouverture ? blanches.concat(origines) : origines.concat(blanches);
  }

  async function presenterEtEnvoyer(fichiers) {
    if (depot.enCours) return;
    const images = Array.from(fichiers || []).filter((f) => f && /^image\//.test(f.type || ''));
    if (!images.length) return;
    if (!Detourage) { direDepot('Préparation des photos indisponible. Recharge l\'extension.', true); return; }
    const tab = await ongletActifVinted();
    if (!tab) { direDepot('Ouvre d\'abord « Vendre un article » sur Vinted, puis dépose tes photos.', true); return; }

    depot.enCours = true;
    depot.elements = [];
    direDepot(images.length > MAX_DEPOT ? 'Seules les ' + MAX_DEPOT + ' premières photos sont préparées.' : '');
    try {
      for (const fichier of images.slice(0, MAX_DEPOT)) {
        const el = { etat: 'en-cours', avant: '', apres: '', note: 'Préparation…' };
        depot.elements.push(el);
        rendreDepot();
        let bitmap = null;
        try {
          bitmap = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
          el.avant = Detourage.originale(bitmap).toDataURL('image/jpeg', 0.9);
          el.note = 'Photo d\'origine';
          if (reglages.photoFond !== false) {
            const rendu = await Detourage.presenter(bitmap, { redresser: reglages.photoRedresser !== false });
            if (rendu && rendu.ok && rendu.canvas) {
              el.apres = rendu.canvas.toDataURL('image/jpeg', 0.9);
              el.note = rendu.angle ? 'Origine et fond blanc, redressée' : 'Origine et fond blanc';
            }
          }
        } catch (e) {
          console.warn('[AF] Préparation de photo :', e);
          el.note = el.avant ? 'Gardée telle quelle : détourage impossible' : 'Photo illisible, ignorée';
        } finally {
          if (bitmap && bitmap.close) bitmap.close();
        }
        el.etat = 'pret';
        rendreDepot();
      }

      const liste = listeDepot();
      if (!liste.length) { direDepot('Aucune photo lisible.', true); return; }
      const uniques = depot.elements.filter((el) => el.avant).length;
      const rep = await versOnglet(tab.id, {
        type: 'addPhotos',
        images: liste.map((url, i) => ({ b64: url.split(',')[1], nom: 'photo-' + (i + 1) + '.jpg' }))
      });
      if (!rep || !rep.ok) {
        direDepot(((rep && rep.error) || 'Impossible de joindre la page Vinted. Actualise-la (F5).') +
          ' Tes photos sont prêtes : enregistre-les puis ajoute-les à la main.', true);
        return;
      }
      livePour(tab.id).depot = { total: rep.nb, uniques: Math.min(uniques, rep.nb) };
      const B = etatBlanc(tab.id);
      for (const el of depot.elements) {
        if (!el.apres) continue;
        const blanche = await signatureVisuelle(el.apres.split(',')[1]);
        const origine = el.avant ? await signatureVisuelle(el.avant.split(',')[1]) : '';
        if (blanche) B.resultats.push(blanche);
        if (origine) B.resultats.push(origine);
        const doublon = reglages.photoOriginales === false ? '' : (reglages.photoCouverture ? origine : blanche);
        if (doublon) B.doublons.push(doublon);
      }
      B.jusqua = Date.now() + DELAI_APPARITION_MS;
      setTimeout(reprogrammerAutomatique, DELAI_APPARITION_MS + 100);
      direDepot(rep.nb + ' photo' + (rep.nb > 1 ? 's ajoutées' : ' ajoutée') + ' au formulaire Vinted.');
    } finally {
      depot.enCours = false;
      rendreDepot();
    }
  }

  // ----- Photos IA (studio, portée) : image recréée par le serveur, à la demande et payante -----
  const LIBELLES_IA = {
    studio: 'studio', mannequin_femme: 'portée femme', mannequin_homme: 'portée homme',
    enfant: 'enfant', bebe: 'bébé', chien: 'chien', chat: 'chat', objet: 'fond objet', fond_blanc: 'fond blanc'
  };
  const COTE_SOURCE_IA = 1280;

  function sourcePhotoIA(i) {
    const el = depot.elements[i];
    return el && el.avant ? el.avant : '';
  }

  function coutPhotoIA() {
    const c = compte.credits && Number(compte.credits.photo_cost);
    return c > 0 ? c : null;
  }

  function rendrePhotoIA() {
    const bloc = $('#photo-ia');
    const dispo = depot.elements.some((el) => el.avant);
    bloc.hidden = !dispo;
    if (!dispo) return;
    const cout = coutPhotoIA();
    const credits = cout ? cout + ' crédits' : 'des crédits';
    $('#photo-ia-cout').textContent = '· utilise ' + credits;
    $('#photo-ia-aide').textContent = compte.connected
      ? 'Chaque image est recréée par l\'IA et utilise ' + credits + ', puis elle est ajoutée dans Vinted. Vérifie qu\'elle reste fidèle à l\'article. Enfant et bébé : le visage est créé par l\'IA, ce n\'est pas une vraie personne.'
      : 'Connecte-toi à ton compte dans Réglages. Chaque image utilise ' + credits + '.';
    bloc.querySelectorAll('button[data-mode]').forEach((b) => { b.disabled = depot.enCours || !compte.connected; });
  }

  async function reduireJpeg(url, cote) {
    const image = await chargerImage(url);
    const ratio = Math.min(1, cote / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    c.height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(image, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  // L'appel part du panneau : une image peut demander plus de 30 secondes, durée au-delà de laquelle
  // Chrome arrête le service de fond d'une extension.
  function textePhotoIA(json, status) {
    const code = json && typeof json.code === 'string' ? json.code : '';
    if (code === 'cost_ceiling') return 'Limite du jour atteinte. La photo n\'a pas été créée. Réessayez demain.';
    if (code === 'photo_refused') return 'L\'IA a refusé cette photo. Choisissez un autre mode.';
    if (code === 'photo_in_progress') return 'Une photo IA est déjà en cours.';
    const texte = json && json.message ? String(json.message).replace(/\s+/g, ' ').trim().slice(0, 180) : '';
    return texte || ('Le serveur n\'a pas pu créer la photo (' + status + ').');
  }

  async function demanderPhotoIA(b64, mode) {
    const d = await chrome.storage.local.get(['backendUrl', 'backendToken']);
    if (!d.backendToken) throw new Error('Connecte-toi à ton compte dans Réglages pour créer des photos IA.');
    const url = IA.urlApi(d.backendUrl || IA.API_OFFICIELLE, '/api/v1/photos/enhance');
    let reponse;
    try {
      reponse = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(170000),
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + d.backendToken },
        body: JSON.stringify({ image: b64, mode: mode })
      });
    } catch (e) {
      throw new Error(e && e.name === 'TimeoutError'
        ? 'Le serveur n\'a pas répondu à temps. Vérifie tes crédits avant de réessayer.'
        : 'Connexion impossible au serveur.');
    }
    let json = null;
    try { json = await reponse.json(); } catch (e) { json = null; }
    if (reponse.status === 401) throw new Error('Session expirée. Reconnecte-toi dans Réglages.');
    if (reponse.status === 404) throw new Error('Ce serveur ne propose pas encore les photos IA : il doit être mis à jour.');
    if (!reponse.ok || !json || !json.data || typeof json.data.image !== 'string') {
      throw new Error(textePhotoIA(json, reponse.status));
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(json.data.image)) throw new Error('Image reçue illisible.');
    return json.data.image;
  }

  async function lancerPhotoIA(mode) {
    if (depot.enCours || !LIBELLES_IA[mode]) return;
    const source = sourcePhotoIA(depot.choix);
    if (!source) return;
    if (!compte.connected) { direDepot('Connecte-toi à ton compte dans Réglages pour créer des photos IA.', true); return; }
    const tab = await ongletActifVinted();
    if (!tab) { direDepot('Ouvre d\'abord « Vendre un article » sur Vinted.', true); return; }

    depot.enCours = true;
    const el = { etat: 'en-cours', avant: '', apres: '', vue: source, note: 'Photo IA en cours, jusqu\'à une minute…', ia: true };
    depot.elements.push(el);
    direDepot('');
    try {
      const image = await demanderPhotoIA(await reduireJpeg(source, COTE_SOURCE_IA), mode);
      el.apres = 'data:image/jpeg;base64,' + image;
      el.etat = 'pret';
      el.note = 'Photo IA, ' + LIBELLES_IA[mode];
      rendreDepot();
      const ajout = await versOnglet(tab.id, { type: 'addPhotos', images: [{ b64: image, nom: 'photo-ia-' + mode + '.jpg' }] });
      if (ajout && ajout.ok) {
        const B = etatBlanc(tab.id);
        B.attente += ajout.nb;
        B.jusqua = Date.now() + DELAI_APPARITION_MS;
        setTimeout(reprogrammerAutomatique, DELAI_APPARITION_MS + 100);
        direDepot('Photo IA ajoutée au formulaire Vinted. Vérifie qu\'elle est fidèle à l\'article et précise dans ta description que c\'est une image générée.');
      } else {
        direDepot(((ajout && ajout.error) || 'Impossible de joindre la page Vinted.') + ' La photo IA est prête : enregistre-la puis ajoute-la à la main.', true);
      }
    } catch (e) {
      el.etat = 'echec';
      el.note = e && e.message ? e.message : 'Photo IA impossible.';
      direDepot(el.note, true);
    } finally {
      depot.enCours = false;
      rendreDepot();
      actualiserCompte().then(rendrePhotoIA, () => {});
    }
  }

  $('#photo-ia').addEventListener('click', (e) => {
    const bouton = e.target.closest ? e.target.closest('button[data-mode]') : null;
    if (bouton && !bouton.disabled) garder('Photo IA', () => lancerPhotoIA(bouton.dataset.mode));
  });
  $('#depot-liste').addEventListener('click', (e) => {
    const figure = e.target.closest ? e.target.closest('.depot-photo.cliquable') : null;
    if (!figure || depot.enCours) return;
    depot.choix = Number(figure.dataset.i) || 0;
    rendreDepot();
  });

  // ----- Photos ajoutées directement dans le formulaire Vinted -----
  // Chaque nouvelle photo du formulaire reçoit sa version sur fond blanc, ajoutée à la suite.
  // Les versions ajoutées par l'extension sont reconnues à leur retour : elles ne sont jamais retraitées.
  async function fondBlancAuto(L, tab) {
    if (!L.photos.length) { direDepot('Ajoute d\'abord une photo.', true); return; }
    const B = etatBlanc(tab.id);
    if (!B.resultats) B.resultats = [];
    if (B.enCours || depot.enCours) { direDepot('Un détourage est déjà en cours.', true); return; }
    if (!Detourage) { direDepot('Détourage indisponible. Recharge l\'extension.', true); return; }
    if (!/\/items\/(new|\d+\/edit)/.test(tab.url || '')) {
      direDepot('Ouvre la page Vinted « Vendre un article ».', true);
      return;
    }

    const photos = L.photos.slice();
    const signatures = new Map();
    const aTraiter = [];
    for (const p of photos) {
      if (B.generees.has(p.fp)) continue;
      const s = await signatureVisuelle(p.b64);
      signatures.set(p, s);
      if (B.resultats.some((v) => distanceSignature(v, s) <= SEUIL_MEME_PHOTO)) continue;
      aTraiter.push(p);
    }
    if (!aTraiter.length) {
      direDepot('Ces photos ont déjà un fond blanc.', true);
      afficherStatut('Ces photos ont déjà un fond blanc.', 'info');
      return;
    }
    B.enCours = true;
    annulerMinuteur(L);
    depot.enCours = true;
    depot.elements = [];
    direDepot('Détourage en cours…');
    try {
      // Les photos sont relues en meilleure définition que pour l'analyse.
      let nettes = null;
      const rep = await versOnglet(tab.id, { type: 'collectPhotos', cote: Detourage.COTE_MAX });
      if (rep && rep.ok && Array.isArray(rep.images) && rep.images.length === photos.length) nettes = rep.images;

      const blanches = [];
      for (const p of aTraiter) {
        const el = { etat: 'en-cours', avant: 'data:image/jpeg;base64,' + p.b64, apres: '', note: 'Préparation…' };
        depot.elements.push(el);
        rendreDepot();
        try {
          const b64 = nettes ? nettes[photos.indexOf(p)] : p.b64;
          const image = await chargerImage('data:image/jpeg;base64,' + b64);
          const res = await Detourage.presenter(image, { redresser: reglages.photoRedresser });
          if (res.ok) {
            el.apres = res.canvas.toDataURL('image/jpeg', 0.9);
            el.note = res.angle ? 'Fond blanc, redressée' : 'Fond blanc';
            const signature = await signatureVisuelle(el.apres.split(',')[1]);
            if (signature) B.resultats.push(signature);
            B.generees.add(p.fp);
            blanches.push(el.apres);
          } else {
            el.note = 'Gardée telle quelle : ' + res.raison;
          }
        } catch (e) {
          console.warn('[AF] Fond blanc :', e);
          el.note = 'Gardée telle quelle : détourage impossible';
        }
        el.etat = 'pret';
        rendreDepot();
      }

      if (blanches.length) {
        const ajout = await versOnglet(tab.id, {
          type: 'addPhotos',
          images: blanches.map((url, i) => ({ b64: url.split(',')[1], nom: 'fond-blanc-' + (i + 1) + '.jpg' }))
        });
        if (ajout && ajout.ok) {
          const nb = Number(ajout.nb) || blanches.length;
          B.attente += nb;
          B.plafond = Math.max(B.plafond || 0, photos.length + nb);
          B.jusqua = Date.now() + DELAI_APPARITION_MS;
          setTimeout(reprogrammerAutomatique, DELAI_APPARITION_MS + 100);
          const texte = nb + (nb > 1 ? ' versions sur fond blanc ajoutées' : ' version sur fond blanc ajoutée') + ' au formulaire Vinted.';
          direDepot(texte);
          afficherStatut(texte, 'succes');
        } else {
          const texte = ((ajout && ajout.error) || 'Impossible de joindre la page Vinted.') +
            ' Les versions sur fond blanc sont prêtes : enregistre-les puis ajoute-les à la main.';
          direDepot(texte, true);
          afficherStatut(texte, 'erreur');
        }
      } else {
        direDepot('Le détourage n\'a pas pu isoler l\'article.', true);
        afficherStatut('Le détourage n\'a pas pu isoler l\'article.', 'erreur');
      }
    } finally {
      B.enCours = false;
      depot.enCours = false;
      rendreDepot();
      if (B.aRefaire) { B.aRefaire = false; synchroniser(true); }
      reprogrammerAutomatique();
    }
  }

  $('#fond-blanc-demande').addEventListener('click', () => garder('Fond blanc', () => {
    if (!sourcePhotoIA(depot.choix)) {
      direDepot('Dépose une photo ici, puis clique dessus pour la choisir.', true);
      afficherStatut('Choisis d\'abord une photo dans le panneau.', 'erreur');
      return;
    }
    return lancerPhotoIA('fond_blanc');
  }));
  $('#depot-zone').addEventListener('click', () => $('#depot-fichiers').click());
  $('#depot-fichiers').addEventListener('change', (e) => garder('Photos', () => {
    const fichiers = Array.from(e.target.files || []);
    e.target.value = '';
    return presenterEtEnvoyer(fichiers);
  }));
  ['dragenter', 'dragover'].forEach((type) => $('#depot').addEventListener(type, (e) => {
    e.preventDefault();
    $('#depot-zone').classList.add('survol');
  }));
  ['dragleave', 'drop'].forEach((type) => $('#depot').addEventListener(type, (e) => {
    e.preventDefault();
    $('#depot-zone').classList.remove('survol');
  }));
  $('#depot').addEventListener('drop', (e) => garder('Photos', () =>
    presenterEtEnvoyer(e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [])));
  $('#depot-enregistrer').addEventListener('click', () => {
    listeDepot().forEach((url, i) => {
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = 'annonce-photo-' + (i + 1) + '.jpg';
      lien.click();
    });
  });
  // Le modèle est préparé à l'ouverture du panneau : la première photo n'attend pas son chargement.
  if (Detourage && Detourage.disponible()) setTimeout(() => { Detourage.charger().catch(() => {}); }, 600);

  // ========== DÉMARRAGE ==========
  try { $('#version').textContent = chrome.runtime.getManifest().version; } catch (e) { /* version inconnue */ }
  // La vue initiale est affichée tout de suite : si l'utilisateur change d'onglet pendant le chargement
  // des données, sa navigation n'est jamais écrasée (les vues sont simplement rafraîchies à la fin).
  naviguerVers('dashboard');
  await chargerReglages();
  await chargerBrouillons();
  brouillons.forEach((b) => { if (b.cle) analysesTentees.add(b.cle); });
  await chargerEnvois();
  await chargerAtelier();
  rafraichirVues();
  const compteLocal = await lire(['backendToken', 'backendEmail']);
  if (compteLocal.backendToken) {
    compte = { connected: true, email: compteLocal.backendEmail || '', credits: null };
    majCompteUI();
    garder('Lecture du compte', () => actualiserCompte());
  }
  synchroniser(true);
})();
