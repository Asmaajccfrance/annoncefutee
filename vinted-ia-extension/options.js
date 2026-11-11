const IA = globalThis.VintedIA;
const el = (id) => document.getElementById(id);
const message = el('message');

function dire(texte, type) {
  message.textContent = texte;
  message.className = type || '';
}

function afficher(s) {
  el('apiKey').value = s.apiKey;
  el('model').value = s.model;
  el('signature').value = s.signature;
  el('style').value = s.style;
  el('hashtags').checked = !!s.hashtags;
  el('prixAjustement').value = s.prixAjustement ? String(s.prixAjustement) : '';
  el('prixArrondi').value = String(s.prixArrondi);
  el('autoGenerer').checked = !!s.autoGenerer;
  el('backendUrl').value = s.backendUrl;
  el('email').value = s.backendEmail;
}

function afficherCompte(compte) {
  if (!compte || !compte.connected) {
    el('compte').textContent = 'Non connecté. Sans session, l\'extension continue d\'utiliser la clé Claude si elle est enregistrée.';
    return;
  }
  let texte = 'Connecté' + (compte.email ? ' : ' + compte.email : '');
  if (compte.credits && typeof compte.credits.remaining === 'number') {
    const n = compte.credits.remaining;
    texte += ' — ' + n + ' crédit' + (n > 1 ? 's' : '') + ' restant' + (n > 1 ? 's' : '') + ' ce mois-ci';
  } else if (compte.offline) {
    texte += ' — serveur injoignable';
  }
  el('compte').textContent = texte;
}

chrome.storage.local.get(IA.REGLAGES_DEFAUT, (r) => {
  if (chrome.runtime.lastError) {
    dire('Lecture des réglages impossible.', 'erreur');
    return;
  }
  afficher(IA.assainirReglages(r));
  chrome.runtime.sendMessage({ type: 'getAccount' }, (rep) => {
    if (rep && rep.ok) afficherCompte(rep.data);
  });
});

el('enregistrer').addEventListener('click', () => {
  chrome.storage.local.get(IA.REGLAGES_DEFAUT, (actuel) => {
    const s = IA.assainirReglages({
      apiKey: el('apiKey').value,
      model: el('model').value,
      signature: el('signature').value,
      style: el('style').value,
      hashtags: el('hashtags').checked,
      prixAjustement: el('prixAjustement').value,
      prixArrondi: el('prixArrondi').value,
      autoGenerer: el('autoGenerer').checked,
      backendUrl: el('backendUrl').value,
      backendToken: actuel.backendToken,
      backendEmail: el('email').value || actuel.backendEmail
    });
    afficher(s);
    chrome.storage.local.set(s, () => {
      if (chrome.runtime.lastError) {
        dire('Enregistrement impossible.', 'erreur');
        return;
      }
      dire('Réglages enregistrés. Actualise la page Vinted (F5) pour les appliquer.', 'ok');
    });
  });
});

el('connecter').addEventListener('click', () => {
  const email = el('email').value.trim();
  const password = el('password').value;
  const backendUrl = el('backendUrl').value.trim();
  if (!email || !password) {
    dire('Indique l\'e-mail et le mot de passe du compte.', 'erreur');
    return;
  }
  try {
    IA.urlApi(backendUrl, '/api/v1/auth/login');
  } catch (e) {
    dire(e.message, 'erreur');
    return;
  }
  dire('Connexion…');
  chrome.runtime.sendMessage({ type: 'authLogin', email: email, password: password, backendUrl: backendUrl }, (rep) => {
    el('password').value = '';
    if (chrome.runtime.lastError || !rep) {
      dire('Pas de réponse de l\'extension. Recharge-la puis réessaie.', 'erreur');
    } else if (rep.ok) {
      if (rep.data.backendUrl) el('backendUrl').value = rep.data.backendUrl;
      if (rep.data.email) el('email').value = rep.data.email;
      afficherCompte(rep.data);
      dire('Connecté. Les prochaines annonces passent par le serveur.', 'ok');
    } else {
      dire(rep.error, 'erreur');
    }
  });
});

el('deconnecter').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'authLogout' }, (rep) => {
    if (chrome.runtime.lastError || !rep) {
      dire('Pas de réponse de l\'extension. Recharge-la puis réessaie.', 'erreur');
      return;
    }
    afficherCompte({ connected: false });
    dire(rep.ok ? 'Déconnecté. La clé Claude redevient utilisée si elle est enregistrée.' : rep.error, rep.ok ? 'ok' : 'erreur');
  });
});

el('tester').addEventListener('click', () => {
  const apiKey = el('apiKey').value.trim();
  if (!apiKey) {
    dire('Colle d\'abord ta clé API.', 'erreur');
    return;
  }
  dire('Test en cours…');
  chrome.runtime.sendMessage({ type: 'testKey', apiKey: apiKey, model: el('model').value }, (rep) => {
    if (chrome.runtime.lastError || !rep) {
      dire('Pas de réponse de l\'extension. Recharge-la puis réessaie.', 'erreur');
    } else if (rep.ok) {
      dire('La clé fonctionne.', 'ok');
    } else {
      dire(rep.error, 'erreur');
    }
  });
});
