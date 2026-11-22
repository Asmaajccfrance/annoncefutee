'use strict';

// Le vrai content.js, exécuté dans jsdom sur un faux formulaire « Vendre un article ».
// Vérifie : photos réellement chargées, jamais d'écrasement d'une saisie, jamais de soumission.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..', 'vinted-ia-extension');
const CORE = fs.readFileSync(path.join(DIR, 'lib', 'core.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(DIR, 'content.js'), 'utf8');

const fenetresOuvertes = [];
// Referme toute fenêtre restée ouverte (même si un test échoue) pour que le processus se termine.
test.after(() => fenetresOuvertes.forEach((w) => { try { w.close(); } catch (e) { /* déjà fermée */ } }));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function creerPage(corps) {
  const dom = new JSDOM(
    '<!doctype html><html><body><main><form id="f">' +
    '<input data-testid="title--input" id="titre" type="text">' +
    '<textarea data-testid="description--input" id="description"></textarea>' +
    '<input data-testid="price-input--input" id="prix" type="text">' +
    '<input data-testid="status-select-dropdown-input" id="etat" type="text" readonly>' +
    '<div id="photos"></div>' +
    (corps || '') +
    '</form></main></body></html>',
    { url: 'https://www.vinted.fr/items/new', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  fenetresOuvertes.push(w);
  const ecouteurs = [];
  const envoyes = [];
  w.chrome = {
    runtime: {
      id: 'abc',
      lastError: undefined,
      onMessage: { addListener: (f) => ecouteurs.push(f) },
      sendMessage: (msg, cb) => { envoyes.push(msg); if (cb) cb({ ok: true }); },
      getURL: (p) => 'chrome-extension://abc/' + p
    }
  };
  w.CSS = { escape: (s) => s };
  w.Element.prototype.getBoundingClientRect = function rect() {
    if (this.closest('[hidden]')) return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    return { width: 120, height: 120, top: 0, left: 0, right: 120, bottom: 120 };
  };
  w.eval(CORE);
  w.eval(CONTENT);

  const appeler = (msg) => new Promise((resolve) => ecouteurs[0](msg, { id: 'abc' }, resolve));
  const ajouterPhoto = (src, options = {}) => {
    const conteneur = w.document.createElement('div');
    const img = w.document.createElement('img');
    img.setAttribute('src', src);
    Object.defineProperty(img, 'complete', { get: () => options.chargee !== false, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { get: () => (options.chargee !== false ? 800 : 0), configurable: true });
    conteneur.appendChild(img);
    if (options.progression) {
      const barre = w.document.createElement('div');
      barre.setAttribute('role', 'progressbar');
      conteneur.appendChild(barre);
    }
    w.document.getElementById('photos').appendChild(conteneur);
    return img;
  };
  return { w, appeler, envoyes, ajouterPhoto, doc: w.document, fermer: () => w.close() };
}

const ANNONCE = { titre: 'Pull bleu', description: 'Pull doux.', prix_suggere: 18 };

test('seules les photos entièrement chargées sont prêtes, les autres sont comptées en chargement', async () => {
  const p = creerPage();
  p.ajouterPhoto('blob:https://www.vinted.fr/a');
  p.ajouterPhoto('blob:https://www.vinted.fr/b', { chargee: false });
  p.ajouterPhoto('blob:https://www.vinted.fr/c', { progression: true });
  const info = await p.appeler({ type: 'getPageInfo' });
  assert.strictEqual(info.photos, 1);
  assert.strictEqual(info.enChargement, 2);

  const collecte = await p.appeler({ type: 'getPageInfo' });
  assert.strictEqual(collecte.hash, info.hash, 'empreinte stable tant que rien ne change');
  p.fermer();
});

test('la fin du chargement est signalée une seule fois, sans bruit tant que rien ne change', async () => {
  const p = creerPage();
  const api = p.w.__annonceFutee;
  const photos = () => p.envoyes.filter((m) => m.type === 'photosChanged');

  const img = p.ajouterPhoto('blob:https://www.vinted.fr/a', { chargee: false });
  api.verifierPhotos();
  assert.strictEqual(photos().length, 1);
  assert.strictEqual(photos()[0].enChargement, 1);
  assert.strictEqual(photos()[0].count, 0);
  api.verifierPhotos();
  assert.strictEqual(photos().length, 1, 'aucune notification en double');

  Object.defineProperty(img, 'complete', { get: () => true });
  Object.defineProperty(img, 'naturalWidth', { get: () => 800 });
  api.verifierPhotos();
  assert.strictEqual(photos().length, 2);
  assert.strictEqual(photos()[1].enChargement, 0);
  assert.strictEqual(photos()[1].count, 1);

  img.parentElement.remove();
  api.verifierPhotos();
  assert.strictEqual(photos().length, 3);
  assert.strictEqual(photos()[2].count, 0, 'le retrait d\'une photo est détecté');
  p.fermer();
});

test('champs vides : remplis puis relus, états confirmés', async () => {
  const p = creerPage();
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.ok, true);
  assert.strictEqual(rep.fait.titre, 'rempli');
  assert.strictEqual(rep.fait.description, 'rempli');
  assert.strictEqual(rep.fait.prix, 'rempli');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull bleu');
  assert.strictEqual(p.doc.getElementById('prix').value, '18');
  p.fermer();
});

test('une saisie de l\'utilisateur n\'est jamais écrasée sans confirmation', async () => {
  const p = creerPage();
  p.doc.getElementById('titre').value = 'Mon titre à moi';
  p.doc.getElementById('prix').value = '18';

  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.fait.titre, 'conserve');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Mon titre à moi', 'valeur saisie intacte');
  assert.strictEqual(rep.fait.prix, 'deja', 'valeur déjà identique');
  assert.strictEqual(rep.fait.description, 'rempli');

  const force = await p.appeler({ type: 'fillListing', annonce: ANNONCE, forcer: ['titre'], seulement: ['titre'] });
  assert.strictEqual(force.fait.titre, 'rempli');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull bleu');
  assert.strictEqual(force.fait.description, undefined, 'seul le champ confirmé est touché');
  p.fermer();
});

test('une valeur posée par l\'extension peut être mise à jour, mais pas une valeur retouchée à la main ensuite', async () => {
  const p = creerPage();
  await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  const suivante = await p.appeler({ type: 'fillListing', annonce: { titre: 'Pull rouge', description: 'Autre.', prix_suggere: 25 } });
  assert.strictEqual(suivante.fait.titre, 'rempli');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull rouge');

  p.doc.getElementById('titre').value = 'Pull rouge, légère retouche perso';
  const derniere = await p.appeler({ type: 'fillListing', annonce: { titre: 'Pull vert', description: 'Encore.', prix_suggere: 30 } });
  assert.strictEqual(derniere.fait.titre, 'conserve');
  assert.strictEqual(p.doc.getElementById('titre').value, 'Pull rouge, légère retouche perso');
  p.fermer();
});

test('un champ qui refuse la valeur n\'est jamais annoncé comme rempli', async () => {
  const p = creerPage();
  const titre = p.doc.getElementById('titre');
  // formulaire qui remet la valeur à zéro à chaque saisie
  titre.addEventListener('input', () => {
    Object.getOwnPropertyDescriptor(p.w.HTMLInputElement.prototype, 'value').set.call(titre, '');
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.fait.titre, 'echec');
  assert.strictEqual(rep.fait.description, 'rempli');
  p.fermer();
});

test('jamais de soumission du formulaire pendant le remplissage', async () => {
  const p = creerPage();
  let soumissions = 0;
  const form = p.doc.getElementById('f');
  form.addEventListener('submit', (e) => { soumissions++; e.preventDefault(); });
  // un champ dont la réaction à « change » tente d'envoyer le formulaire
  p.doc.getElementById('titre').addEventListener('change', () => {
    form.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(soumissions, 0);
  assert.ok(rep.soumissionsBloquees >= 1);

  // hors remplissage, le comportement normal de la page est rétabli
  form.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(soumissions, 1);
  p.fermer();
});

test('un bouton de validation ou de publication n\'est jamais cliqué, une vraie option l\'est', async () => {
  const p = creerPage();
  const etat = p.doc.getElementById('etat');
  let clicsPublier = 0;
  let clicsOption = 0;
  etat.addEventListener('click', () => {
    if (p.doc.getElementById('menu-ouvert')) return;
    const menu = p.doc.createElement('div');
    menu.id = 'menu-ouvert';
    menu.innerHTML = '<button type="submit" id="valider"><span>Très bon état</span></button>';
    p.doc.body.appendChild(menu);
    p.doc.getElementById('valider').addEventListener('click', () => { clicsPublier++; });
  });
  const annonce = Object.assign({ etat: 'Très bon état' }, ANNONCE);
  const rep = await p.appeler({ type: 'fillListing', annonce: annonce });
  assert.strictEqual(clicsPublier, 0, 'le bouton de type submit n\'est pas cliqué');
  assert.strictEqual(rep.menus.etat, 'a_choisir');

  const q = creerPage();
  const champ = q.doc.getElementById('etat');
  champ.addEventListener('click', () => {
    if (q.doc.getElementById('liste')) return;
    const liste = q.doc.createElement('div');
    liste.id = 'liste';
    liste.innerHTML = '<div id="opt">Très bon état</div>';
    q.doc.body.appendChild(liste);
    q.doc.getElementById('opt').addEventListener('click', () => { clicsOption++; });
  });
  const rep2 = await q.appeler({ type: 'fillListing', annonce: annonce });
  assert.ok(clicsOption >= 1);
  assert.strictEqual(rep2.menus.etat, 'rempli');
  p.fermer();
  q.fermer();
});

test('une couleur masquée dans la page est cochée dès que la liste s\'ouvre', async () => {
  const p = creerPage('<input data-testid="color-select-dropdown-input" id="couleur" type="text" readonly>');
  const champ = p.doc.getElementById('couleur');
  const liste = p.doc.createElement('div');
  liste.hidden = true;
  liste.innerHTML = '<span id="noir">Noir</span><span id="blanc">Blanc</span>';
  p.doc.body.appendChild(liste);
  let clics = 0;
  p.doc.getElementById('noir').addEventListener('click', () => { clics++; });
  champ.addEventListener('click', () => { liste.hidden = false; });

  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({ couleurs: ['Noir'] }, ANNONCE) });
  assert.ok(clics >= 1, 'la ligne Noir est cliquée');
  assert.strictEqual(rep.menus.couleurs, 'rempli');
  assert.strictEqual(clics, 1, 'Noir n\'est cliqué qu\'une fois');
  p.fermer();
});

test('une couleur absente de la liste apparaît quand on la tape dans le champ', async () => {
  const p = creerPage('<input data-testid="color-select-dropdown-input" id="couleur" type="text">');
  const champ = p.doc.getElementById('couleur');
  let clics = 0;
  champ.addEventListener('input', () => {
    if (champ.value !== 'Noir' || p.doc.getElementById('noir')) return;
    const ligne = p.doc.createElement('span');
    ligne.id = 'noir';
    ligne.textContent = 'Noir';
    ligne.addEventListener('click', () => { clics++; });
    p.doc.body.appendChild(ligne);
  });

  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({ couleurs: ['Noir'] }, ANNONCE) });
  assert.ok(clics >= 1);
  assert.strictEqual(rep.menus.couleurs, 'rempli');
  p.fermer();
});

test('un menu déjà renseigné n\'est pas modifié', async () => {
  const p = creerPage();
  p.doc.getElementById('etat').value = 'Satisfaisant';
  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({ etat: 'Très bon état' }, ANNONCE) });
  assert.strictEqual(rep.menus.etat, 'conserve');
  assert.strictEqual(p.doc.getElementById('etat').value, 'Satisfaisant');

  p.doc.getElementById('etat').value = 'Très bon état';
  const rep2 = await p.appeler({ type: 'fillListing', annonce: Object.assign({ etat: 'Très bon état' }, ANNONCE) });
  assert.strictEqual(rep2.menus.etat, 'deja');
  p.fermer();
});

test('la suggestion de catégorie du bon rayon est cochée', async () => {
  const p = creerPage('<label for="categorie">Catégorie</label><input id="categorie" data-testid="catalog-select-dropdown-input" placeholder="Sélectionne une catégorie" readonly>');
  const champ = p.doc.getElementById('categorie');
  const clics = { hommes: 0, femmes: 0 };
  champ.addEventListener('click', () => {
    if (p.doc.getElementById('catalogue')) return;
    const bloc = p.doc.createElement('div');
    bloc.id = 'catalogue';
    bloc.innerHTML = '<input placeholder="Trouver une catégorie"><div>Suggestions</div>'
      + '<label><span>Bonnets</span><span>Hommes &gt; Chapeaux et casquettes</span><input type="radio" id="h"></label>'
      + '<label><span>Bonnets</span><span>Femmes &gt; Chapeaux et casquettes</span><input type="radio" id="f"></label>';
    p.doc.body.appendChild(bloc);
    p.doc.getElementById('h').addEventListener('click', () => { clics.hommes++; });
    p.doc.getElementById('f').addEventListener('click', () => { clics.femmes++; });
  });
  const rep = await p.appeler({
    type: 'fillListing',
    annonce: Object.assign({}, ANNONCE, {
      titre: 'Bonnet Calvin Klein Jeans noir',
      categorie: 'Femmes > Chapeaux et casquettes > Bonnets',
      sousCategorie: 'Bonnets'
    })
  });
  assert.strictEqual(clics.hommes, 0, 'la ligne Hommes n\'est pas choisie');
  assert.ok(clics.femmes >= 1, 'la ligne Femmes est cochée');
  assert.strictEqual(rep.menus.categorie, 'rempli');
  p.fermer();
});

test('la catégorie est cherchée puis cochée quand aucune suggestion ne correspond', async () => {
  const p = creerPage('<label for="categorie">Catégorie</label><input id="categorie" data-testid="catalog-select-dropdown-input" placeholder="Sélectionne une catégorie" readonly>');
  const champ = p.doc.getElementById('categorie');
  let clics = 0;
  champ.addEventListener('click', () => {
    if (p.doc.getElementById('recherche-cat')) return;
    const bloc = p.doc.createElement('div');
    bloc.innerHTML = '<input id="recherche-cat" placeholder="Trouver une catégorie">'
      + '<label><span>Robes</span><span>Femmes &gt; Vêtements</span><input type="radio"></label>';
    p.doc.body.appendChild(bloc);
    p.doc.getElementById('recherche-cat').addEventListener('input', () => {
      if (p.doc.getElementById('bonnets')) return;
      const ligne = p.doc.createElement('label');
      ligne.innerHTML = '<span>Bonnets</span><span>Femmes &gt; Chapeaux et casquettes</span><input type="radio" id="bonnets">';
      p.doc.body.appendChild(ligne);
      p.doc.getElementById('bonnets').addEventListener('click', () => { clics++; });
    });
  });
  const rep = await p.appeler({
    type: 'fillListing',
    annonce: Object.assign({}, ANNONCE, { titre: 'Bonnet noir', categorie: 'Accessoires', sousCategorie: 'Bonnets' })
  });
  assert.ok(clics >= 1, 'la ligne trouvée par la recherche est cochée');
  assert.strictEqual(rep.menus.categorie, 'rempli');
  assert.strictEqual(p.doc.getElementById('recherche-cat').value, 'Bonnets');
  p.fermer();
});

test('une catégorie déjà choisie n\'est pas remplacée', async () => {
  const p = creerPage('<label for="categorie">Catégorie</label><input id="categorie" data-testid="catalog-select-dropdown-input" value="Robes" readonly>');
  let ouvertures = 0;
  p.doc.getElementById('categorie').addEventListener('click', () => { ouvertures++; });
  const rep = await p.appeler({
    type: 'fillListing',
    annonce: Object.assign({}, ANNONCE, { categorie: 'Femmes > Bonnets', sousCategorie: 'Bonnets' })
  });
  assert.strictEqual(rep.menus.categorie, 'conserve');
  assert.strictEqual(ouvertures, 0);
  p.doc.getElementById('categorie').value = 'Bonnets';
  const rep2 = await p.appeler({
    type: 'fillListing',
    annonce: Object.assign({}, ANNONCE, { categorie: 'Femmes > Bonnets', sousCategorie: 'Bonnets' })
  });
  assert.strictEqual(rep2.menus.categorie, 'deja');
  p.fermer();
});

test('la marque est choisie seulement si une option a exactement le même texte', async () => {
  const p = creerPage('<label for="marque">Marque</label><input id="marque" data-testid="brand-select-dropdown-input" placeholder="Sélectionne une marque" readonly>');
  const champ = p.doc.getElementById('marque');
  const clics = { zara: 0, autre: 0 };
  champ.addEventListener('click', () => {
    if (p.doc.getElementById('zara')) return;
    const liste = p.doc.createElement('div');
    liste.innerHTML = '<span id="zara">Zara</span><span id="autre">Zara Home</span>';
    p.doc.body.appendChild(liste);
    p.doc.getElementById('zara').addEventListener('click', () => { clics.zara++; });
    p.doc.getElementById('autre').addEventListener('click', () => { clics.autre++; });
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({}, ANNONCE, { marque: 'Zara' }) });
  assert.ok(clics.zara >= 1, 'l\'option Zara est cliquée');
  assert.strictEqual(clics.autre, 0, 'une option plus longue n\'est pas choisie');
  assert.strictEqual(rep.menus.marque, 'rempli');
  p.fermer();
});

test('la marque est tapée dans le champ de recherche du menu', async () => {
  const p = creerPage('<label for="marque">Marque</label><input id="marque" data-testid="brand-select-dropdown-input" readonly>');
  const champ = p.doc.getElementById('marque');
  let clics = 0;
  champ.addEventListener('click', () => {
    if (p.doc.getElementById('recherche-marque')) return;
    const bloc = p.doc.createElement('div');
    bloc.innerHTML = '<input id="recherche-marque" placeholder="Rechercher une marque">';
    p.doc.body.appendChild(bloc);
    p.doc.getElementById('recherche-marque').addEventListener('input', () => {
      if (p.doc.getElementById('nike')) return;
      const ligne = p.doc.createElement('span');
      ligne.id = 'nike';
      ligne.textContent = 'Nike';
      p.doc.body.appendChild(ligne);
      ligne.addEventListener('click', () => { clics++; });
    });
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({}, ANNONCE, { marque: 'Nike' }) });
  assert.ok(clics >= 1, 'l\'option apparue après la recherche est cliquée');
  assert.strictEqual(p.doc.getElementById('recherche-marque').value, 'Nike');
  assert.strictEqual(rep.menus.marque, 'rempli');
  p.fermer();
});

test('une marque déjà remplie par Vinted n\'est pas modifiée', async () => {
  const p = creerPage('<label for="marque">Marque</label><input id="marque" data-testid="brand-select-dropdown-input" value="Nike" readonly>');
  let ouvertures = 0;
  p.doc.getElementById('marque').addEventListener('click', () => { ouvertures++; });
  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({}, ANNONCE, { marque: 'Zara' }) });
  assert.strictEqual(rep.menus.marque, 'deja');
  assert.strictEqual(ouvertures, 0);
  assert.strictEqual(p.doc.getElementById('marque').value, 'Nike');
  p.fermer();
});

test('une marque vide ou absente du menu n\'est pas choisie', async () => {
  const p = creerPage('<label for="marque">Marque</label><input id="marque" data-testid="brand-select-dropdown-input" readonly>');
  const champ = p.doc.getElementById('marque');
  let clics = 0;
  champ.addEventListener('click', () => {
    if (p.doc.getElementById('adidas')) return;
    const ligne = p.doc.createElement('span');
    ligne.id = 'adidas';
    ligne.textContent = 'Adidas';
    p.doc.body.appendChild(ligne);
    ligne.addEventListener('click', () => { clics++; });
  });
  const vide = await p.appeler({ type: 'fillListing', annonce: Object.assign({}, ANNONCE, { marque: '' }) });
  assert.strictEqual(vide.menus.marque, 'a_choisir');
  assert.strictEqual(clics, 0, 'menu non ouvert quand la marque est vide');

  const absente = await p.appeler({ type: 'fillListing', annonce: Object.assign({}, ANNONCE, { marque: 'Inconnue' }) });
  assert.strictEqual(absente.menus.marque, 'a_choisir');
  assert.strictEqual(clics, 0, 'aucune option différente n\'est cliquée');
  p.fermer();
});

function recommandations() {
  return '<div id="reco">'
    + '<button type="button" id="affaire">1,00 €<span>Bonne affaire</span></button>'
    + '<button type="button" id="ideal">1,65 €<span>Prix idéal</span></button>'
    + '<button type="button" id="premium">2,00 €<span>Premium</span></button>'
    + '<a id="similaires" href="https://www.vinted.fr/catalog?search_text=pull">Voir le prix de vente d\'articles similaires</a>'
    + '</div>';
}

test('le Prix idéal affiché par Vinted remplace l\'estimation, sans toucher aux autres cases', async () => {
  const p = creerPage(recommandations());
  const clics = { affaire: 0, ideal: 0, premium: 0, similaires: 0 };
  ['affaire', 'ideal', 'premium', 'similaires'].forEach((id) => {
    p.doc.getElementById(id).addEventListener('click', () => { clics[id]++; });
  });
  const rep = await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(rep.fait.prix, 'rempli');
  assert.strictEqual(p.doc.getElementById('prix').value, '1.65');
  assert.ok(clics.ideal >= 1, 'la case Prix idéal est choisie');
  assert.strictEqual(clics.affaire, 0);
  assert.strictEqual(clics.premium, 0);
  assert.strictEqual(clics.similaires, 0, 'le lien des annonces similaires n\'est pas ouvert');
  p.fermer();

  const q = creerPage('<button type="button" id="ideal">1,65 € Prix idéal</button><button type="button" id="premium">2,00 € Premium</button>');
  let clic = 0;
  q.doc.getElementById('ideal').addEventListener('click', () => { clic++; });
  await q.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(q.doc.getElementById('prix').value, '1.65');
  assert.ok(clic >= 1, 'une case dont le montant et le libellé sont dans le même texte est choisie');
  q.fermer();
});

test('le Prix idéal est choisi dès qu\'il apparaît, sauf si le prix a été saisi à la main', async () => {
  const p = creerPage();
  await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(p.doc.getElementById('prix').value, '18');
  p.doc.querySelector('main').insertAdjacentHTML('beforeend', recommandations());
  const debut = Date.now();
  let vu = false;
  while (Date.now() - debut < 2000) {
    if (p.doc.getElementById('prix').value === '1.65') { vu = true; break; }
    await attendre(50);
  }
  assert.strictEqual(vu, true, 'le prix du formulaire devient le Prix idéal');

  const q = creerPage();
  q.doc.getElementById('prix').value = '9';
  q.doc.querySelector('main').insertAdjacentHTML('beforeend', recommandations());
  await attendre(500);
  assert.strictEqual(q.doc.getElementById('prix').value, '9', 'un prix saisi à la main reste en place');
  q.fermer();
  p.fermer();
});

test('un prix illisible NaN est remplacé par le Prix idéal', async () => {
  const p = creerPage(recommandations());
  p.doc.getElementById('prix').value = 'NaN';
  await p.appeler({ type: 'fillListing', annonce: ANNONCE });
  assert.strictEqual(p.doc.getElementById('prix').value, '1.65');
  p.fermer();
});

test('la taille écrite est choisie dans le menu, même si elle apparaît après la catégorie', async () => {
  const p = creerPage('');
  const clics = { m: 0, xs: 0 };
  setTimeout(() => {
    const label = p.doc.createElement('label');
    label.htmlFor = 'taille';
    label.textContent = 'Taille';
    const champ = p.doc.createElement('input');
    champ.id = 'taille';
    champ.setAttribute('data-testid', 'size-select-dropdown-input');
    champ.readOnly = true;
    p.doc.querySelector('form').append(label, champ);
    champ.addEventListener('click', () => {
      if (p.doc.getElementById('opt-m')) return;
      const liste = p.doc.createElement('div');
      liste.innerHTML = '<span id="opt-xs">XS</span><span id="opt-m">M / 38</span><span id="opt-l">L</span>';
      p.doc.body.appendChild(liste);
      p.doc.getElementById('opt-m').addEventListener('click', () => { clics.m++; });
      p.doc.getElementById('opt-xs').addEventListener('click', () => { clics.xs++; });
    });
  }, 200);
  const rep = await p.appeler({ type: 'fillListing', annonce: Object.assign({}, ANNONCE, { taille: 'Taille M' }) });
  assert.ok(clics.m >= 1, 'l\'option M est cliquée');
  assert.strictEqual(clics.xs, 0, 'XS n\'est pas pris pour S ni pour M');
  assert.strictEqual(rep.menus.taille, 'rempli');
  p.fermer();
});

test('le script de page ne contient aucun moyen de soumettre ou de publier', () => {
  assert.ok(!/requestSubmit|\.submit\s*\(/.test(CONTENT), 'aucun appel de soumission');
  assert.ok(!/click\(\)[^;]*publier/i.test(CONTENT));
  assert.ok(/estBoutonValidation/.test(CONTENT));
});
