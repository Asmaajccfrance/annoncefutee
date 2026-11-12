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
  let analyseEnCours = false;

  function estPageVente() {
    return /^\/items\/(new|\d+\/edit)/.test(location.pathname);
  }

  // ---------- Récupération des photos ----------

  function horsZone(el) {
    return !!el.closest('header, nav, footer, #annonce-futee-declencheur');
  }

  function trouverPhotosVinted() {
    if (!estPageVente()) return [];
    
    // Zone du formulaire de vente
    const zone = document.querySelector('main') || document.body;
    
    // Chercher les images dans la zone d'upload de photos
    // Vinted utilise des conteneurs spécifiques pour les photos uploadées
    const conteneurs = [
      // Sélecteurs pour les photos uploadées sur Vinted
      '[data-testid*="photo"]',
      '[class*="photo-upload"]',
      '[class*="image-upload"]',
      '[class*="dropzone"]',
      '[class*="ItemPhoto"]',
      'form [class*="photo"]'
    ];

    const imgs = [];
    const vus = new Set();

    // D'abord chercher les images blob/data (photos locales uploadées)
    zone.querySelectorAll('img').forEach((img) => {
      if (!img.src || horsZone(img)) return;
      if (vus.has(img.src)) return;
      
      // Photos locales (blob ou data URL)
      if (/^(blob:|data:image\/)/.test(img.src)) {
        const rect = img.getBoundingClientRect();
        if (rect.width >= 50 && rect.height >= 50) {
          vus.add(img.src);
          imgs.push(img.src);
        }
      }
    });

    // Si pas de photos locales, chercher les images du CDN Vinted
    if (imgs.length === 0) {
      zone.querySelectorAll('img').forEach((img) => {
        if (!img.src || horsZone(img) || vus.has(img.src)) return;
        if (!IA.hoteImageAutorise(img.src)) return;
        
        const rect = img.getBoundingClientRect();
        if (rect.width >= 80 && rect.height >= 80) {
          vus.add(img.src);
          imgs.push(img.src);
        }
      });
    }

    return imgs.slice(0, MAX_PHOTOS);
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

  async function notifierChangementPhotos(photos) {
    const maintenant = Date.now();
    const hash = calculerHash(photos);
    
    // Éviter les notifications en double (debounce)
    if (hash === dernieresPhotosHash && maintenant - dernierEnvoi < 2000) {
      return;
    }
    
    dernieresPhotosHash = hash;
    dernierEnvoi = maintenant;

    // Notifier le background/sidepanel
    envoyer({
      type: 'photosChanged',
      count: photos.length,
      hash: hash,
      pageUrl: location.href,
      timestamp: maintenant
    });
  }

  // ---------- Observation automatique du DOM ----------

  function demarrerObservation() {
    if (observateurActif || !estPageVente()) return;

    const zone = document.querySelector('main') || document.body;
    
    observateurActif = new MutationObserver((mutations) => {
      // Vérifier si les mutations concernent des images
      let peutAvoirPhotos = false;
      
      for (const mutation of mutations) {
        // Nouvel élément ajouté
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              if (node.tagName === 'IMG' || node.querySelector?.('img')) {
                peutAvoirPhotos = true;
                break;
              }
            }
          }
        }
        // Attribut src changé sur une image
        if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
          if (mutation.target.tagName === 'IMG') {
            peutAvoirPhotos = true;
          }
        }
        if (peutAvoirPhotos) break;
      }

      if (peutAvoirPhotos) {
        // Délai pour laisser le DOM se stabiliser
        setTimeout(verifierPhotos, 300);
      }
    });

    observateurActif.observe(zone, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    // Écouter aussi les événements de fichiers
    zone.addEventListener('change', gererChangementFichier, true);
    zone.addEventListener('drop', gererDrop, true);

    // Vérification initiale
    setTimeout(verifierPhotos, 500);
  }

  function arreterObservation() {
    if (observateurActif) {
      observateurActif.disconnect();
      observateurActif = null;
    }
  }

  function gererChangementFichier(e) {
    if (e.target?.tagName === 'INPUT' && e.target.type === 'file') {
      setTimeout(verifierPhotos, 500);
    }
  }

  function gererDrop(e) {
    if (e.dataTransfer?.files?.length > 0) {
      setTimeout(verifierPhotos, 500);
    }
  }

  function verifierPhotos() {
    if (!estPageVente()) return;
    
    const photos = trouverPhotosVinted();
    const hash = calculerHash(photos);
    
    if (hash !== dernieresPhotosHash) {
      notifierChangementPhotos(photos);
    }
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

  async function enJpegBase64(source) {
    const blob = await lireBlob(source);
    const image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const ratio = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (image.close) image.close();
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  }

  async function collecterPhotosBase64() {
    const photos = trouverPhotosVinted();
    const images = [];
    for (const source of photos) {
      try {
        images.push(await enJpegBase64(source));
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

  function remplir(annonce) {
    const fait = { titre: false, description: false, prix: false };
    const valeurs = {
      titre: annonce.titre || '',
      description: annonce.description || '',
      prix: formaterPrix(annonce.prix_suggere || annonce.prix)
    };
    for (const cle of Object.keys(valeurs)) {
      if (!valeurs[cle]) continue;
      try {
        const el = CHAMPS[cle]();
        if (el && !el.disabled && !el.readOnly) {
          ecrire(el, valeurs[cle]);
          fait[cle] = true;
        }
      } catch (e) { /* champ introuvable */ }
    }
    return fait;
  }

  // ---------- Menus déroulants ----------

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function cliquer(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
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

  async function choisirDansMenu(def, valeurs) {
    const cibles = (valeurs || []).map(normaliser).filter(Boolean);
    if (!cibles.length) return 'a_choisir';
    const menu = trouverMenu(def);
    if (!menu) return 'a_choisir';
    if (menu.value && String(menu.value).trim()) return 'deja';

    const tous = () => Array.from(document.querySelectorAll('body *'));
    const avant = new WeakSet(tous());
    const nouveau = (el) => !avant.has(el) && !horsZone(el) && visible(el);

    if (menu.scrollIntoView) menu.scrollIntoView({ block: 'center' });
    cliquer(menu);

    let choisis = 0;
    for (const cible of cibles) {
      let option = null;
      for (let essai = 0; essai < 15 && !option; essai++) {
        await pause(100);
        option = tous().find((el) => nouveau(el) && el.children.length === 0 && normaliser(el.textContent) === cible) || null;
      }
      if (!option) continue;
      cliquer(option);
      choisis++;
      await pause(200);
    }

    const ouvert = () => tous().some(nouveau);
    if (ouvert()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await pause(150);
      if (ouvert()) {
        cliquer(menu);
        await pause(150);
      }
    }
    return choisis > 0 ? 'rempli' : 'a_choisir';
  }

  async function remplirMenus(annonce) {
    const resultat = { etat: 'a_choisir', couleurs: 'a_choisir', taille: 'a_choisir', matiere: 'a_choisir' };
    const essais = [
      ['etat', [annonce.etat]],
      ['couleurs', Array.isArray(annonce.couleurs) ? annonce.couleurs.slice(0, 2) : []],
      ['taille', [annonce.taille]],
      ['matiere', [annonce.matiere]]
    ];
    for (const [cle, valeurs] of essais) {
      try {
        resultat[cle] = await choisirDansMenu(MENUS[cle], valeurs);
      } catch (e) { /* menu inattendu */ }
    }
    return resultat;
  }

  // ---------- Interface minimale : indicateur d'état ----------

  const STYLE = `
    :host { all: initial; }
    .declencheur {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; background: #6D28D9; color: #fff;
      border: none; border-radius: 24px; cursor: pointer;
      font: 600 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(109, 40, 217, 0.35);
      transition: transform 0.15s ease-out, box-shadow 0.15s ease-out, background 0.15s;
    }
    .declencheur:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(109, 40, 217, 0.45);
    }
    .declencheur:active { transform: translateY(0); }
    .declencheur svg { width: 18px; height: 18px; fill: currentColor; }
    .declencheur.actif { background: #149388; }
    .declencheur.actif::after {
      content: '';
      width: 8px; height: 8px;
      background: #4ADE80;
      border-radius: 50%;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.2); }
    }
    .badge {
      background: rgba(255,255,255,0.25);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
    }
    @media (prefers-reduced-motion: reduce) {
      .declencheur, .declencheur::after { transition: none; animation: none; }
    }
  `;

  let hote = null;
  let bouton = null;

  function creerInterface() {
    hote = document.createElement('div');
    hote.id = 'annonce-futee-declencheur';
    const racine = hote.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    racine.appendChild(style);

    bouton = document.createElement('button');
    bouton.className = 'declencheur';
    bouton.type = 'button';
    majBouton(0);

    bouton.addEventListener('click', () => {
      envoyer({ type: 'openSidePanel' }).catch(() => {});
    });

    racine.appendChild(bouton);
    document.documentElement.appendChild(hote);
  }

  function majBouton(nbPhotos, enCours = false) {
    if (!bouton) return;
    
    bouton.classList.toggle('actif', enCours);
    
    if (enCours) {
      bouton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <span>Analyse en cours...</span>
      `;
    } else if (nbPhotos > 0) {
      bouton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <span>Ouvrir le panneau complet</span>
        <span class="badge">${nbPhotos}</span>
      `;
    } else {
      bouton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <span>Ouvrir le panneau complet</span>
      `;
    }
    bouton.setAttribute('aria-label', 'Ouvrir le panneau complet');
  }

  // ---------- Messages depuis le panneau latéral ----------

  chrome.runtime.onMessage.addListener((msg, sender, repondre) => {
    if (!msg || !sender || sender.id !== chrome.runtime.id) return false;

    if (msg.type === 'collectPhotos') {
      collecterPhotosBase64().then((images) => {
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
        const fait = remplir(data);
        const menus = await remplirMenus(data);
        repondre({ ok: true, fait: fait, menus: menus });
      })();
      return true;
    }

    if (msg.type === 'getPageInfo') {
      const photos = trouverPhotosVinted();
      repondre({
        ok: true,
        estPageVente: estPageVente(),
        photos: photos.length,
        hash: calculerHash(photos),
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

      if (estPageVente()) {
        if (!hote) creerInterface();
        hote.style.display = '';
        demarrerObservation();
        // Vérifier les photos après un court délai
        setTimeout(verifierPhotos, 800);
      } else {
        if (hote) hote.style.display = 'none';
        arreterObservation();
      }
    }
  }

  window.__annonceFutee = {
    estPageVente, trouverPhotosVinted, remplir, remplirMenus, formaterPrix, CHAMPS, synchroniser,
    verifierPhotos, collecterPhotosBase64
  };

  function planifier() {
    synchroniser();
    
    // Sur page de vente, vérifier périodiquement (backup de l'observateur)
    if (estPageVente()) {
      const photos = trouverPhotosVinted();
      majBouton(photos.length, analyseEnCours);
    }
    
    setTimeout(planifier, estPageVente() ? 1500 : 3000);
  }
  planifier();
})();
