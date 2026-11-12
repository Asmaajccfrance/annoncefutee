// Atelier photo et brouillons. Aucun accès à chrome, au réseau ou à une IA d'image.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AnnonceFuteeStudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_ATELIER = 8;
  const MAX_BROUILLONS = 30;

  const FONCTIONS_PLATEFORME = [
    {
      id: 'remplissage',
      plateforme: 'Vinted',
      etat: 'manuel',
      detail: 'Le formulaire se remplit quand tu le demandes. Le clic sur Publier reste à toi.'
    },
    {
      id: 'publication',
      plateforme: 'Vinted',
      etat: 'interdit',
      detail: 'Aucune publication automatique.'
    },
    {
      id: 'programmation',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Programmer une mise en ligne exigerait d’agir sur Vinted sans toi. Les comptes particuliers n’ont pas d’API d’écriture.'
    },
    {
      id: 'republication',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Republier une annonce toute seule n’est pas proposé.'
    },
    {
      id: 'negociation',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Répondre ou négocier à ta place n’est pas proposé.'
    },
    {
      id: 'favoris',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Envoyer une offre aux favoris n’est pas proposé.'
    },
    {
      id: 'messagerie',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'La messagerie Vinted n’est pas lue ni écrite par l’extension.'
    },
    {
      id: 'expedition',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Le suivi d’expédition Vinted n’est pas branché.'
    },
    {
      id: 'statistiques',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Les statistiques du compte Vinted ne sont pas collectées.'
    },
    {
      id: 'multicomptes',
      plateforme: 'Vinted',
      etat: 'non_autorise',
      detail: 'Un seul usage à la fois, sur la page que tu as ouverte. Pas de gestion de plusieurs comptes Vinted.'
    },
    {
      id: 'leboncoin',
      plateforme: 'Leboncoin',
      etat: 'absent',
      detail: 'Leboncoin n’est pas connecté. L’extension ne lit pas ce site et ne s’y connecte pas.'
    }
  ];

  let compteur = 0;

  function nouvelId() {
    compteur += 1;
    return 'p' + compteur.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function borne(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  }

  function chaine(v, max) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function creerImage(largeur, hauteur, couleur) {
    const w = Math.max(1, Math.round(largeur));
    const h = Math.max(1, Math.round(hauteur));
    const data = new Uint8ClampedArray(w * h * 4);
    const c = couleur || [255, 255, 255, 255];
    for (let i = 0; i < data.length; i += 4) {
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = c.length > 3 ? c[3] : 255;
    }
    return { width: w, height: h, data: data };
  }

  function copier(im) {
    return { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
  }

  function lirePixel(im, x, y) {
    const p = (y * im.width + x) * 4;
    return [im.data[p], im.data[p + 1], im.data[p + 2], im.data[p + 3]];
  }

  function ecrirePixel(im, x, y, couleur) {
    const p = (y * im.width + x) * 4;
    im.data[p] = couleur[0];
    im.data[p + 1] = couleur[1];
    im.data[p + 2] = couleur[2];
    im.data[p + 3] = couleur.length > 3 ? couleur[3] : 255;
  }

  function peindre(im, x, y, w, h, couleur) {
    const out = copier(im);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(out.width, x0 + Math.round(w));
    const y1 = Math.min(out.height, y0 + Math.round(h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) ecrirePixel(out, xx, yy, couleur);
    }
    return out;
  }

  function distance(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  }

  function moyenne(couleurs) {
    const s = [0, 0, 0];
    for (const c of couleurs) {
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
    }
    return s.map((n) => Math.round(n / couleurs.length));
  }

  function coins(im) {
    return [
      lirePixel(im, 0, 0),
      lirePixel(im, im.width - 1, 0),
      lirePixel(im, 0, im.height - 1),
      lirePixel(im, im.width - 1, im.height - 1)
    ];
  }

  function fondUni(im) {
    const bords = coins(im);
    const moy = moyenne(bords);
    if (bords.some((c) => distance(c, moy) > 28)) return null;
    return moy;
  }

  function recadrer(im, rect) {
    const x = Math.max(0, Math.min(im.width - 1, Math.round(rect.x)));
    const y = Math.max(0, Math.min(im.height - 1, Math.round(rect.y)));
    const w = Math.max(1, Math.min(im.width - x, Math.round(rect.w)));
    const h = Math.max(1, Math.min(im.height - y, Math.round(rect.h)));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * im.width + x) * 4;
      data.set(im.data.subarray(src, src + w * 4), row * w * 4);
    }
    return { width: w, height: h, data: data };
  }

  function recadrerAuto(im) {
    const moy = fondUni(im);
    if (!moy) return { image: copier(im), rogne: false, raison: 'bord_non_uni' };
    let minX = im.width;
    let minY = im.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        if (distance(lirePixel(im, x, y), moy) <= 24) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { image: copier(im), rogne: false, raison: 'rien' };
    if (minX === 0 && minY === 0 && maxX === im.width - 1 && maxY === im.height - 1) {
      return { image: copier(im), rogne: false, raison: 'deja' };
    }
    return {
      image: recadrer(im, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }),
      rogne: true,
      raison: 'bord'
    };
  }

  function echantillon(im, sx, sy) {
    if (sx < 0 || sy < 0 || sx > im.width - 1 || sy > im.height - 1) return null;
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(im.width - 1, x0 + 1);
    const y1 = Math.min(im.height - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const a = lirePixel(im, x0, y0);
    const b = lirePixel(im, x1, y0);
    const c = lirePixel(im, x0, y1);
    const d = lirePixel(im, x1, y1);
    const mel = (i) => Math.round(
      a[i] * (1 - tx) * (1 - ty) + b[i] * tx * (1 - ty) + c[i] * (1 - tx) * ty + d[i] * tx * ty
    );
    return [mel(0), mel(1), mel(2), 255];
  }

  function redresser(im, degres) {
    const angle = borne(degres, -15, 15);
    if (angle === 0) return copier(im);
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = im.width / 2;
    const cy = im.height / 2;
    const pts = [[0, 0], [im.width, 0], [im.width, im.height], [0, im.height]].map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      return [dx * cos - dy * sin, dx * sin + dy * cos];
    });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const nw = Math.max(1, Math.round(Math.max(...xs) - Math.min(...xs)));
    const nh = Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys)));
    const out = creerImage(nw, nh, [255, 255, 255, 255]);
    const icos = Math.cos(-rad);
    const isin = Math.sin(-rad);
    const ncx = nw / 2;
    const ncy = nh / 2;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const dx = x - ncx;
        const dy = y - ncy;
        const couleur = echantillon(im, dx * icos - dy * isin + cx, dx * isin + dy * icos + cy);
        if (couleur) ecrirePixel(out, x, y, couleur);
      }
    }
    return out;
  }

  function angleRedressement(im) {
    let somme = 0;
    let poids = 0;
    const gris = (x, y) => {
      const p = lirePixel(im, x, y);
      return p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    };
    for (let y = 1; y < im.height - 1; y++) {
      for (let x = 1; x < im.width - 1; x++) {
        const gx = gris(x + 1, y) - gris(x - 1, y);
        const gy = gris(x, y + 1) - gris(x, y - 1);
        const mag = Math.hypot(gx, gy);
        if (mag < 40) continue;
        let deg = Math.atan2(gy, gx) * 180 / Math.PI + 90;
        let dev = ((deg % 90) + 90) % 90;
        if (dev > 45) dev -= 90;
        somme += dev * mag;
        poids += mag;
      }
    }
    if (poids === 0) return 0;
    return borne(Math.round((-somme / poids) * 10) / 10, -12, 12);
  }

  function regler(im, params) {
    const lum = borne(params.luminosite, -100, 100) * 2.55;
    const cf = (100 + borne(params.contraste, -100, 100)) / 100;
    const sf = (100 + borne(params.saturation, -100, 100)) / 100;
    const out = copier(im);
    for (let i = 0; i < out.data.length; i += 4) {
      let r = out.data[i] + lum;
      let g = out.data[i + 1] + lum;
      let b = out.data[i + 2] + lum;
      r = (r - 128) * cf + 128;
      g = (g - 128) * cf + 128;
      b = (b - 128) * cf + 128;
      const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
      out.data[i] = borne(Math.round(y + (r - y) * sf), 0, 255);
      out.data[i + 1] = borne(Math.round(y + (g - y) * sf), 0, 255);
      out.data[i + 2] = borne(Math.round(y + (b - y) * sf), 0, 255);
    }
    return out;
  }

  function messageFond(raison) {
    if (raison === 'fond_non_uni') return 'Le fond touche les bords mais il n’est pas uni. Rien n’a été effacé.';
    if (raison === 'rien_a_retirer') return 'Aucun fond uni à retirer.';
    if (raison === 'trop_large') return 'Le retrait mangerait l’article. Rien n’a été effacé.';
    return 'Retrait du fond impossible.';
  }

  function retirerFond(im, couleur) {
    const moy = fondUni(im);
    if (!moy) return { ok: false, raison: 'fond_non_uni', image: im };
    const w = im.width;
    const h = im.height;
    const vis = new Uint8Array(w * h);
    const qx = [];
    const qy = [];
    const proche = (x, y) => distance(lirePixel(im, x, y), moy) <= 36;
    const ajouter = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const k = y * w + x;
      if (vis[k] || !proche(x, y)) return;
      vis[k] = 1;
      qx.push(x);
      qy.push(y);
    };
    for (let x = 0; x < w; x++) {
      ajouter(x, 0);
      ajouter(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      ajouter(0, y);
      ajouter(w - 1, y);
    }
    let tete = 0;
    while (tete < qx.length) {
      const x = qx[tete];
      const y = qy[tete];
      tete += 1;
      ajouter(x + 1, y);
      ajouter(x - 1, y);
      ajouter(x, y + 1);
      ajouter(x, y - 1);
    }
    const ratio = qx.length / (w * h);
    if (ratio < 0.02) return { ok: false, raison: 'rien_a_retirer', image: im };
    if (ratio > 0.72) return { ok: false, raison: 'trop_large', image: im };
    const remplacement = couleur || [255, 255, 255];
    const out = copier(im);
    for (let i = 0; i < qx.length; i++) ecrirePixel(out, qx[i], qy[i], remplacement);
    return { ok: true, raison: 'fond_uni', image: out };
  }

  function appliquerOperation(im, op) {
    if (!op || typeof op !== 'object') throw new Error('Retouche inconnue.');
    if (op.type === 'recadrer') return recadrer(im, op);
    if (op.type === 'recadrerAuto') {
      const resultat = recadrerAuto(im);
      if (!resultat.rogne) {
        const err = new Error('Aucun bord uni à rogner.');
        err.code = resultat.raison;
        throw err;
      }
      return resultat.image;
    }
    if (op.type === 'redresser') return redresser(im, op.degres);
    if (op.type === 'redresserAuto') return redresser(im, angleRedressement(im));
    if (op.type === 'reglages') return regler(im, op);
    if (op.type === 'retirerFond') {
      const resultat = retirerFond(im, op.couleur || [255, 255, 255]);
      if (!resultat.ok) {
        const err = new Error(messageFond(resultat.raison));
        err.code = resultat.raison;
        throw err;
      }
      return resultat.image;
    }
    throw new Error('Retouche inconnue.');
  }

  function creerAlbum() {
    return { photos: [], selection: [], active: '' };
  }

  function creerPhoto(source, nom) {
    if (!source || !source.width || !source.height || !source.data) throw new Error('Photo illisible.');
    return {
      id: nouvelId(),
      nom: chaine(nom, 80) || 'photo',
      source: copier(source),
      operations: [],
      generee: false
    };
  }

  function ajouterPhoto(album, source, nom) {
    if (album.photos.length >= MAX_ATELIER) throw new Error('Huit photos au maximum dans l’atelier.');
    const photo = creerPhoto(source, nom);
    return {
      photos: album.photos.concat([photo]),
      selection: album.selection.concat([photo.id]),
      active: photo.id
    };
  }

  function definirSelection(album, ids) {
    const connues = new Set(album.photos.map((p) => p.id));
    const selection = [];
    for (const id of ids || []) {
      if (connues.has(id) && selection.indexOf(id) === -1) selection.push(id);
    }
    const active = selection.indexOf(album.active) === -1 ? (selection[0] || album.photos[0]?.id || '') : album.active;
    return { photos: album.photos, selection: selection, active: active };
  }

  function activer(album, id) {
    if (!album.photos.some((p) => p.id === id)) return album;
    return { photos: album.photos, selection: album.selection, active: id };
  }

  function deplacerPhoto(album, id, sens) {
    const i = album.photos.findIndex((p) => p.id === id);
    const j = i + sens;
    if (i < 0 || j < 0 || j >= album.photos.length) return album;
    const photos = album.photos.slice();
    const [photo] = photos.splice(i, 1);
    photos.splice(j, 0, photo);
    return { photos: photos, selection: album.selection, active: album.active };
  }

  function rendre(photo) {
    let image = copier(photo.source);
    for (const op of photo.operations) image = appliquerOperation(image, op);
    return image;
  }

  function avecOperation(album, id, op) {
    let trouve = false;
    const photos = album.photos.map((photo) => {
      if (photo.id !== id) return photo;
      trouve = true;
      if (photo.generee) throw new Error('Une image générée ne se retouche pas comme une photo réelle.');
      const rendu = rendre(photo);
      appliquerOperation(rendu, op);
      return { id: photo.id, nom: photo.nom, source: photo.source, operations: photo.operations.concat([op]), generee: false };
    });
    if (!trouve) throw new Error('Photo introuvable.');
    return { photos: photos, selection: album.selection, active: album.active };
  }

  function annuler(album, id) {
    return {
      photos: album.photos.map((photo) => {
        if (photo.id !== id || !photo.operations.length) return photo;
        return {
          id: photo.id,
          nom: photo.nom,
          source: photo.source,
          operations: photo.operations.slice(0, -1),
          generee: photo.generee
        };
      }),
      selection: album.selection,
      active: album.active
    };
  }

  function demanderMannequin(photo) {
    return {
      ok: false,
      code: 'modele_non_valide',
      generee: false,
      message: 'Le mannequin virtuel est une image générée, distincte de la photo réelle. Aucun modèle d’image ni aucun budget n’a été validé : la photo n’a pas été modifiée et aucun appel n’a été envoyé.'
    };
  }

  function photosPourAnalyse(album, max) {
    const limite = Math.max(1, Math.min(8, Number(max) || 5));
    const ordre = album.selection.length ? album.selection : album.photos.map((p) => p.id);
    const photos = [];
    const exclues = [];
    for (const id of ordre) {
      const photo = album.photos.find((p) => p.id === id);
      if (!photo) continue;
      if (photo.generee) {
        exclues.push(id);
        continue;
      }
      if (photos.length >= limite) continue;
      photos.push(photo);
    }
    return { photos: photos, exclues: exclues };
  }

  function prixBrouillon(v) {
    if (v === '' || v == null) return null;
    const n = Math.round(Number(String(v).replace(',', '.')));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(100000, n);
  }

  function creerBrouillon(champs, existants) {
    const titre = chaine(champs.titre, 140);
    const description = chaine(champs.description, 5000);
    if (!titre && !description) throw new Error('Le brouillon est vide.');
    const item = {
      id: nouvelId(),
      titre: titre,
      description: description,
      prix: prixBrouillon(champs.prix),
      photos: Math.max(0, Math.min(MAX_ATELIER, Math.round(Number(champs.photos) || 0)))
    };
    const liste = Array.isArray(existants) ? existants.slice() : [];
    return [item].concat(liste).slice(0, MAX_BROUILLONS);
  }

  function supprimerBrouillons(liste, ids) {
    const choisi = new Set(ids || []);
    return (liste || []).filter((b) => !choisi.has(b.id));
  }

  function modifierPrixMasse(liste, ids, action) {
    const mode = action && action.mode;
    const valeur = Number(action && action.valeur);
    if (!['fixe', 'ajouter', 'pourcent'].includes(mode) || !Number.isFinite(valeur)) {
      throw new Error('Modification de prix invalide.');
    }
    const choisi = new Set(ids || []);
    if (!choisi.size) throw new Error('Coche au moins une annonce.');
    return (liste || []).map((b) => {
      if (!choisi.has(b.id)) return b;
      let prix = Number(b.prix);
      if (mode === 'fixe') prix = valeur;
      else if (!Number.isFinite(prix)) return b;
      else if (mode === 'ajouter') prix = prix + valeur;
      else prix = prix * (1 + valeur / 100);
      prix = Math.round(prix);
      if (prix < 1) prix = 1;
      if (prix > 100000) prix = 100000;
      return {
        id: b.id,
        titre: b.titre,
        description: b.description,
        prix: prix,
        photos: b.photos
      };
    });
  }

  // ========== Gestion d'état pour le sidepanel ==========
  // Stockage interne des albums par ID
  const albumsParId = new Map();
  let compteurAlbum = 0;

  function genererIdAlbum() {
    compteurAlbum++;
    return 'album_' + Date.now().toString(36) + '_' + compteurAlbum;
  }

  // Crée un nouvel album et le stocke, retourne { id, ... }
  function creerAlbumAvecId(nom) {
    const album = creerAlbum(nom);
    const id = genererIdAlbum();
    const albumAvecId = { ...album, id: id };
    albumsParId.set(id, albumAvecId);
    return albumAvecId;
  }

  // Récupère un album par son ID
  function obtenirAlbum(albumId) {
    return albumsParId.get(albumId) || null;
  }

  // Met à jour un album dans le stockage
  function mettreAJourAlbum(albumId, nouvelAlbum) {
    if (!albumsParId.has(albumId)) return null;
    const maj = { ...nouvelAlbum, id: albumId };
    albumsParId.set(albumId, maj);
    return maj;
  }

  // Liste les photos d'un album par son ID
  function listerPhotos(albumId) {
    const album = albumsParId.get(albumId);
    return album ? (album.photos || []) : [];
  }

  // Ajoute une photo à un album par son ID
  function ajouterPhotoParId(albumId, source, nom) {
    const album = albumsParId.get(albumId);
    if (!album) throw new Error('Album introuvable.');
    const nouveau = ajouterPhoto(album, source, nom);
    return mettreAJourAlbum(albumId, nouveau);
  }

  // Supprime une photo d'un album par ID
  function supprimerPhoto(albumId, photoId) {
    const album = albumsParId.get(albumId);
    if (!album) return null;
    const photos = (album.photos || []).filter((p) => p.id !== photoId);
    const selection = (album.selection || []).filter((id) => id !== photoId);
    const active = album.active === photoId ? (photos[0]?.id || '') : album.active;
    return mettreAJourAlbum(albumId, { ...album, photos, selection, active });
  }

  // Applique une opération de recadrage par ID
  function recadrerParId(albumId, photoId, rect) {
    const album = albumsParId.get(albumId);
    if (!album) return null;
    const op = { type: 'recadrer', x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    const nouveau = avecOperation(album, photoId, op);
    return mettreAJourAlbum(albumId, nouveau);
  }

  // Applique un redressement par ID
  function redresserParId(albumId, photoId, degres) {
    const album = albumsParId.get(albumId);
    if (!album) return null;
    const op = { type: 'redresser', degres: degres };
    const nouveau = avecOperation(album, photoId, op);
    return mettreAJourAlbum(albumId, nouveau);
  }

  // Applique des réglages lumière par ID
  function reglerParId(albumId, photoId, luminosite, contraste, saturation) {
    const album = albumsParId.get(albumId);
    if (!album) return null;
    const op = { type: 'reglages', luminosite: luminosite, contraste: contraste, saturation: saturation };
    const nouveau = avecOperation(album, photoId, op);
    return mettreAJourAlbum(albumId, nouveau);
  }

  // Retire le fond par ID
  function retirerFondParId(albumId, photoId, couleur) {
    const album = albumsParId.get(albumId);
    if (!album) return null;
    const op = { type: 'retirerFond', couleur: couleur };
    const nouveau = avecOperation(album, photoId, op);
    return mettreAJourAlbum(albumId, nouveau);
  }

  // Demande mannequin par ID (actuellement retourne une erreur car non configuré)
  function demanderMannequinParId(albumId, photoId) {
    const album = albumsParId.get(albumId);
    if (!album) return Promise.reject(new Error('Album introuvable.'));
    const photo = (album.photos || []).find((p) => p.id === photoId);
    if (!photo) return Promise.reject(new Error('Photo introuvable.'));
    const result = demanderMannequin(photo);
    if (!result.ok) {
      return Promise.reject(new Error(result.message || 'Mannequin non disponible.'));
    }
    return Promise.resolve(result);
  }

  return {
    MAX_ATELIER: MAX_ATELIER,
    MAX_BROUILLONS: MAX_BROUILLONS,
    FONCTIONS_PLATEFORME: FONCTIONS_PLATEFORME,
    creerImage: creerImage,
    peindre: peindre,
    lirePixel: lirePixel,
    // Fonctions originales (pures)
    creerAlbum: creerAlbum,
    ajouterPhoto: ajouterPhoto,
    definirSelection: definirSelection,
    activer: activer,
    deplacerPhoto: deplacerPhoto,
    rendre: rendre,
    avecOperation: avecOperation,
    annuler: annuler,
    demanderMannequin: demanderMannequin,
    photosPourAnalyse: photosPourAnalyse,
    creerBrouillon: creerBrouillon,
    supprimerBrouillons: supprimerBrouillons,
    modifierPrixMasse: modifierPrixMasse,
    angleRedressement: angleRedressement,
    messageFond: messageFond,
    // Fonctions avec gestion d'état par ID
    creerAlbumAvecId: creerAlbumAvecId,
    obtenirAlbum: obtenirAlbum,
    listerPhotos: listerPhotos,
    ajouterPhotoParId: ajouterPhotoParId,
    supprimerPhoto: supprimerPhoto,
    recadrerParId: recadrerParId,
    redresserParId: redresserParId,
    reglerParId: reglerParId,
    retirerFondParId: retirerFondParId,
    demanderMannequinParId: demanderMannequinParId
  };
});
