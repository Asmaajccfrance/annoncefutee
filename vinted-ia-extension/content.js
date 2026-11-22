// Script injecté sur vinted.fr. Détection automatique des photos + remplissage.
// Il ne publie jamais rien. Le clic "Publier" reste à l'utilisateur.

(() => {
  if (window.__annonceFutee) return;
  const IA = globalThis.VintedIA;
  if (!IA) return;

  const MAX_PHOTOS = IA.MAX_PHOTOS;
  const COTE_MAX = 1024;
  const formaterPrix = IA.formaterPrix;
  const normaliser = IA.normaliser;

  // État de synchronisation pour éviter les doublons
  let dernieresPhotosHash = '';
  let dernierEnvoi = 0;
  let observateurActif = null;
  let observateurPrix = null;
  let minuteurPrix = null;
  let analyseEnCours = false;

  function estPageVente() {
    return /^\/items\/(new|\d+\/edit)/.test(location.pathname);
  }

  // ---------- Récupération des photos ----------

  function horsZone(el) {
    return !!el.closest('header, nav, footer, #annonce-futee-declencheur');
  }

  const SELECTEUR_PROGRESSION = 'progress, [role="progressbar"], [aria-busy="true"]';

  // Une photo est « prête » quand elle est entièrement décodée et sans indicateur de progression autour.
  function enChargement(img) {
    if (!img.complete || !img.naturalWidth) return true;
    let parent = img.parentElement;
    for (let i = 0; i < 3 && parent; i++, parent = parent.parentElement) {
      // On s'arrête au conteneur d'une seule photo : l'indicateur d'une photo voisine ne la concerne pas.
      if (parent.querySelectorAll('img').length > 1) break;
      if (parent.matches && parent.matches('[aria-busy="true"]')) return true;
      if (parent.querySelector && parent.querySelector(SELECTEUR_PROGRESSION)) return true;
    }
    return false;
  }

  // Retourne les photos prêtes (sources) et le nombre de photos encore en cours de chargement.
  function analyserPhotos() {
    const resultat = { sources: [], enChargement: 0 };
    if (!estPageVente()) return resultat;
    const zone = document.querySelector('main') || document.body;
    const vus = new Set();

    const examiner = (filtre, minimum) => {
      zone.querySelectorAll('img').forEach((img) => {
        if (!img.src || horsZone(img) || vus.has(img.src) || !filtre(img.src)) return;
        const rect = img.getBoundingClientRect();
        if (rect.width < minimum || rect.height < minimum) return;
        vus.add(img.src);
        if (enChargement(img)) resultat.enChargement++;
        else resultat.sources.push(img.src);
      });
    };

    // Photos locales ajoutées par l'utilisateur (blob / data), sinon photos du CDN Vinted (annonce modifiée)
    examiner((src) => /^(blob:|data:image\/)/.test(src), 50);
    if (resultat.sources.length === 0 && resultat.enChargement === 0) {
      examiner((src) => IA.hoteImageAutorise(src), 80);
    }
    resultat.sources = resultat.sources.slice(0, MAX_PHOTOS);
    return resultat;
  }

  function trouverPhotosVinted() {
    return analyserPhotos().sources;
  }

  // Calculer un hash simple pour détecter les changements
  function calculerHash(photos) {
    return photos.map((p) => p.slice(-40)).sort().join('|');
  }

  // ---------- Notification au panneau latéral ----------

  function envoyer(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (rep) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: 'Extension rechargée : actualise la page (F5).' });
          } else {
            resolve(rep || { ok: false, error: 'Pas de réponse.' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: 'Extension rechargée : actualise la page (F5).' });
      }
    });
  }

  // Une seule vérification en attente à la fois : plusieurs mutations rapprochées
  // (ajout de 3 photos d'affilée) ne produisent qu'une seule notification.
  let minuteurVerif = null;
  function planifierVerification(delai) {
    clearTimeout(minuteurVerif);
    minuteurVerif = setTimeout(verifierPhotos, delai);
  }

  let dernierChargement = 0;
  let tentativesChargement = 0;

  function notifierChangementPhotos(photos, hash, nbChargement) {
    dernieresPhotosHash = hash;
    dernierChargement = nbChargement;
    dernierEnvoi = Date.now();
    majBouton(photos.length, analyseEnCours);
    envoyer({
      type: 'photosChanged',
      count: photos.length,
      enChargement: nbChargement,
      hash: hash,
      pageUrl: location.href,
      timestamp: dernierEnvoi
    });
  }

  // ---------- Observation automatique du DOM ----------

  function gererChangementFichier(e) {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'file') planifierVerification(250);
  }

  function gererDrop(e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) planifierVerification(250);
  }

  let zoneObservee = null;

  function mutationConcerneImage(mutations) {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (m.target.tagName === 'IMG') return true;
        continue;
      }
      for (const liste of [m.addedNodes, m.removedNodes]) {
        for (const node of liste) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG' || (node.querySelector && node.querySelector('img'))) return true;
        }
      }
    }
    return false;
  }

  function demarrerObservation() {
    if (observateurActif || !estPageVente()) return;
    zoneObservee = document.querySelector('main') || document.body;

    observateurActif = new MutationObserver((mutations) => {
      if (mutationConcerneImage(mutations)) planifierVerification(200);
    });
    observateurActif.observe(zoneObservee, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
    if (!observateurPrix) {
      observateurPrix = new MutationObserver(() => planifierPrixIdeal());
      observateurPrix.observe(zoneObservee, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
      planifierPrixIdeal();
    }
    zoneObservee.addEventListener('change', gererChangementFichier, true);
    zoneObservee.addEventListener('drop', gererDrop, true);

    planifierVerification(200);
  }

  function arreterObservation() {
    clearTimeout(minuteurVerif);
    clearTimeout(minuteurPrix);
    if (observateurActif) {
      observateurActif.disconnect();
      observateurActif = null;
    }
    if (observateurPrix) {
      observateurPrix.disconnect();
      observateurPrix = null;
    }
    if (zoneObservee) {
      zoneObservee.removeEventListener('change', gererChangementFichier, true);
      zoneObservee.removeEventListener('drop', gererDrop, true);
      zoneObservee = null;
    }
  }

  // Ne notifie que si l'ensemble des photos prêtes (ou leur chargement) a réellement changé.
  // Tant que des photos se chargent, on revérifie sans bruit (borné) pour signaler la fin du chargement.
  function verifierPhotos() {
    if (!estPageVente()) return;
    const etat = analyserPhotos();
    const hash = calculerHash(etat.sources);
    if (etat.enChargement > 0 && tentativesChargement < 90) {
      tentativesChargement++;
      planifierVerification(300);
    } else if (etat.enChargement === 0) {
      tentativesChargement = 0;
    }
    if (hash !== dernieresPhotosHash || etat.enChargement !== dernierChargement) {
      notifierChangementPhotos(etat.sources, hash, etat.enChargement);
    }
  }

  // ---------- Ajout de photos préparées par le panneau ----------
  // Même geste que « Ajouter des photos » : les fichiers sont remis au champ photo du formulaire.
  // Rien n'est envoyé ni publié ici.

  const MAX_AJOUT = 20;

  function champPhotos() {
    if (!estPageVente()) return null;
    const zone = document.querySelector('main') || document.body;
    const champs = Array.from(zone.querySelectorAll('input[type="file"]')).filter((el) => !horsZone(el) && !el.disabled);
    return champs.find((el) => /image/i.test(el.accept || '')) || champs[0] || null;
  }

  function ajouterPhotos(images) {
    if (!estPageVente()) return { ok: false, error: 'Ouvre la page Vinted « Vendre un article ».' };
    const liste = (Array.isArray(images) ? images : []).filter((im) => im && typeof im.b64 === 'string' && im.b64.length > 100);
    if (!liste.length) return { ok: false, error: 'Aucune photo à ajouter.' };
    const champ = champPhotos();
    if (!champ) return { ok: false, error: 'Zone d\'ajout de photos introuvable sur la page Vinted.' };

    const lot = new DataTransfer();
    liste.slice(0, champ.multiple ? MAX_AJOUT : 1).forEach((im, i) => {
      const bin = atob(im.b64);
      const octets = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) octets[k] = bin.charCodeAt(k);
      const nom = String(im.nom || 'photo-' + (i + 1) + '.jpg').replace(/[^\w.\-]/g, '_').slice(0, 60);
      lot.items.add(new File([octets], nom, { type: 'image/jpeg' }));
    });
    champ.files = lot.files;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
    planifierVerification(250);
    return { ok: true, nb: lot.files.length };
  }

  // ---------- Conversion en base64 ----------

  async function lireBlob(source) {
    if (source instanceof Blob) return source;
    try {
      const r = await fetch(source);
      if (!r.ok) throw new Error('lecture impossible');
      return await r.blob();
    } catch (e) {
      const rep = await envoyer({ type: 'fetchImage', url: source });
      if (!rep.ok) throw new Error(rep.error);
      const r2 = await fetch(rep.data);
      return await r2.blob();
    }
  }

  // cote : plus grand côté voulu (1024 px pour l'analyse, davantage pour préparer une photo de présentation).
  async function enJpegBase64(source, cote) {
    const max = Math.max(256, Math.min(1600, Number(cote) || COTE_MAX));
    const blob = await lireBlob(source);
    const image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const ratio = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (image.close) image.close();
    return canvas.toDataURL('image/jpeg', max > COTE_MAX ? 0.9 : 0.8).split(',')[1];
  }

  async function collecterPhotosBase64(cote) {
    const photos = trouverPhotosVinted();
    const images = [];
    for (const source of photos) {
      try {
        images.push(await enJpegBase64(source, cote));
      } catch (e) {
        console.warn('[AF] Photo illisible:', e);
      }
    }
    return images;
  }

  // ---------- Remplissage du formulaire ----------

  function texteAssocie(el) {
    const morceaux = [el.placeholder || '', el.getAttribute('aria-label') || '', el.name || '', el.id || ''];
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) morceaux.push(lab.textContent || '');
    }
    const parentLabel = el.closest('label');
    if (parentLabel) morceaux.push(parentLabel.textContent || '');
    return morceaux.join(' ').toLowerCase();
  }

  function chercherChamp(selecteurs, balises, motif) {
    for (const s of selecteurs) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    const candidats = Array.from(document.querySelectorAll(balises)).filter((el) => !horsZone(el));
    return candidats.find((el) => motif.test(texteAssocie(el))) || null;
  }

  const CHAMPS = {
    titre: () => chercherChamp(IA.CHAMPS.titre.selecteurs, IA.CHAMPS.titre.balises, IA.CHAMPS.titre.motif),
    description: () => chercherChamp(IA.CHAMPS.description.selecteurs, IA.CHAMPS.description.balises, IA.CHAMPS.description.motif),
    prix: () => chercherChamp(IA.CHAMPS.prix.selecteurs, IA.CHAMPS.prix.balises, IA.CHAMPS.prix.motif)
  };

  function ecrire(el, valeur) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    if (desc && desc.set) desc.set.call(el, valeur);
    else el.value = valeur;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function memeValeur(cle, lue, voulue) {
    if (cle === 'prix') {
      const a = parseFloat(String(lue).replace(',', '.').replace(/[^\d.]/g, ''));
      const b = parseFloat(String(voulue).replace(',', '.').replace(/[^\d.]/g, ''));
      return isFinite(a) && isFinite(b) && a === b;
    }
    return String(lue).trim() === String(voulue).trim();
  }

  // Valeurs écrites par l'extension : permettent de distinguer une saisie de l'utilisateur
  // (jamais écrasée sans confirmation) d'une valeur qu'elle a elle-même posée.
  const ecrits = {};

  // États par champ : 'rempli' (relu et confirmé), 'deja' (déjà identique), 'conserve' (saisie existante
  // différente, non écrasée), 'echec', 'introuvable', 'absent' (rien à écrire).
  // options.forcer : champs que l'utilisateur a confirmé de remplacer. options.seulement : limite aux champs listés.
  async function remplir(annonce, options) {
    const forcer = (options && options.forcer) || [];
    const seulement = (options && options.seulement) || null;
    const etats = {};
    const valeurs = {
      titre: annonce.titre || '',
      description: annonce.description || '',
      prix: formaterPrix(annonce.prix_suggere || annonce.prix)
    };
    for (const cle of Object.keys(valeurs)) {
      if (seulement && seulement.indexOf(cle) < 0) continue;
      etats[cle] = 'absent';
      if (!valeurs[cle]) continue;
      etats[cle] = 'introuvable';
      try {
        const el = CHAMPS[cle]();
        if (!el || el.disabled || el.readOnly) continue;
        const actuelle = String(el.value || '').trim();
        if (actuelle) {
          if (memeValeur(cle, actuelle, valeurs[cle])) {
            etats[cle] = 'deja';
            ecrits[cle] = actuelle;
            continue;
          }
          const poseParExtension = ecrits[cle] !== undefined && memeValeur(cle, actuelle, ecrits[cle]);
          if (!poseParExtension && forcer.indexOf(cle) < 0) {
            etats[cle] = 'conserve';
            continue;
          }
        }
        ecrire(el, valeurs[cle]);
        await pause(40);
        const relu = CHAMPS[cle]() || el;
        const ok = memeValeur(cle, relu.value, valeurs[cle]);
        if (ok) ecrits[cle] = String(relu.value).trim();
        etats[cle] = ok ? 'rempli' : 'echec';
      } catch (e) {
        etats[cle] = 'echec';
      }
    }
    return etats;
  }

  // La recommandation « Prix idéal » de Vinted remplace l'estimation de l'IA dès qu'elle s'affiche.
  // On ne lit pas les autres annonces : seul le montant déjà affiché sur ce formulaire est repris.
  function montantAffiche(texte) {
    const m = String(texte || '').match(/(\d+(?:[ \u00a0]?\d{3})*(?:[.,]\d{1,2})?)\s*€/);
    if (!m) return '';
    const n = Number(m[1].replace(/[ \u00a0]/g, '').replace(',', '.'));
    if (!isFinite(n) || n <= 0) return '';
    const cents = Math.round(n * 100);
    const reste = cents % 100;
    // Point, pas virgule : le champ Vinted affiche « NaN € » quand la valeur contient une virgule.
    return reste ? Math.floor(cents / 100) + '.' + String(reste).padStart(2, '0') : String(cents / 100);
  }

  function prixSaisi(valeur) {
    const a = parseFloat(String(valeur || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
    return isFinite(a) && a > 0;
  }

  function etiquettePrixIdeal(el) {
    if (el.children.length > 0 || !visible(el) || horsZone(el)) return false;
    const t = normaliser(el.textContent);
    if (t === 'prix ideal') return true;
    return /prix ideal$/.test(t) && !!montantAffiche(el.textContent) && t.indexOf('bonne affaire') < 0 && t.indexOf('premium') < 0;
  }

  function cartePrixIdeal() {
    const feuilles = Array.from(document.querySelectorAll('body *')).filter(etiquettePrixIdeal);
    for (const feuille of feuilles) {
      let parent = feuille;
      let carte = null;
      for (let i = 0; i < 8 && parent; i++, parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) break;
        const t = normaliser(parent.textContent);
        if (t.indexOf('bonne affaire') >= 0 || t.indexOf('premium') >= 0) break;
        if (montantAffiche(parent.textContent)) carte = parent;
      }
      if (carte) return { carte: carte, montant: montantAffiche(carte.textContent) };
    }
    return null;
  }

  function choisirPrixIdeal() {
    if (!estPageVente()) return false;
    const trouve = cartePrixIdeal();
    if (!trouve) return false;
    const el = CHAMPS.prix();
    if (!el || el.disabled || el.readOnly) return false;
    const actuelle = String(el.value || '').trim();
    const saisi = prixSaisi(actuelle);
    const poseeParNous = saisi && ecrits.prix !== undefined && memeValeur('prix', actuelle, ecrits.prix);
    if (saisi && !poseeParNous) return false;
    if (actuelle && memeValeur('prix', actuelle, trouve.montant)) {
      ecrits.prix = actuelle;
      return true;
    }
    const bouton = trouve.carte.closest('button, [role="button"]') || trouve.carte.querySelector('button, [role="button"]');
    const cible = (bouton && bouton.tagName !== 'A') ? bouton : trouve.carte;
    if (cible.tagName !== 'A' && !estBoutonValidation(cible)) cliquer(cible);
    const apres = CHAMPS.prix() || el;
    if (!memeValeur('prix', apres.value, trouve.montant)) ecrire(apres, trouve.montant);
    const final = CHAMPS.prix() || apres;
    if (!memeValeur('prix', final.value, trouve.montant)) return false;
    ecrits.prix = String(final.value).trim();
    return true;
  }

  function planifierPrixIdeal() {
    clearTimeout(minuteurPrix);
    minuteurPrix = setTimeout(choisirPrixIdeal, 300);
  }

  // ---------- Menus déroulants ----------

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Un bouton d'envoi du formulaire ou de publication n'est jamais cliqué par l'extension.
  function estBoutonValidation(el) {
    const bouton = el.closest && el.closest('button, input[type="submit"], [type="submit"], a, [role="button"]');
    if (!bouton) return false;
    if ((bouton.getAttribute('type') || '').toLowerCase() === 'submit') return true;
    const texte = normaliser(bouton.textContent || bouton.value || '');
    return /\b(publier|mettre en ligne|ajouter l'article|envoyer l'annonce)\b/.test(texte);
  }

  // Retourne false quand le clic est refusé (bouton de validation) : l'appelant ne doit alors rien annoncer.
  function cliquer(el) {
    if (estBoutonValidation(el)) return false;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
    return true;
  }

  const MENUS = IA.MENUS;

  function trouverMenu(def) {
    for (const s of def.selecteurs) {
      const el = document.querySelector(s);
      if (el && visible(el)) return el;
    }
    const zone = document.querySelector('main') || document.body;
    const etiquettes = Array.from(zone.querySelectorAll('label, span, div, p, h2, h3')).filter(
      (el) => !horsZone(el) && el.children.length === 0 && def.motif.test(normaliser(el.textContent)) && visible(el)
    );
    for (const et of etiquettes) {
      if (et.tagName === 'LABEL' && et.htmlFor) {
        const cible = document.getElementById(et.htmlFor);
        if (cible) return cible;
      }
      let parent = et.parentElement;
      for (let i = 0; i < 4 && parent; i++, parent = parent.parentElement) {
        const cible = parent.querySelector('input, [role="combobox"], [role="button"], button');
        if (cible && visible(cible)) return cible;
      }
    }
    return null;
  }

  function texteCourt(el) {
    const texte = normaliser(el.textContent);
    return texte && texte.length <= 40 ? texte : '';
  }

  // La liste des couleurs est souvent déjà dans la page, simplement masquée.
  // On retient ce qui était visible avant le clic : tout ce qui apparaît ensuite est une option.
  function optionsVisibles(tous, dejaVisibles) {
    return tous().filter((el) => el.children.length === 0 && visible(el) && !horsZone(el) && !dejaVisibles.has(el) && texteCourt(el));
  }

  function correspondTaille(texte, cible, jeton) {
    if (texte === cible) return true;
    if (!jeton) return false;
    return texte.split(/[^a-z0-9]+/).filter(Boolean).indexOf(cible) >= 0;
  }

  async function attendreOption(tous, dejaVisibles, cible, essaisMax, jeton) {
    let nbOptions = -1;
    let stable = 0;
    for (let essai = 0; essai < essaisMax; essai++) {
      await pause(40);
      const apparus = optionsVisibles(tous, dejaVisibles)
        .filter((el) => correspondTaille(texteCourt(el), cible, jeton))
        .sort((a, b) => (texteCourt(a) === cible ? 0 : 1) - (texteCourt(b) === cible ? 0 : 1) || a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      for (const option of apparus) {
        if (cliquer(option)) return true;
      }
      const proposes = optionsVisibles(tous, dejaVisibles);
      stable = proposes.length > 0 && proposes.length === nbOptions ? stable + 1 : 0;
      nbOptions = proposes.length;
      if (stable >= 6) return false;
    }
    return false;
  }

  function saisieMenu(menu) {
    const v = String(menu.value || '').trim();
    if (!v) return '';
    const ph = String(menu.placeholder || '').trim();
    if (ph && normaliser(v) === normaliser(ph)) return '';
    return v;
  }

  function saisirFiltre(menu, texte) {
    if (!menu || menu.tagName !== 'INPUT' || menu.disabled) return;
    menu.focus();
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(menu, texte);
    else menu.value = texte;
    menu.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Champ de recherche apparu après l'ouverture du menu (marque, couleur).
  function champRechercheMenu(tous, dejaVisibles) {
    const champs = tous().filter((el) =>
      el.tagName === 'INPUT' && visible(el) && !horsZone(el) && !dejaVisibles.has(el) &&
      !el.disabled && el.type !== 'radio' && el.type !== 'checkbox'
    );
    return champs.find((el) => /recherch|trouver|search|marque|brand/i.test((el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || ''))) || champs[0] || null;
  }

  function preparerTailles(brutes) {
    const ignore = /^(taille|pointure|eu|fr|uk|us|cm|ans)$/;
    const lettres = /^(xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl)$/;
    const sortie = [];
    for (const brut of brutes) {
      const mots = normaliser(brut).split(/[^a-z0-9]+/).filter((m) => m && !ignore.test(m));
      const lettre = mots.find((m) => lettres.test(m));
      const nombre = mots.find((m) => /^\d{1,3}$/.test(m));
      if (lettre) sortie.push(lettre);
      else if (nombre) sortie.push(nombre);
      else if (mots.length) sortie.push(mots[mots.length - 1]);
    }
    return sortie;
  }

  async function choisirDansMenu(def, valeurs) {
    const lus = (valeurs || []).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    const brutes = def.jeton ? preparerTailles(lus) : lus;
    const cibles = brutes.map(normaliser);
    if (!cibles.length) return 'a_choisir';
    let menu = trouverMenu(def);
    if (!menu && def.attendre) {
      for (let i = 0; i < 15 && !menu; i++) {
        await pause(80);
        menu = trouverMenu(def);
      }
    }
    if (!menu) return 'a_choisir';
    const saisie = saisieMenu(menu);
    if (saisie) {
      if (def.conserverSiRempli) return 'deja';
      const actuelle = normaliser(saisie);
      return cibles.some((c) => actuelle.indexOf(c) >= 0) ? 'deja' : 'conserve';
    }

    const tous = () => Array.from(document.querySelectorAll('body *'));
    const dejaVisibles = new WeakSet(tous().filter((el) => visible(el)));
    const chercheCouleur = (def.selecteurs || []).some((s) => s.indexOf('color') >= 0);

    if (menu.scrollIntoView) menu.scrollIntoView({ block: 'center' });
    cliquer(menu);

    let choisis = 0;
    for (let i = 0; i < cibles.length; i++) {
      let ok = await attendreOption(tous, dejaVisibles, cibles[i], chercheCouleur ? 30 : 20, def.jeton);
      // Liste trop longue pour être affichée en entier : on tape la couleur pour la faire apparaître.
      if (!ok && (chercheCouleur || def.recherche)) {
        const champ = def.recherche ? (champRechercheMenu(tous, dejaVisibles) || menu) : menu;
        saisirFiltre(champ, brutes[i]);
        ok = await attendreOption(tous, dejaVisibles, cibles[i], 20, def.jeton);
        if (!ok && champ === menu && normaliser(menu.value) === cibles[i]) saisirFiltre(menu, '');
      }
      if (ok) choisis++;
      await pause(80);
    }

    const ouvert = () => tous().some((el) => visible(el) && !horsZone(el) && !dejaVisibles.has(el));
    if (ouvert()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await pause(60);
      if (ouvert()) {
        cliquer(menu);
        await pause(60);
      }
    }
    return choisis > 0 ? 'rempli' : 'a_choisir';
  }

  // « Bonnets » et « Bonnet » désignent la même rubrique.
  function proche(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const court = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    if (long.indexOf(court) !== 0) return false;
    const reste = long.slice(court.length);
    return reste === 's' || reste === 'x' || reste === 'es';
  }

  const RACINES_CATEGORIE = {
    hommes: 1, femmes: 1, enfants: 1, fille: 1, filles: 1, garcon: 1, garcons: 1,
    bebe: 1, bebes: 1, accessoires: 1, vetements: 1
  };

  function infoCategorie(annonce) {
    const sous = String(annonce.sousCategorie || annonce.sous_categorie || '').trim();
    const cat = String(annonce.categorie || '').trim();
    const segments = cat.split(/\s*>\s*/).map((s) => s.trim()).filter(Boolean);
    return { feuille: sous || segments[segments.length - 1] || '', segments: segments, titre: String(annonce.titre || '') };
  }

  function scoreLigne(ligne, info) {
    const titre = normaliser(ligne.titre);
    const chemin = normaliser(ligne.chemin);
    const feuille = normaliser(info.feuille);
    let score = 0;
    if (feuille && !RACINES_CATEGORIE[feuille] && (titre === feuille || proche(titre, feuille))) score += 12;
    const mots = normaliser(info.titre).split(' ').filter((m) => m.length >= 3);
    for (let i = 0; i < mots.length; i++) {
      if (proche(mots[i], titre) || mots[i] === titre) {
        score += 10 - Math.min(i, 4);
        break;
      }
    }
    for (const seg of info.segments) {
      const s = normaliser(seg);
      if (!s || s === titre || proche(s, titre)) continue;
      if (chemin.indexOf(s) >= 0) score += 4;
    }
    return score;
  }

  function meilleurLigne(lignes, info) {
    let meilleur = null;
    let score = 7;
    for (const ligne of lignes) {
      const s = scoreLigne(ligne, info);
      if (s > score) {
        score = s;
        meilleur = ligne;
      }
    }
    return meilleur;
  }

  // Une suggestion Vinted a un nom (« Bonnets ») et un chemin (« Femmes > Chapeaux et casquettes »).
  function lignesCategorie() {
    const lignes = [];
    const vus = new Set();
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!visible(el) || horsZone(el) || el.children.length === 0) continue;
      const feuilles = Array.from(el.querySelectorAll('*')).filter((n) => n.children.length === 0 && visible(n));
      if (feuilles.length < 2 || feuilles.length > 6) continue;
      const textes = feuilles
        .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length <= 80);
      const chemins = textes.filter((t) => t.indexOf('>') >= 0);
      if (chemins.length !== 1) continue;
      const titre = textes.find((t) => t.indexOf('>') < 0 && t.length <= 40 && normaliser(t) !== 'suggestions');
      if (!titre) continue;
      const cle = normaliser(titre) + '|' + normaliser(chemins[0]);
      if (vus.has(cle)) continue;
      vus.add(cle);
      const radio = el.querySelector('input[type="radio"], [role="radio"], [role="option"]');
      lignes.push({ titre: titre, chemin: chemins[0], cible: radio || el });
    }
    return lignes;
  }

  function trouverCategorie() {
    const menu = trouverMenu(MENUS.categorie);
    if (menu) return menu;
    return Array.from(document.querySelectorAll('input, [role="combobox"], button')).find((el) => {
      if (!visible(el) || horsZone(el)) return false;
      const indice = normaliser((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.value || ''));
      return indice.indexOf('selectionne une categorie') >= 0 || indice.indexOf('selectionner une categorie') >= 0;
    }) || null;
  }

  function champRechercheCategorie(menu) {
    const indice = (el) => normaliser((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || ''));
    const candidats = Array.from(document.querySelectorAll('input')).filter((el) => el !== menu && visible(el) && !el.disabled);
    return candidats.find((el) => {
      const i = indice(el);
      return i.indexOf('trouver') >= 0 || i.indexOf('recherch') >= 0;
    }) || candidats.find((el) => {
      const i = indice(el);
      return i.indexOf('categor') >= 0 && i.indexOf('selectionne') < 0 && i.indexOf('selectionner') < 0;
    }) || null;
  }

  function valeurCategorie(menu) {
    const v = normaliser(String(menu.value || ''));
    if (!v || v.indexOf('selectionne une categorie') >= 0 || v.indexOf('selectionner une categorie') >= 0) return '';
    return v;
  }

  async function attendreCategorie(info, essais) {
    let vues = -1;
    let stable = 0;
    for (let i = 0; i < essais; i++) {
      await pause(40);
      const lignes = lignesCategorie();
      const meilleur = meilleurLigne(lignes, info);
      if (meilleur) return meilleur;
      stable = lignes.length > 0 && lignes.length === vues ? stable + 1 : 0;
      vues = lignes.length;
      if (stable >= 3) return null;
    }
    return null;
  }

  function cliquerChoix(el) {
    if (!cliquer(el)) return false;
    const radio = el.matches && el.matches('input[type="radio"]') ? el : (el.querySelector ? el.querySelector('input[type="radio"]') : null);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  async function choisirCategorie(annonce) {
    const info = infoCategorie(annonce);
    if (!info.feuille && !info.titre) return 'absent';
    const menu = trouverCategorie();
    if (!menu) return 'a_choisir';
    const actuelle = valeurCategorie(menu);
    if (actuelle) {
      const feuille = normaliser(info.feuille);
      return feuille && (actuelle.indexOf(feuille) >= 0 || proche(feuille, actuelle)) ? 'deja' : 'conserve';
    }

    if (menu.scrollIntoView) menu.scrollIntoView({ block: 'center' });
    let choix = meilleurLigne(lignesCategorie(), info);
    if (!choix) {
      cliquer(menu);
      choix = await attendreCategorie(info, 15);
    }
    if (!choix) {
      const terme = (info.feuille && !RACINES_CATEGORIE[normaliser(info.feuille)]) ? info.feuille : (info.titre.split(/\s+/)[0] || '');
      const champ = champRechercheCategorie(menu);
      if (champ && terme) {
        saisirFiltre(champ, terme);
        choix = await attendreCategorie(info, 15);
      }
    }
    const ok = !!(choix && cliquerChoix(choix.cible));
    if (!ok) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await pause(40);
    }
    return ok ? 'rempli' : 'a_choisir';
  }

  async function remplirMenus(annonce) {
    const resultat = { categorie: 'a_choisir', etat: 'a_choisir', couleurs: 'a_choisir', taille: 'a_choisir', matiere: 'a_choisir', marque: 'a_choisir' };
    try {
      resultat.categorie = await choisirCategorie(annonce);
    } catch (e) {
      resultat.categorie = 'echec';
    }
    const essais = [
      ['etat', [annonce.etat]],
      ['couleurs', Array.isArray(annonce.couleurs) ? annonce.couleurs.slice(0, 2) : []],
      ['taille', [annonce.taille]],
      ['matiere', [annonce.matiere]]
    ];
    for (const [cle, valeurs] of essais) {
      try {
        resultat[cle] = await choisirDansMenu(MENUS[cle], valeurs);
      } catch (e) {
        resultat[cle] = 'echec';
      }
    }
    if (annonce.marque && String(annonce.marque).trim()) {
      try {
        resultat.marque = await choisirDansMenu(MENUS.marque, [annonce.marque]);
      } catch (e) {
        resultat.marque = 'echec';
      }
    }
    return resultat;
  }

  // ---------- Interface minimale : indicateur d'état ----------

  const STYLE = `
    :host { all: initial; }
    .declencheur {
      position: relative;
      display: block;
      width: 112px; height: 112px;
      padding: 10px;
      border: 3px solid #fff;
      border-radius: 50%;
      background: #fff;
      cursor: pointer;
      overflow: hidden;
      animation: ombre-vive 2.4s ease-in-out infinite;
    }
    .declencheur img {
      width: 100%; height: 100%;
      display: block; object-fit: contain;
      border-radius: 50%;
    }
    .declencheur:hover { animation-duration: 1.2s; }
    .declencheur:active { transform: translateY(1px); }
    .declencheur.actif { animation-duration: 0.9s; }
    @keyframes ombre-vive {
      0%   { box-shadow: -10px 6px 0 rgba(109, 40, 217, 0.55), 0 12px 18px rgba(109, 40, 217, 0.35); }
      50%  { box-shadow: 12px 8px 0 rgba(20, 184, 166, 0.7), 0 16px 22px rgba(20, 184, 166, 0.4); }
      100% { box-shadow: -10px 6px 0 rgba(109, 40, 217, 0.55), 0 12px 18px rgba(109, 40, 217, 0.35); }
    }
    .badge {
      position: absolute; top: 0; right: 0;
      min-width: 18px; height: 18px; padding: 0 5px;
      border-radius: 999px;
      background: #6D28D9; color: #fff;
      font: 700 11px/18px system-ui, sans-serif;
      text-align: center;
      box-shadow: 0 2px 6px rgba(109, 40, 217, 0.4);
    }
    @media (prefers-reduced-motion: reduce) {
      .declencheur { animation: none; box-shadow: 0 8px 16px rgba(109, 40, 217, 0.4); }
    }
  `;

  let hote = null;
  let bouton = null;

  function creerInterface() {
    hote = document.createElement('div');
    hote.id = 'annonce-futee-declencheur';
    // La zone cliquable est l'hôte lui-même. Un bouton « fixed » dans l'ombre
    // s'affiche, mais le clic traverse si l'hôte n'a pas de boîte.
    hote.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
    const racine = hote.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    racine.appendChild(style);

    bouton = document.createElement('button');
    bouton.className = 'declencheur';
    bouton.type = 'button';
    majBouton(0);

    bouton.addEventListener('click', () => {
      envoyer({ type: 'openSidePanel' }).then((rep) => {
        if (rep && rep.ok) return;
        const texte = (rep && rep.error) || 'Panneau impossible à ouvrir.';
        bouton.title = texte;
        setTimeout(() => { if (bouton.title === texte) bouton.title = 'Ouvrir le panneau complet'; }, 4000);
      });
    });

    racine.appendChild(bouton);
    document.documentElement.appendChild(hote);
  }

  function majBouton(nbPhotos, enCours = false) {
    if (!bouton) return;
    bouton.classList.toggle('actif', enCours);
    const logo = chrome.runtime.getURL('icons/logo.jpg');
    const badge = nbPhotos > 0 ? '<span class="badge">' + nbPhotos + '</span>' : '';
    bouton.innerHTML = '<img src="' + logo + '" alt="">' + badge;
    bouton.title = enCours ? 'Analyse en cours' : 'Ouvrir le panneau complet';
    bouton.setAttribute('aria-label', bouton.title);
  }

  // ---------- Messages depuis le panneau latéral ----------

  chrome.runtime.onMessage.addListener((msg, sender, repondre) => {
    if (!msg || !sender || sender.id !== chrome.runtime.id) return false;

    if (msg.type === 'collectPhotos') {
      collecterPhotosBase64(msg.cote).then((images) => {
        repondre({ ok: true, images: images });
      });
      return true;
    }

    if (msg.type === 'fillListing') {
      (async () => {
        const data = msg.annonce;
        if (!data || typeof data !== 'object') {
          repondre({ ok: false, error: 'Annonce absente.' });
          return;
        }
        if (!estPageVente()) {
          repondre({ ok: false, error: 'Ouvre la page Vinted « Vendre un article ».' });
          return;
        }
        const seulement = Array.isArray(msg.seulement) ? msg.seulement : null;
        const forcer = Array.isArray(msg.forcer) ? msg.forcer : [];
        let bloquees = 0;
        const bloquer = (e) => { e.preventDefault(); e.stopImmediatePropagation(); bloquees++; };
        window.addEventListener('submit', bloquer, true);
        try {
          const fait = await remplir(data, { forcer: forcer, seulement: seulement });
          const menus = seulement ? {} : await remplirMenus(data);
          if (!seulement || seulement.indexOf('prix') >= 0) choisirPrixIdeal();
          repondre({ ok: true, fait: fait, menus: menus, soumissionsBloquees: bloquees });
        } finally {
          window.removeEventListener('submit', bloquer, true);
        }
      })();
      return true;
    }

    if (msg.type === 'addPhotos') {
      try {
        repondre(ajouterPhotos(msg.images));
      } catch (e) {
        repondre({ ok: false, error: 'Ajout des photos impossible : ' + (e && e.message ? e.message : e) });
      }
      return true;
    }

    if (msg.type === 'getPageInfo') {
      const etat = analyserPhotos();
      repondre({
        ok: true,
        estPageVente: estPageVente(),
        photos: etat.sources.length,
        enChargement: etat.enChargement,
        hash: calculerHash(etat.sources),
        url: location.href
      });
      return true;
    }

    if (msg.type === 'setAnalyseEnCours') {
      analyseEnCours = !!msg.enCours;
      majBouton(trouverPhotosVinted().length, analyseEnCours);
      repondre({ ok: true });
      return true;
    }

    if (msg.type === 'forceCheckPhotos') {
      verifierPhotos();
      repondre({ ok: true });
      return true;
    }

    return false;
  });

  // ---------- Gestion de la navigation ----------

  let dernierChemin = null;

  function synchroniser() {
    const cheminActuel = location.pathname;
    
    if (cheminActuel !== dernierChemin) {
      dernierChemin = cheminActuel;
      dernieresPhotosHash = '';
      dernierChargement = 0;
      tentativesChargement = 0;

      if (estPageVente()) {
        if (!hote) creerInterface();
        hote.style.display = '';
        demarrerObservation();
        // Vérifier les photos après un court délai
        setTimeout(verifierPhotos, 300);
      } else {
        if (hote) hote.style.display = 'none';
        arreterObservation();
      }
    }
  }

  window.__annonceFutee = {
    estPageVente, trouverPhotosVinted, remplir, remplirMenus, formaterPrix, choisirPrixIdeal, CHAMPS, synchroniser,
    verifierPhotos, collecterPhotosBase64
  };

  // Suivi de la navigation (page Vinted en application monopage) : compare seulement le chemin.
  setInterval(synchroniser, 1000);
  synchroniser();

  // Garde le service de l'extension éveillé : sinon le clic sur le bouton
  // arrive trop tard pour que Chrome accepte d'ouvrir le panneau.
  function maintenirService() {
    try {
      const port = chrome.runtime.connect({ name: 'maintien' });
      const battement = setInterval(() => {
        try { port.postMessage({ type: 'battement' }); } catch (e) { clearInterval(battement); }
      }, 20000);
      port.onDisconnect.addListener(() => {
        clearInterval(battement);
        setTimeout(maintenirService, 500);
      });
    } catch (e) { /* extension rechargée : la page doit être actualisée */ }
  }
  maintenirService();

})();
