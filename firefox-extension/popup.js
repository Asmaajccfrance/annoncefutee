const ext = typeof browser !== 'undefined' ? browser : chrome;
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
  if (!credits) return 'Extension Firefox Android & PC';
  if (credits.unlimited) return 'Crédits IA : Illimités';
  if (credits.remaining != null) return `Crédits IA : ${credits.remaining} restants`;
  return 'Connecté';
}

function ongletActif() {
  return new Promise((resolve) => {
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function rafraichir() {
  ext.runtime.sendMessage({ type: 'ETAT_COMPTE' }, (rep) => {
    if (!rep || !rep.ok) return;
    afficherAnnonce(rep.annonce);
    if (rep.connecte) {
      $('zone-connexion').hidden = true;
      $('zone-connecte').hidden = false;
      $('credits-badge').textContent = formaterCredits(rep.credits);
    } else {
      $('zone-connexion').hidden = false;
      $('zone-connecte').hidden = true;
      $('credits-badge').textContent = 'Extension Firefox Android & PC';
    }
  });
}

$('btn-preremplir').addEventListener('click', async () => {
  if (!annonceCourante) return;
  const tab = await ongletActif();
  if (!tab || !tab.id) {
    afficherStatut('Ouvre vinted.fr/items/new dans Firefox.', true);
    return;
  }
  ext.tabs.sendMessage(
    tab.id,
    { type: 'REMPLIR_MAINTENANT', annonce: annonceCourante },
    (rep) => {
      if (rep && rep.ok && rep.remplis > 0) {
        afficherStatut(`${rep.remplis} champ(s) pré-rempli(s) sur Vinted.`);
      } else {
        afficherStatut('Va sur la page « Vendre un article » de vinted.fr.', true);
      }
    }
  );
});

$('btn-effacer-annonce').addEventListener('click', () => {
  ext.runtime.sendMessage({ type: 'EFFACER_ANNONCE' }, () => {
    afficherAnnonce(null);
    afficherStatut('Annonce retirée de l\'extension.');
  });
});

$('btn-connexion').addEventListener('click', () => {
  afficherStatut('Connexion…');
  ext.runtime.sendMessage(
    {
      type: 'CONNEXION',
      email: $('email').value,
      password: $('password').value,
    },
    (rep) => {
      if (rep && rep.ok) {
        afficherStatut('Connecté.');
        rafraichir();
      } else {
        afficherStatut((rep && rep.error) || 'Connexion refusée.', true);
      }
    }
  );
});

$('btn-deconnexion').addEventListener('click', () => {
  ext.runtime.sendMessage({ type: 'DECONNEXION' }, () => {
    afficherStatut('');
    rafraichir();
  });
});

$('btn-analyser').addEventListener('click', async () => {
  const tab = await ongletActif();
  if (!tab || !tab.id) {
    afficherStatut('Ouvre vinted.fr/items/new dans Firefox.', true);
    return;
  }
  afficherStatut('Lecture des photos sur la page…');
  ext.tabs.sendMessage(tab.id, { type: 'EXTRAIRE_PHOTOS_PAGE' }, (extraction) => {
    if (!extraction || !extraction.ok || !extraction.images || extraction.images.length === 0) {
      afficherStatut('Ajoute d\'abord tes photos sur la page Vinted dans Firefox.', true);
      return;
    }
    afficherStatut('Rédaction de l\'annonce en cours…');
    ext.runtime.sendMessage(
      {
        type: 'ANALYSER_DEPUIS_FIREFOX',
        images: extraction.images,
        precisions: $('precisions').value,
      },
      (rep) => {
        if (!rep || !rep.ok) {
          afficherStatut((rep && rep.error) || 'Analyse échouée.', true);
          return;
        }
        afficherAnnonce(rep.annonce);
        $('credits-badge').textContent = formaterCredits(rep.credits);
        ext.tabs.sendMessage(tab.id, {
          type: 'REMPLIR_MAINTENANT',
          annonce: rep.annonce,
        });
        afficherStatut('Annonce générée et pré-remplie sur Vinted !');
      }
    );
  });
});

rafraichir();
