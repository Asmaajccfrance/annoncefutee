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
}

chrome.storage.local.get(IA.REGLAGES_DEFAUT, (r) => {
  if (chrome.runtime.lastError) {
    dire('Lecture des réglages impossible.', 'erreur');
    return;
  }
  afficher(IA.assainirReglages(r));
});

el('enregistrer').addEventListener('click', () => {
  const s = IA.assainirReglages({
    apiKey: el('apiKey').value,
    model: el('model').value,
    signature: el('signature').value,
    style: el('style').value,
    hashtags: el('hashtags').checked,
    prixAjustement: el('prixAjustement').value,
    prixArrondi: el('prixArrondi').value,
    autoGenerer: el('autoGenerer').checked
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
