# Automatisation totale pour le compte de test

Objectif : ouvrir Vinted, ajouter des photos, vérifier l'annonce. Aucun clic sur « Générer », « Régénérer », « Récupérer les photos » ni « Remplir le formulaire ».

Tant que le service reste fermé au public (`CLIENT_API=false`), **seul** le compte `essai-chrome@annoncefutee.fr` peut se connecter et analyser. Aucun autre compte n'obtient quoi que ce soit.

## Ce que fait le serveur (vérifié par PHPUnit : 62 tests, 339 assertions)

Double verrou, contrôlé **côté serveur** à chaque requête :

1. l'e-mail figure dans `TEST_ACCOUNT_EMAILS` (fichier `.env`, jamais dans le dépôt) ;
2. le compte porte le drapeau `users.internal_test_account`, posé uniquement par la commande `php artisan account:test-admin` (le drapeau n'est pas remplissable depuis une requête, l'inscription ne peut pas le poser).

Pour ce compte : pas de quota mensuel, pas de refus lié aux 50 crédits gratuits, historique et consommation réelle conservés, affichage « Crédits IA : Illimités — Compte test ».

**Illimité = pas de quota de crédits. Pas de dépenses illimitées.** Restent actifs pour ce compte : plafond de coût quotidien par utilisateur (`LISTING_DAILY_USER_COST_USD`, 1 $ par défaut) et global (`LISTING_DAILY_GLOBAL_COST_USD`, 25 $), une seule analyse simultanée (`LISTING_MAX_INFLIGHT`), limite par minute, protections contre les appels répétés. La clé OpenAI ne quitte jamais Laravel ; l'extension ne la voit jamais.

## Déploiement (à faire par toi sur o2switch, dossier du site Annonce Futée uniquement)

Je n'ai pas d'accès à la production : rien n'a été déployé.

1. Envoyer les fichiers `backend/` modifiés.
2. `php artisan migrate` (ajoute la colonne `internal_test_account`, sans toucher aux données existantes).
3. Dans `.env` : `TEST_ACCOUNT_EMAILS=essai-chrome@annoncefutee.fr`. Garder `CLIENT_API=false`, `PUBLIC_REGISTRATION=false`, `APP_DEBUG=false`.
4. `php artisan config:clear` (puis `php artisan config:cache` si le cache de configuration est utilisé).
5. `php artisan account:test-admin essai-chrome@annoncefutee.fr` (la commande refuse un compte inconnu, une adresse non listée, et un second compte).
6. `node scripts/diagnostic-serveur.mjs` : doit afficher « FERMÉ au public » et « accès RÉSERVÉ configuré (TEST_ACCOUNT_EMAILS) », inscriptions fermées.

Retour en arrière : `php artisan account:test-admin essai-chrome@annoncefutee.fr --revoke` (retire le drapeau et supprime les jetons) ; vider `TEST_ACCOUNT_EMAILS`. État : `--status`.

## Utilisation

1. Recharger l'extension (`chrome://extensions`), actualiser Vinted, ouvrir le panneau latéral et le **laisser ouvert** : Chrome interdit à une extension de l'ouvrir seule sans geste de l'utilisateur.
2. Réglages → Compte : se connecter (mot de passe dans le champ masqué uniquement).
3. Tableau de bord → activer « Préparation automatique » : le consentement explique l'envoi des photos à l'IA et la consommation. Le réglage est conservé entre les sessions et se coupe d'un clic.
4. Sur Vinted, ajouter les photos. Le panneau suit le formulaire (quelle que soit la section ouverte du panneau), attend que les photos se stabilisent, lance **une** analyse, puis remplit les champs fiables. Tu vérifies, tu publies toi-même : l'extension ne clique jamais sur Publier / Ajouter / soumettre.

## Garanties anti-double analyse (testées)

- Cinq photos ajoutées une à une : une seule analyse pour l'ensemble.
- Empreinte de l'ensemble de photos : un ensemble déjà analysé n'est jamais ré-analysé (retrait puis retour compris).
- Les modifications faites par l'extension elle-même ne déclenchent rien.
- Analyse annulée si les photos changent ; nouvelle analyse seulement pour un ensemble différent.
- L'envoi est mémorisé **avant** l'appel ; le service worker mémorise le résultat. Panneau fermé ou rechargé pendant l'analyse : à la réouverture le résultat est repris, jamais relancé. Résultat perdu : message explicite, aucune relance automatique (« Régénérer l'annonce » reste à ta demande).
- Erreur passagère (réseau, 500–504) : au plus **deux** nouveaux essais automatiques, uniquement si la non-consommation d'un crédit est vérifiée, annulables par « Interrompre ». Crédit consommé ou non vérifiable : aucun essai automatique.
- « Accès fermé » (403) et « Serveur injoignable » sont distingués : un accès fermé n'est jamais présenté comme une panne.

## Remplissage

Titre, description structurée, prix, catégorie, sous-catégorie, marque, taille, état, couleurs, matière : seulement les champs dont le remplissage est confirmé sur le formulaire réel ; les autres sont signalés « À vérifier » avec la raison. Une valeur saisie à la main n'est jamais écrasée sans confirmation.

## Amélioration automatique des photos

Avant l'analyse, sur les copies de travail : redressement, recadrage des seuls bords parfaitement unis, luminosité/contraste. L'original est conservé et « Annuler » le restitue. Les couleurs ne sont pas modifiées automatiquement (fidélité du vêtement pour l'acheteur) ; le remplacement de fond reste manuel ; aucun défaut réel n'est retiré ; les photos déjà publiées sur Vinted ne sont jamais remplacées sans accord. Le module mannequin est réservé à plus tard.

## Limites connues

- Le panneau doit rester ouvert pour que l'automatisation tourne.
- Les sélecteurs du vrai formulaire Vinted n'ont pas été vérifiés en conditions réelles par moi : voir la procédure de test.
- La première analyse réelle exige ton accord budgétaire (`docs/PROCEDURE-TEST-CHROME.md`) ; le coût réel par annonce n'est pas encore mesuré. Le tableau de bord affiche une dépense **estimée** (coût réel mesuré côté serveur par analyse).
