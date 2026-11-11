# Migration fichier par fichier

Chaque ligne dit ce qui arrive au fichier. « Conservé » signifie que le comportement utilisateur de la 1.2.0 reste en place.

| Fichier | Maintenant | Suite |
| --- | --- | --- |
| `vinted-ia-extension/manifest.json` | Conservé. Version 1.2.1. Permission de lecture des images `vinted.fr` ajoutée, déjà prévue par le code. | P5 : icônes et `side_panel`. P2 : retirer `api.anthropic.com` quand l'appel passe par Laravel. |
| `vinted-ia-extension/background.js` | Conservé comme seul interlocuteur de l'IA. Origine des messages vérifiée, images et réponse nettoyées, cookies omis. | P2 : remplacer l'appel Anthropic par l'API du compte. Le fichier ne doit jamais recevoir la clé OpenAI. |
| `vinted-ia-extension/lib/core.js` | Nouveau. Prix, schémas, sélecteurs, validation, origines. Sans `chrome`. | Reste le contrat partagé. P3 : le même schéma côté Laravel. |
| `vinted-ia-extension/content.js` | Conservé. Sélecteurs inchangés, panneau fermé aux scripts de la page, photos distantes filtrées. | P5 : déplacer l'interface dans le panneau latéral. Le remplissage du formulaire ouvert reste ici. |
| `vinted-ia-extension/options.html` | Conservé, même mise en page. Charge `lib/core.js`. | P2 : connexion au compte à la place de la clé. P5 : appliquer le design system. |
| `vinted-ia-extension/options.js` | Conservé. Enregistre les mêmes clés, avec les bornes de `lib/core.js`. | Même horizon que la page. |
| `tests/core.test.js` | Nouveau. 10 tests, sans navigateur ni clé. | P3–P5 : ajouter les tests d'annonce, de photo et d'interface. |
| `tests/demo/formulaire.html` | Nouveau. Formulaire statique qui porte les `data-testid` reconnus. Il n'est pas chargé par l'extension. | Sert de contrat pour les tests de champs. |
| `backend/` | Absent, volontairement. | P2 : Laravel, auth, quotas, OpenAI, files, Stripe. |
| `mobile/` | Absent, volontairement. | P6 : Flutter, synchronisation des brouillons. Pas de promesse de publication dans l'app Vinted. |
| Connecteur Vinted | Absent, volontairement. | P7 : uniquement l'API Pro si le compte est autorisé. Pas de contournement, pas de cookies envoyés au serveur. |

## Phases suivantes, sans les démarrer ici

- P2 — compte, API, clé serveur, quota avant chaque génération.
- P3 — annonce structurée, confiance, taxonomie quand une source autorisée existe.
- P4 — retouche classique séparée de la génération d'image, simulation marquée.
- P5 — panneau et design system, sans retirer le remplissage actuel.
- P6 — Flutter et sync.
- P7 — étude du connecteur autorisé, avec un refus documenté pour les particuliers.
- P8 — stats, crédits, outils vendeur qui ne pilotent pas Vinted tout seuls.
- P9 — sécurité, perf, parcours, préparation commerciale.
