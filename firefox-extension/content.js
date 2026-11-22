// Script de contenu Firefox Android & PC sur vinted.fr/items/new.
// Autocomplète Titre, Description et Prix dès que le formulaire Vinted apparaît
// lorsqu'une annonce vient d'être envoyée depuis l'app Android Annonce Futée,
// et affiche un bandeau d'aide avec les caractéristiques (Marque, Taille, État…).
// RÈGLE ABSOLUE : ne clique JAMAIS sur Publier, Ajouter ou tout bouton d'envoi.

(() => {
  if (window.__annonceFuteeFirefox) return;
  window.__annonceFuteeFirefox = true;

  const ext = typeof browser !== 'undefined' ? browser : chrome;

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

  function remplirFormulaire(annonce, ecraserExistant = false) {
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
      if (!champ || champ.disabled || champ.readOnly) continue;
      const deja = String(champ.value || '').trim();
      if (deja && !ecraserExistant && deja !== valeur) continue;
      ecrireReact(champ, valeur);
      remplis++;
    }
    return { remplis };
  }

  function attendreEtAutoRemplir(annonce, surSucces) {
    let essais = 0;
    const maxEssais = 24;
    const tenter = () => {
      essais++;
      if (!estPageCreation()) return;
      const champTitre = trouverChamp('titre');
      const champDesc = trouverChamp('description');
      if (champTitre || champDesc) {
        const res = remplirFormulaire(annonce, false);
        ext.runtime.sendMessage({ type: 'CONSOMMER_DRAPEAU_AUTO' });
        if (surSucces) surSucces(res.remplis);
        return;
      }
      if (essais < maxEssais) {
        setTimeout(tenter, 350);
      }
    };
    tenter();
  }

  async function extrairePhotosBase64() {
    const zone = document.querySelector('main') || document.body;
    const imgs = Array.from(zone.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth >= 64 && /^(blob:|data:image\/|https:\/\/)/.test(img.src)
    );
    const resultats = [];
    for (const img of imgs.slice(0, 5)) {
      try {
        const coteMax = 1280;
        const ratio = Math.min(1, coteMax / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(32, Math.round(img.naturalWidth * ratio));
        canvas.height = Math.max(32, Math.round(img.naturalHeight * ratio));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const base64 = dataUrl.split(',')[1];
        if (base64 && base64.length <= 1500000) resultats.push(base64);
      } catch (_) {}
    }
    return resultats;
  }

  function construireDomElement(tag, style, texte) {
    const el = document.createElement(tag);
    if (style) el.style.cssText = style;
    if (texte !== undefined) el.textContent = texte;
    return el;
  }

  function injecterBandeau(annonce, autoActive) {
    const existant = document.getElementById('af-firefox-barre');
    if (existant) existant.remove();
    if (!annonce || (!annonce.titre && !annonce.description)) return;

    const barre = construireDomElement(
      'div',
      [
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
        'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        'color:#242037',
      ].join(';')
    );
    barre.id = 'af-firefox-barre';

    const entete = construireDomElement(
      'div',
      'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;'
    );
    const titre = construireDomElement(
      'div',
      'font-weight:700;font-size:14px;color:#6D28D9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'Annonce Futée · ' + (annonce.titre || 'Annonce prête')
    );
    const btnFermer = construireDomElement(
      'button',
      'border:0;background:#F7F5FC;color:#5F5B78;border-radius:8px;width:28px;height:28px;font-weight:700;font-size:14px;cursor:pointer;',
      '✕'
    );
    btnFermer.type = 'button';
    btnFermer.addEventListener('click', () => barre.remove());
    entete.appendChild(titre);
    entete.appendChild(btnFermer);
    barre.appendChild(entete);

    const attributs = [
      ['Marque', annonce.marque],
      ['État', annonce.etat],
      ['Taille', annonce.taille],
      ['Couleurs', annonce.couleurs],
      ['Matière', annonce.matiere],
      ['Catégorie', annonce.categorie],
    ].filter(([, val]) => val && String(val).trim());

    if (attributs.length > 0) {
      const zonePuces = construireDomElement('div', 'margin-bottom:9px;line-height:1.4;');
      for (const [nom, val] of attributs) {
        const puce = construireDomElement(
          'span',
          'display:inline-block;background:#F0EBFF;color:#242037;border-radius:999px;padding:3px 9px;font-size:12px;margin:2px 4px 2px 0;'
        );
        const label = construireDomElement('strong', 'color:#5F5B78;font-weight:500;', nom + ' : ');
        puce.appendChild(label);
        puce.appendChild(document.createTextNode(String(val)));
        zonePuces.appendChild(puce);
      }
      barre.appendChild(zonePuces);
    }

    const btnRemplir = construireDomElement(
      'button',
      'width:100%;min-height:42px;border:0;border-radius:10px;background:#6D28D9;color:#FFFFFF;font-weight:700;font-size:14px;cursor:pointer;',
      'Pré-remplir Titre, Description et Prix'
    );
    btnRemplir.type = 'button';
    barre.appendChild(btnRemplir);

    const statut = construireDomElement(
      'div',
      'margin-top:6px;font-size:12px;color:#5F5B78;text-align:center;',
      autoActive
        ? 'Autocomplétion en cours…'
        : 'Ajoute tes photos, vérifie les menus déroulants et publie toi-même.'
    );
    barre.appendChild(statut);

    btnRemplir.addEventListener('click', () => {
      const res = remplirFormulaire(annonce, true);
      if (res.remplis > 0) {
        statut.style.color = '#116E66';
        statut.style.fontWeight = '600';
        statut.textContent = `✓ ${res.remplis} champ(s) pré-rempli(s). Ajoute tes photos et publie quand tu veux.`;
      } else {
        statut.style.color = '#B42318';
        statut.textContent = 'Champs introuvables : vérifie que tu es connecté sur Vinted.';
      }
    });

    document.body.appendChild(barre);

    if (autoActive) {
      attendreEtAutoRemplir(annonce, (nb) => {
        if (nb > 0) {
          statut.style.color = '#116E66';
          statut.style.fontWeight = '600';
          statut.textContent = `✓ ${nb} champ(s) autocomplété(s) automatiquement ! Ajoute tes photos de la galerie.`;
        } else {
          statut.textContent = 'Appuie sur le bouton violet dès que le formulaire est affiché.';
        }
      });
    }
  }

  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'REMPLIR_MAINTENANT') {
      injecterBandeau(msg.annonce, false);
      const res = remplirFormulaire(msg.annonce, true);
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
    if (window.__afAnnonceAppAndroid) {
      const a = window.__afAnnonceAppAndroid;
      window.__afAnnonceAppAndroid = null;
      injecterBandeau(a, true);
      return;
    }
    ext.runtime.sendMessage({ type: 'OBTENIR_ANNONCE' }, (rep) => {
      if (rep && rep.ok && rep.annonce) {
        const recente =
          rep.annonce._autoRemplir &&
          Date.now() - (rep.annonce._horodatage || 0) < 5 * 60 * 1000;
        injecterBandeau(rep.annonce, !!recente);
      }
    });
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
