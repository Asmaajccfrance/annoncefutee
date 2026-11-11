# P0 — Audit de l'extension 1.2.0

Sauvegarde Git avant toute modification : `8f8c943`.

Le dépôt contenait cinq fichiers, tous dans `vinted-ia-extension/`. Pas de popup, pas de panneau latéral, pas d'icônes, pas de tests, pas de backend, pas d'application mobile.

## Inventaire

| Zone | État | Constat |
| --- | --- | --- |
| Manifest V3, storage, service worker, options | Fonctionnel | L'icône ouvre les réglages. La clé reste dans `chrome.storage.local`, inaccessible à la page Vinted (`TRUSTED_CONTEXTS`). |
| Génération Haiku 5.5 | Fonctionnel | Outil forcé `annonce`, photos JPEG 1024 px, titre, description, prix, état, couleurs, taille, matière. |
| Sonnet 5.5 et Opus 5.5 | Cassé en 1.2.0 | Ces modèles rejettent `tool_choice` de type `tool`. L'appel renvoyait une erreur 400. Corrigé en P1. |
| Remplissage titre, description, prix | Fonctionnel | Setter natif React, puis `input` et `change`. La publication reste un clic de l'utilisateur. |
| Menus état, couleur, taille, matière | Partiel | Ouverture et clic sur le libellé. Fragile si Vinted change le DOM. |
| Catégorie et marque | Partiel | Affichées et copiables. Pas écrites dans le formulaire. Pas d'identifiants de taxonomie. |
| Photos déjà en ligne | Partiel | Toute image HTTPS assez grande dans `main` pouvait partir vers l'IA. P1 limite aux hôtes `vinted.net` et `vinted.fr`. |
| Prix | Partiel | Estimation du modèle, puis règle locale (% et arrondi). Aucune référence de marché vérifiée. |
| Clé API personnelle | Fonctionnel, à retirer | Encore obligatoire. Le passage par Laravel est la phase P2. |
| Bibliothèque, brouillons, lots, calendrier, stats, abonnements | Absent | |
| Retouche photo et simulation portée | Absent | Seul le redimensionnement JPEG existe. |
| Flutter, Laravel, Stripe, OpenAI | Absent | |
| Autres pays Vinted | Absent | Le script ne tourne que sur `www.vinted.fr`. |

## Ce qui se réutilise

- Le contrat d'annonce (titre, description, catégorie, marque, taille, état, couleurs, matière, prix, points à vérifier).
- La liste d'états et de couleurs, les sélecteurs de champs, la règle de prix, la consigne « ne rien inventer ».
- L'isolation de la clé dans le service worker, jusqu'à ce que le serveur la remplace.
- Le remplissage explicite du formulaire, déclenché par l'utilisateur, sans clic sur Publier.

## Connecteur Vinted

Les conditions Vinted en vigueur depuis le 8 octobre 2026 interdisent les logiciels externes (bots, scrapers, automatisations) sauf autorisation de Vinted. L'API Vinted Pro Integrations existe, réservée aux comptes Pro autorisés : annonces, ontologies, commandes, bordereaux, webhooks. Elle n'est pas ouverte aux particuliers.

P1 ne clique pas sur Publier, n'envoie pas de message, ne négocie pas et ne demande aucun mot de passe, cookie ou jeton Vinted. Le remplissage du formulaire déjà ouvert, après un clic sur Générer, est conservé. Aucune publication dans l'application native Vinted n'est promise.

## Risques de régression surveillés en P1

- Ne pas changer l'appel Haiku (version d'API `2023-06-01`, outil forcé, 1500 jetons, schéma sans `strict`).
- Ne pas changer le texte de consigne, les sélecteurs, ni le calcul de prix.
- Ne pas publier à la place de l'utilisateur.
