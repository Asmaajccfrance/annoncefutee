# Architecture cible

L'extension actuelle reste le client Chrome. Le serveur et le mobile s'ajoutent autour d'elle. Rien n'est régénéré à vide.

```
Chrome (MV3)          Flutter Android / iOS
popup léger +         appareil photo, galerie,
panneau latéral       brouillons, bibliothèque
        \                   /
         \                 /
          API REST Laravel
          MySQL, files, Stripe
          OpenAI uniquement ici
                 |
          connecteur Vinted
          seulement si Vinted l'autorise
```

## Règles

- Une annonce a le même schéma partout : brouillon, validation, confiance, photos d'origine séparées des dérivés.
- OpenAI n'est appelée que par Laravel, après contrôle du compte, de l'abonnement, du quota texte et du quota photo.
- La clé du fournisseur d'IA ne figure ni dans l'extension, ni dans Flutter, ni dans les réponses.
- Les traitements longs (lot, détourage, essayage) passent par une file. L'interface reste utilisable.
- Le connecteur Vinted est un module séparé, désactivé par défaut. Il n'est branché que pour un compte Pro explicitement autorisé, avec les jetons de cette API. Jamais les cookies de session.
- Les particuliers gardent le parcours actuel : préparer l'annonce, remplir le formulaire ouvert, publier soi-même.

## Backend, quand P2 commencera

- Comptes, profils autorisés, brouillons, fichiers, abonnements, quotas, journal, coûts.
- Authentification par jeton d'application, distinct de Vinted.
- Deux modèles configurables : un modèle vision économique pour l'annonce, un modèle image pour les dérivés génératifs.
- Chaque opération enregistre des jetons et un coût estimé.
- Photos : durée de conservation limitée, suppression avec le brouillon, originaux conservés à part des rendus.

## Hors de ce dépôt pour l'instant

Laravel, Flutter, Stripe et OpenAI ne sont pas créés en P1. Les poser vides casserait la promesse de ne pas recommencer à zéro et n'apporterait aucun comportement.
