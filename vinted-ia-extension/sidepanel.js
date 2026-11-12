// Annonce Futée — Panneau latéral Chrome
// Gère l'interface utilisateur et orchestre les modules batch et studio

(async () => {
  'use strict';

  const IA = globalThis.VintedIA;
  const Studio = globalThis.AnnonceFuteeStudio;
  const Batch = globalThis.AnnonceFuteeBatch;

  if (!IA || !Studio || !Batch) {
    console.error('[AF] Modules manquants');
    return;
  }

  // ========== ÉTAT ==========
  let token = null;
  let backendUrl = '';
  let credits = null;
  let sectionActive = 'dashboard';
  let albumActif = null;
  let photoActive = null;
  let retoucheActive = null;
  let recadrageEnCours = null;
  
  // État des brouillons (persistant)
  let brouillons = [];
  
  // État de l'automatisation
  let autoGenerer = false;
  let autoRemplir = true;
  let dernierHashTraite = '';
  let generationEnCours = false;
  let dernierBrouillonGenere = null;
  
  async function chargerBrouillons() {
    try {
      const data = await chrome.storage.local.get(['brouillons']);
      brouillons = Array.isArray(data.brouillons) ? data.brouillons : [];
    } catch (e) {
      brouillons = [];
    }
  }
  
  async function sauvegarderBrouillons() {
    try {
      await chrome.storage.local.set({ brouillons: brouillons });
    } catch (e) {
      console.warn('[AF] Erreur sauvegarde brouillons:', e);
    }
  }

  // ========== UTILITAIRES ==========
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  function afficherStatut(msg, type = 'info') {
    const el = $('#statut');
    el.textContent = msg;
    el.className = 'statut ' + type;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, type === 'erreur' ? 6000 : 4000);
  }

  // ========== NAVIGATION ==========
  function naviguerVers(section) {
    sectionActive = section;
    $$('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === section);
    });
    $$('.section').forEach((sec) => {
      sec.hidden = sec.id !== section;
    });
    if (section === 'dashboard') rafraichirDashboard();
    if (section === 'photos') rafraichirGalerie();
    if (section === 'creer') rafraichirCreation();
    if (section === 'annonces') rafraichirAnnonces();
  }

  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => naviguerVers(btn.dataset.section));
  });

  // ========== DASHBOARD ==========
  function rafraichirDashboard() {
    const liste = Array.isArray(brouillons) ? brouillons : [];
    const stats = Batch.calculerStatistiques(liste);
    $('#stat-brouillons').textContent = stats.brouillons || 0;
    $('#stat-prets').textContent = stats.prets || 0;
    $('#stat-valeur').textContent = (stats.valeurTotale || 0).toFixed(0) + ' €';
    $('#stat-credits').textContent = credits !== null ? credits : '--';

    // Afficher activité récente
    const recents = Batch.trierBrouillons(liste, 'date_desc').slice(0, 3);
    const listeEl = $('#activite-liste');
    const videEl = $('#activite-vide');
    listeEl.innerHTML = '';

    if (recents.length === 0) {
      videEl.hidden = false;
    } else {
      videEl.hidden = true;
      recents.forEach((b) => {
        const div = document.createElement('div');
        div.className = 'annonce-carte';
        div.innerHTML = `
          <img class="annonce-photo" src="${b.photoUrl || ''}" alt="">
          <div class="annonce-infos">
            <div class="annonce-titre">${escapeHtml(b.titre || 'Sans titre')}</div>
            <div class="annonce-meta">${b.categorie || 'Non catégorisé'}</div>
            <div class="annonce-prix">${b.prix ? b.prix + ' €' : '–'}</div>
          </div>
        `;
        div.addEventListener('click', () => {
          naviguerVers('annonces');
        });
        listeEl.appendChild(div);
      });
    }
  }

  $('#action-importer').addEventListener('click', () => {
    naviguerVers('photos');
    $('#fichiers').click();
  });

  $('#action-vinted').addEventListener('click', () => {
    naviguerVers('photos');
    recupererPhotosVinted();
  });

  // ========== PHOTOS ==========
  function creerAlbumSiBesoin() {
    if (!albumActif) {
      albumActif = Studio.creerAlbumAvecId('Import ' + new Date().toLocaleDateString('fr-FR'));
    }
    return albumActif;
  }

  async function importerFichiers(fichiers) {
    if (!fichiers || fichiers.length === 0) return;
    const album = creerAlbumSiBesoin();
    let nbOk = 0;

    for (const fichier of fichiers) {
      if (!fichier.type.startsWith('image/')) continue;
      try {
        const base64 = await lireEnBase64(fichier);
        Studio.ajouterPhotoParId(album.id, base64, fichier.name);
        nbOk++;
      } catch (e) {
        console.warn('[AF] Erreur import:', e);
      }
    }

    rafraichirGalerie();
    if (nbOk > 0) {
      afficherStatut(`${nbOk} photo${nbOk > 1 ? 's' : ''} importée${nbOk > 1 ? 's' : ''}.`, 'succes');
    }
  }

  function lireEnBase64(fichier) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(fichier);
    });
  }

  async function recupererPhotosVinted() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) {
        afficherStatut('Aucun onglet actif.', 'erreur');
        return;
      }
      const rep = await chrome.tabs.sendMessage(tabs[0].id, { type: 'collectPhotos' });
      if (!rep || !rep.ok || !rep.images || rep.images.length === 0) {
        afficherStatut('Aucune photo trouvée sur la page.', 'info');
        return;
      }

      const album = creerAlbumSiBesoin();
      rep.images.forEach((b64, i) => {
        const dataUrl = b64.startsWith('data:') ? b64 : 'data:image/jpeg;base64,' + b64;
        Studio.ajouterPhotoParId(album.id, dataUrl, 'vinted-' + (i + 1) + '.jpg');
      });

      rafraichirGalerie();
      afficherStatut(`${rep.images.length} photo(s) récupérée(s).`, 'succes');
    } catch (e) {
      afficherStatut('Impossible de récupérer les photos.', 'erreur');
    }
  }

  function rafraichirGalerie() {
    const galerie = $('#galerie');
    galerie.innerHTML = '';

    const photos = albumActif ? Studio.listerPhotos(albumActif.id) : [];
    $('#compteur-photos').textContent = photos.length + ' photo' + (photos.length !== 1 ? 's' : '');
    $('#vers-creation').hidden = photos.length === 0;

    photos.forEach((photo, i) => {
      const div = document.createElement('div');
      div.className = 'vignette' + (photoActive && photoActive.id === photo.id ? ' active' : '');
      div.innerHTML = `
        <img src="${photo.modifiee || photo.source}" alt="Photo ${i + 1}">
        <span class="vignette-badge">${i + 1}</span>
        <button type="button" class="vignette-suppr" title="Supprimer">×</button>
      `;
      div.addEventListener('click', (e) => {
        if (e.target.classList.contains('vignette-suppr')) {
          Studio.supprimerPhoto(albumActif.id, photo.id);
          if (photoActive && photoActive.id === photo.id) {
            photoActive = null;
            $('#apercu-container').hidden = true;
          }
          rafraichirGalerie();
          return;
        }
        selectionnerPhoto(photo);
      });
      galerie.appendChild(div);
    });
  }

  function selectionnerPhoto(photo) {
    photoActive = photo;
    retoucheActive = null;
    cacherPanneauxRetouche();
    $$('.vignette').forEach((v, i) => {
      const photos = Studio.listerPhotos(albumActif.id);
      v.classList.toggle('active', photos[i] && photos[i].id === photo.id);
    });
    $('#apercu-container').hidden = false;
    $('#apercu-nom').textContent = photo.nom || 'Photo';
    afficherApercu('apres');
  }

  function afficherApercu(mode) {
    if (!photoActive) return;
    const canvas = $('#apercu');
    const src = mode === 'avant' ? photoActive.source : (photoActive.modifiee || photoActive.source);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(canvas.parentElement.clientWidth / img.width, 280 / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;

    $('#voir-avant').classList.toggle('active', mode === 'avant');
    $('#voir-apres').classList.toggle('active', mode === 'apres');
  }

  $('#voir-avant').addEventListener('click', () => afficherApercu('avant'));
  $('#voir-apres').addEventListener('click', () => afficherApercu('apres'));

  // Zone d'import
  const zoneImport = $('#zone-import');
  const inputFichiers = $('#fichiers');

  zoneImport.addEventListener('click', () => inputFichiers.click());
  inputFichiers.addEventListener('change', () => importerFichiers(inputFichiers.files));

  zoneImport.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneImport.classList.add('survol');
  });
  zoneImport.addEventListener('dragleave', () => {
    zoneImport.classList.remove('survol');
  });
  zoneImport.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneImport.classList.remove('survol');
    importerFichiers(e.dataTransfer.files);
  });

  $('#recuperer-vinted').addEventListener('click', recupererPhotosVinted);

  // Amélioration automatique
  $('#ameliorer-auto').addEventListener('click', async () => {
    if (!albumActif) {
      afficherStatut('Importe des photos d\'abord.', 'info');
      return;
    }
    const photos = Studio.listerPhotos(albumActif.id);
    if (photos.length === 0) {
      afficherStatut('Aucune photo à améliorer.', 'info');
      return;
    }

    afficherStatut('Amélioration en cours...', 'info');
    let nbAmeliorees = 0;

    for (const photo of photos) {
      try {
        const ops = Batch.ameliorerPhotoAuto(photo, Studio);
        if (Array.isArray(ops) && ops.length > 0) {
          for (const op of ops) {
            if (op.type === 'redresser' && op.degres) {
              Studio.redresserParId(albumActif.id, photo.id, op.degres);
            } else if (op.type === 'regler') {
              Studio.reglerParId(albumActif.id, photo.id, op.luminosite || 0, op.contraste || 0, op.saturation || 0);
            }
          }
          nbAmeliorees++;
        }
      } catch (e) {
        console.warn('[AF] Erreur amélioration:', e);
      }
    }

    rafraichirGalerie();
    if (nbAmeliorees > 0) {
      afficherStatut(`${nbAmeliorees} photo${nbAmeliorees > 1 ? 's' : ''} améliorée${nbAmeliorees > 1 ? 's' : ''}.`, 'succes');
    } else {
      afficherStatut('Photos déjà optimales.', 'info');
    }
  });

  // ========== RETOUCHES ==========
  const btnsRetouche = {
    recadrer: '#btn-recadrer',
    redresser: '#btn-redresser',
    lumiere: '#btn-lumiere',
    fond: '#btn-fond'
  };

  function cacherPanneauxRetouche() {
    $('#panneau-retouche').hidden = true;
    $$('#panneau-retouche > div').forEach((d) => { d.hidden = true; });
    $$('.btn-retouche').forEach((b) => b.classList.remove('active'));
    retoucheActive = null;
    recadrageEnCours = null;
  }

  function ouvrirRetouche(type) {
    if (retoucheActive === type) {
      cacherPanneauxRetouche();
      return;
    }
    cacherPanneauxRetouche();
    retoucheActive = type;
    $('#panneau-retouche').hidden = false;
    $(`#retouche-${type}`).hidden = false;
    $(btnsRetouche[type]).classList.add('active');

    if (type === 'redresser') {
      $('#angle').value = 0;
      $('#angle-val').textContent = '0°';
    }
    if (type === 'lumiere') {
      $('#lum').value = 0;
      $('#contraste').value = 0;
      $('#saturation').value = 0;
      $('#lum-val').textContent = '0';
      $('#contraste-val').textContent = '0';
      $('#saturation-val').textContent = '0';
    }
  }

  $('#btn-recadrer').addEventListener('click', () => ouvrirRetouche('recadrer'));
  $('#btn-redresser').addEventListener('click', () => ouvrirRetouche('redresser'));
  $('#btn-lumiere').addEventListener('click', () => ouvrirRetouche('lumiere'));
  $('#btn-fond').addEventListener('click', () => ouvrirRetouche('fond'));

  $('#btn-annuler').addEventListener('click', () => {
    if (!photoActive || !albumActif) return;
    photoActive.modifiee = null;
    photoActive.operations = [];
    rafraichirGalerie();
    afficherApercu('apres');
    afficherStatut('Modifications annulées.', 'info');
  });

  // Redresser
  $('#angle').addEventListener('input', (e) => {
    $('#angle-val').textContent = e.target.value + '°';
  });

  $('#redresser-auto').addEventListener('click', () => {
    if (!photoActive) return;
    const angle = Studio.angleRedressement(photoActive.modifiee || photoActive.source);
    $('#angle').value = angle;
    $('#angle-val').textContent = angle.toFixed(1) + '°';
  });

  $('#appliquer-angle').addEventListener('click', () => {
    if (!photoActive || !albumActif) return;
    const angle = parseFloat($('#angle').value);
    if (Math.abs(angle) < 0.1) return;
    Studio.redresserParId(albumActif.id, photoActive.id, angle);
    rafraichirGalerie();
    afficherApercu('apres');
    cacherPanneauxRetouche();
    afficherStatut('Redressement appliqué.', 'succes');
  });

  // Lumière
  $('#lum').addEventListener('input', (e) => { $('#lum-val').textContent = e.target.value; });
  $('#contraste').addEventListener('input', (e) => { $('#contraste-val').textContent = e.target.value; });
  $('#saturation').addEventListener('input', (e) => { $('#saturation-val').textContent = e.target.value; });

  $('#appliquer-lumiere').addEventListener('click', () => {
    if (!photoActive || !albumActif) return;
    const lum = parseInt($('#lum').value, 10);
    const contraste = parseInt($('#contraste').value, 10);
    const saturation = parseInt($('#saturation').value, 10);
    Studio.reglerParId(albumActif.id, photoActive.id, lum, contraste, saturation);
    rafraichirGalerie();
    afficherApercu('apres');
    cacherPanneauxRetouche();
    afficherStatut('Lumière ajustée.', 'succes');
  });

  // Fond
  function retirerFond(couleur) {
    if (!photoActive || !albumActif) return;
    Studio.retirerFondParId(albumActif.id, photoActive.id, couleur);
    rafraichirGalerie();
    afficherApercu('apres');
    cacherPanneauxRetouche();
    afficherStatut('Fond remplacé.', 'succes');
  }

  $('#fond-blanc').addEventListener('click', () => retirerFond('#FFFFFF'));
  $('#fond-lavande').addEventListener('click', () => retirerFond('#F0EBFF'));

  // Mannequin IA (désactivé jusqu'à validation budget)
  $('#mannequin').addEventListener('click', async () => {
    if (!photoActive || !albumActif) return;
    // Studio.demanderMannequinParId retourne une promesse rejetée car pas de service configuré
    try {
      await Studio.demanderMannequinParId(albumActif.id, photoActive.id);
      rafraichirGalerie();
      afficherApercu('apres');
      afficherStatut('Mannequin appliqué.', 'succes');
    } catch (e) {
      afficherStatut(e.message || 'Mannequin non disponible.', 'erreur');
    }
  });

  // Recadrer - nécessite interaction sur canvas
  const canvasApercu = $('#apercu');
  canvasApercu.addEventListener('mousedown', (e) => {
    if (retoucheActive !== 'recadrer' || !photoActive) return;
    const rect = canvasApercu.getBoundingClientRect();
    recadrageEnCours = {
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      endX: e.clientX - rect.left,
      endY: e.clientY - rect.top
    };
  });

  canvasApercu.addEventListener('mousemove', (e) => {
    if (!recadrageEnCours) return;
    const rect = canvasApercu.getBoundingClientRect();
    recadrageEnCours.endX = e.clientX - rect.left;
    recadrageEnCours.endY = e.clientY - rect.top;
    dessinerRecadrage();
  });

  canvasApercu.addEventListener('mouseup', () => {
    // Garder recadrageEnCours pour appliquer
  });

  function dessinerRecadrage() {
    if (!recadrageEnCours || !photoActive) return;
    afficherApercu('apres');
    const ctx = canvasApercu.getContext('2d');
    const { startX, startY, endX, endY } = recadrageEnCours;
    ctx.strokeStyle = '#6D28D9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, startY, endX - startX, endY - startY);
    ctx.setLineDash([]);
  }

  $('#appliquer-cadre').addEventListener('click', () => {
    if (!recadrageEnCours || !photoActive || !albumActif) {
      afficherStatut('Trace un rectangle sur la photo.', 'info');
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scaleX = img.width / canvasApercu.width;
      const scaleY = img.height / canvasApercu.height;
      const { startX, startY, endX, endY } = recadrageEnCours;
      const x = Math.min(startX, endX) * scaleX;
      const y = Math.min(startY, endY) * scaleY;
      const w = Math.abs(endX - startX) * scaleX;
      const h = Math.abs(endY - startY) * scaleY;

      if (w < 20 || h < 20) {
        afficherStatut('Zone trop petite.', 'erreur');
        return;
      }

      Studio.recadrerParId(albumActif.id, photoActive.id, { x, y, w, h });
      recadrageEnCours = null;
      rafraichirGalerie();
      afficherApercu('apres');
      cacherPanneauxRetouche();
      afficherStatut('Recadrage appliqué.', 'succes');
    };
    img.src = photoActive.modifiee || photoActive.source;
  });

  $('#vers-creation').addEventListener('click', () => naviguerVers('creer'));

  // ========== CRÉATION ==========
  function rafraichirCreation() {
    const photosEl = $('#photos-selectionnees');
    const photos = albumActif ? Studio.listerPhotos(albumActif.id) : [];

    if (photos.length === 0) {
      photosEl.innerHTML = '<p class="texte-vide">Importe des photos dans l\'onglet Photos.</p>';
      $('#info-articles').textContent = '';
      return;
    }

    photosEl.innerHTML = photos.map((p) =>
      `<img src="${p.modifiee || p.source}" alt="${p.nom}">`
    ).join('');

    const mode = $('input[name="mode-creation"]:checked').value;
    let infoText = '';
    if (mode === 'unique') {
      infoText = `${photos.length} photo(s) pour 1 article`;
    } else if (mode === 'multiple') {
      infoText = `${photos.length} article(s) (1 photo chacun)`;
    } else {
      infoText = 'Groupement automatique selon similarité';
    }
    $('#info-articles').textContent = infoText;
  }

  $$('input[name="mode-creation"]').forEach((radio) => {
    radio.addEventListener('change', rafraichirCreation);
  });

  $('#generer-lot').addEventListener('click', async () => {
    const photos = albumActif ? Studio.listerPhotos(albumActif.id) : [];
    if (photos.length === 0) {
      afficherStatut('Importe des photos d\'abord.', 'erreur');
      return;
    }

    const mode = $('input[name="mode-creation"]:checked').value;
    const precisions = $('#precisions').value.trim();

    // Créer les articles selon le mode
    // Structure simplifiée: chaque article a un id et un tableau de photos (URLs)
    let articles = [];
    if (mode === 'unique') {
      // Toutes les photos pour un seul article
      articles = [{
        id: Batch.nouvelId(),
        photos: photos.map((p) => p.modifiee || p.source)
      }];
    } else if (mode === 'multiple') {
      // Une photo par article
      articles = photos.map((p) => ({
        id: Batch.nouvelId(),
        photos: [p.modifiee || p.source]
      }));
    } else {
      // Groupes automatiques - pour l'instant 1 photo = 1 article
      // TODO: implémenter regroupement intelligent basé sur similarité
      articles = photos.map((p) => ({
        id: Batch.nouvelId(),
        photos: [p.modifiee || p.source]
      }));
    }

    // Afficher progression
    $('#progression').hidden = false;
    $('#resultats-creation').hidden = true;
    const fillEl = $('#progression-fill');
    const texteEl = $('#progression-texte');

    // Traiter chaque article
    let i = 0;
    for (const art of articles) {
      i++;
      const pct = Math.round((i / articles.length) * 100);
      fillEl.style.width = pct + '%';
      texteEl.textContent = `Article ${i}/${articles.length}...`;

      // Appeler l'IA pour générer l'annonce
      const photosB64 = art.photos.map((src) => {
        if (src.startsWith('data:')) {
          return src.split(',')[1];
        }
        return src;
      });

      try {
        const annonce = await analyserAvecIA(photosB64, precisions);
        if (annonce) {
          const brouillon = {
            id: Batch.nouvelId(),
            titre: annonce.titre || '',
            description: annonce.description || '',
            prix: annonce.prix_suggere ? Math.round(annonce.prix_suggere) : null,
            categorie: annonce.categorie || '',
            taille: annonce.taille || '',
            marque: annonce.marque || '',
            couleurs: annonce.couleurs || [],
            etat: annonce.etat || '',
            matiere: annonce.matiere || '',
            aVerifier: annonce.a_verifier || [],
            photoUrl: art.photos[0] || '',
            photos: art.photos,
            statut: 'pret',
            dateCreation: Date.now(),
            dateModification: Date.now(),
            plateforme: 'vinted'
          };
          brouillons.push(brouillon);
        } else {
          brouillons.push({
            id: Batch.nouvelId(),
            titre: 'À compléter',
            photoUrl: art.photos[0] || '',
            photos: art.photos,
            statut: 'brouillon',
            dateCreation: Date.now(),
            dateModification: Date.now(),
            plateforme: 'vinted'
          });
        }
      } catch (e) {
        console.error('[AF] Erreur génération:', e);
        brouillons.push({
          id: Batch.nouvelId(),
          titre: 'Erreur IA: ' + (e.message || '').slice(0, 50),
          photoUrl: art.photos[0] || '',
          photos: art.photos,
          statut: 'brouillon',
          dateCreation: Date.now(),
          dateModification: Date.now(),
          plateforme: 'vinted'
        });
      }
    }
    
    await sauvegarderBrouillons();
    fillEl.style.width = '100%';
    texteEl.textContent = 'Terminé !';

    setTimeout(() => {
      $('#progression').hidden = true;
      naviguerVers('annonces');
      afficherStatut(`${articles.length} annonce(s) créée(s).`, 'succes');
    }, 500);
  });

  // ========== MES ANNONCES ==========
  function rafraichirAnnonces() {
    const filtre = $('#filtre-statut').value;
    const recherche = $('#recherche').value.trim();

    let liste = brouillons;

    if (filtre) {
      liste = Batch.filtrerBrouillons(liste, { statut: filtre });
    }

    if (recherche) {
      liste = Batch.filtrerBrouillons(liste, { recherche: recherche });
    }

    liste = Batch.trierBrouillons(liste, 'date_desc');

    const listeEl = $('#liste-annonces');

    if (liste.length === 0) {
      listeEl.innerHTML = '<p class="texte-vide">Aucune annonce trouvée.</p>';
      $('#actions-masse').hidden = true;
      return;
    }

    listeEl.innerHTML = liste.map((b) => `
      <div class="annonce-carte" data-id="${b.id}">
        <input type="checkbox" class="annonce-select" data-id="${b.id}">
        <img class="annonce-photo" src="${b.photoUrl || (b.photos && b.photos[0]) || ''}" alt="">
        <div class="annonce-infos">
          <div class="annonce-titre">
            ${escapeHtml(b.titre || 'Sans titre')}
            <span class="annonce-badge badge-${b.statut}">${b.statut}</span>
          </div>
          <div class="annonce-meta">${escapeHtml(b.categorie || '')} ${b.marque ? '· ' + escapeHtml(b.marque) : ''}</div>
          <div class="annonce-prix">${b.prix ? b.prix + ' €' : '–'}</div>
        </div>
        <div class="annonce-actions">
          <button type="button" class="btn-remplir" data-id="${b.id}">Remplir</button>
          <button type="button" class="btn-editer" data-id="${b.id}">Éditer</button>
        </div>
      </div>
    `).join('');

    // Gérer sélection
    $$('.annonce-select', listeEl).forEach((cb) => {
      cb.addEventListener('change', majSelectionMasse);
    });

    // Remplir sur Vinted
    $$('.btn-remplir', listeEl).forEach((btn) => {
      btn.addEventListener('click', () => remplirSurVinted(btn.dataset.id));
    });

    // Éditer (TODO: modal d'édition)
    $$('.btn-editer', listeEl).forEach((btn) => {
      btn.addEventListener('click', () => {
        afficherStatut('Édition bientôt disponible.', 'info');
      });
    });
  }

  function majSelectionMasse() {
    const selectionnes = $$('.annonce-select:checked');
    $('#actions-masse').hidden = selectionnes.length === 0;
    $('#selection-count').textContent = selectionnes.length + ' sélectionné' + (selectionnes.length > 1 ? 's' : '');
  }

  $('#filtre-statut').addEventListener('change', rafraichirAnnonces);
  $('#recherche').addEventListener('input', rafraichirAnnonces);

  $('#appliquer-prix').addEventListener('click', async () => {
    const ids = $$('.annonce-select:checked').map((cb) => cb.dataset.id);
    if (ids.length === 0) return;

    const mode = $('#action-prix-mode').value;
    const val = parseFloat($('#action-prix-val').value) || 0;

    const actionType = mode === 'fixe' ? 'prix_fixe' : mode === 'ajouter' ? 'prix_ajouter' : 'prix_pourcentage';
    brouillons = Batch.modifierBrouillonsEnMasse(brouillons, ids, { type: actionType, valeur: val });
    await sauvegarderBrouillons();

    rafraichirAnnonces();
    afficherStatut('Prix modifiés.', 'succes');
  });

  $('#supprimer-selection').addEventListener('click', async () => {
    const ids = $$('.annonce-select:checked').map((cb) => cb.dataset.id);
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} annonce(s) ?`)) return;

    const selection = new Set(ids);
    brouillons = brouillons.filter((b) => !selection.has(b.id));
    await sauvegarderBrouillons();
    
    rafraichirAnnonces();
    afficherStatut('Annonces supprimées.', 'succes');
  });

  async function remplirSurVinted(id) {
    const brouillon = brouillons.find((b) => b.id === id);
    if (!brouillon) {
      afficherStatut('Annonce introuvable.', 'erreur');
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0] || !tabs[0].url.includes('vinted.')) {
        afficherStatut('Ouvre la page Vinted « Vendre un article ».', 'erreur');
        return;
      }

      const rep = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'fillListing',
        annonce: brouillon
      });

      if (rep && rep.ok) {
        afficherStatut('Formulaire rempli ! Vérifie et publie toi-même.', 'succes');
      } else {
        afficherStatut(rep?.error || 'Erreur de remplissage.', 'erreur');
      }
    } catch (e) {
      afficherStatut('Erreur : ' + e.message, 'erreur');
    }
  }

  // ========== RÉGLAGES ==========
  async function chargerReglages() {
    const data = await chrome.storage.local.get([
      'backendUrl', 'token', 'credits',
      'style', 'hashtags', 'signature',
      'prixAjustement', 'prixArrondi', 'apiKey',
      'autoGenerer', 'autoRemplir'
    ]);

    backendUrl = data.backendUrl || '';
    token = data.token || null;
    credits = data.credits !== undefined ? data.credits : null;
    autoGenerer = !!data.autoGenerer;
    autoRemplir = data.autoRemplir !== false;

    $('#backendUrl').value = backendUrl;
    $('#style').value = data.style || 'normal';
    $('#hashtags').checked = data.hashtags !== false;
    $('#signature').value = data.signature || '';
    $('#prixAjustement').value = data.prixAjustement || 0;
    $('#prixArrondi').value = data.prixArrondi || 1;
    $('#apiKey').value = data.apiKey || '';
    $('#autoGenerer').checked = autoGenerer;
    $('#autoRemplir').checked = autoRemplir;

    majStatutCompte();
    majCreditsHeader();
  }

  function majStatutCompte() {
    const el = $('#compte-statut');
    if (token && backendUrl) {
      el.textContent = 'Connecté à ' + new URL(backendUrl).hostname;
      el.className = 'compte-statut connecte';
      $('#deconnecter').hidden = false;
    } else {
      el.textContent = 'Non connecté';
      el.className = 'compte-statut deconnecte';
      $('#deconnecter').hidden = true;
    }
  }

  function majCreditsHeader() {
    const el = $('#credits');
    const valEl = $('#credits-val');
    if (credits !== null) {
      el.hidden = false;
      valEl.textContent = credits;
    } else {
      el.hidden = true;
    }
  }

  $('#connecter').addEventListener('click', async () => {
    const url = $('#backendUrl').value.trim().replace(/\/+$/, '');
    const email = $('#email').value.trim();
    const pwd = $('#password').value;

    if (!url || !email || !pwd) {
      afficherStatut('Remplis tous les champs.', 'erreur');
      return;
    }

    try {
      const rep = await fetch(url + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, password: pwd })
      });

      const data = await rep.json();
      if (!rep.ok || !data.token) {
        throw new Error(data.message || 'Identifiants invalides.');
      }

      token = data.token;
      backendUrl = url;
      credits = data.user?.credits ?? null;

      await chrome.storage.local.set({ backendUrl, token, credits });
      $('#password').value = '';

      majStatutCompte();
      majCreditsHeader();
      afficherStatut('Connecté !', 'succes');
    } catch (e) {
      afficherStatut(e.message || 'Erreur de connexion.', 'erreur');
    }
  });

  $('#deconnecter').addEventListener('click', async () => {
    token = null;
    credits = null;
    await chrome.storage.local.remove(['token', 'credits']);
    majStatutCompte();
    majCreditsHeader();
    afficherStatut('Déconnecté.', 'info');
  });

  $('#tester-cle').addEventListener('click', async () => {
    const cle = $('#apiKey').value.trim();
    if (!cle) {
      afficherStatut('Entre une clé API.', 'erreur');
      return;
    }

    try {
      const rep = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cle,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Dis "ok".' }]
        })
      });

      if (rep.ok) {
        afficherStatut('Clé valide !', 'succes');
      } else {
        const err = await rep.json();
        throw new Error(err.error?.message || 'Clé invalide.');
      }
    } catch (e) {
      afficherStatut(e.message || 'Clé invalide.', 'erreur');
    }
  });

  $('#sauvegarder').addEventListener('click', async () => {
    autoGenerer = $('#autoGenerer').checked;
    autoRemplir = $('#autoRemplir').checked;
    
    await chrome.storage.local.set({
      backendUrl: $('#backendUrl').value.trim().replace(/\/+$/, ''),
      style: $('#style').value,
      hashtags: $('#hashtags').checked,
      signature: $('#signature').value.trim(),
      prixAjustement: parseInt($('#prixAjustement').value, 10) || 0,
      prixArrondi: parseInt($('#prixArrondi').value, 10) || 1,
      apiKey: $('#apiKey').value.trim(),
      autoGenerer: autoGenerer,
      autoRemplir: autoRemplir
    });
    afficherStatut('Réglages enregistrés.', 'succes');
  });

  // Sauvegarder automatiquement les options d'automatisation
  $('#autoGenerer').addEventListener('change', async () => {
    autoGenerer = $('#autoGenerer').checked;
    await chrome.storage.local.set({ autoGenerer });
    if (autoGenerer) {
      afficherStatut('Mode automatique activé.', 'succes');
      // Vérifier immédiatement s'il y a des photos
      verifierEtTraiterPhotos();
    }
  });

  $('#autoRemplir').addEventListener('change', async () => {
    autoRemplir = $('#autoRemplir').checked;
    await chrome.storage.local.set({ autoRemplir });
  });

  // ========== IA ==========
  async function analyserAvecIA(photosB64, contexte = '') {
    // Essayer d'abord le backend
    if (token && backendUrl) {
      try {
        const rep = await fetch(backendUrl + '/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            images: photosB64.slice(0, 5),
            context: contexte
          })
        });

        if (rep.ok) {
          const data = await rep.json();
          if (data.credits !== undefined) {
            credits = data.credits;
            await chrome.storage.local.set({ credits });
            majCreditsHeader();
          }
          return data;
        }
      } catch (e) {
        console.warn('[AF] Backend indisponible:', e);
      }
    }

    // Fallback: clé Claude locale
    const data = await chrome.storage.local.get(['apiKey']);
    const apiKey = data.apiKey;
    if (!apiKey) {
      throw new Error('Connecte-toi ou entre une clé API.');
    }

    const reglages = await chrome.storage.local.get(['style', 'hashtags', 'signature']);
    const systeme = `Tu es un assistant expert en vente de vêtements d'occasion sur Vinted.
Analyse les photos et génère une annonce complète au format JSON avec :
- titre (max 50 car)
- description (${reglages.style === 'court' ? '2-3' : reglages.style === 'detaille' ? '5-6' : '3-4'} phrases${reglages.hashtags !== false ? ', avec hashtags pertinents' : ''})
- categorie, marque, taille, couleurs (tableau), etat, matiere
- prix_suggere (€, entier)${reglages.signature ? `\nAjoute cette formule en fin de description : "${reglages.signature}"` : ''}`;

    const contenu = photosB64.map((b64) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 }
    }));
    contenu.push({ type: 'text', text: contexte ? `Contexte : ${contexte}` : 'Analyse ces photos.' });

    const rep = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systeme,
        messages: [{ role: 'user', content: contenu }]
      })
    });

    if (!rep.ok) {
      const err = await rep.json();
      throw new Error(err.error?.message || 'Erreur IA.');
    }

    const result = await rep.json();
    const texte = result.content?.[0]?.text || '';
    const match = texte.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Réponse IA invalide.');
  }

  // ========== UTILS ==========
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ========== FLUX AUTOMATIQUE ==========
  
  // Écouter les notifications de photos détectées
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'photosDetected' && msg.count > 0) {
      console.log('[AF] Photos détectées:', msg.count, 'hash:', msg.hash);
      
      // Mettre à jour l'affichage
      if (sectionActive === 'dashboard') {
        rafraichirDashboard();
      }
      
      // Si mode auto activé et nouveau hash
      if (autoGenerer && msg.hash && msg.hash !== dernierHashTraite) {
        traiterPhotosAuto(msg);
      }
    }
  });

  async function verifierEtTraiterPhotos() {
    if (generationEnCours) return;
    
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0] || !tabs[0].url?.includes('vinted.')) return;
      
      const rep = await chrome.tabs.sendMessage(tabs[0].id, { type: 'getPageInfo' });
      if (rep?.ok && rep.estPageVente && rep.photos > 0) {
        if (rep.hash !== dernierHashTraite) {
          traiterPhotosAuto({ count: rep.photos, hash: rep.hash, tabId: tabs[0].id });
        }
      }
    } catch (e) {
      console.warn('[AF] Erreur vérification photos:', e);
    }
  }

  async function traiterPhotosAuto(msg) {
    if (generationEnCours || !autoGenerer) return;
    if (msg.hash === dernierHashTraite) return;
    
    // Vérifier qu'on a une session valide
    if (!token && !backendUrl) {
      const data = await chrome.storage.local.get(['apiKey']);
      if (!data.apiKey) {
        afficherStatut('Configure ton compte ou ta clé API dans Réglages.', 'erreur');
        return;
      }
    }
    
    generationEnCours = true;
    dernierHashTraite = msg.hash;
    
    try {
      // Notifier le content script que l'analyse commence
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'setAnalyseEnCours', enCours: true }).catch(() => {});
      }
      
      afficherStatut(`${msg.count} photo(s) détectée(s). Analyse en cours...`, 'info');
      
      // Récupérer les photos
      const rep = await chrome.tabs.sendMessage(tabs[0].id, { type: 'collectPhotos' });
      if (!rep?.ok || !rep.images?.length) {
        throw new Error('Impossible de récupérer les photos.');
      }

      // Ajouter à la galerie
      const album = creerAlbumSiBesoin();
      rep.images.forEach((b64, i) => {
        const dataUrl = b64.startsWith('data:') ? b64 : 'data:image/jpeg;base64,' + b64;
        Studio.ajouterPhotoParId(album.id, dataUrl, 'vinted-' + (i + 1) + '.jpg');
      });
      rafraichirGalerie();

      afficherStatut('Photos récupérées. Génération de l\'annonce...', 'info');
      
      // Générer l'annonce
      const annonce = await analyserAvecIA(rep.images, '');
      
      if (!annonce) {
        throw new Error('Génération échouée.');
      }

      // Créer le brouillon
      const brouillon = {
        id: Batch.nouvelId(),
        titre: annonce.titre || '',
        description: annonce.description || '',
        prix: annonce.prix_suggere ? Math.round(annonce.prix_suggere) : null,
        categorie: annonce.categorie || '',
        taille: annonce.taille || '',
        marque: annonce.marque || '',
        couleurs: annonce.couleurs || [],
        etat: annonce.etat || '',
        matiere: annonce.matiere || '',
        aVerifier: annonce.a_verifier || [],
        photoUrl: rep.images[0] ? 'data:image/jpeg;base64,' + rep.images[0] : '',
        photos: rep.images.map((b64) => 'data:image/jpeg;base64,' + b64),
        statut: 'pret',
        dateCreation: Date.now(),
        dateModification: Date.now(),
        plateforme: 'vinted'
      };
      
      brouillons.push(brouillon);
      await sauvegarderBrouillons();
      dernierBrouillonGenere = brouillon;

      // Mettre à jour l'interface
      rafraichirDashboard();
      
      // Remplir automatiquement si activé
      if (autoRemplir) {
        afficherStatut('Annonce générée ! Remplissage du formulaire...', 'succes');
        
        const repFill = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'fillListing',
          annonce: brouillon
        });
        
        if (repFill?.ok) {
          const champsRemplis = Object.entries(repFill.fait || {})
            .filter(([_, ok]) => ok)
            .map(([champ]) => champ);
          const menusRemplis = Object.entries(repFill.menus || {})
            .filter(([_, etat]) => etat === 'rempli')
            .map(([menu]) => menu);
          
          const total = champsRemplis.length + menusRemplis.length;
          afficherStatut(`✓ Annonce prête ! ${total} champ(s) rempli(s). Vérifie et publie.`, 'succes');
        } else {
          afficherStatut('Annonce générée ! ' + (repFill?.error || 'Remplis le formulaire manuellement.'), 'info');
        }
      } else {
        afficherStatut('✓ Annonce générée ! Clique sur "Remplir" pour compléter le formulaire.', 'succes');
        naviguerVers('annonces');
      }

    } catch (e) {
      console.error('[AF] Erreur traitement auto:', e);
      const msg = e.message || 'Erreur inconnue';
      
      if (msg.includes('Connecte-toi') || msg.includes('clé API')) {
        afficherStatut('Configure ton compte dans Réglages pour activer la génération.', 'erreur');
      } else if (msg.includes('serveur') || msg.includes('Backend')) {
        afficherStatut('Serveur indisponible. Vérifie ta connexion.', 'erreur');
      } else {
        afficherStatut('Erreur : ' + msg, 'erreur');
      }
      
      // Remettre le hash à vide pour permettre une nouvelle tentative
      dernierHashTraite = '';
      
    } finally {
      generationEnCours = false;
      
      // Notifier le content script que l'analyse est terminée
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'setAnalyseEnCours', enCours: false }).catch(() => {});
        }
      } catch (e) {}
    }
  }

  // Vérifier périodiquement l'état des photos (backup)
  async function surveillerPhotos() {
    if (autoGenerer && !generationEnCours) {
      await verifierEtTraiterPhotos();
    }
    setTimeout(surveillerPhotos, 3000);
  }

  // ========== INIT ==========
  await chargerReglages();
  await chargerBrouillons();
  naviguerVers('dashboard');
  
  // Démarrer la surveillance si mode auto activé
  if (autoGenerer) {
    setTimeout(verifierEtTraiterPhotos, 1000);
  }
  surveillerPhotos();

})();
