const runtime = typeof browser !== 'undefined' ? browser : chrome;
let annonceCourante = null;

const $ = (id) => document.getElementById(id);

function afficherStatut(texte, erreur = false) {
  const el = $('statut');
  el.hidden = !texte;
  el.textContent = texte || '';
  el.className = 'statut ' + (erreur ? 'erreur' : 'succes');
}

function afficherAnnonce(annonce) {
  annonceCourante = annonce;
  if (!annonce || (!annonce.titre && !annonce.description)) {
    $('zone-annonce').hidden = true;
    return;
  }
  $('zone-annonce').hidden = false;
  $('annonce-titre').textContent = annonce.titre || 'Sans titre';
  const p = String(annonce.prix || '').trim();
  $('annonce-prix').textContent = p ? (p.includes('€') ? p : p + ' €') : '-- €';
  $('annonce-desc').textContent = annonce.description || '';
}

function formaterCredits(credits) {
  if (!credits) return 'Extension Safari iPhone';
  if (credits.unlimited) return 'Crédits IA : Illimités';
  if (credits.remaining != null) return `Crédits IA : ${credits.remaining} restants`;
  return 'Connecté';
}

async function ongletActif() {
  const tabs = await runtime.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function envoyer(message) {
  try {
    return await runtime.runtime.sendMessage(message);
  } catch (_) {
    return null;
  }
}

async function envoyerOnglet(tabId, message) {
  try {
    return await runtime.tabs.sendMessage(tabId, message);
  } catch (_) {
    return null;
  }
}

async function rafraichir() {
  const rep = await envoyer({ type: 'ETAT_COMPTE' });
  if (!rep || !rep.ok) return;
  afficherAnnonce(rep.annonce);
  if (rep.connecte) {
    $('zone-connexion').hidden = true;
    $('zone-connecte').hidden = false;
    $('credits-badge').textContent = formaterCredits(rep.credits);
  } else {
    $('zone-connexion').hidden = false;
    $('zone-connecte').hidden = true;
    $('credits-badge').textContent = 'Extension Safari iPhone';
  }
}

$('btn-preremplir').addEventListener('click', async () => {
  if (!annonceCourante) return;
  const tab = await ongletActif();
  if (!tab || !tab.id) {
    afficherStatut('Ouvre vinted.fr/items/new dans Safari.', true);
    return;
  }
  const rep = await envoyerOnglet(tab.id, { type: 'REMPLIR_MAINTENANT', annonce: annonceCourante });
  if (rep && rep.ok && rep.remplis > 0) {
    afficherStatut(`${rep.remplis} champ(s) pré-rempli(s) sur Vinted.`);
  } else {
    afficherStatut('Va sur la page « Vendre un article » de vinted.fr.', true);
  }
});

$('btn-connexion').addEventListener('click', async () => {
  afficherStatut('Connexion…');
  const rep = await envoyer({
    type: 'CONNEXION',
    email: $('email').value,
    password: $('password').value,
  });
  if (rep && rep.ok) {
    afficherStatut('Connecté.');
    rafraichir();
  } else {
    afficherStatut((rep && rep.error) || 'Connexion refusée.', true);
  }
});

$('btn-deconnexion').addEventListener('click', async () => {
  await envoyer({ type: 'DECONNEXION' });
  afficherStatut('');
  rafraichir();
});

$('btn-analyser').addEventListener('click', async () => {
  const tab = await ongletActif();
  if (!tab || !tab.id) {
    afficherStatut('Ouvre vinted.fr/items/new dans Safari.', true);
    return;
  }
  afficherStatut('Lecture des photos sur la page…');
  const extraction = await envoyerOnglet(tab.id, { type: 'EXTRAIRE_PHOTOS_PAGE' });
  if (!extraction || !extraction.ok || !extraction.images || extraction.images.length === 0) {
    afficherStatut('Ajoute d\'abord tes photos sur la page Vinted dans Safari.', true);
    return;
  }
  afficherStatut('Rédaction de l\'annonce en cours…');
  const rep = await envoyer({
    type: 'ANALYSER_DEPUIS_SAFARI',
    images: extraction.images,
    precisions: $('precisions').value,
  });
  if (!rep || !rep.ok) {
    afficherStatut((rep && rep.error) || 'Analyse échouée.', true);
    return;
  }
  afficherAnnonce(rep.annonce);
  $('credits-badge').textContent = formaterCredits(rep.credits);
  await envoyerOnglet(tab.id, { type: 'REMPLIR_MAINTENANT', annonce: rep.annonce });
  afficherStatut('Annonce générée et pré-remplie sur Vinted !');
});

rafraichir();
