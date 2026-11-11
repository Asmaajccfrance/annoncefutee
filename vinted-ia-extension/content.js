// Script injecté sur vinted.fr. Il n'agit que sur la page "Vendre un article".
// Il ne publie jamais rien : il lit les photos, demande l'annonce à l'IA,
// remplit les champs texte et affiche le reste à côté. Le clic "Publier" reste à toi.

(() => {
  if (window.__annonceIA) return;

  const MAX_PHOTOS = 5;
  const COTE_MAX = 1024;
  const fichiersAjoutes = [];

  // ---------- Page concernée ----------

  function estPageVente() {
    return /^\/items\/(new|\d+\/edit)/.test(location.pathname);
  }

  // ---------- Récupération des photos ----------

  // Filet de sécurité : on mémorise les fichiers image ajoutés au formulaire,
  // au cas où les miniatures de la page ne seraient pas lisibles.
  function memoriser(fichiers) {
    if (!fichiers || !estPageVente()) return;
    for (const f of fichiers) {
      if (f && f.type && f.type.startsWith('image/')) fichiersAjoutes.push(f);
    }
  }
  document.addEventListener(
    'change',
    (e) => {
      const t = e.target;
      if (t && t.tagName === 'INPUT' && t.type === 'file') memoriser(t.files);
    },
    true
  );
  document.addEventListener(
    'drop',
    (e) => {
      if (e.dataTransfer) memoriser(e.dataTransfer.files);
    },
    true
  );

  function horsZone(el) {
    return !!el.closest('header, nav, footer, #annonce-ia-hote');
  }

  function trouverPhotos() {
    const zone = document.querySelector('main') || document.body;
    const imgs = Array.from(zone.querySelectorAll('img')).filter((img) => img.src && !horsZone(img));

    const vus = new Set();
    const unique = (liste) =>
      liste.filter((img) => {
        if (vus.has(img.src)) return false;
        vus.add(img.src);
        return true;
      });

    // 1. Miniatures des photos qui viennent d'être ajoutées (adresses locales).
    const locales = unique(imgs.filter((img) => /^(blob:|data:image\/)/.test(img.src)));
    if (locales.length) return locales.slice(0, MAX_PHOTOS).map((img) => img.src);

    // 2. Photos déjà enregistrées (modification d'une annonce existante).
    const distantes = unique(
      imgs.filter((img) => {
        if (!/^https:/.test(img.src)) return false;
        const r = img.getBoundingClientRect();
        return r.width >= 80 && r.height >= 80;
      })
    );
    if (distantes.length) return distantes.slice(0, MAX_PHOTOS).map((img) => img.src);

    // 3. Fichiers mémorisés au moment de l'ajout.
    return fichiersAjoutes.slice(-MAX_PHOTOS);
  }

  function envoyer(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (rep) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: 'Extension rechargée : actualise la page Vinted (F5).' });
          } else {
            resolve(rep || { ok: false, error: 'Pas de réponse de l\'extension.' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: 'Extension rechargée : actualise la page Vinted (F5).' });
      }
    });
  }

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

  // Réduit la photo (1024 px max) et la convertit en JPEG : plus rapide et moins cher.
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
    titre: () =>
      chercherChamp(
        ['[data-testid="title--input"]', 'input[name="title"]', 'input#title'],
        'input[type="text"], input:not([type])',
        /titre|title/
      ),
    description: () =>
      chercherChamp(
        ['[data-testid="description--input"]', 'textarea[name="description"]', 'textarea#description'],
        'textarea',
        /d[ée]cri|description/
      ),
    prix: () =>
      chercherChamp(
        ['[data-testid="price-input--input"]', 'input[name="price"]', 'input#price'],
        'input',
        /prix|price/
      )
  };

  // Vinted utilise React : il faut passer par le "setter" natif puis émettre
  // les événements, sinon la valeur est effacée au prochain rafraîchissement.
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

  function formaterPrix(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return '';
    return String(Math.max(1, Math.round(v)));
  }

  function remplir(annonce) {
    const fait = { titre: false, description: false, prix: false };
    const valeurs = {
      titre: annonce.titre || '',
      description: annonce.description || '',
      prix: formaterPrix(annonce.prix_suggere)
    };
    for (const cle of Object.keys(valeurs)) {
      if (!valeurs[cle]) continue;
      try {
        const el = CHAMPS[cle]();
        if (el && !el.disabled && !el.readOnly) {
          ecrire(el, valeurs[cle]);
          fait[cle] = true;
        }
      } catch (e) {
        /* champ introuvable : la valeur reste disponible dans le panneau */
      }
    }
    return fait;
  }

  // ---------- Menus déroulants (état, couleurs, taille) ----------
  // Même geste que toi : on ouvre le menu, on clique sur l'option dont le texte
  // correspond, on referme. Si le menu ou l'option est introuvable, on ne touche
  // à rien et la ligne reste marquée « à choisir ».

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  function normaliser(t) {
    return (t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

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

  const MENUS = {
    etat: {
      selecteurs: [
        '[data-testid="status-select-dropdown-input"]',
        '[data-testid="condition-select-dropdown-input"]',
        'input[name="status"]',
        'input#status_id'
      ],
      motif: /^etat( de l'article)?$/
    },
    couleurs: {
      selecteurs: ['[data-testid="color-select-dropdown-input"]', 'input[name="color"]', 'input#color'],
      motif: /^couleurs?( \(.*\))?$/
    },
    taille: {
      selecteurs: ['[data-testid="size-select-dropdown-input"]', 'input[name="size"]', 'input#size_id'],
      motif: /^tailles?( \(.*\))?$/
    },
    matiere: {
      selecteurs: ['[data-testid="material-select-dropdown-input"]', 'input[name="material"]', 'input#material'],
      motif: /^matieres?( \(.*\))?$/
    }
  };

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

  // Renvoie 'rempli', 'deja' (le menu avait déjà une valeur) ou 'a_choisir'.
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

    // Refermer le menu s'il est resté ouvert (cas des choix multiples).
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
      } catch (e) {
        /* menu inattendu : on laisse la main à l'utilisateur */
      }
    }
    return resultat;
  }

  // ---------- Interface ----------

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .boite {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      width: 340px; max-height: calc(100vh - 40px); display: flex; flex-direction: column;
      background: #fff; color: #171717; border: 1px solid #d9d9d9; border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); font-size: 14px; line-height: 1.4;
    }
    .boite.replie { width: auto; }
    .boite.replie .corps { display: none; }
    .entete {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px; font-weight: 600; cursor: pointer; user-select: none;
    }
    .entete span.petit { font-weight: 400; color: #666; font-size: 12px; }
    .corps { padding: 0 12px 12px; overflow-y: auto; }
    input.precisions {
      width: 100%; padding: 8px 10px; border: 1px solid #c9c9c9; border-radius: 8px;
      font-size: 13px; margin-bottom: 8px; color: #171717; background: #fff;
    }
    button { font: inherit; cursor: pointer; border-radius: 8px; }
    button.principal {
      width: 100%; padding: 10px 12px; border: 0; background: #007782; color: #fff; font-weight: 600;
    }
    button.principal:disabled { opacity: .6; cursor: progress; }
    button.lien { background: none; border: 0; color: #007782; padding: 0; text-decoration: underline; font-size: 13px; }
    .etat { margin-top: 8px; font-size: 13px; color: #444; min-height: 18px; }
    .etat.erreur { color: #b3261e; }
    .ligne { border-top: 1px solid #ececec; padding: 8px 0; }
    .ligne .haut { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ligne .nom { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .03em; }
    .ligne .marque { font-size: 11px; padding: 1px 6px; border-radius: 10px; }
    .marque.ok { background: #e3f4ea; color: #17643a; }
    .marque.main { background: #fdf0d5; color: #7a4b00; }
    .ligne .valeur { margin-top: 3px; white-space: pre-wrap; word-break: break-word; }
    button.copier { border: 1px solid #c9c9c9; background: #fff; color: #171717; padding: 2px 8px; font-size: 12px; }
    .averifier { margin: 8px 0 0; padding: 8px 10px; background: #fdf0d5; color: #5c3900; border-radius: 8px; font-size: 13px; }
    .averifier ul { margin: 4px 0 0; padding-left: 18px; }
    .note { margin-top: 8px; font-size: 12px; color: #666; }
    a.comparer {
      display: block; margin: 0 0 8px; padding: 7px 10px; text-align: center; text-decoration: none;
      border: 1px solid #007782; border-radius: 8px; color: #007782; font-size: 13px; font-weight: 600;
    }
  `;

  let hote = null;
  let racine = null;
  let refs = {};

  function creerInterface() {
    hote = document.createElement('div');
    hote.id = 'annonce-ia-hote';
    racine = hote.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    racine.appendChild(style);

    const boite = document.createElement('div');
    boite.className = 'boite';
    boite.innerHTML =
      '<div class="entete"><span>Annonce IA</span><span class="petit bascule">Réduire</span></div>' +
      '<div class="corps">' +
      '<input class="precisions" type="text" maxlength="300" placeholder="Précisions (facultatif) : taille, défauts, marque…">' +
      '<button class="principal" type="button">Générer avec l\'IA</button>' +
      '<div class="etat" role="status"></div>' +
      '<div class="resultat"></div>' +
      '</div>';
    racine.appendChild(boite);

    refs = {
      boite,
      entete: boite.querySelector('.entete'),
      bascule: boite.querySelector('.bascule'),
      precisions: boite.querySelector('.precisions'),
      bouton: boite.querySelector('.principal'),
      etat: boite.querySelector('.etat'),
      resultat: boite.querySelector('.resultat')
    };

    refs.entete.addEventListener('click', () => {
      const replie = refs.boite.classList.toggle('replie');
      refs.bascule.textContent = replie ? 'Ouvrir' : 'Réduire';
    });
    refs.bouton.addEventListener('click', lancer);
    refs.precisions.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') lancer();
    });

    document.documentElement.appendChild(hote);
  }

  function dire(texte, erreur) {
    refs.etat.textContent = texte || '';
    refs.etat.classList.toggle('erreur', !!erreur);
  }

  function ajouterLigne(nom, valeur, rempli, complement) {
    if (!valeur) return;
    const ligne = document.createElement('div');
    ligne.className = 'ligne';

    const haut = document.createElement('div');
    haut.className = 'haut';
    const gauche = document.createElement('span');
    gauche.className = 'nom';
    gauche.textContent = nom;
    haut.appendChild(gauche);

    const droite = document.createElement('span');
    const LIBELLES = { rempli: 'rempli', deja: 'déjà rempli', a_coller: 'à coller', a_choisir: 'à choisir' };
    if (rempli !== undefined) {
      const statut = rempli === true ? 'rempli' : rempli === false ? 'a_coller' : rempli;
      const m = document.createElement('span');
      m.className = 'marque ' + (statut === 'rempli' || statut === 'deja' ? 'ok' : 'main');
      m.textContent = LIBELLES[statut] || statut;
      droite.appendChild(m);
      droite.appendChild(document.createTextNode(' '));
    }
    const copier = document.createElement('button');
    copier.type = 'button';
    copier.className = 'copier';
    copier.textContent = 'Copier';
    copier.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(valeur);
        copier.textContent = 'Copié';
      } catch (e) {
        copier.textContent = 'Échec';
      }
      setTimeout(() => (copier.textContent = 'Copier'), 1200);
    });
    droite.appendChild(copier);
    haut.appendChild(droite);

    const v = document.createElement('div');
    v.className = 'valeur';
    v.textContent = complement ? valeur + ' ' + complement : valeur;

    ligne.appendChild(haut);
    ligne.appendChild(v);
    refs.resultat.appendChild(ligne);
  }

  function afficher(annonce, fait, menus) {
    refs.resultat.textContent = '';
    menus = menus || {};

    const points = Array.isArray(annonce.a_verifier) ? annonce.a_verifier.filter(Boolean) : [];
    if (points.length) {
      const bloc = document.createElement('div');
      bloc.className = 'averifier';
      bloc.appendChild(document.createTextNode('À vérifier avant de publier :'));
      const ul = document.createElement('ul');
      for (const p of points) {
        const li = document.createElement('li');
        li.textContent = p;
        ul.appendChild(li);
      }
      bloc.appendChild(ul);
      refs.resultat.appendChild(bloc);
    }

    ajouterLigne('Titre', annonce.titre, fait.titre);
    ajouterLigne('Description', annonce.description, fait.description);
    const prix = formaterPrix(annonce.prix_suggere);
    const prixIa = formaterPrix(annonce.prix_ia);
    const regle = prixIa && prixIa !== prix ? '(estimation IA : ' + prixIa + ' €, ta règle de prix appliquée)' : '';
    ajouterLigne('Prix conseillé', prix ? prix + ' €' : '', fait.prix, regle);

    // Le prix est une estimation : un clic pour comparer avec les annonces du même article.
    if (annonce.titre) {
      const comparer = document.createElement('a');
      comparer.className = 'comparer';
      comparer.target = '_blank';
      comparer.rel = 'noopener';
      comparer.href = 'https://www.vinted.fr/catalog?search_text=' + encodeURIComponent(annonce.titre);
      comparer.textContent = 'Voir les annonces similaires';
      refs.resultat.appendChild(comparer);
    }

    ajouterLigne('État', annonce.etat, menus.etat);
    ajouterLigne('Couleurs', Array.isArray(annonce.couleurs) ? annonce.couleurs.join(', ') : '', menus.couleurs);
    ajouterLigne('Taille', annonce.taille, menus.taille);
    ajouterLigne('Matière', annonce.matiere, menus.matiere);
    ajouterLigne('Catégorie', annonce.categorie);
    ajouterLigne('Marque', annonce.marque);

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'Catégorie et marque : Vinted les propose souvent seul à partir de la photo. Vérifie-les avant de publier.';
    refs.resultat.appendChild(note);
  }

  let enCours = false;

  async function lancer() {
    if (enCours) return;
    enCours = true;
    refs.bouton.disabled = true;
    refs.resultat.textContent = '';

    try {
      const sources = trouverPhotos();
      if (!sources.length) {
        dire('Ajoute d\'abord tes photos dans le formulaire Vinted, puis clique à nouveau.', true);
        return;
      }

      dire('Préparation de ' + sources.length + ' photo' + (sources.length > 1 ? 's' : '') + '…');
      const images = [];
      for (const s of sources) {
        try {
          images.push(await enJpegBase64(s));
        } catch (e) {
          /* photo illisible : on continue avec les autres */
        }
      }
      if (!images.length) {
        dire('Impossible de lire les photos. Retire-les puis ajoute-les à nouveau.', true);
        return;
      }

      dire('L\'IA rédige l\'annonce…');
      const rep = await envoyer({
        type: 'generate',
        images,
        precisions: refs.precisions.value.trim()
      });

      if (!rep.ok) {
        dire(rep.error || 'Erreur inconnue.', true);
        if (rep.code === 'NO_KEY') {
          const lien = document.createElement('button');
          lien.type = 'button';
          lien.className = 'lien';
          lien.textContent = 'Ouvrir les réglages';
          lien.addEventListener('click', () => envoyer({ type: 'openOptions' }));
          refs.resultat.appendChild(lien);
        }
        return;
      }

      const fait = remplir(rep.data);
      dire('Sélection de l\'état, des couleurs, de la taille et de la matière…');
      const menus = await remplirMenus(rep.data);
      afficher(rep.data, fait, menus);
      const textesOk = Object.values(fait).every(Boolean);
      // Un menu sans valeur proposée par l'IA (taille illisible, par ex.) n'est pas affiché : on ne le compte pas.
      const propose = {
        etat: !!rep.data.etat,
        couleurs: Array.isArray(rep.data.couleurs) && rep.data.couleurs.length > 0,
        taille: !!rep.data.taille,
        matiere: !!rep.data.matiere
      };
      const resteMenus = Object.keys(menus).some((k) => propose[k] && menus[k] === 'a_choisir');
      dire(
        textesOk && !resteMenus
          ? 'Annonce remplie. Vérifie, puis publie.'
          : 'Annonce prête. Complète ce qui est marqué « à coller » ou « à choisir », puis publie.'
      );
    } catch (e) {
      dire('Erreur : ' + (e && e.message ? e.message : e), true);
    } finally {
      enCours = false;
      refs.bouton.disabled = false;
    }
  }

  // ---------- Affichage selon la page (Vinted change de page sans recharger) ----------

  let dernierChemin = null;

  // Génération automatique (si activée dans les réglages) : une seule fois par
  // nouvelle annonce, quand les photos sont en place et que le titre est vide.
  let prefs = { autoGenerer: false };
  let autoFait = false;
  let nbPhotos = 0;
  let stableDepuis = 0;
  const DELAI_STABLE = 2500;

  function surveillerPhotos() {
    if (!prefs.autoGenerer || autoFait || enCours) return;
    if (!/^\/items\/new/.test(location.pathname)) return;

    const nb = trouverPhotos().length;
    if (nb === 0) {
      nbPhotos = 0;
      return;
    }
    if (nb !== nbPhotos) {
      // Une photo vient d'être ajoutée ou retirée : on attend que ça se stabilise.
      nbPhotos = nb;
      stableDepuis = Date.now();
      return;
    }
    if (Date.now() - stableDepuis < DELAI_STABLE) return;

    autoFait = true;
    const titre = CHAMPS.titre();
    if (titre && titre.value.trim()) return; // annonce déjà commencée : on n'écrase rien
    lancer();
  }

  function synchroniser() {
    if (location.pathname !== dernierChemin) {
      dernierChemin = location.pathname;
      fichiersAjoutes.length = 0;
      autoFait = false;
      nbPhotos = 0;

      if (estPageVente()) {
        if (!hote) creerInterface();
        hote.style.display = '';
        refs.resultat.textContent = '';
        refs.precisions.value = '';
        dire('');
        envoyer({ type: 'getPrefs' }).then((rep) => {
          if (rep && rep.ok && rep.data) {
            prefs = rep.data;
            if (prefs.autoGenerer && !enCours && !refs.etat.textContent) {
              dire('Génération automatique activée : ajoute tes photos.');
            }
          }
        });
      } else if (hote) {
        hote.style.display = 'none';
      }
    }
    if (hote && estPageVente()) surveillerPhotos();
  }

  window.__annonceIA = {
    estPageVente, trouverPhotos, remplir, remplirMenus, formaterPrix, CHAMPS, synchroniser,
    etatAuto: () => ({ prefs, autoFait, nbPhotos })
  };

  synchroniser();
  setInterval(synchroniser, 800);
})();
