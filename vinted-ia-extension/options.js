const DEFAUT = {
  apiKey: '',
  model: 'claude-haiku-5-5',
  signature: '',
  style: 'normal',
  hashtags: true,
  prixAjustement: 0,
  prixArrondi: 1,
  autoGenerer: false
};

const el = (id) => document.getElementById(id);
const message = el('message');

function dire(texte, type) {
  message.textContent = texte;
  message.className = type || '';
}

chrome.storage.local.get(DEFAUT, (r) => {
  el('apiKey').value = r.apiKey;
  el('model').value = r.model;
  el('signature').value = r.signature;
  el('style').value = r.style;
  el('hashtags').checked = !!r.hashtags;
  el('prixAjustement').value = r.prixAjustement ? String(r.prixAjustement) : '';
  el('prixArrondi').value = String(Number(r.prixArrondi) === 5 ? 5 : 1);
  el('autoGenerer').checked = !!r.autoGenerer;
});

el('enregistrer').addEventListener('click', () => {
  let pct = Math.round(Number(el('prixAjustement').value) || 0);
  pct = Math.min(100, Math.max(-90, pct));
  el('prixAjustement').value = pct ? String(pct) : '';

  chrome.storage.local.set(
    {
      apiKey: el('apiKey').value.trim(),
      model: el('model').value,
      signature: el('signature').value.trim(),
      style: el('style').value,
      hashtags: el('hashtags').checked,
      prixAjustement: pct,
      prixArrondi: Number(el('prixArrondi').value) === 5 ? 5 : 1,
      autoGenerer: el('autoGenerer').checked
    },
    () => dire('Réglages enregistrés. Actualise la page Vinted (F5) pour les appliquer.', 'ok')
  );
});

el('tester').addEventListener('click', () => {
  const apiKey = el('apiKey').value.trim();
  if (!apiKey) {
    dire('Colle d\'abord ta clé API.', 'erreur');
    return;
  }
  dire('Test en cours…');
  chrome.runtime.sendMessage({ type: 'testKey', apiKey, model: el('model').value }, (rep) => {
    if (chrome.runtime.lastError || !rep) {
      dire('Pas de réponse de l\'extension. Recharge-la puis réessaie.', 'erreur');
    } else if (rep.ok) {
      dire('La clé fonctionne.', 'ok');
    } else {
      dire(rep.error, 'erreur');
    }
  });
});
