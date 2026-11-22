// S'exécute à document_start sur vinted.fr pour intercepter l'annonce transmise
// par l'application Android Annonce Futée (#af=<base64url>), la mémoriser dans l'extension
// et nettoyer immédiatement l'URL avant le chargement du routeur Vinted.

(() => {
  const hash = location.hash || '';
  if (!hash.startsWith('#af=')) return;

  const brut = hash.slice(4);
  try {
    // Nettoyage immédiat de l'URL visible
    history.replaceState(null, '', location.pathname + location.search);
  } catch (_) {}

  if (!brut || brut.length > 24000) return;

  try {
    const b64 = brut.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binaire = atob(pad);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) {
      octets[i] = binaire.charCodeAt(i);
    }
    const jsonTexte = new TextDecoder('utf-8').decode(octets);
    const lu = JSON.parse(jsonTexte);
    if (!lu || typeof lu !== 'object') return;

    const cles = [
      'titre',
      'prix',
      'description',
      'marque',
      'etat',
      'taille',
      'couleurs',
      'matiere',
      'categorie',
      'sousCategorie',
    ];
    const propre = {};
    for (const cle of cles) {
      if (typeof lu[cle] === 'string') {
        propre[cle] = lu[cle].slice(0, cle === 'description' ? 5000 : 200).trim();
      }
    }
    if (!propre.titre && !propre.description) return;

    propre._autoRemplir = true;
    propre._horodatage = Date.now();
    window.__afAnnonceAppAndroid = propre;

    const ext = typeof browser !== 'undefined' ? browser : chrome;
    ext.runtime.sendMessage({ type: 'MEMORISER_ANNONCE_APP', annonce: propre });
  } catch (_) {}
})();
