// Moteur de traitement en lot. Gestion des articles multiples et file de traitement.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AnnonceFuteeBatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_ARTICLES = 50;
  const MAX_PHOTOS_PAR_ARTICLE = 5;

  let compteur = 0;

  function nouvelId() {
    compteur += 1;
    return 'art' + Date.now().toString(36) + compteur.toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function chaine(v, max) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // Structure d'un article complet avec photos et annonce
  function creerArticle(photos) {
    if (!Array.isArray(photos) || !photos.length) throw new Error('Un article doit avoir au moins une photo.');
    if (photos.length > MAX_PHOTOS_PAR_ARTICLE) photos = photos.slice(0, MAX_PHOTOS_PAR_ARTICLE);
    return {
      id: nouvelId(),
      photos: photos.map((p) => ({ ...p })),
      annonce: null,
      statut: 'brouillon', // brouillon, pret, erreur
      erreur: null,
      dateCreation: Date.now(),
      dateModification: Date.now()
    };
  }

  // Regroupe les photos par article selon leurs caractéristiques visuelles
  // Pour l'instant: 1 photo = 1 article, ou groupes manuels
  function regrouperPhotosParArticle(photos, mode) {
    if (!Array.isArray(photos) || !photos.length) return [];
    if (mode === 'une_par_article') {
      return photos.map((photo) => [photo]);
    }
    if (mode === 'toutes_ensemble') {
      return [photos.slice(0, MAX_PHOTOS_PAR_ARTICLE)];
    }
    // Par défaut: regroupement intelligent basé sur la similarité des noms de fichiers
    // Les photos avec des noms similaires (IMG_001, IMG_002) sont groupées
    const groupes = [];
    let groupeCourant = [];
    let dernierPrefixe = null;
    
    for (const photo of photos) {
      const nom = photo.nom || '';
      // Extraire le préfixe numérique (IMG_001 -> IMG_)
      const match = nom.match(/^(.+?)(\d+)/);
      const prefixe = match ? match[1] : nom;
      
      if (dernierPrefixe === null || prefixe === dernierPrefixe) {
        if (groupeCourant.length < MAX_PHOTOS_PAR_ARTICLE) {
          groupeCourant.push(photo);
        } else {
          groupes.push(groupeCourant);
          groupeCourant = [photo];
        }
      } else {
        if (groupeCourant.length) groupes.push(groupeCourant);
        groupeCourant = [photo];
      }
      dernierPrefixe = prefixe;
    }
    if (groupeCourant.length) groupes.push(groupeCourant);
    return groupes;
  }

  // File de traitement
  function creerFile() {
    return {
      articles: [],
      enCours: null,
      termines: 0,
      erreurs: 0,
      annules: false
    };
  }

  function ajouterArticle(file, article) {
    if (file.articles.length >= MAX_ARTICLES) {
      throw new Error('La file contient déjà ' + MAX_ARTICLES + ' articles.');
    }
    return {
      ...file,
      articles: file.articles.concat([article])
    };
  }

  function retirerArticle(file, id) {
    return {
      ...file,
      articles: file.articles.filter((a) => a.id !== id)
    };
  }

  function mettreAJourArticle(file, id, modifications) {
    return {
      ...file,
      articles: file.articles.map((article) => {
        if (article.id !== id) return article;
        return {
          ...article,
          ...modifications,
          dateModification: Date.now()
        };
      })
    };
  }

  function articleParId(file, id) {
    return file.articles.find((a) => a.id === id) || null;
  }

  function articlesParStatut(file, statut) {
    return file.articles.filter((a) => a.statut === statut);
  }

  function progression(file) {
    const total = file.articles.length;
    const termines = file.articles.filter((a) => a.statut === 'pret' || a.statut === 'erreur').length;
    const erreurs = file.articles.filter((a) => a.statut === 'erreur').length;
    return {
      total: total,
      termines: termines,
      restants: total - termines,
      erreurs: erreurs,
      pourcentage: total > 0 ? Math.round((termines / total) * 100) : 0
    };
  }

  // Amélioration automatique d'une photo
  // Retourne un tableau d'opérations à appliquer (ne modifie pas la photo)
  function ameliorerPhotoAuto(photo, Studio) {
    if (!photo || !photo.source) return [];
    
    const operations = [];
    
    try {
      // 1. Détecter et corriger l'inclinaison
      const angle = Studio.angleRedressement(photo.source);
      if (Math.abs(angle) > 0.5) {
        operations.push({ type: 'redresser', degres: angle });
      }
      
      // 2. Légère amélioration de luminosité/contraste par défaut
      // L'analyse d'image complète nécessiterait un canvas, on applique des valeurs modérées
      operations.push({ type: 'regler', luminosite: 5, contraste: 8, saturation: 0 });
      
    } catch (e) {
      // Si l'analyse échoue, retourner des opérations par défaut
      console.warn('[Batch] Erreur analyse photo:', e);
    }
    
    return operations;
  }

  // Améliorer toutes les photos d'un article
  function ameliorerArticleAuto(article, Studio) {
    if (!article || !article.photos) return article;
    return {
      ...article,
      photos: article.photos.map((photo) => {
        const ops = ameliorerPhotoAuto(photo, Studio);
        return {
          ...photo,
          operations: (photo.operations || []).concat(ops)
        };
      }),
      dateModification: Date.now()
    };
  }

  // Préparer les images pour l'analyse IA
  function imagesArticlePourAnalyse(article, Studio) {
    const images = [];
    for (const photo of article.photos) {
      if (photo.generee) continue;
      let image = Studio.copier ? Studio.copier(photo.source) : { ...photo.source };
      for (const op of photo.operations || []) {
        try {
          if (Studio.appliquerOperation) {
            image = Studio.appliquerOperation(image, op);
          }
        } catch (e) {
          // Ignorer les opérations en erreur
        }
      }
      images.push(image);
    }
    return images;
  }

  // Sérialisation des articles pour le stockage
  function serialiserArticle(article) {
    return {
      id: article.id,
      photos: article.photos.map((p) => ({
        id: p.id,
        nom: p.nom,
        operations: p.operations || [],
        generee: p.generee || false
        // Ne pas sérialiser source (trop volumineux)
      })),
      annonce: article.annonce,
      statut: article.statut,
      erreur: article.erreur,
      dateCreation: article.dateCreation,
      dateModification: article.dateModification
    };
  }

  // Modèle de brouillon persistant enrichi
  function creerBrouillonComplet(article) {
    if (!article) throw new Error('Article manquant.');
    const annonce = article.annonce || {};
    return {
      id: article.id,
      titre: chaine(annonce.titre, 140),
      description: chaine(annonce.description, 5000),
      prix: annonce.prix_suggere ? Math.round(annonce.prix_suggere) : null,
      categorie: chaine(annonce.categorie, 100),
      sousCategorie: chaine(annonce.sous_categorie, 100),
      marque: chaine(annonce.marque, 100),
      taille: chaine(annonce.taille, 50),
      etat: chaine(annonce.etat, 50),
      couleurs: Array.isArray(annonce.couleurs) ? annonce.couleurs.slice(0, 2) : [],
      matiere: chaine(annonce.matiere, 100),
      aVerifier: Array.isArray(annonce.a_verifier) ? annonce.a_verifier : [],
      photos: article.photos.length,
      statut: article.statut,
      dateCreation: article.dateCreation,
      dateModification: Date.now(),
      plateforme: 'vinted'
    };
  }

  // Actions groupées sur les brouillons
  function modifierBrouillonsEnMasse(brouillons, ids, action) {
    const selection = new Set(ids || []);
    if (!selection.size) throw new Error('Sélectionnez au moins un article.');

    return brouillons.map((b) => {
      if (!selection.has(b.id)) return b;

      const copie = { ...b, dateModification: Date.now() };

      switch (action.type) {
        case 'prix_fixe':
          copie.prix = Math.max(1, Math.min(100000, Math.round(Number(action.valeur) || 0)));
          break;
        case 'prix_ajouter':
          if (copie.prix) copie.prix = Math.max(1, Math.min(100000, copie.prix + Math.round(Number(action.valeur) || 0)));
          break;
        case 'prix_pourcentage':
          if (copie.prix) copie.prix = Math.max(1, Math.min(100000, Math.round(copie.prix * (1 + (Number(action.valeur) || 0) / 100))));
          break;
        case 'statut':
          if (['brouillon', 'pret', 'archive'].includes(action.valeur)) {
            copie.statut = action.valeur;
          }
          break;
      }

      return copie;
    });
  }

  function filtrerBrouillons(brouillons, filtres) {
    if (!Array.isArray(brouillons)) return [];
    if (!filtres) return brouillons;
    
    return brouillons.filter((b) => {
      if (!b) return false;
      if (filtres.statut && b.statut !== filtres.statut) return false;
      if (filtres.plateforme && b.plateforme !== filtres.plateforme) return false;
      if (filtres.recherche) {
        const r = filtres.recherche.toLowerCase();
        const titre = (b.titre || '').toLowerCase();
        const marque = (b.marque || '').toLowerCase();
        if (!titre.includes(r) && !marque.includes(r)) return false;
      }
      if (filtres.prixMin && (b.prix || 0) < filtres.prixMin) return false;
      if (filtres.prixMax && (b.prix || 0) > filtres.prixMax) return false;
      return true;
    });
  }

  function trierBrouillons(brouillons, tri) {
    if (!Array.isArray(brouillons)) return [];
    const copie = brouillons.slice();
    switch (tri) {
      case 'date_desc':
        return copie.sort((a, b) => ((b && b.dateModification) || 0) - ((a && a.dateModification) || 0));
      case 'date_asc':
        return copie.sort((a, b) => ((a && a.dateModification) || 0) - ((b && b.dateModification) || 0));
      case 'prix_desc':
        return copie.sort((a, b) => ((b && b.prix) || 0) - ((a && a.prix) || 0));
      case 'prix_asc':
        return copie.sort((a, b) => ((a && a.prix) || 0) - ((b && b.prix) || 0));
      case 'titre':
        return copie.sort((a, b) => ((a && a.titre) || '').localeCompare((b && b.titre) || ''));
      default:
        return copie;
    }
  }

  // Statistiques
  function calculerStatistiques(brouillons) {
    if (!Array.isArray(brouillons)) {
      return { total: 0, brouillons: 0, prets: 0, archives: 0, prixMoyen: 0, valeurTotale: 0 };
    }
    
    const total = brouillons.length;
    const parStatut = { brouillon: 0, pret: 0, archive: 0 };
    let totalPrix = 0;
    let comptePrix = 0;

    for (const b of brouillons) {
      if (!b) continue;
      parStatut[b.statut] = (parStatut[b.statut] || 0) + 1;
      if (b.prix && b.prix > 0) {
        totalPrix += b.prix;
        comptePrix += 1;
      }
    }

    return {
      total: total,
      brouillons: parStatut.brouillon || 0,
      prets: parStatut.pret || 0,
      archives: parStatut.archive || 0,
      prixMoyen: comptePrix > 0 ? Math.round(totalPrix / comptePrix) : 0,
      valeurTotale: totalPrix
    };
  }

  return {
    MAX_ARTICLES: MAX_ARTICLES,
    MAX_PHOTOS_PAR_ARTICLE: MAX_PHOTOS_PAR_ARTICLE,
    nouvelId: nouvelId,
    creerArticle: creerArticle,
    regrouperPhotosParArticle: regrouperPhotosParArticle,
    creerFile: creerFile,
    ajouterArticle: ajouterArticle,
    retirerArticle: retirerArticle,
    mettreAJourArticle: mettreAJourArticle,
    articleParId: articleParId,
    articlesParStatut: articlesParStatut,
    progression: progression,
    ameliorerPhotoAuto: ameliorerPhotoAuto,
    ameliorerArticleAuto: ameliorerArticleAuto,
    imagesArticlePourAnalyse: imagesArticlePourAnalyse,
    serialiserArticle: serialiserArticle,
    creerBrouillonComplet: creerBrouillonComplet,
    modifierBrouillonsEnMasse: modifierBrouillonsEnMasse,
    filtrerBrouillons: filtrerBrouillons,
    trierBrouillons: trierBrouillons,
    calculerStatistiques: calculerStatistiques
  };
});
