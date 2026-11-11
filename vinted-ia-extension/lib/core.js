// Logique pure, partagée par le service worker, la page d'options,
// le script de contenu et les tests. Aucun accès à chrome ni au réseau.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VintedIA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODELE_DEFAUT = 'claude-haiku-5-5';
  const MODELES = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
  const MAX_PHOTOS = 5;
  const MAX_IMAGE_CHARS = 1500000;
  const MAX_PRECISIONS = 300;

  const ETATS = [
    'Neuf avec étiquette',
    'Neuf sans étiquette',
    'Très bon état',
    'Bon état',
    'Satisfaisant'
  ];

  const COULEURS = [
    'Noir', 'Marron', 'Gris', 'Beige', 'Rose', 'Violet', 'Rouge', 'Jaune', 'Bleu', 'Vert',
    'Orange', 'Blanc', 'Argenté', 'Doré', 'Multicolore', 'Kaki', 'Turquoise', 'Crème',
    'Abricot', 'Corail', 'Bordeaux', 'Lila', 'Bleu clair', 'Marine', 'Vert foncé',
    'Moutarde', 'Menthe'
  ];

  const REGLAGES_DEFAUT = {
    apiKey: '',
    model: MODELE_DEFAUT,
    signature: '',
    style: 'normal',
    hashtags: true,
    prixAjustement: 0,
    prixArrondi: 1,
    autoGenerer: false
  };

  const LONGUEURS = {
    court: '2 lignes maximum, l\'essentiel seulement',
    normal: '3 à 6 lignes',
    detaille: '6 à 10 lignes, avec les détails utiles à un acheteur (coupe, poches, fermetures, usage)'
  };

  const CHAMPS = {
    titre: {
      selecteurs: ['[data-testid="title--input"]', 'input[name="title"]', 'input#title'],
      balises: 'input[type="text"], input:not([type])',
      motif: /titre|title/
    },
    description: {
      selecteurs: ['[data-testid="description--input"]', 'textarea[name="description"]', 'textarea#description'],
      balises: 'textarea',
      motif: /d[ée]cri|description/
    },
    prix: {
      selecteurs: ['[data-testid="price-input--input"]', 'input[name="price"]', 'input#price'],
      balises: 'input',
      motif: /prix|price/
    }
  };

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

  function chaine(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/\u0000/g, '').trim().slice(0, max);
  }

  function normaliser(t) {
    return (t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function formaterPrix(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return '';
    return String(Math.max(1, Math.round(v)));
  }

  function appliquerReglePrix(prix, r) {
    const p = Number(prix);
    if (!isFinite(p) || p <= 0) return prix;
    const pct = Math.min(100, Math.max(-90, Number(r.prixAjustement) || 0));
    const pas = Number(r.prixArrondi) === 5 ? 5 : 1;
    const v = Math.round((p * (1 + pct / 100)) / pas) * pas;
    return Math.max(pas, v);
  }

  function consigneDescription(r) {
    const longueur = LONGUEURS[r.style] || LONGUEURS.normal;
    const fin = r.hashtags ? 'suivie de 3 à 5 hashtags pertinents' : 'sans aucun hashtag';
    return 'Description naturelle en français, ' + longueur + ', sans emoji en excès, ' + fin + '.';
  }

  function hoteImageAutorise(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && (/(^|\.)vinted\.net$/.test(u.hostname) || /(^|\.)vinted\.fr$/.test(u.hostname));
    } catch (e) {
      return false;
    }
  }

  function assainirPrecisions(p) {
    return chaine(typeof p === 'string' ? p : '', MAX_PRECISIONS);
  }

  function assainirImages(images) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Aucune photo reçue.');
    }
    const out = [];
    let tropGrosses = 0;
    for (let i = 0; i < images.length && out.length < MAX_PHOTOS; i++) {
      const img = images[i];
      if (typeof img !== 'string') continue;
      const data = img.replace(/^data:image\/jpeg;base64,/i, '').replace(/\s/g, '');
      if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) continue;
      if (data.length > MAX_IMAGE_CHARS) {
        tropGrosses++;
        continue;
      }
      out.push(data);
    }
    if (!out.length) {
      throw new Error(tropGrosses ? 'Photos trop volumineuses. Réduis-les puis réessaie.' : 'Aucune photo reçue.');
    }
    return out;
  }

  function assainirAnnonce(brut) {
    if (!brut || typeof brut !== 'object') {
      throw new Error('L\'IA n\'a pas renvoyé d\'annonce exploitable. Réessaie.');
    }
    const titre = chaine(brut.titre, 150);
    const description = chaine(brut.description, 4000);
    if (!titre || !description) {
      throw new Error('L\'IA n\'a pas renvoyé d\'annonce exploitable. Réessaie.');
    }
    const couleurs = [];
    if (Array.isArray(brut.couleurs)) {
      for (let i = 0; i < brut.couleurs.length && couleurs.length < 2; i++) {
        const c = brut.couleurs[i];
        if (COULEURS.indexOf(c) >= 0 && couleurs.indexOf(c) < 0) couleurs.push(c);
      }
    }
    const prix = Number(brut.prix_suggere);
    const aVerifier = [];
    if (Array.isArray(brut.a_verifier)) {
      for (let i = 0; i < brut.a_verifier.length && aVerifier.length < 8; i++) {
        const s = chaine(brut.a_verifier[i], 200);
        if (s) aVerifier.push(s);
      }
    }
    return {
      titre: titre,
      description: description,
      categorie: chaine(brut.categorie, 200),
      marque: chaine(brut.marque, 80),
      taille: chaine(brut.taille, 40),
      etat: ETATS.indexOf(brut.etat) >= 0 ? brut.etat : '',
      couleurs: couleurs,
      matiere: chaine(brut.matiere, 60),
      prix_suggere: isFinite(prix) && prix > 0 ? prix : null,
      a_verifier: aVerifier
    };
  }

  function assainirReglages(src) {
    const r = src || {};
    let pct = Math.round(Number(r.prixAjustement) || 0);
    if (!isFinite(pct)) pct = 0;
    pct = Math.min(100, Math.max(-90, pct));
    return {
      apiKey: chaine(typeof r.apiKey === 'string' ? r.apiKey : '', 500),
      model: MODELES.indexOf(r.model) >= 0 ? r.model : MODELE_DEFAUT,
      signature: chaine(typeof r.signature === 'string' ? r.signature : '', 300),
      style: r.style === 'court' || r.style === 'detaille' ? r.style : 'normal',
      hashtags: r.hashtags === undefined ? true : !!r.hashtags,
      prixAjustement: pct,
      prixArrondi: Number(r.prixArrondi) === 5 ? 5 : 1,
      autoGenerer: !!r.autoGenerer
    };
  }

  // Haiku 5.5 accepte un outil forcé : la réponse commence par l'outil, sans réflexion.
  // Sonnet 5.5 et Opus 5.5 rejettent tool_choice "tool" et "any" (erreur 400).
  function optionsAppel(model) {
    if (model === 'claude-sonnet-5-5') {
      return {
        max_tokens: 8000,
        tool_choice: { type: 'auto' },
        strict: true,
        thinking: { type: 'between_tools' },
        anthropicVersion: '2026-10-21'
      };
    }
    if (model === 'claude-opus-5-5') {
      return {
        max_tokens: 8000,
        tool_choice: { type: 'auto' },
        strict: true,
        thinking: null,
        anthropicVersion: '2026-10-21'
      };
    }
    return {
      max_tokens: 1500,
      tool_choice: { type: 'tool', name: 'annonce' },
      strict: false,
      thinking: null,
      anthropicVersion: '2023-06-01'
    };
  }

  function construireOutil(r, strict) {
    const input_schema = {
      type: 'object',
      properties: {
        titre: {
          type: 'string',
          description: 'Titre court et précis (60 caractères max) : type d\'article, marque, détail clé, taille si connue.'
        },
        description: {
          type: 'string',
          description: consigneDescription(r)
        },
        categorie: {
          type: 'string',
          description: 'Chemin de catégorie Vinted le plus probable, ex. "Femmes > Vêtements > Robes > Robes d\'été".'
        },
        marque: {
          type: 'string',
          description: 'Marque visible sur les photos (logo, étiquette). Chaîne vide si non identifiable.'
        },
        taille: {
          type: 'string',
          description: 'Taille lue sur une étiquette ou donnée par le vendeur. Chaîne vide si inconnue.'
        },
        etat: { type: 'string', enum: ETATS },
        couleurs: {
          type: 'array',
          items: { type: 'string', enum: COULEURS },
          description: 'Une ou deux couleurs principales, la plus présente en premier, choisies dans la liste Vinted (ex. un bleu marine se dit "Marine").'
        },
        matiere: {
          type: 'string',
          description: 'Matière principale en un seul mot courant tel qu\'il figure dans un menu (ex. "Coton", "Polyester", "Cuir", "Laine"), uniquement si elle est lisible sur une étiquette ou évidente. Chaîne vide sinon.'
        },
        prix_suggere: {
          type: 'number',
          description: 'Prix de vente conseillé en euros pour de la seconde main, estimation prudente.'
        },
        a_verifier: {
          type: 'array',
          items: { type: 'string' },
          description: 'Points que les photos ne permettent pas de confirmer (taille, défauts, authenticité...).'
        }
      },
      required: ['titre', 'description', 'categorie', 'marque', 'taille', 'etat', 'couleurs', 'matiere', 'prix_suggere', 'a_verifier']
    };
    // maxItems n'est pas accepté par l'outil strict (Sonnet / Opus). Haiku le conserve.
    if (!strict) input_schema.properties.couleurs.maxItems = 2;
    if (strict) input_schema.additionalProperties = false;
    const outil = {
      name: 'annonce',
      description: 'Enregistre l\'annonce Vinted rédigée à partir des photos.',
      input_schema: input_schema
    };
    if (strict) outil.strict = true;
    return outil;
  }

  function autoriserMessage(type, sender, extensionId) {
    if (!sender || !extensionId || sender.id !== extensionId) return false;
    const prefix = 'chrome-extension://' + extensionId;
    const url = typeof sender.url === 'string' ? sender.url : '';
    const origin = typeof sender.origin === 'string' ? sender.origin : '';
    const interne = url.indexOf(prefix) === 0 || origin === prefix;
    let pageVinted = false;
    const candidat = url || origin;
    if (candidat) {
      try {
        const u = new URL(candidat);
        pageVinted = u.protocol === 'https:' && u.hostname === 'www.vinted.fr';
      } catch (e) {
        pageVinted = false;
      }
    }
    if (type === 'testKey') return interne;
    if (type === 'openOptions') return interne || pageVinted;
    if (type === 'generate' || type === 'fetchImage' || type === 'getPrefs') return pageVinted;
    return false;
  }

  return {
    MODELE_DEFAUT: MODELE_DEFAUT,
    MODELES: MODELES,
    MAX_PHOTOS: MAX_PHOTOS,
    ETATS: ETATS,
    COULEURS: COULEURS,
    REGLAGES_DEFAUT: REGLAGES_DEFAUT,
    CHAMPS: CHAMPS,
    MENUS: MENUS,
    normaliser: normaliser,
    formaterPrix: formaterPrix,
    appliquerReglePrix: appliquerReglePrix,
    consigneDescription: consigneDescription,
    hoteImageAutorise: hoteImageAutorise,
    assainirPrecisions: assainirPrecisions,
    assainirImages: assainirImages,
    assainirAnnonce: assainirAnnonce,
    assainirReglages: assainirReglages,
    optionsAppel: optionsAppel,
    construireOutil: construireOutil,
    autoriserMessage: autoriserMessage
  };
});
