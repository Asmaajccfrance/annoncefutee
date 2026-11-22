// Script de contenu Safari iOS sur vinted.fr/items/new.
// Pré-remplit uniquement Titre, Description et Prix à la demande de l'utilisateur
// et affiche un aide-mémoire des attributs.
// RÈGLE ABSOLUE : ne clique JAMAIS sur Publier, Ajouter ou tout bouton d'envoi.

(() => {
  if (window.__annonceFuteeSafariIos) return;
  window.__annonceFuteeSafariIos = true;

  const runtime = typeof browser !== 'undefined' ? browser : chrome;

  const SELECTEURS = {
    titre: {
      liste: ['[data-testid="title--input"]', 'input[name="title"]', 'input#title'],
      balises: 'input[type="text"], input:not([type])',
      motif: /titre|title/i,
    },
    description: {
      liste: ['[data-testid="description--input"]', 'textarea[name="description"]', 'textarea#description'],
      balises: 'textarea',
      motif: /d[ée]cri|description/i,
    },
    prix: {
      liste: ['[data-testid="price-input--input"]', 'input[name="price"]', 'input#price'],
      balises: 'input',
      motif: /prix|price/i,
    },
  };

  function estPageCreation() {
    return /^\/items\/(new|\d+\/edit)/.test(location.pathname);
  }

  function texteAssocie(el) {
    const morceaux = [
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      el.name || '',
      el.id || '',
    ];
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) morceaux.push(lab.textContent || '');
    }
    const parent = el.closest('label');
    if (parent) morceaux.push(parent.textContent || '');
    return morceaux.join(' ');
  }

  function trouverChamp(cle) {
    const def = SELECTEURS[cle];
    for (const sel of def.liste) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const candidats = Array.from(document.querySelectorAll(def.balises));
    return candidats.find((el) => def.motif.test(texteAssocie(el))) || null;
  }

  function ecrireReact(el, valeur) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    if (desc && desc.set) desc.set.call(el, valeur);
    else el.value = valeur;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function nettoyerPrix(brut) {
    const propre = String(brut || '').replace('€', '').trim().replace(',', '.');
    const n = parseFloat(propre);
    if (!isFinite(n) || n <= 0) return '';
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  }

  function remplirFormulaire(annonce) {
    if (!annonce) return { remplis: 0 };
    let remplis = 0;
    const couples = [
      ['titre', annonce.titre || ''],
      ['description', annonce.description || ''],
      ['prix', nettoyerPrix(annonce.prix)],
    ];
    for (const [cle, valeur] of couples) {
      if (!valeur) continue;
      const champ = trouverChamp(cle);
      if (champ && !champ.disabled && !champ.readOnly) {
        ecrireReact(champ, valeur);
        remplis++;
      }
    }
    return { remplis };
  }

  function chargerImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Chargement image impossible.'));
      im.src = src;
    });
  }

  function imageVersBase64(img) {
    const coteMax = 1280;
    const ratio = Math.min(1, coteMax / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(32, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(32, Math.round(img.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82); // lève SecurityError si canvas « tainted »
    return dataUrl.split(',')[1];
  }

  async function extrairePhotosBase64() {
    const zone = document.querySelector('main') || document.body;
    const imgs = Array.from(zone.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth >= 64 && /^(blob:|data:image\/|https:\/\/)/.test(img.src)
    );
    const resultats = [];
    for (const img of imgs.slice(0, 5)) {
      let base64 = null;
      try {
        base64 = imageVersBase64(img);
      } catch (_) {
        // Image cross-origin (CDN Vinted) : on la télécharge via le background.
        try {
          const rep = await runtime.runtime.sendMessage({ type: 'IMAGE_EN_DATA_URL', url: img.src });
          if (rep && rep.ok) base64 = imageVersBase64(await chargerImage(rep.dataUrl));
        } catch (_) {}
      }
      if (base64 && base64.length <= 1500000) resultats.push(base64);
    }
    return resultats;
  }

  function injecterBandeau(annonce) {
    let barre = document.getElementById('af-safari-ios-barre');
    if (barre) barre.remove();
    if (!annonce || (!annonce.titre && !annonce.description)) return;

    barre = document.createElement('div');
    barre.id = 'af-safari-ios-barre';
    barre.style.cssText = [
      'position:fixed',
      'left:10px',
      'right:10px',
      'bottom:14px',
      'z-index:2147483646',
      'background:#FFFFFF',
      'border:2px solid #6D28D9',
      'border-radius:14px',
      'box-shadow:0 10px 28px rgba(36,32,55,0.22)',
      'padding:12px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#242037',
    ].join(';');

    const attributs = [
      ['Marque', annonce.marque],
      ['État', annonce.etat],
      ['Taille', annonce.taille],
      ['Couleurs', annonce.couleurs],
      ['Matière', annonce.matiere],
      ['Catégorie', annonce.categorie],
    ].filter(([, val]) => val && String(val).trim());

    const pucesHtml = attributs
      .map(
        ([nom, val]) =>
          `<span style="display:inline-block;background:#F0EBFF;color:#242037;border-radius:999px;padding:3px 9px;font-size:12px;margin:2px 4px 2px 0;">` +
          `<strong style="color:#5F5B78;font-weight:500;">${nom} :</strong> ${echapper(val)}</span>`
      )
      .join('');

    barre.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="font-weight:700;font-size:14px;color:#6D28D9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          Annonce Futée · ${echapper(annonce.titre || 'Annonce prête')}
        </div>
        <button id="af-ios-fermer" type="button" style="border:0;background:#F7F5FC;color:#5F5B78;border-radius:8px;width:28px;height:28px;font-weight:700;font-size:14px;">✕</button>
      </div>
      ${pucesHtml ? `<div style="margin-bottom:9px;line-height:1.4;">${pucesHtml}</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="af-ios-remplir" type="button" style="flex:1;min-height:42px;border:0;border-radius:10px;background:#6D28D9;color:#FFFFFF;font-weight:700;font-size:14px;">
          Pré-remplir Titre, Description et Prix
        </button>
      </div>
      <div id="af-ios-statut" style="margin-top:6px;font-size:12px;color:#5F5B78;text-align:center;">
        Vérifie ensuite les menus déroulants et publie toi-même.
      </div>
    `;

    document.body.appendChild(barre);

    document.getElementById('af-ios-fermer').addEventListener('click', () => {
      barre.remove();
    });

    document.getElementById('af-ios-remplir').addEventListener('click', () => {
      const res = remplirFormulaire(annonce);
      const statut = document.getElementById('af-ios-statut');
      if (res.remplis > 0) {
        statut.style.color = '#116E66';
        statut.style.fontWeight = '600';
        statut.textContent = `✓ ${res.remplis} champ(s) pré-rempli(s). Choisis la catégorie et publie quand tu veux.`;
      } else {
        statut.style.color = '#B42318';
        statut.textContent = 'Ouvre d\'abord la page « Vendre un article » sur Vinted.';
      }
    });
  }

  function echapper(texte) {
    return String(texte || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  runtime.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'REMPLIR_MAINTENANT') {
      injecterBandeau(msg.annonce);
      const res = remplirFormulaire(msg.annonce);
      sendResponse({ ok: true, remplis: res.remplis });
      return false;
    }
    if (msg.type === 'EXTRAIRE_PHOTOS_PAGE') {
      extrairePhotosBase64().then((images) => sendResponse({ ok: true, images }));
      return true;
    }
    return false;
  });

  function verifierPage() {
    if (!estPageCreation()) return;
    runtime.runtime
      .sendMessage({ type: 'OBTENIR_ANNONCE' })
      .then((rep) => {
        if (rep && rep.ok && rep.annonce) injecterBandeau(rep.annonce);
      })
      .catch(() => {});
  }

  verifierPage();
  let derniereUrl = location.href;
  setInterval(() => {
    if (location.href !== derniereUrl) {
      derniereUrl = location.href;
      setTimeout(verifierPage, 500);
    }
  }, 1000);
})();
