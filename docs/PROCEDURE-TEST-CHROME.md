# Procédure sécurisée de test : Chrome → Laravel → OpenAI

> Depuis la version 1.6.0, le compte de test peut être réservé côté serveur sans ouvrir `CLIENT_API` : voir `docs/AUTOMATISATION-COMPTE-TEST.md`. Les étapes « ouvrir `CLIENT_API=true` » ci-dessous ne sont alors plus nécessaires pour ce compte. Le budget OpenAI reste à autoriser explicitement avant toute analyse réelle.

Cette procédure vérifie le parcours réel avec **l'unique compte existant**. Elle n'ouvre pas les inscriptions publiques, ne crée aucun compte et ne dépense rien sans accord explicite à chaque étape payante.

## État vérifié le 12 novembre 2026

Commande : `node scripts/diagnostic-serveur.mjs` (3 requêtes sans identifiant, sans IA, sans crédit).

| Point | Résultat |
|---|---|
| Serveur `https://annoncefutee.fr` | joignable |
| Clé OpenAI côté serveur | présente (booléen renvoyé par `/api/v1/health`) |
| `CLIENT_API` | **false** : toute connexion est refusée (403) |
| `PUBLIC_REGISTRATION` | **false** : l'inscription est refusée (403) |
| Génération Chrome → Laravel → OpenAI | **non vérifiée** : impossible tant que `CLIENT_API=false` |

Tant que la dernière ligne n'est pas validée par les étapes ci-dessous, rien ne doit affirmer que la connexion OpenAI fonctionne depuis Chrome. Le panneau l'applique : « Diagnostic du serveur » (Réglages) affiche l'état réel et la mention « fonctionnement non vérifié ».

## Garde-fous (à respecter à chaque étape)

- `PUBLIC_REGISTRATION` reste à `false` en permanence.
- `CLIENT_API=true` uniquement pendant la fenêtre de test, jamais plus longtemps.
- Le mot de passe se saisit uniquement dans le champ masqué du panneau (Réglages → Compte). Jamais dans une commande, un fichier, un journal, une capture ou ce chat.
- L'extension ne clique jamais sur « Publier » et ne soumet jamais le formulaire. Ne publie rien pendant les essais.
- Seul le dossier du site Annonce Futée est touché sur o2switch. Aucun autre site, aucun réglage PHP global, aucune tâche cron.
- Le compte existant n'est pas supprimé. Le jeton de test est révoqué en fin d'essai.

## Autorisations à donner avant de commencer

À donner explicitement, par écrit :

1. **Ouverture de la fenêtre** : « J'autorise `CLIENT_API=true` jusqu'à la fin des essais. »
2. **Budget OpenAI** : nombre maximal d'analyses réelles (proposition : **2** = 1 photo, puis 3 à 5 photos de la même annonce) et modèle (`OPENAI_MODEL` du serveur, par défaut `gpt-5.6-luna`). Le coût réel d'une annonce n'a jamais été mesuré : le premier essai sert aussi à le mesurer.

Sans l'une de ces deux autorisations, ne pas continuer.

## Étapes

### 1. Avant d'ouvrir

```
node scripts/diagnostic-serveur.mjs
```

Attendu : service **FERMÉ**, inscriptions **fermées**. Noter l'heure et le solde de crédits du compte (visible après connexion).

### 2. Ouvrir la fenêtre (action sur le serveur)

Dans le dossier du site Annonce Futée uniquement, dans `.env` : `CLIENT_API=true`, puis `php artisan config:clear` (et `php artisan config:cache` si le cache de configuration est utilisé). Ne pas modifier `PUBLIC_REGISTRATION`.

```
node scripts/diagnostic-serveur.mjs
```

Attendu : service **OUVERT**, inscriptions **fermées**.

### 3. Connexion depuis Chrome

1. Recharger l'extension (`chrome://extensions` → Recharger), puis actualiser l'onglet Vinted (F5).
2. Panneau → Réglages → Compte : serveur `https://annoncefutee.fr`, e-mail du compte existant, mot de passe dans le champ masqué → « Se connecter ».
3. Le panneau affiche « Connecté » et le solde de crédits.

### 4. Essai A : une photo, déclenchement manuel (1 analyse)

1. Réglages : mode automatique **désactivé**.
2. Page Vinted « Vendre un article » : ajouter **une** photo. Elle apparaît dans la carte « Formulaire Vinted ».
3. « Générer l'annonce ». Relever dans le bilan : analyse terminée, annonce générée, **crédit consommé : 1 (solde avant → après)**.
4. « Remplir le formulaire ». Vérifier champ par champ l'état affiché et le formulaire réel. Vérifier qu'une valeur saisie à la main avant le remplissage n'a pas été écrasée.

### 5. Essai B : mode automatique, plusieurs photos (1 analyse)

1. Réglages : activer « Préparer automatiquement mes annonces » et lire le message de consentement (envoi des photos au service IA, crédits).
2. Ajouter 3 photos de la même annonce, une par une, en moins de quelques secondes chacune.
3. Attendu : aucune analyse tant que les photos arrivent ; **une seule** analyse après le délai de stabilisation (6 s par défaut) ; solde −1 ; champs remplis.
4. Tester « Interrompre » pendant le délai : aucune analyse, solde inchangé.

### 6. Clôture (obligatoire, dans cet ordre)

1. **Déconnexion dans l'extension** (Réglages → Déconnexion). C'est ce qui révoque le jeton côté serveur. Une fois `CLIENT_API=false`, la route de déconnexion répond 403 et ne révoque plus rien.
2. Remettre `CLIENT_API=false` dans `.env`, puis `php artisan config:clear` (ou `config:cache`).
3. Vérifier :

```
node scripts/diagnostic-serveur.mjs
```

Attendu : service **FERMÉ**, inscriptions **fermées**.
4. Si la déconnexion n'a pas pu se faire avant la fermeture, révoquer les jetons du compte de test côté serveur (`php artisan tinker`, puis `User::where('email', '<e-mail du compte>')->first()->tokens()->delete();`).
5. Vérifier que les autres sites hébergés répondent toujours normalement.

## Relevé à remplir

| Mesure | Valeur |
|---|---|
| Solde avant essai A / après | |
| Solde après essai B | |
| Analyses réelles effectuées | |
| Coût OpenAI réel par analyse | |
| Champs correctement remplis sur le vrai formulaire Vinted | |
| Champs à corriger | |
| `CLIENT_API` remis à `false` à | |
| Jeton révoqué | oui / non |

## En cas de problème

- « Serveur indisponible » dans le panneau : le service est fermé, ou le serveur est injoignable. Lancer le diagnostic. Aucun crédit n'est consommé dans ces cas.
- « Crédits insuffisants » : aucune analyse n'est envoyée.
- Analyse interrompue : le panneau compare le solde avant et après et affiche si un crédit a été consommé. Vérifier aussi dans le compte.
- Arrêt d'urgence : `CLIENT_API=false` et `php artisan config:clear` suffisent à bloquer toute nouvelle analyse.
