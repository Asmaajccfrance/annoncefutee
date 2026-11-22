// Présentation des photos : détourage de l'article, fond uni, redressement et recadrage.
// Tout est calculé dans le navigateur (modèle U2-Net léger exécuté en WebAssembly) :
// aucune photo ne quitte l'ordinateur pour cette étape, et elle ne coûte rien.
(function (root) {
  const MODELE = 'silueta.onnx';
  const COTE_MODELE = 320;
  const COTE_MAX = 1600;
  const HAUTEUR_MAX = 1600;   // sortie en portrait 3:4, le format des vignettes Vinted
  const HAUTEUR_MIN = 800;
  const MARGE = 0.07;
  const ALLONGEMENT_MIN = 1.9;
  const COTE_GUIDE = 512;
  const MOYENNE = [0.485, 0.456, 0.406];
  const ECART = [0.229, 0.224, 0.225];

  let session = null;
  let chargement = null;

  function base() {
    const c = root.chrome;
    if (c && c.runtime && c.runtime.getURL) return c.runtime.getURL('');
    // Hors extension (page d'essai) : dossier de la page courante, en adresse complète.
    return new URL('.', root.location.href).href;
  }

  function disponible() {
    return typeof root.ort !== 'undefined' && typeof root.document !== 'undefined';
  }

  // Le modèle n'est chargé qu'une fois ; un échec n'empêche pas de réessayer plus tard.
  function charger() {
    if (session) return Promise.resolve(session);
    if (!disponible()) return Promise.reject(new Error('Détourage indisponible dans ce navigateur.'));
    if (!chargement) {
      chargement = (async () => {
        root.ort.env.wasm.wasmPaths = base() + 'ort/';
        root.ort.env.wasm.numThreads = root.crossOriginIsolated ? Math.min(4, Math.max(1, (root.navigator && root.navigator.hardwareConcurrency) || 1)) : 1;
        session = await root.ort.InferenceSession.create(base() + 'modeles/' + MODELE + '', {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        return session;
      })().catch((e) => {
        chargement = null;
        throw e;
      });
    }
    return chargement;
  }

  function toile(largeur, hauteur) {
    const c = root.document.createElement('canvas');
    c.width = largeur;
    c.height = hauteur;
    return c;
  }

  // Carte de présence de l'article (0 = fond, 1 = article), en 320 × 320.
  async function calculerMasque(source) {
    const s = await charger();
    const petit = toile(COTE_MODELE, COTE_MODELE);
    const ctx = petit.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, COTE_MODELE, COTE_MODELE);
    const px = ctx.getImageData(0, 0, COTE_MODELE, COTE_MODELE).data;
    const n = COTE_MODELE * COTE_MODELE;

    let max = 1;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > max) max = px[i];
      if (px[i + 1] > max) max = px[i + 1];
      if (px[i + 2] > max) max = px[i + 2];
    }
    const entree = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      entree[i] = (px[i * 4] / max - MOYENNE[0]) / ECART[0];
      entree[n + i] = (px[i * 4 + 1] / max - MOYENNE[1]) / ECART[1];
      entree[2 * n + i] = (px[i * 4 + 2] / max - MOYENNE[2]) / ECART[2];
    }

    const tenseur = new root.ort.Tensor('float32', entree, [1, 3, COTE_MODELE, COTE_MODELE]);
    const sorties = await s.run({ [s.inputNames[0]]: tenseur });
    const brut = sorties[s.outputNames[0]].data;

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (brut[i] < lo) lo = brut[i];
      if (brut[i] > hi) hi = brut[i];
    }
    const etendue = hi - lo || 1;
    const masque = new Float32Array(n);
    for (let i = 0; i < n; i++) masque[i] = (brut[i] - lo) / etendue;
    return masque;
  }

  // Ne garde que l'article : le plus grand bloc du masque, et les blocs d'une taille comparable
  // (une paire de chaussures). Les petits morceaux de fond mal classés disparaissent.
  function garderArticle(masque) {
    const N = COTE_MODELE;
    const etiquettes = new Int32Array(N * N);
    const tailles = [0];
    const pile = new Int32Array(N * N);
    let courant = 0;
    for (let depart = 0; depart < N * N; depart++) {
      if (masque[depart] <= 0.5 || etiquettes[depart]) continue;
      courant++;
      let taille = 0;
      let haut = 0;
      pile[haut++] = depart;
      etiquettes[depart] = courant;
      while (haut > 0) {
        const i = pile[--haut];
        taille++;
        const x = i % N;
        const y = (i - x) / N;
        if (x > 0 && masque[i - 1] > 0.5 && !etiquettes[i - 1]) { etiquettes[i - 1] = courant; pile[haut++] = i - 1; }
        if (x < N - 1 && masque[i + 1] > 0.5 && !etiquettes[i + 1]) { etiquettes[i + 1] = courant; pile[haut++] = i + 1; }
        if (y > 0 && masque[i - N] > 0.5 && !etiquettes[i - N]) { etiquettes[i - N] = courant; pile[haut++] = i - N; }
        if (y < N - 1 && masque[i + N] > 0.5 && !etiquettes[i + N]) { etiquettes[i + N] = courant; pile[haut++] = i + N; }
      }
      tailles.push(taille);
    }
    let max = 0;
    for (let k = 1; k < tailles.length; k++) if (tailles[k] > max) max = tailles[k];
    const seuil = max * 0.2;
    // Distance au bloc gardé : au-delà de quelques pixels, tout est du fond (plus de halo flou).
    const garde = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) if (etiquettes[i] && tailles[etiquettes[i]] >= seuil) garde[i] = 1;
    const RAYON = 4;
    const proche = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!garde[y * N + x]) continue;
        const y0 = Math.max(0, y - RAYON);
        const y1 = Math.min(N - 1, y + RAYON);
        const x0 = Math.max(0, x - RAYON);
        const x1 = Math.min(N - 1, x + RAYON);
        // Seuls les pixels du bord ont besoin d'élargir la zone.
        if (x > 0 && x < N - 1 && y > 0 && y < N - 1 && garde[y * N + x - 1] && garde[y * N + x + 1] && garde[(y - 1) * N + x] && garde[(y + 1) * N + x]) {
          proche[y * N + x] = 1;
          continue;
        }
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) proche[yy * N + xx] = 1;
      }
    }
    const net = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) net[i] = proche[i] ? masque[i] : 0;
    return net;
  }

  // Bouche les petits trous (un imprimé très contrasté) sans élargir le contour.
  function fermerTrous(masque) {
    const N = COTE_MODELE;
    const R = 2;
    const dilate = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let m = 0;
        const y0 = Math.max(0, y - R);
        const y1 = Math.min(N - 1, y + R);
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(N - 1, x + R);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const v = masque[yy * N + xx];
            if (v > m) m = v;
          }
        }
        dilate[y * N + x] = m;
      }
    }
    const ferme = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let m = 1;
        const y0 = Math.max(0, y - R);
        const y1 = Math.min(N - 1, y + R);
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(N - 1, x + R);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const v = dilate[yy * N + xx];
            if (v < m) m = v;
          }
        }
        const i = y * N + x;
        ferme[i] = m > masque[i] ? m : masque[i];
      }
    }
    return ferme;
  }

  // Dans une grille binaire, garde le plus grand bloc et ceux d'une taille comparable.
  function blocsPrincipaux(bin, l, h) {
    const etiquettes = new Int32Array(l * h);
    const tailles = [0];
    const pile = new Int32Array(l * h);
    let courant = 0;
    for (let depart = 0; depart < l * h; depart++) {
      if (!bin[depart] || etiquettes[depart]) continue;
      courant++;
      let taille = 0;
      let haut = 0;
      pile[haut++] = depart;
      etiquettes[depart] = courant;
      while (haut > 0) {
        const i = pile[--haut];
        taille++;
        const x = i % l;
        const y = (i - x) / l;
        if (x > 0 && bin[i - 1] && !etiquettes[i - 1]) { etiquettes[i - 1] = courant; pile[haut++] = i - 1; }
        if (x < l - 1 && bin[i + 1] && !etiquettes[i + 1]) { etiquettes[i + 1] = courant; pile[haut++] = i + 1; }
        if (y > 0 && bin[i - l] && !etiquettes[i - l]) { etiquettes[i - l] = courant; pile[haut++] = i - l; }
        if (y < h - 1 && bin[i + l] && !etiquettes[i + l]) { etiquettes[i + l] = courant; pile[haut++] = i + l; }
      }
      tailles.push(taille);
    }
    let max = 0;
    for (let k = 1; k < tailles.length; k++) if (tailles[k] > max) max = tailles[k];
    const garde = new Uint8Array(l * h);
    for (let i = 0; i < l * h; i++) if (etiquettes[i] && tailles[etiquettes[i]] >= max * 0.2) garde[i] = 1;
    return garde;
  }

  function moyenneGlissante(src, l, h, r) {
    const tmp = new Float32Array(l * h);
    const out = new Float32Array(l * h);
    for (let y = 0; y < h; y++) {
      let somme = 0;
      const ligne = y * l;
      for (let x = -r; x <= r; x++) somme += src[ligne + Math.min(l - 1, Math.max(0, x))];
      for (let x = 0; x < l; x++) {
        tmp[ligne + x] = somme / (2 * r + 1);
        somme += src[ligne + Math.min(l - 1, x + r + 1)] - src[ligne + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < l; x++) {
      let somme = 0;
      for (let y = -r; y <= r; y++) somme += tmp[Math.min(h - 1, Math.max(0, y)) * l + x];
      for (let y = 0; y < h; y++) {
        out[y * l + x] = somme / (2 * r + 1);
        somme += tmp[Math.min(h - 1, y + r + 1) * l + x] - tmp[Math.max(0, y - r) * l + x];
      }
    }
    return out;
  }

  // Affinage des bords : le masque (320 px, flou une fois agrandi) est recalé sur les contours réels
  // de la photo (filtre guidé). Retourne l'opacité de chaque pixel de la photo, de 0 à 255.
  function affiner(image, masque) {
    const L = image.width;
    const H = image.height;
    const k = Math.min(1, COTE_GUIDE / Math.max(L, H));
    const l = Math.max(8, Math.round(L * k));
    const h = Math.max(8, Math.round(H * k));

    const petit = toile(l, h);
    const pctx = petit.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(image, 0, 0, l, h);
    const px = pctx.getImageData(0, 0, l, h).data;
    const n = l * h;
    const I = new Float32Array(n);
    for (let i = 0; i < n; i++) I[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;

    // Masque rééchantillonné à la taille du guide.
    const p = new Float32Array(n);
    const fx = COTE_MODELE / l;
    const fy = COTE_MODELE / h;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(COTE_MODELE - 1.001, Math.max(0, (y + 0.5) * fy - 0.5));
      const y0 = Math.floor(sy);
      const ty = sy - y0;
      for (let x = 0; x < l; x++) {
        const sx = Math.min(COTE_MODELE - 1.001, Math.max(0, (x + 0.5) * fx - 0.5));
        const x0 = Math.floor(sx);
        const tx = sx - x0;
        const a = masque[y0 * COTE_MODELE + x0];
        const b = masque[y0 * COTE_MODELE + x0 + 1];
        const c = masque[(y0 + 1) * COTE_MODELE + x0];
        const d = masque[(y0 + 1) * COTE_MODELE + x0 + 1];
        p[y * l + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
    }

    const r = Math.max(2, Math.round(Math.max(l, h) / 64));
    const EPS = 0.0008;
    const Ip = new Float32Array(n);
    const II = new Float32Array(n);
    for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    const mI = moyenneGlissante(I, l, h, r);
    const mp = moyenneGlissante(p, l, h, r);
    const mIp = moyenneGlissante(Ip, l, h, r);
    const mII = moyenneGlissante(II, l, h, r);
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + EPS);
      b[i] = mp[i] - a[i] * mI[i];
    }
    const ma = moyenneGlissante(a, l, h, r);
    const mb = moyenneGlissante(b, l, h, r);

    // Application à pleine définition : coefficients agrandis, luminance de la vraie photo.
    const plein = image.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, L, H).data;
    const opacite = new Float32Array(L * H);
    const gx = l / L;
    const gy = h / H;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(h - 1.001, Math.max(0, (y + 0.5) * gy - 0.5));
      const y0 = Math.floor(sy);
      const ty = sy - y0;
      for (let x = 0; x < L; x++) {
        const sx = Math.min(l - 1.001, Math.max(0, (x + 0.5) * gx - 0.5));
        const x0 = Math.floor(sx);
        const tx = sx - x0;
        const i00 = y0 * l + x0;
        const i10 = i00 + 1;
        const i01 = i00 + l;
        const i11 = i01 + 1;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const av = ma[i00] * w00 + ma[i10] * w10 + ma[i01] * w01 + ma[i11] * w11;
        const bv = mb[i00] * w00 + mb[i10] * w10 + mb[i01] * w01 + mb[i11] * w11;
        const pv = p[i00] * w00 + p[i10] * w10 + p[i01] * w01 + p[i11] * w11;
        const j = (y * L + x) * 4;
        const lum = (plein[j] * 0.299 + plein[j + 1] * 0.587 + plein[j + 2] * 0.114) / 255;
        const guide = av * lum + bv;
        // L'intérieur reste plein : un imprimé contrasté ne doit pas creuser l'article.
        const q = pv > 0.72 ? 1 : (pv < 0.08 ? 0 : guide);
        opacite[y * L + x] = q < 0 ? 0 : (q > 1 ? 1 : q);
      }
    }
    // Léger lissage avant le seuil : un contour net, sans dentelure ni halo.
    const douce = moyenneGlissante(opacite, L, H, Math.max(1, Math.round(Math.max(L, H) / 450)));
    const alpha = new Uint8ClampedArray(L * H);
    for (let i = 0; i < alpha.length; i++) alpha[i] = lisser(douce[i]) * 255;
    return alpha;
  }

  // Mesures tirées du masque : part de l'image occupée, centre, inclinaison de l'article.
  function mesurer(masque) {
    let nb = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < COTE_MODELE; y++) {
      for (let x = 0; x < COTE_MODELE; x++) {
        if (masque[y * COTE_MODELE + x] > 0.5) {
          nb++;
          sx += x;
          sy += y;
        }
      }
    }
    const part = nb / (COTE_MODELE * COTE_MODELE);
    if (!nb) return { part: 0 };
    return { part: part, cx: sx / nb, cy: sy / nb, nb: nb };
  }

  // Inclinaison de l'article par rapport à la verticale ou à l'horizontale la plus proche (en radians).
  // Calculée dans le repère réel de la photo. Elle n'est retenue que pour un article nettement allongé
  // et une inclinaison modérée : un tee-shirt posé à plat, presque carré, n'est pas tourné au hasard.
  function inclinaison(masque, m, largeur, hauteur) {
    const kx = largeur / COTE_MODELE;
    const ky = hauteur / COTE_MODELE;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let y = 0; y < COTE_MODELE; y++) {
      for (let x = 0; x < COTE_MODELE; x++) {
        if (masque[y * COTE_MODELE + x] <= 0.5) continue;
        const dx = (x - m.cx) * kx;
        const dy = (y - m.cy) * ky;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
    }
    const commun = Math.sqrt((sxx - syy) * (sxx - syy) + 4 * sxy * sxy);
    const grand = (sxx + syy + commun) / 2;
    const petit = (sxx + syy - commun) / 2;
    if (petit <= 0 || Math.sqrt(grand / petit) < ALLONGEMENT_MIN) return 0;
    const axe = 0.5 * Math.atan2(2 * sxy, sxx - syy) * 180 / Math.PI;
    let ecart = ((axe % 90) + 90) % 90;
    if (ecart > 45) ecart -= 90;
    if (Math.abs(ecart) < 2 || Math.abs(ecart) > 10) return 0;
    return ecart * Math.PI / 180;
  }

  // Le bord semi-transparent garde sinon la couleur de l'ancien fond (zèbre, tapis, mur).
  // On la retire pour qu'il ne reste que la couleur de l'article, posée sur le blanc.
  function nettoyerFrange(data, L, H) {
    const PAS = 8;
    const gw = Math.ceil(L / PAS);
    const gh = Math.ceil(H / PAS);
    const bgR = new Float32Array(gw * gh);
    const bgG = new Float32Array(gw * gh);
    const bgB = new Float32Array(gw * gh);
    const bgN = new Uint16Array(gw * gh);
    for (let y = 0; y < H; y++) {
      const gy = (y / PAS) | 0;
      for (let x = 0; x < L; x++) {
        const i = (y * L + x) * 4;
        if (data[i + 3] > 12) continue;
        const g = gy * gw + ((x / PAS) | 0);
        bgR[g] += data[i];
        bgG[g] += data[i + 1];
        bgB[g] += data[i + 2];
        bgN[g]++;
      }
    }
    for (let g = 0; g < bgN.length; g++) {
      if (!bgN[g]) continue;
      bgR[g] /= bgN[g];
      bgG[g] /= bgN[g];
      bgB[g] /= bgN[g];
    }
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (bgN[g]) continue;
        let r = 0;
        let v = 0;
        let b = 0;
        let n = 0;
        for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
          for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
            const k = yy * gw + xx;
            if (!bgN[k]) continue;
            r += bgR[k];
            v += bgG[k];
            b += bgB[k];
            n++;
          }
        }
        if (n) {
          bgR[g] = r / n;
          bgG[g] = v / n;
          bgB[g] = b / n;
        } else {
          bgR[g] = 255;
          bgG[g] = 255;
          bgB[g] = 255;
        }
      }
    }
    for (let y = 0; y < H; y++) {
      const gy = Math.min(gh - 1, (y / PAS) | 0);
      for (let x = 0; x < L; x++) {
        const i = (y * L + x) * 4;
        const a = data[i + 3];
        if (a < 24 || a > 250) continue;
        const g = gy * gw + Math.min(gw - 1, (x / PAS) | 0);
        const t = a / 255;
        const inv = 1 - t;
        const r = (data[i] - bgR[g] * inv) / t;
        const v = (data[i + 1] - bgG[g] * inv) / t;
        const b = (data[i + 2] - bgB[g] * inv) / t;
        data[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
        data[i + 1] = v < 0 ? 0 : (v > 255 ? 255 : v);
        data[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
      }
    }
  }

  function lisser(a) {
    const t = Math.min(1, Math.max(0, (a - 0.38) / 0.24));
    return t * t * (3 - 2 * t);
  }

  function redimensionner(source) {
    const l = source.width;
    const h = source.height;
    const ratio = Math.min(1, COTE_MAX / Math.max(l, h));
    const c = toile(Math.max(1, Math.round(l * ratio)), Math.max(1, Math.round(h * ratio)));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  // Retourne { ok, canvas, angle, part } ou { ok: false, raison } : dans ce cas la photo d'origine
  // doit être utilisée telle quelle, jamais une image dégradée.
  async function presenter(source, options) {
    const opt = options || {};
    const image = redimensionner(source);
    const L = image.width;
    const H = image.height;

    const brut = await calculerMasque(image);
    const masque = fermerTrous(garderArticle(brut));
    const m = mesurer(masque);
    if (m.part < 0.03) return { ok: false, raison: 'article non repéré sur la photo' };
    if (m.part > 0.9) return { ok: false, raison: 'l\'article remplit toute la photo, aucun fond à remplacer' };

    // Opacité à la définition de la photo, bords recalés sur les contours réels.
    const alpha = affiner(image, masque);
    const decoupe = toile(L, H);
    const dctx = decoupe.getContext('2d', { willReadFrequently: true });
    dctx.drawImage(image, 0, 0);
    const dim = dctx.getImageData(0, 0, L, H);
    for (let i = 0; i < alpha.length; i++) dim.data[i * 4 + 3] = alpha[i];
    dctx.putImageData(dim, 0, 0);

    // Cadre de l'article, dans le repère redressé.
    const angle = opt.redresser === false ? 0 : inclinaison(masque, m, L, H);
    const kx = L / COTE_MODELE;
    const ky = H / COTE_MODELE;
    const cx = m.cx * kx;
    const cy = m.cy * ky;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    // Le cadre suit ce qui sera réellement visible. Les éclats isolés (quelques pixels de fond restés
    // opaques) sont effacés : ils fausseraient le cadrage et laisseraient des taches.
    const PAS = Math.max(1, Math.round(Math.max(L, H) / 400));
    const gl = Math.ceil(L / PAS);
    const gh = Math.ceil(H / PAS);
    const grille = new Uint8Array(gl * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gl; gx++) {
        if (alpha[Math.min(H - 1, gy * PAS) * L + Math.min(L - 1, gx * PAS)] >= 128) grille[gy * gl + gx] = 1;
      }
    }
    const garde = blocsPrincipaux(grille, gl, gh);
    const autour = new Uint8Array(gl * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gl; gx++) {
        if (!garde[gy * gl + gx]) continue;
        for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
          for (let xx = Math.max(0, gx - 2); xx <= Math.min(gl - 1, gx + 2); xx++) autour[yy * gl + xx] = 1;
        }
        const dx = gx * PAS - cx;
        const dy = gy * PAS - cy;
        const qx = dx * cos - dy * sin;
        const qy = dx * sin + dy * cos;
        if (qx < x0) x0 = qx;
        if (qx > x1) x1 = qx;
        if (qy < y0) y0 = qy;
        if (qy > y1) y1 = qy;
      }
    }
    for (let y = 0; y < H; y++) {
      const ligne = Math.min(gh - 1, Math.round(y / PAS)) * gl;
      for (let x = 0; x < L; x++) {
        if (!autour[ligne + Math.min(gl - 1, Math.round(x / PAS))]) dim.data[(y * L + x) * 4 + 3] = 0;
      }
    }
    nettoyerFrange(dim.data, L, H);
    dctx.putImageData(dim, 0, 0);
    if (x1 < x0) return { ok: false, raison: 'article non repéré sur la photo' };
    const bl = Math.max(1, x1 - x0 + 2 * PAS);
    const bh = Math.max(1, y1 - y0 + 2 * PAS);
    const qcx = (x0 + x1) / 2;
    const qcy = (y0 + y1) / 2;

    // La sortie est dimensionnée sur l'article : il n'est pas agrandi au-delà de sa définition (pas de flou).
    const utile = 1 - 2 * MARGE;
    const hauteur = Math.round(Math.min(HAUTEUR_MAX, Math.max(HAUTEUR_MIN, Math.max(bh, bl * 4 / 3) / utile)));
    const sortie = toile(Math.round(hauteur * 3 / 4), hauteur);
    const sctx = sortie.getContext('2d');
    sctx.fillStyle = opt.fond || '#FFFFFF';
    sctx.fillRect(0, 0, sortie.width, sortie.height);
    const echelle = Math.min((sortie.width * utile) / bl, (sortie.height * utile) / bh);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.translate(sortie.width / 2, sortie.height / 2);
    sctx.scale(echelle, echelle);
    sctx.translate(-qcx, -qcy);
    sctx.rotate(-angle);
    sctx.translate(-cx, -cy);
    sctx.drawImage(decoupe, 0, 0);

    return { ok: true, canvas: sortie, angle: Math.round(angle * 1800 / Math.PI) / 10, part: m.part };
  }

  // Photo d'origine, seulement réduite et convertie en JPEG.
  function originale(source) {
    return redimensionner(source);
  }

  root.AnnonceFuteeDetourage = { disponible, charger, presenter, originale, COTE_MAX };
})(typeof globalThis !== 'undefined' ? globalThis : this);
