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
  const DELAI_DEFAUT_S = 6;
  const ERREURS_REFUS_SERVEUR = ['HTTP_401', 'HTTP_402', 'HTTP_403', 'HTTP_404', 'HTTP_422', 'HTTP_429', 'NO_KEY'];
  const CHAMPS_REMPLACABLES = ['titre', 'description', 'prix'];

  // ========== ÉTAT ==========
  const etat = { albumId: null, photoActiveId: null, retouche: null, recadrage: null, section: 'dashboard' };
  let brouillons = [];
  let reglages = {
    autoGenerer: false, autoRemplir: true, limiteAuto: 10, consentementIA: false, claudeExplicite: false,
    delaiS: DELAI_DEFAUT_S
  };
  let compte = { connected: false, email: '', credits: null };

  // Un état par formulaire Vinted (onglet) : plusieurs articles en préparation restent distincts.
  function creerLive(tabId) {
    return {
      tabId: tabId,
      hashPage: '',
      enChargement: 0,
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
      annulation: null,        // { annule, envoye, requestId } pendant une analyse
      ignoree: ''              // ensemble de photos pour lequel l'automatisme ne doit plus rien lancer
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

  function messageErreur(err) {
    const code = err && err.code;
    if (code === 'HTTP_403') return MSG_FERME;
    if (code === 'NETWORK') return MSG_RESEAU;
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

  async function ajouterDepuisUrl(url, nom, origine) {
    const id = assurerAlbum();
    if (photosAlbum().length >= Studio.MAX_ATELIER) throw new Error('Huit photos au maximum dans l\'atelier.');
    const pixels = await urlVersPixels(url);
    const album = Studio.ajouterPhotoParId(id, pixels, nom);
    const photo = album.photos[album.photos.length - 1];
    if (origine) fpParPhoto.set(photo.id, origine);
    return photo;
  }

  const photosManuelles = () => photosAlbum().filter((p) => !fpParPhoto.has(p.id));

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

    $('#live-photos').innerHTML = L.photos
      .map((p) => '<img src="data:image/jpeg;base64,' + p.b64 + '" alt="Photo du formulaire">')
      .join('');

    $('#live-etapes').hidden = !Object.values(L.etapes).some(Boolean);
    $$('#live-etapes li').forEach((li) => { li.className = L.etapes[li.dataset.etape] || ''; });

    const msgEl = $('#live-message');
    msgEl.textContent = L.message;
    msgEl.className = 'live-message' + (L.erreur ? ' erreur' : '');

    $('#live-bilan').innerHTML = (nb || L.analyse !== 'aucune')
      ? lignesBilan(L).map((l) => '<li class="' + l[2] + '"><span>' + escapeHtml(l[0]) + '</span><span>' + escapeHtml(l[1]) + '</span></li>').join('')
      : '';

    $('#live-champs').innerHTML = (L.champs || []).map((c) =>
      '<div class="champ-ligne ' + c.etat + '"><span class="champ-nom">' + escapeHtml(c.nom) + '</span>' +
      '<span class="champ-etat">' + escapeHtml(TEXTE_ETAT[c.etat] || c.etat) +
      (c.valeur && (c.etat === 'manuel' || c.etat === 'echec' || c.etat === 'a_choisir') ? ' : ' + escapeHtml(c.valeur) : '') +
      (c.etat === 'conserve' && CHAMPS_REMPLACABLES.indexOf(c.cle) >= 0
        ? ' <button type="button" class="btn-remplacer" data-cle="' + c.cle + '">Remplacer</button>' : '') +
      '</span></div>'
    ).join('');

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
    $('#live-annuler').hidden = !(occupe || L.minuteur);
  }

  function annulerMinuteur(L) {
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
  }

  // ========== SYNCHRONISATION AVEC LES FORMULAIRES VINTED ==========
  async function ongletActifVinted() {
    try {
      const [actif] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (actif && PAGE_VENTE.test(actif.url || '')) return actif;
    } catch (e) { /* aucun onglet */ }
    return null;
  }

  function retirerPhotosVintedDeLAtelier(tabId, garder) {
    if (!etat.albumId) return;
    for (const [photoId, origine] of Array.from(fpParPhoto.entries())) {
      if (origine.tabId !== tabId) continue;
      if (garder && garder.has(origine.fp)) continue;
      Studio.supprimerPhoto(etat.albumId, photoId);
      fpParPhoto.delete(photoId);
      photosAmeliorees.delete(photoId);
      if (etat.photoActiveId === photoId) etat.photoActiveId = null;
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
    for (let i = 0; i < images.length; i++) {
      if (connues.has(fps[i])) continue;
      try {
        await ajouterDepuisUrl('data:image/jpeg;base64,' + images[i], 'vinted-' + (i + 1) + '.jpg', { fp: fps[i], tabId: tabId });
        connues.add(fps[i]);
      } catch (e) {
        console.warn('[AF] Photo non ajoutée à l\'atelier :', e.message);
      }
    }

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

  async function appelGenerer(images, precisions, requestId) {
    const rep = await envoyer({ type: 'generate', images: images, precisions: precisions || '', requestId: requestId || '' });
    if (rep && rep.ok && rep.data) return rep.data;
    const err = new Error((rep && rep.error) || 'Génération impossible.');
    err.code = rep && rep.code;
    throw err;
  }

  // Constate le crédit réellement consommé en comparant le solde avant/après.
  async function constaterCredit(L, moteur, avant, apresEnvoi) {
    if (moteur !== 'backend') { L.credit = { etat: 'claude', detail: '' }; return; }
    await actualiserCompte();
    const apres = creditsRestants();
    if (avant === null || apres === null) {
      L.credit = { etat: 'inconnu', detail: 'solde illisible, vérifie ton compte' };
    } else if (apres < avant) {
      L.credit = { etat: 'consomme', detail: (avant - apres) + ' crédit (' + avant + ' → ' + apres + ')' };
    } else {
      L.credit = { etat: 'non-consomme', detail: 'solde inchangé : ' + apres + (apresEnvoi ? ', à confirmer plus tard' : '') };
    }
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
  function ameliorerPhotosVinted(L) {
    let appliquees = 0;
    for (const photo of photosAlbum()) {
      const origine = fpParPhoto.get(photo.id);
      if (!origine || origine.tabId !== L.tabId || photosAmeliorees.has(photo.id)) continue;
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

  function imagesPourIA(L) {
    const parFp = new Map();
    for (const photo of photosAlbum()) {
      const origine = fpParPhoto.get(photo.id);
      if (origine && origine.tabId === L.tabId) parFp.set(origine.fp, photo);
    }
    const images = [];
    for (const p of L.photos) {
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
      { cle: 'titre', nom: LIBELLES.titre, etat: fait.titre || 'absent', valeur: b.titre },
      { cle: 'description', nom: LIBELLES.description, etat: fait.description || 'absent', valeur: '' },
      { cle: 'prix', nom: LIBELLES.prix, etat: fait.prix || 'absent', valeur: b.prix ? b.prix + ' €' : '' },
      { cle: 'categorie', nom: LIBELLES.categorie, etat: manuel(b.categorie), valeur: b.categorie },
      { cle: 'sousCategorie', nom: LIBELLES.sousCategorie, etat: manuel(b.sousCategorie), valeur: b.sousCategorie },
      { cle: 'marque', nom: LIBELLES.marque, etat: manuel(b.marque), valeur: b.marque },
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
    annulerMinuteur(L);
    if (!reglages.autoGenerer || !L.photos.length || L.enChargement) return;
    if (L.ignoree === L.cle || analysesTentees.has(L.cle) || brouillons.some((b) => b.cle === L.cle)) return;
    const delai = reglages.delaiS * 1000;
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
      const nbRetouches = ameliorerPhotosVinted(L);
      const images = imagesPourIA(L);
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
        creditsAvant = creditsRestants();
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
      try {
        annonce = await appelGenerer(images, precisions, ctl.requestId);
      } catch (err) {
        L.analyse = err.code === 'ABORTED' ? 'interrompue' : 'echec';
        if (ERREURS_REFUS_SERVEUR.indexOf(err.code) >= 0) {
          L.credit = { etat: 'non-consomme', detail: 'refusé par le serveur' };
        } else {
          await constaterCredit(L, moteur.moteur, creditsAvant, true);
        }
        L.ignoree = cle;
        echecLive(L, messageErreur(err) + (err.code === 'ABORTED' ? ' ' + texteCredit(L.credit) + '.' : ''));
        return;
      }
      L.analyse = 'terminee';
      etape(L, 'analyse', 'fait');
      await constaterCredit(L, moteur.moteur, creditsAvant, false);

      const premiere = photosAlbum().find((p) => {
        const o = fpParPhoto.get(p.id);
        return o && o.tabId === tabId && L.photos[0] && o.fp === L.photos[0].fp;
      });
      const vignette = premiere ? vignetteDe(Studio.rendrePhoto(premiere)) : '';
      const brouillon = await enregistrerBrouillon(annonce, vignette, images.length, cle, precisions);
      etape(L, 'annonce', 'fait');

      if (L.cle !== cle) {
        afficherStatut('Annonce générée pour un ensemble de photos précédent : retrouve-la dans « Mes annonces ».', 'info');
        return;
      }
      L.brouillon = brouillon;
      L.precisionsUtilisees = precisions;
      L.champs = null;

      if (ctl.annule) {
        messageLive(L, 'L\'analyse s\'est terminée avant l\'interruption : annonce enregistrée (' + texteCredit(L.credit).toLowerCase() +
          '). Le formulaire n\'a pas été rempli.');
        return;
      }

      const remplirAuto = !manuel && reglages.autoGenerer && reglages.autoRemplir;
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
    if (L.minuteur) {
      annulerMinuteur(L);
      L.ignoree = L.cle;
      L.analyse = 'non-lancee';
      etape(L, 'pretes', '');
      messageLive(L, 'Analyse automatique annulée pour ces photos. « Générer l\'annonce » la lancera à ta demande.');
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
    if (!liste.length) return;
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
    if (ok) afficherStatut(ok + ' photo' + (ok > 1 ? 's' : '') + ' importée' + (ok > 1 ? 's' : '') + '.', 'succes');
    if (derniereErreur) afficherStatut(derniereErreur, 'erreur');
  }

  function rafraichirGalerie() {
    const galerie = $('#galerie');
    galerie.innerHTML = '';
    const photos = photosAlbum();
    $('#compteur-photos').textContent = photos.length + ' photo' + (photos.length !== 1 ? 's' : '');
    $('#vers-creation').hidden = photosManuelles().length === 0;

    photos.forEach((photo, i) => {
      const div = document.createElement('div');
      div.className = 'vignette' + (photo.id === etat.photoActiveId ? ' active' : '');
      div.title = fpParPhoto.has(photo.id) ? 'Photo du formulaire Vinted' : 'Photo importée';
      div.innerHTML =
        '<img src="' + urlPhoto(photo) + '" alt="Photo ' + (i + 1) + '">' +
        '<span class="vignette-badge">' + (i + 1) + '</span>' +
        '<button type="button" class="vignette-suppr" title="Retirer de l\'atelier">×</button>';
      div.addEventListener('click', (e) => {
        if (e.target.classList.contains('vignette-suppr')) {
          Studio.supprimerPhoto(etat.albumId, photo.id);
          fpParPhoto.delete(photo.id);
          groupeParPhoto.delete(photo.id);
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
  const bornerDelai = (v) => Math.max(3, Math.min(60, parseInt(v, 10) || DELAI_DEFAUT_S));

  async function chargerReglages() {
    const d = await lire([
      'backendUrl', 'backendEmail', 'style', 'hashtags', 'signature', 'prixAjustement', 'prixArrondi', 'apiKey',
      'autoGenerer', 'autoRemplir', 'limiteAuto', 'consentementIA', 'claudeExplicite', 'delaiStabilisation'
    ]);
    reglages = {
      autoGenerer: !!d.autoGenerer && !!d.consentementIA,
      autoRemplir: d.autoRemplir !== false,
      limiteAuto: Math.max(1, Math.min(100, parseInt(d.limiteAuto, 10) || 10)),
      consentementIA: !!d.consentementIA,
      claudeExplicite: !!d.claudeExplicite,
      delaiS: bornerDelai(d.delaiStabilisation)
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
    $('#delaiStabilisation').value = reglages.delaiS;
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
      afficherStatut(messageErreur({ code: rep.code, message: rep.error }).replace(' Aucune annonce n\'a été générée.', ''), 'erreur');
      return;
    }
    compte = { connected: true, email: rep.data.email, credits: rep.data.credits || null };
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
    const ouverture = r.ferme === true ? 'service FERMÉ aux connexions (CLIENT_API=false) : aucune génération possible depuis Chrome'
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
      limiteAuto: reglages.limiteAuto,
      delaiStabilisation: reglages.delaiS,
      claudeExplicite: reglages.claudeExplicite
    });
    afficherStatut('Réglages enregistrés.', 'succes');
    reautoriserAutomatique();
  });

  // Mode automatique : activé volontairement, avec information claire sur l'envoi des photos et les crédits
  $('#autoGenerer').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const limite = Math.max(1, Math.min(100, parseInt($('#limiteAuto').value, 10) || 10));
      const delai = bornerDelai($('#delaiStabilisation').value);
      const accord = confirm(
        'Mode automatique\n\n' +
        'Quand les photos de ton formulaire Vinted ne changent plus pendant ' + delai + ' s, Annonce Futée les ENVOIE ' +
        'à notre service d\'IA (OpenAI via ton serveur Annonce Futée) pour rédiger l\'annonce, une seule fois par ensemble de photos.\n\n' +
        '• Chaque analyse consomme des crédits\n' +
        '• Maximum ' + limite + ' analyses automatiques par jour\n' +
        '• Tu peux interrompre à tout moment depuis le panneau\n' +
        '• Tes saisies manuelles ne sont jamais écrasées sans ta confirmation\n' +
        '• Rien n\'est jamais publié automatiquement\n\nActiver ?');
      if (!accord) { e.target.checked = false; return; }
      reglages.autoGenerer = true;
      reglages.consentementIA = true;
      reglages.limiteAuto = limite;
      reglages.delaiS = delai;
      await chrome.storage.local.set({ autoGenerer: true, consentementIA: true, limiteAuto: limite, delaiStabilisation: delai });
      afficherStatut('Mode automatique activé.', 'succes');
      await synchroniser(true);
      reautoriserAutomatique();
    } else {
      reglages.autoGenerer = false;
      reglages.consentementIA = false;
      lives.forEach(annulerMinuteur);
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
