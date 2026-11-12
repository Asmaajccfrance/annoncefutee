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

  const MSG_FERME = 'Serveur indisponible : le service n\'est pas ouvert pour le moment. Aucune annonce n\'a été générée.';
  const MSG_RESEAU = 'Serveur indisponible : connexion impossible. Aucune annonce n\'a été générée.';
  const PAGE_VENTE = /^https:\/\/www\.vinted\.fr\/items\/(new|\d+\/edit)/;
  const COTE_MAX = 1024;
  const MAX_BROUILLONS_STOCKES = 200;

  // ========== ÉTAT ==========
  const etat = { albumId: null, photoActiveId: null, retouche: null, recadrage: null, section: 'dashboard' };
  let brouillons = [];
  let reglages = {
    autoGenerer: false, autoRemplir: true, limiteAuto: 10, consentementIA: false, claudeExplicite: false
  };
  let compte = { connected: false, email: '', credits: null };

  const live = {
    tabId: null,
    hashPage: '',
    photos: [],            // [{ fp, b64 }] : état courant du formulaire Vinted
    cle: '',               // empreinte de l'ensemble des photos
    etapes: {},            // photos | retouches | generation | remplissage -> '' | 'en-cours' | 'fait' | 'erreur'
    message: '',
    erreur: false,
    brouillon: null,       // annonce générée pour la clé courante
    champs: null           // états de remplissage par champ
  };

  let generationEnCours = false;
  let syncEnCours = false;
  let syncDemandee = false;
  let syncForcee = false;
  let minuteurAuto = null;
  let minuteurStatut = null;
  const analysesTentees = new Set();   // ensembles de photos déjà envoyés à l'IA (jamais deux fois)
  const fpParPhoto = new Map();        // id photo atelier -> empreinte (photos venant de Vinted)
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

  function messageErreur(err) {
    const code = err && err.code;
    if (code === 'HTTP_403') return MSG_FERME;
    if (code === 'NETWORK') return MSG_RESEAU;
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
  function assurerAlbum() {
    if (!etat.albumId) etat.albumId = Studio.creerAlbumAvecId('Atelier').id;
    return etat.albumId;
  }

  function photosAlbum() {
    return etat.albumId ? Studio.listerPhotos(etat.albumId) : [];
  }

  function photoActive() {
    return photosAlbum().find((p) => p.id === etat.photoActiveId) || null;
  }

  async function ajouterDepuisUrl(url, nom, fp) {
    const id = assurerAlbum();
    if (photosAlbum().length >= Studio.MAX_ATELIER) throw new Error('Huit photos au maximum dans l\'atelier.');
    const pixels = await urlVersPixels(url);
    const album = Studio.ajouterPhotoParId(id, pixels, nom);
    const photo = album.photos[album.photos.length - 1];
    if (fp) fpParPhoto.set(photo.id, fp);
    return photo;
  }

  // ========== PERSISTANCE DES BROUILLONS ==========
  async function chargerBrouillons() {
    try {
      const data = await lire(['brouillons']);
      const liste = Array.isArray(data.brouillons) ? data.brouillons : [];
      brouillons = liste.filter(Boolean).map((b) => {
        const { photos, photoUrl, ...reste } = b;
        if (!reste.vignette && typeof photoUrl === 'string' && photoUrl.length < 40000) reste.vignette = photoUrl;
        return reste;
      });
    } catch (e) {
      brouillons = [];
    }
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

  async function enregistrerBrouillon(annonce, vignette, nbPhotos, cle) {
    const aVerifier = Array.isArray(annonce.a_verifier) ? annonce.a_verifier : [];
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
      vignette: vignette || '',
      nbPhotos: nbPhotos || 0,
      cle: cle || '',
      statut: aVerifier.length ? 'brouillon' : 'pret',
      dateCreation: Date.now(),
      dateModification: Date.now(),
      plateforme: 'vinted'
    };
    brouillons.push(b);
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
    $('#stat-credits').textContent = cr === null ? '--' : cr;
    rendreLive();

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

  // ========== CARTE « FORMULAIRE VINTED » ==========
  const LIBELLES = {
    titre: 'Titre', description: 'Description', prix: 'Prix', categorie: 'Catégorie',
    sousCategorie: 'Sous-catégorie', marque: 'Marque', taille: 'Taille / pointure',
    etat: 'État', couleurs: 'Couleurs', matiere: 'Matière'
  };
  const TEXTE_ETAT = {
    rempli: 'Rempli ✓', deja: 'Déjà renseigné', a_choisir: 'À choisir toi-même',
    echec: 'Échec — à saisir', introuvable: 'Champ introuvable', manuel: 'À renseigner',
    absent: 'Non détecté par l\'IA'
  };

  function definirEtapes(valeurs) {
    live.etapes = Object.assign({ photos: '', retouches: '', generation: '', remplissage: '' }, valeurs);
    rendreLive();
  }

  function etape(nom, valeur) {
    live.etapes[nom] = valeur;
    rendreLive();
  }

  function messageLive(texte, erreur = false) {
    live.message = texte;
    live.erreur = erreur;
    rendreLive();
  }

  function echecLive(texte) {
    const enCours = Object.keys(live.etapes).find((k) => live.etapes[k] === 'en-cours');
    if (enCours) live.etapes[enCours] = 'erreur';
    messageLive(texte, true);
  }

  function rendreLive() {
    const badge = $('#live-badge');
    const nb = live.photos.length;
    let texte = 'Aucune photo';
    let classe = 'live-badge';
    if (generationEnCours) { texte = 'En cours…'; classe += ' actif'; }
    else if (live.erreur) { texte = 'Erreur'; classe += ' erreur'; }
    else if (live.brouillon && live.champs) { texte = 'Prête'; classe += ' ok'; }
    else if (live.brouillon) { texte = 'Générée'; classe += ' ok'; }
    else if (nb > 0) { texte = nb + ' photo' + (nb > 1 ? 's' : ''); classe += ' actif'; }
    badge.textContent = texte;
    badge.className = classe;

    $('#live-photos').innerHTML = live.photos
      .map((p) => '<img src="data:image/jpeg;base64,' + p.b64 + '" alt="Photo du formulaire">')
      .join('');

    const aEtapes = Object.values(live.etapes).some(Boolean);
    $('#live-etapes').hidden = !aEtapes;
    $$('#live-etapes li').forEach((li) => {
      li.className = live.etapes[li.dataset.etape] || '';
    });

    const msgEl = $('#live-message');
    msgEl.textContent = live.message;
    msgEl.className = 'live-message' + (live.erreur ? ' erreur' : '');

    $('#live-champs').innerHTML = (live.champs || []).map((c) =>
      '<div class="champ-ligne ' + c.etat + '"><span class="champ-nom">' + escapeHtml(c.nom) + '</span>' +
      '<span class="champ-etat">' + escapeHtml(TEXTE_ETAT[c.etat] || c.etat) +
      (c.valeur && (c.etat === 'manuel' || c.etat === 'echec' || c.etat === 'a_choisir') ? ' : ' + escapeHtml(c.valeur) : '') +
      '</span></div>'
    ).join('');

    const gen = $('#live-generer');
    gen.hidden = generationEnCours || nb === 0;
    gen.textContent = live.brouillon || live.erreur ? 'Régénérer l\'annonce' : 'Générer l\'annonce';
    $('#live-remplir').hidden = generationEnCours || !live.brouillon || !live.tabId;
  }

  function reinitialiserLive() {
    live.etapes = {};
    live.message = '';
    live.erreur = false;
    live.brouillon = null;
    live.champs = null;
  }

  // ========== SYNCHRONISATION AVEC LE FORMULAIRE VINTED ==========
  async function trouverOngletVinted() {
    if (live.tabId !== null) {
      try {
        const t = await chrome.tabs.get(live.tabId);
        if (t && PAGE_VENTE.test(t.url || '')) return t;
      } catch (e) { /* onglet fermé */ }
    }
    try {
      const [actif] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (actif && PAGE_VENTE.test(actif.url || '')) return actif;
    } catch (e) { /* aucun onglet */ }
    return null;
  }

  function retirerPhotosVintedDeLAtelier(garder) {
    if (!etat.albumId) return;
    for (const [photoId, fp] of Array.from(fpParPhoto.entries())) {
      if (garder && garder.has(fp)) continue;
      Studio.supprimerPhoto(etat.albumId, photoId);
      fpParPhoto.delete(photoId);
      photosAmeliorees.delete(photoId);
      if (etat.photoActiveId === photoId) etat.photoActiveId = null;
    }
  }

  function synchroniser(forcer = false) {
    if (forcer) syncForcee = true;
    if (syncEnCours) {
      syncDemandee = true;
      return Promise.resolve();
    }
    syncEnCours = true;
    return (async () => {
      try {
        do {
          syncDemandee = false;
          const force = syncForcee;
          syncForcee = false;
          await synchroniserUneFois(force);
        } while (syncDemandee);
      } catch (e) {
        console.warn('[AF] Synchronisation :', e);
      } finally {
        syncEnCours = false;
      }
    })();
  }

  async function synchroniserUneFois(force) {
    const tab = await trouverOngletVinted();
    if (!tab) {
      live.tabId = null;
      live.hashPage = '';
      if (live.photos.length || live.cle) {
        live.photos = [];
        live.cle = '';
        reinitialiserLive();
        retirerPhotosVintedDeLAtelier(null);
      }
      if (!live.message) live.message = 'Ouvre « Vendre un article » sur Vinted et ajoute une photo : elle apparaît ici automatiquement.';
      rafraichirVues();
      return;
    }
    live.tabId = tab.id;

    const info = await versOnglet(tab.id, { type: 'getPageInfo' });
    if (!info || !info.ok) {
      messageLive('Actualise la page Vinted (F5) pour activer la détection automatique.', true);
      return;
    }
    if (!force && info.hash === live.hashPage) return;

    const rep = await versOnglet(tab.id, { type: 'collectPhotos' });
    if (!rep || !rep.ok) {
      messageLive('Impossible de lire les photos de la page Vinted. Actualise-la (F5).', true);
      return;
    }
    live.hashPage = info.hash;

    const images = rep.images || [];
    const fps = images.map(empreinte);
    const cle = fps.slice().sort().join('|');
    const ensembleChange = cle !== live.cle;

    retirerPhotosVintedDeLAtelier(new Set(fps));
    const connues = new Set(fpParPhoto.values());
    for (let i = 0; i < images.length; i++) {
      if (connues.has(fps[i])) continue;
      try {
        await ajouterDepuisUrl('data:image/jpeg;base64,' + images[i], 'vinted-' + (i + 1) + '.jpg', fps[i]);
        connues.add(fps[i]);
      } catch (e) {
        console.warn('[AF] Photo non ajoutée à l\'atelier :', e.message);
      }
    }

    live.photos = images.map((b64, i) => ({ fp: fps[i], b64: b64 }));
    live.cle = cle;

    if (ensembleChange) {
      reinitialiserLive();
      if (images.length) {
        definirEtapes({ photos: 'fait' });
        messageLive(images.length + ' photo' + (images.length > 1 ? 's' : '') + ' détectée' + (images.length > 1 ? 's' : '') +
          (reglages.autoGenerer ? '. Préparation automatique de l\'annonce…' : '. Clique sur « Générer l\'annonce ».'));
        planifierAuto();
      } else {
        messageLive('Aucune photo sur le formulaire. Ajoute une photo : elle apparaît ici automatiquement.');
      }
    }
    rafraichirVues();
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

  // Événements du navigateur (aucun scrutin périodique)
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || !sender || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'photosDetected') {
      if (typeof msg.tabId === 'number') live.tabId = msg.tabId;
      synchroniser();
    }
  });
  chrome.tabs.onActivated.addListener(() => { synchroniser(); });
  chrome.tabs.onUpdated.addListener((id, changeInfo) => {
    if (changeInfo.status === 'complete') synchroniser();
  });

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
        ferme: !!rep.data.ferme,
        hors_ligne: !!(rep.data.offline || rep.data.indisponible)
      };
    }
    majCompteUI();
    return rep;
  }

  async function verifierCredits(nbAnalyses) {
    const rep = await actualiserCompte();
    if (!rep.ok) return { erreur: MSG_RESEAU };
    if (!compte.connected) return { erreur: 'Session expirée. Reconnecte-toi dans Réglages.' };
    if (compte.ferme) return { erreur: MSG_FERME };
    if (compte.hors_ligne) return { erreur: MSG_RESEAU };
    if (compte.credits && typeof compte.credits.remaining === 'number') {
      const cout = (compte.credits.analysis_cost || 1) * nbAnalyses;
      if (compte.credits.remaining < cout) {
        return { erreur: 'Crédits insuffisants : ' + compte.credits.remaining + ' restant(s), ' + cout + ' nécessaire(s). Aucune annonce n\'a été générée.' };
      }
      return { ok: true, cout: cout };
    }
    return { ok: true, cout: nbAnalyses };
  }

  async function appelGenerer(images, precisions) {
    const rep = await envoyer({ type: 'generate', images: images, precisions: precisions || '' });
    if (rep && rep.ok && rep.data) return rep.data;
    const err = new Error((rep && rep.error) || 'Génération impossible.');
    err.code = rep && rep.code;
    throw err;
  }

  async function controlesAuto() {
    if (!reglages.consentementIA) {
      return 'Active « Préparer automatiquement mes annonces » dans Réglages et accepte le traitement par IA.';
    }
    const c = (await lire(['autoCompteur'])).autoCompteur;
    const n = c && c.jour === aujourdhui() ? c.n : 0;
    if (n >= reglages.limiteAuto) {
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
  function ameliorerPhotosVinted() {
    let appliquees = 0;
    for (const photo of photosAlbum()) {
      if (!fpParPhoto.has(photo.id) || photosAmeliorees.has(photo.id)) continue;
      photosAmeliorees.add(photo.id);
      let ops = [];
      try { ops = Batch.ameliorerPhotoAuto(photo, Studio); } catch (e) { ops = []; }
      for (const op of ops) {
        try {
          Studio.avecOperationParId(etat.albumId, photo.id, op);
          appliquees++;
        } catch (e) { /* retouche non applicable à cette photo */ }
      }
    }
    return appliquees;
  }

  function imagesPourIA() {
    const parFp = new Map();
    for (const photo of photosAlbum()) {
      const fp = fpParPhoto.get(photo.id);
      if (fp) parFp.set(fp, photo);
    }
    const images = [];
    for (const p of live.photos) {
      if (images.length >= IA.MAX_PHOTOS) break;
      const photo = parFp.get(p.fp);
      images.push(photo ? urlPhoto(photo).split(',')[1] : p.b64);
    }
    return images;
  }

  function construireChamps(b, rep) {
    const fait = rep.fait || {};
    const menus = rep.menus || {};
    const manuel = (valeur) => (valeur ? 'manuel' : 'absent');
    const menu = (cle, valeur) => {
      if (Array.isArray(valeur) ? !valeur.length : !valeur) return 'absent';
      return menus[cle] || 'a_choisir';
    };
    return [
      { nom: LIBELLES.titre, etat: fait.titre || 'absent', valeur: b.titre },
      { nom: LIBELLES.description, etat: fait.description || 'absent', valeur: '' },
      { nom: LIBELLES.prix, etat: fait.prix || 'absent', valeur: b.prix ? b.prix + ' €' : '' },
      { nom: LIBELLES.categorie, etat: manuel(b.categorie), valeur: b.categorie },
      { nom: LIBELLES.sousCategorie, etat: manuel(b.sousCategorie), valeur: b.sousCategorie },
      { nom: LIBELLES.marque, etat: manuel(b.marque), valeur: b.marque },
      { nom: LIBELLES.taille, etat: menu('taille', b.taille), valeur: b.taille },
      { nom: LIBELLES.etat, etat: menu('etat', b.etat), valeur: b.etat },
      { nom: LIBELLES.couleurs, etat: menu('couleurs', b.couleurs), valeur: (b.couleurs || []).join(', ') },
      { nom: LIBELLES.matiere, etat: menu('matiere', b.matiere), valeur: b.matiere }
    ];
  }

  function resumerChamps(champs) {
    const nb = (e) => champs.filter((c) => c.etat === e).length;
    return nb('rempli') + ' rempli(s) · ' + (nb('a_choisir') + nb('manuel')) + ' à compléter toi-même' +
      (nb('echec') + nb('introuvable') ? ' · ' + (nb('echec') + nb('introuvable')) + ' en échec' : '');
  }

  async function remplirFormulaire(tabId, brouillon) {
    const rep = await versOnglet(tabId, { type: 'fillListing', annonce: brouillon });
    if (!rep) return { erreur: 'Impossible de joindre la page Vinted. Actualise-la (F5).' };
    if (!rep.ok) return { erreur: rep.error || 'Remplissage impossible.' };
    return { champs: construireChamps(brouillon, rep) };
  }

  function planifierAuto() {
    clearTimeout(minuteurAuto);
    if (!reglages.autoGenerer || !live.photos.length) return;
    minuteurAuto = setTimeout(() => { lancerPipeline(false); }, 1500);
  }

  async function lancerPipeline(manuel) {
    if (generationEnCours || !live.photos.length) return;
    const cle = live.cle;
    const tabId = live.tabId;

    if (!manuel) {
      if (analysesTentees.has(cle) || brouillons.some((b) => b.cle === cle)) return;
      const refus = await controlesAuto();
      if (refus) { echecLive(refus); return; }
    } else if (brouillons.some((b) => b.cle === cle)) {
      if (!confirm('Une annonce existe déjà pour ces photos. La régénérer consommera des crédits. Continuer ?')) return;
    }

    const moteur = await moteurDisponible();
    if (moteur.erreur) { echecLive(moteur.erreur); return; }

    generationEnCours = true;
    definirEtapes({ photos: 'fait', retouches: 'en-cours' });
    messageLive('Préparation des photos…');
    if (tabId !== null) versOnglet(tabId, { type: 'setAnalyseEnCours', enCours: true });

    try {
      const nbRetouches = ameliorerPhotosVinted();
      const images = imagesPourIA();
      etape('retouches', 'fait');

      if (moteur.moteur === 'backend') {
        const credits = await verifierCredits(1);
        if (credits.erreur) { echecLive(credits.erreur); return; }
      }

      if (live.photos.length > IA.MAX_PHOTOS) {
        afficherStatut('Seules les ' + IA.MAX_PHOTOS + ' premières photos sont analysées.', 'info');
      }
      etape('generation', 'en-cours');
      messageLive('Génération de l\'annonce (' + images.length + ' photo' + (images.length > 1 ? 's' : '') +
        (nbRetouches ? ', ' + nbRetouches + ' retouche(s) automatique(s)' : '') + ')…');

      // À partir d'ici l'envoi est irréversible : jamais deux analyses pour le même ensemble de photos.
      analysesTentees.add(cle);
      if (!manuel) await compterAnalyseAuto();

      let annonce;
      try {
        annonce = await appelGenerer(images, '');
      } catch (err) {
        echecLive(messageErreur(err));
        return;
      }
      etape('generation', 'fait');

      const premiere = photosAlbum().find((p) => fpParPhoto.get(p.id) === (live.photos[0] && live.photos[0].fp));
      const vignette = premiere ? vignetteDe(Studio.rendrePhoto(premiere)) : '';
      const brouillon = await enregistrerBrouillon(annonce, vignette, images.length, cle);
      if (moteur.moteur === 'backend') actualiserCompte();

      if (live.cle !== cle) {
        afficherStatut('Annonce générée pour un ensemble de photos précédent : retrouve-la dans « Mes annonces ».', 'info');
        return;
      }
      live.brouillon = brouillon;
      live.champs = null;

      const remplirAuto = !manuel && reglages.autoGenerer && reglages.autoRemplir;
      if (remplirAuto && tabId !== null) {
        etape('remplissage', 'en-cours');
        messageLive('Annonce générée. Remplissage du formulaire…');
        const res = await remplirFormulaire(tabId, brouillon);
        if (res.erreur) {
          etape('remplissage', 'erreur');
          messageLive('Annonce générée, mais le formulaire n\'a pas été rempli : ' + res.erreur, true);
        } else {
          live.champs = res.champs;
          etape('remplissage', 'fait');
          messageLive('Annonce prête : ' + resumerChamps(res.champs) + '. Vérifie, puis publie toi-même.');
        }
      } else {
        messageLive('Annonce générée : « ' + brouillon.titre + ' ». Clique sur « Remplir le formulaire ».');
      }
    } catch (e) {
      console.error('[AF] Erreur traitement :', e);
      echecLive('Erreur : ' + (e.message || 'inconnue') + '. Aucune annonce n\'a été générée.');
    } finally {
      generationEnCours = false;
      if (tabId !== null) versOnglet(tabId, { type: 'setAnalyseEnCours', enCours: false });
      rafraichirVues();
      if (live.cle !== cle) planifierAuto();
    }
  }

  $('#live-generer').addEventListener('click', () => lancerPipeline(true));
  $('#live-remplir').addEventListener('click', async () => {
    if (!live.brouillon || live.tabId === null) return;
    etape('remplissage', 'en-cours');
    const res = await remplirFormulaire(live.tabId, live.brouillon);
    if (res.erreur) {
      etape('remplissage', 'erreur');
      messageLive(res.erreur, true);
      return;
    }
    live.champs = res.champs;
    etape('remplissage', 'fait');
    messageLive('Formulaire traité : ' + resumerChamps(res.champs) + '. Vérifie, puis publie toi-même.');
  });

  // ========== PHOTOS ==========
  async function importerFichiers(fichiers) {
    const liste = Array.from(fichiers || []).filter((f) => f.type && f.type.startsWith('image/'));
    if (!liste.length) return;
    let ok = 0;
    let derniereErreur = '';
    for (const f of liste) {
      try {
        await ajouterDepuisUrl(await lireFichier(f), f.name);
        ok++;
      } catch (e) {
        derniereErreur = e.message;
      }
    }
    rafraichirGalerie();
    if (ok) afficherStatut(ok + ' photo' + (ok > 1 ? 's' : '') + ' importée' + (ok > 1 ? 's' : '') + '.', 'succes');
    if (derniereErreur) afficherStatut(derniereErreur, 'erreur');
  }

  function rafraichirGalerie() {
    const galerie = $('#galerie');
    galerie.innerHTML = '';
    const photos = photosAlbum();
    $('#compteur-photos').textContent = photos.length + ' photo' + (photos.length !== 1 ? 's' : '');
    $('#vers-creation').hidden = photos.length === 0;

    photos.forEach((photo, i) => {
      const div = document.createElement('div');
      div.className = 'vignette' + (photo.id === etat.photoActiveId ? ' active' : '');
      div.innerHTML =
        '<img src="' + urlPhoto(photo) + '" alt="Photo ' + (i + 1) + '">' +
        '<span class="vignette-badge">' + (i + 1) + '</span>' +
        '<button type="button" class="vignette-suppr" title="Retirer de l\'atelier">×</button>';
      div.addEventListener('click', (e) => {
        if (e.target.classList.contains('vignette-suppr')) {
          Studio.supprimerPhoto(etat.albumId, photo.id);
          fpParPhoto.delete(photo.id);
          if (etat.photoActiveId === photo.id) {
            etat.photoActiveId = null;
            $('#apercu-container').hidden = true;
          }
          rafraichirGalerie();
          return;
        }
        selectionnerPhoto(photo.id);
      });
      galerie.appendChild(div);
    });
    if (!photoActive()) $('#apercu-container').hidden = true;
  }

  function selectionnerPhoto(id) {
    etat.photoActiveId = id;
    cacherPanneauxRetouche();
    $$('.vignette').forEach((v, i) => v.classList.toggle('active', photosAlbum()[i] && photosAlbum()[i].id === id));
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

  $('#ameliorer-auto').addEventListener('click', () => {
    const photos = photosAlbum();
    if (!photos.length) { afficherStatut('Importe des photos d\'abord.', 'info'); return; }
    let nb = 0;
    for (const photo of photos) {
      if (photosAmeliorees.has(photo.id)) continue;
      photosAmeliorees.add(photo.id);
      let appliquee = false;
      for (const op of Batch.ameliorerPhotoAuto(photo, Studio)) {
        try { Studio.avecOperationParId(etat.albumId, photo.id, op); appliquee = true; } catch (e) { /* ignoré */ }
      }
      if (appliquee) nb++;
    }
    rafraichirGalerie();
    if (photoActive()) afficherApercu('apres');
    afficherStatut(nb ? nb + ' photo(s) améliorée(s).' : 'Photos déjà correctes, rien à améliorer.', nb ? 'succes' : 'info');
  });

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
      Studio.avecOperationParId(etat.albumId, photo.id, op);
    } catch (e) {
      afficherStatut(e.message || 'Retouche impossible.', 'erreur');
      return;
    }
    cacherPanneauxRetouche();
    rafraichirGalerie();
    afficherApercu('apres');
    afficherStatut(succes, 'succes');
  }

  $('#btn-recadrer').addEventListener('click', () => ouvrirRetouche('recadrer'));
  $('#btn-redresser').addEventListener('click', () => ouvrirRetouche('redresser'));
  $('#btn-lumiere').addEventListener('click', () => ouvrirRetouche('lumiere'));
  $('#btn-fond').addEventListener('click', () => ouvrirRetouche('fond'));

  $('#btn-annuler').addEventListener('click', () => {
    const photo = photoActive();
    if (!photo) return;
    Studio.annulerParId(etat.albumId, photo.id);
    photosAmeliorees.add(photo.id);
    rafraichirGalerie();
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
    $('#' + id).addEventListener('input', (e) => { $('#' + (id === 'lum' ? 'lum' : id) + '-val').textContent = e.target.value; });
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
      await Studio.demanderMannequinParId(etat.albumId, photo.id);
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

  // ========== CRÉATION (un ou plusieurs articles) ==========
  function rafraichirCreation() {
    const photos = photosAlbum();
    const el = $('#photos-selectionnees');
    if (!photos.length) {
      el.innerHTML = '<p class="texte-vide">Importe des photos dans l\'onglet Photos.</p>';
      $('#info-articles').textContent = '';
      return;
    }
    el.innerHTML = photos.map((p) => '<img src="' + urlPhoto(p) + '" alt="' + escapeHtml(p.nom) + '">').join('');
    const mode = $('input[name="mode-creation"]:checked').value;
    $('#info-articles').textContent =
      mode === 'unique' ? photos.length + ' photo(s) pour 1 article (' + IA.MAX_PHOTOS + ' analysées au maximum)'
        : mode === 'multiple' ? photos.length + ' article(s), 1 photo chacun'
          : 'Regroupement automatique pas encore disponible : 1 photo = 1 article (confirmation demandée).';
  }
  $$('input[name="mode-creation"]').forEach((r) => r.addEventListener('change', rafraichirCreation));

  $('#generer-lot').addEventListener('click', async () => {
    if (generationEnCours) return;
    const photos = photosAlbum();
    if (!photos.length) { afficherStatut('Importe des photos d\'abord.', 'erreur'); return; }
    const mode = $('input[name="mode-creation"]:checked').value;
    const precisions = $('#precisions').value.trim();

    if (mode === 'groupes' &&
      !confirm('Le regroupement automatique n\'est pas encore disponible : chaque photo sera traitée comme un article distinct. Continuer ?')) return;
    const groupes = mode === 'unique' ? [photos.slice(0, IA.MAX_PHOTOS)] : photos.map((p) => [p]);

    const moteur = await moteurDisponible();
    if (moteur.erreur) { afficherStatut(moteur.erreur, 'erreur'); return; }
    let cout = groupes.length;
    if (moteur.moteur === 'backend') {
      const credits = await verifierCredits(groupes.length);
      if (credits.erreur) { afficherStatut(credits.erreur, 'erreur'); return; }
      cout = credits.cout;
    }
    if (!confirm(groupes.length + ' analyse(s) IA vont être lancées (' + cout + ' crédit(s)). Continuer ?')) return;

    generationEnCours = true;
    rendreLive();
    $('#progression').hidden = false;
    $('#resultats-creation').hidden = true;
    const resultats = [];
    let arret = false;

    for (let i = 0; i < groupes.length && !arret; i++) {
      $('#progression-fill').style.width = Math.round((i / groupes.length) * 100) + '%';
      $('#progression-texte').textContent = 'Article ' + (i + 1) + '/' + groupes.length + '…';
      try {
        const images = groupes[i].map((p) => urlPhoto(p).split(',')[1]);
        const annonce = await appelGenerer(images, precisions);
        const b = await enregistrerBrouillon(annonce, vignetteDe(Studio.rendrePhoto(groupes[i][0])), images.length, '');
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

    const reussies = resultats.filter((r) => r.ok).length;
    if (reussies) {
      afficherStatut(reussies + ' annonce(s) créée(s)' + (reussies < groupes.length ? ', ' + (groupes.length - reussies) + ' en échec.' : '.'), 'succes');
      if (reussies === groupes.length) naviguerVers('annonces');
    } else {
      afficherStatut('Aucune annonce générée.', 'erreur');
    }
    rafraichirVues();
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
    brouillons = Batch.modifierBrouillonsEnMasse(brouillons, ids, { type: type, valeur: parseFloat($('#action-prix-val').value) || 0 });
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
    b.dateModification = Date.now();
    await sauvegarderBrouillons();
    rafraichirAnnonces();
  }

  async function remplirDepuisListe(id) {
    const b = brouillons.find((x) => x.id === id);
    if (!b) { afficherStatut('Annonce introuvable.', 'erreur'); return; }
    const tab = await trouverOngletVinted();
    if (!tab) { afficherStatut('Ouvre la page Vinted « Vendre un article ».', 'erreur'); return; }
    const res = await remplirFormulaire(tab.id, b);
    if (res.erreur) { afficherStatut(res.erreur, 'erreur'); return; }
    afficherStatut('Formulaire traité : ' + resumerChamps(res.champs) + '. Vérifie, puis publie toi-même.', 'succes');
  }

  // ========== RÉGLAGES ET COMPTE ==========
  async function chargerReglages() {
    const d = await lire([
      'backendUrl', 'backendEmail', 'style', 'hashtags', 'signature', 'prixAjustement', 'prixArrondi', 'apiKey',
      'autoGenerer', 'autoRemplir', 'limiteAuto', 'consentementIA', 'claudeExplicite'
    ]);
    reglages = {
      autoGenerer: !!d.autoGenerer && !!d.consentementIA,
      autoRemplir: d.autoRemplir !== false,
      limiteAuto: Math.max(1, Math.min(100, parseInt(d.limiteAuto, 10) || 10)),
      consentementIA: !!d.consentementIA,
      claudeExplicite: !!d.claudeExplicite
    };
    $('#backendUrl').value = d.backendUrl || IA.API_OFFICIELLE || '';
    $('#email').value = d.backendEmail || '';
    $('#style').value = d.style || 'normal';
    $('#hashtags').checked = d.hashtags !== false;
    $('#signature').value = d.signature || '';
    $('#prixAjustement').value = d.prixAjustement || 0;
    $('#prixArrondi').value = d.prixArrondi || 1;
    $('#apiKey').value = d.apiKey || '';
    $('#autoGenerer').checked = reglages.autoGenerer;
    $('#autoRemplir').checked = reglages.autoRemplir;
    $('#limiteAuto').value = reglages.limiteAuto;
    $('#claudeExplicite').checked = reglages.claudeExplicite;
  }

  function majCompteUI() {
    const el = $('#compte-statut');
    if (compte.connected) {
      const cr = creditsRestants();
      el.textContent = 'Connecté' + (compte.email ? ' : ' + compte.email : '') + (cr !== null ? ' — ' + cr + ' crédit(s)' : '') +
        (compte.ferme ? ' — service fermé' : '');
      el.className = 'compte-statut connecte';
    } else {
      el.textContent = 'Non connecté';
      el.className = 'compte-statut deconnecte';
    }
    $('#deconnecter').hidden = !compte.connected;
    const header = $('#credits');
    header.hidden = creditsRestants() === null;
    $('#credits-val').textContent = creditsRestants();
    $('#stat-credits').textContent = creditsRestants() === null ? '--' : creditsRestants();
  }

  $('#connecter').addEventListener('click', async () => {
    const url = $('#backendUrl').value.trim();
    const email = $('#email').value.trim();
    const mdp = $('#password').value;
    if (!url || !email || !mdp) { afficherStatut('Remplis tous les champs.', 'erreur'); return; }
    const rep = await envoyer({ type: 'authLogin', email: email, password: mdp, backendUrl: url });
    $('#password').value = '';
    if (!rep.ok) {
      afficherStatut(messageErreur({ code: rep.code, message: rep.error }).replace(' Aucune annonce n\'a été générée.', ''), 'erreur');
      return;
    }
    compte = { connected: true, email: rep.data.email, credits: rep.data.credits || null };
    majCompteUI();
    afficherStatut('Connecté.', 'succes');
    planifierAuto();
  });

  $('#deconnecter').addEventListener('click', async () => {
    await envoyer({ type: 'authLogout' });
    compte = { connected: false, email: '', credits: null };
    majCompteUI();
    afficherStatut('Déconnecté.', 'info');
  });

  $('#tester-cle').addEventListener('click', async () => {
    const cle = $('#apiKey').value.trim();
    if (!cle) { afficherStatut('Entre une clé API.', 'erreur'); return; }
    const rep = await envoyer({ type: 'testKey', apiKey: cle });
    afficherStatut(rep.ok ? 'Clé valide.' : (rep.error || 'Clé invalide.'), rep.ok ? 'succes' : 'erreur');
  });

  $('#sauvegarder').addEventListener('click', async () => {
    reglages.autoRemplir = $('#autoRemplir').checked;
    reglages.limiteAuto = Math.max(1, Math.min(100, parseInt($('#limiteAuto').value, 10) || 10));
    reglages.claudeExplicite = $('#claudeExplicite').checked;
    await chrome.storage.local.set({
      style: $('#style').value,
      hashtags: $('#hashtags').checked,
      signature: $('#signature').value.trim(),
      prixAjustement: parseInt($('#prixAjustement').value, 10) || 0,
      prixArrondi: parseInt($('#prixArrondi').value, 10) || 1,
      apiKey: $('#apiKey').value.trim(),
      autoRemplir: reglages.autoRemplir,
      limiteAuto: reglages.limiteAuto,
      claudeExplicite: reglages.claudeExplicite
    });
    afficherStatut('Réglages enregistrés.', 'succes');
    planifierAuto();
  });

  // Mode automatique : activé volontairement, avec consentement explicite
  $('#autoGenerer').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const limite = Math.max(1, Math.min(100, parseInt($('#limiteAuto').value, 10) || 10));
      const accord = confirm(
        'Mode automatique\n\n' +
        'Dès que les photos de ton formulaire Vinted changent, Annonce Futée les enverra automatiquement à l\'IA ' +
        'pour rédiger l\'annonce, une seule fois par ensemble de photos.\n\n' +
        '• Chaque analyse consomme des crédits\n' +
        '• Maximum ' + limite + ' analyses automatiques par jour\n' +
        '• Rien n\'est jamais publié automatiquement\n\nActiver ?');
      if (!accord) { e.target.checked = false; return; }
      reglages.autoGenerer = true;
      reglages.consentementIA = true;
      reglages.limiteAuto = limite;
      await chrome.storage.local.set({ autoGenerer: true, consentementIA: true, limiteAuto: limite });
      afficherStatut('Mode automatique activé.', 'succes');
      await synchroniser(true);
      planifierAuto();
    } else {
      reglages.autoGenerer = false;
      reglages.consentementIA = false;
      clearTimeout(minuteurAuto);
      await chrome.storage.local.set({ autoGenerer: false, consentementIA: false });
      afficherStatut('Mode automatique désactivé.', 'info');
    }
    rendreLive();
  });

  $('#autoRemplir').addEventListener('change', async (e) => {
    reglages.autoRemplir = e.target.checked;
    await chrome.storage.local.set({ autoRemplir: reglages.autoRemplir });
  });

  // ========== DÉMARRAGE ==========
  try { $('#version').textContent = chrome.runtime.getManifest().version; } catch (e) { /* version inconnue */ }
  await chargerReglages();
  await chargerBrouillons();
  brouillons.forEach((b) => { if (b.cle) analysesTentees.add(b.cle); });
  naviguerVers('dashboard');
  const compteLocal = await lire(['backendToken', 'backendEmail']);
  if (compteLocal.backendToken) {
    compte = { connected: true, email: compteLocal.backendEmail || '', credits: null };
    majCompteUI();
    actualiserCompte();
  }
  synchroniser(true);
})();
