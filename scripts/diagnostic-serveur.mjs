// Diagnostic du serveur Annonce Futée : AUCUN identifiant, AUCUNE IA, AUCUN crédit.
//
//   node scripts/diagnostic-serveur.mjs [https://annoncefutee.fr]
//
// Fait exactement trois requêtes :
//   1. GET  /api/v1/health          -> serveur joignable ? clé OpenAI présente (booléen seulement) ?
//   2. POST /api/v1/auth/login  {}  -> 403 = service fermé (CLIENT_API=false), 422 = service ouvert.
//   3. POST /api/v1/auth/register {} -> 403 = inscriptions fermées (attendu), 422 = inscriptions OUVERTES (à corriger).
// Ne modifie rien. Ne lit aucun secret. Ne prouve PAS que la génération fonctionne.

const base = (process.argv[2] || 'https://annoncefutee.fr').replace(/\/+$/, '');

async function appeler(chemin, options) {
  try {
    const r = await fetch(base + chemin, Object.assign({ redirect: 'error', headers: { accept: 'application/json', 'content-type': 'application/json' } }, options));
    let corps = null;
    try { corps = await r.json(); } catch (e) { /* non JSON */ }
    return { statut: r.status, corps: corps };
  } catch (e) {
    return { statut: 0, erreur: e.message };
  }
}

const sante = await appeler('/api/v1/health');
const connexion = await appeler('/api/v1/auth/login', { method: 'POST', body: '{}' });
const inscription = await appeler('/api/v1/auth/register', { method: 'POST', body: '{}' });

console.log('Serveur :', base);
if (sante.statut !== 200) {
  console.log('Joignable : NON (' + (sante.erreur || 'HTTP ' + sante.statut) + ')');
  process.exit(1);
}
console.log('Joignable : oui');
console.log('Clé OpenAI présente côté serveur :', sante.corps && sante.corps.openai_configured === true ? 'oui' : 'non / inconnu');

if (connexion.statut === 403) console.log('Service (CLIENT_API) : FERMÉ aux connexions. Aucune génération possible depuis Chrome.');
else if (connexion.statut === 422) console.log('Service (CLIENT_API) : OUVERT aux connexions. À refermer après les essais.');
else console.log('Service (CLIENT_API) : indéterminé (HTTP ' + connexion.statut + ').');

if (inscription.statut === 403) console.log('Inscriptions publiques : fermées (PUBLIC_REGISTRATION=false) ✓');
else if (inscription.statut === 422) console.log('Inscriptions publiques : OUVERTES — ATTENTION, remettre PUBLIC_REGISTRATION=false.');
else console.log('Inscriptions publiques : indéterminées (HTTP ' + inscription.statut + ').');

console.log('Génération OpenAI depuis Chrome : NON VÉRIFIÉE par ce script (voir docs/PROCEDURE-TEST-CHROME.md).');
