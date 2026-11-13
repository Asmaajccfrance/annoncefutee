// Vérification de sécurité APRÈS déploiement : AUCUN appel OpenAI, aucun crédit consommé.
//
//   node scripts/verification-securite.mjs [https://annoncefutee.fr]
//
// Le mot de passe du compte de test est demandé en saisie masquée (jamais en argument, jamais journalisé).
// Contrôles : santé, compte inconnu refusé, inscription refusée, connexion du compte de test, /me illimité,
// aucune clé OpenAI dans les réponses, déconnexion, jeton révoqué refusé.
import readline from 'node:readline';

const base = (process.argv[2] || 'https://annoncefutee.fr').replace(/\/+$/, '');
const EMAIL = 'essai-chrome@annoncefutee.fr';
const resultats = [];
const noter = (nom, ok, detail) => { resultats.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + nom + (detail ? ' : ' + detail : '')); };

async function appeler(chemin, options = {}) {
  try {
    const r = await fetch(base + chemin, {
      redirect: 'error',
      method: options.methode || 'GET',
      headers: Object.assign({ accept: 'application/json', 'content-type': 'application/json' }, options.jeton ? { authorization: 'Bearer ' + options.jeton } : {}),
      body: options.corps ? JSON.stringify(options.corps) : undefined
    });
    const texte = await r.text();
    let json = null;
    try { json = JSON.parse(texte); } catch (e) { /* non JSON */ }
    return { statut: r.status, json, texte };
  } catch (e) {
    return { statut: 0, json: null, texte: String(e.message) };
  }
}

function saisieMasquee(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (rep) => { rl.close(); process.stdout.write('\n'); resolve(rep); });
  });
}

const sante = await appeler('/api/v1/health');
noter('Serveur accessible', sante.statut === 200);
if (sante.statut !== 200) { console.log('STOP : serveur inaccessible.'); process.exit(1); }
noter('Clé OpenAI présente côté serveur (booléen)', sante.json && sante.json.openai_configured === true);
noter('CLIENT_API fermé au public', sante.json && sante.json.client_api === false, 'client_api=' + (sante.json && sante.json.client_api));
noter('Accès réservé au compte de test configuré', sante.json && sante.json.test_account_access === true,
  sante.json && sante.json.test_account_access === undefined ? 'version du backend non déployée' : '');

const inconnu = await appeler('/api/v1/auth/login', { methode: 'POST', corps: { email: 'inconnu-' + Date.now() + '@example.com', password: 'xxxxxxxx', device_name: 'verif' } });
noter('Autre compte refusé (403)', inconnu.statut === 403, 'HTTP ' + inconnu.statut);
const inscription = await appeler('/api/v1/auth/register', { methode: 'POST', corps: {} });
noter('Inscription publique refusée (403)', inscription.statut === 403, 'HTTP ' + inscription.statut);
const sansJeton = await appeler('/api/v1/me');
noter('Route protégée sans jeton refusée', sansJeton.statut === 401 || sansJeton.statut === 403, 'HTTP ' + sansJeton.statut);

const echec = resultats.includes(false);
if (echec) { console.log('\nSTOP : contrôles préalables en échec, aucune connexion tentée.'); process.exit(1); }

// Saisie masquée ; à défaut de terminal interactif, variable d'environnement AF_MOT_DE_PASSE (jamais affichée).
const mdp = (process.env.AF_MOT_DE_PASSE || (process.stdin.isTTY ? await saisieMasquee('Mot de passe du compte ' + EMAIL + ' (masqué) : ') : '')).replace(/[\r\n]+$/, '');
const login = await appeler('/api/v1/auth/login', { methode: 'POST', corps: { email: EMAIL, password: mdp, device_name: 'verif' } });
const jeton = login.json && (login.json.token || (login.json.data && login.json.data.token));
noter('Connexion du compte de test', login.statut === 200 && !!jeton, 'HTTP ' + login.statut);
if (!jeton) {
  if (login.statut === 422) {
    const champs = login.json && login.json.errors ? Object.keys(login.json.errors) : [];
    console.log('Diagnostic 422 : champ(s) en cause = ' + (champs.join(', ') || 'inconnu') + ' ; longueur saisie = ' + mdp.length + ' caractère(s).');
    if (mdp.length === 0) console.log('→ Mot de passe vide : la saisie masquée n\'a rien capturé (relancer dans un terminal interactif, ou utiliser AF_MOT_DE_PASSE).');
    else if (champs.includes('email')) console.log('→ Identifiants incorrects : le mot de passe saisi ne correspond pas à celui du compte.');
  }
  console.log('STOP : connexion impossible.');
  process.exit(1);
}

const me = await appeler('/api/v1/me', { jeton });
const credits = me.json && (me.json.credits || (me.json.data && me.json.data.credits));
const profil = me.json && (me.json.user || (me.json.data && me.json.data.user));
noter('/me : compte de test, crédits illimités', me.statut === 200 && credits && credits.unlimited === true && profil && profil.test_account === true);
const toutesReponses = [sante.texte, login.texte.replace(jeton, '[jeton]'), me.texte].join('\n');
noter('Aucune clé OpenAI dans les réponses', !/sk-[A-Za-z0-9_-]{10,}/.test(toutesReponses));

const logout = await appeler('/api/v1/auth/logout', { methode: 'POST', jeton });
noter('Déconnexion', logout.statut === 200 || logout.statut === 204, 'HTTP ' + logout.statut);
const apres = await appeler('/api/v1/me', { jeton });
noter('Jeton révoqué refusé', apres.statut === 401 || apres.statut === 403, 'HTTP ' + apres.statut);

console.log('\n' + (resultats.every(Boolean) ? 'VERDICT : PASS' : 'VERDICT : FAIL') + ' (aucun appel OpenAI effectué)');
process.exit(resultats.every(Boolean) ? 0 : 1);
