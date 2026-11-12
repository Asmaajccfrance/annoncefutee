# Modules futurs

Ces modules sont documentés pour préparer la suite. Aucun n'est développé dans P2. Aucun ne doit être branché sur la publication Vinted tant que la méthode n'est pas autorisée.

## 1. Catégories et marques

Objectif : proposer la catégorie, la sous-catégorie et la marque que le formulaire Vinted attend, à partir de l'annonce validée par le serveur.

Périmètre : un référentiel versionné, construit depuis les sources que Vinted autorise (pour un compte Pro, l'ontologie de l'API Integrations). Le serveur renvoie un identifiant de référentiel et un libellé. L'extension choisit l'entrée du menu si elle est déjà visible. Si le menu n'est pas ouvert ou si le libellé est absent, le champ reste vide et `a_verifier` l'indique. Aucune invention de marque : une marque illisible reste vide.

Fichiers prévus plus tard : table `catalogs`, service de correspondance, champ supplémentaire dans la réponse d'analyse, test de non-invention. Le remplissage actuel du formulaire n'est pas modifié en attendant.

## 2. Photos

Deux pipelines séparés.

- Peu coûteux, déterministe : redressement, recadrage, lumière, export JPEG dans les limites déjà imposées (5 photos, 1024 px). Exécutable dans l'extension, sans envoi au serveur.
- Génératif : vêtement porté, fond, mannequin. Uniquement sur action explicite, avec un crédit distinct, un plafond de coût et l'image résultat marquée comme générée. Jamais utilisé pour inventer un défaut ou un état.

Les photos sources ne sont pas conservées après la réponse. Pas de contournement des limites d'upload de Vinted.

## 3. Dressings, annonces et comptes Vinted

Objectif : un dressing côté produit (articles, brouillons, statut) relié au compte de l'application, pas au compte Vinted.

Un compte Vinted n'est relié que si Vinted fournit une autorisation explicite (API Pro, jeton obtenu par le flux officiel). Le produit ne demande jamais le mot de passe, les cookies ou le jeton de session Vinted. Il ne les transfère pas au serveur. Les ventes, messages, offres et remises en ligne restent hors de ce module tant que le module 7 n'a pas une méthode autorisée.

## 4. Interface 2026

Objectif : appliquer le design system (`docs/design-system.md`) au site, à l'extension et à l'application mobile, sans changer le parcours qui fonctionne.

L'identité est violet `#6D28D9`, turquoise `#149388`, blanc, lavande `#F0EBFF` et anthracite `#242037`. La signature est « Des annonces plus malignes. » L'extension reste une page de réglages et un panneau compact sur le formulaire. Le mobile consomme la même API. Cette couche visuelle attend la fin des étapes techniques en cours.

## 5. Module partagé navigateurs

Objectif : extraire de `lib/core.js` un module JavaScript ou TypeScript sans API Chrome : normalisation, règle de prix, assainissement de l'annonce, choix du moteur, construction de la requête Laravel, validation d'URL.

Chrome, Safari et le client mobile embarqué importeront ce module. Les accès `chrome.storage`, `chrome.runtime` et le DOM Vinted restent dans des adaptateurs. Les tests actuels de `tests/core.test.js` deviennent la base de ce paquet. Pas de seconde copie des règles de prix.

## 6. Flutter ou React Native

Critères de choix, dans cet ordre :

1. Réutiliser le module du point 5 (Dart via un pont, ou React Native qui exécute le TypeScript directement).
2. Ouvrir la page Vinted dans une WebView ne permet pas de remplir l'application native, ni de réutiliser le script de contenu Chrome. Le formulaire natif Vinted n'est pas une cible.
3. Une extension Safari partage le modèle d'extension web, pas le moteur Flutter. Le code Chrome réutilisable est le module du point 5 et, éventuellement, une extension Safari écrite à part.
4. Le client mobile doit parler à `/api/v1` avec un jeton porteur, comme l'extension.

Piste favorisée tant que ces contraintes tiennent : React Native pour partager le TypeScript, Flutter seulement si l'interface mobile devient le produit principal et que le pont vers le module partagé reste mince. Décision à reprendre avec un prototype de connexion et d'analyse, pas avec la publication Vinted.

## 7. Interactions Vinted

Module isolé, derrière une interface étroite : publier, lire un message, envoyer une offre, relancer une annonce. Chaque méthode déclare son mode : `manuel` (l'utilisateur clique dans le formulaire, comportement actuel) ou `api-pro` (API Integrations Vinted, réservée aux comptes Pro autorisés).

Interdit dans tous les modes : mot de passe Vinted, cookies, jeton de session, contournement de CAPTCHA, anti-bot, ou simulation de frappe non demandée par l'utilisateur. Les conditions Vinted du 8 octobre 2026 interdisent les logiciels externes, robots et collecteurs sauf autorisation. Le vendeur particulier conserve donc le remplissage qu'il déclenche lui-même, puis son propre clic sur Publier.

Ce module n'est pas importé par l'analyse photo. Un échec ou un retrait de l'autorisation Vinted ne coupe pas la rédaction d'annonce.
