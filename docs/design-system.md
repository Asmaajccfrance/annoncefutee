# Design system initial

Le système s'appliquera au panneau et au mobile en P5 et P6. P1 ne change pas l'apparence : le panneau et les réglages restent ceux de la 1.2.0, pour ne pas mélanger correctif et refonte.

Le point de départ visuel est le teal déjà utilisé, `#007782`, sur fond clair et typographie système. La direction P5 s'en écarte sans devenir un tableau de bord générique.

## Principes

- Une annonce se crée en trois temps visibles : photos, relecture, publication manuelle.
- La photo occupe la place principale. Les champs sont une colonne de relecture, pas un formulaire administratif.
- Une seule action forte à la fois. Le reste est contextuel.
- Les simulations générées portent un marquage visible et ne sont pas présentées comme la photo du produit.

## Couleurs

| Jeton | Valeur | Rôle |
| --- | --- | --- |
| `ink` | `#1C1915` | Texte |
| `ink-soft` | `#5C564C` | Texte secondaire |
| `paper` | `#F4F1EA` | Fond |
| `surface` | `#FFFCF7` | Cartes et panneau |
| `line` | `#E4DDD2` | Séparations |
| `pine` | `#1F6F66` | Action principale, hérité du teal actuel |
| `pine-deep` | `#144E48` | Action pressée |
| `sand` | `#E7D7BE` | À vérifier |
| `clay` | `#8C3A32` | Erreur |
| `moss` | `#2C6B45` | Champ rempli |

Le mode sombre inverse `paper` vers `#161411` et `surface` vers `#221F1B`, garde `pine` pour l'action, et vérifie le contraste du texte secondaire au-dessus de 4.5:1.

## Typographie et rythme

- Titres : Fraunces, optique douce, tailles 28 / 22 / 18.
- Interface : Outfit, 15 px pour le texte, 13 px pour les métadonnées.
- Espacements : 4, 8, 12, 16, 24, 32, 48.
- Rayon : 10 px pour les champs, 16 px pour le panneau.
- Mouvement : 180 ms, ease-out. Aucune animation si `prefers-reduced-motion` est demandé.
- États : skeleton sur la photo pendant l'analyse, toast bref en bas, confirmation avant une action payante (crédit photo).

## Composants à introduire en P5

Photo principale, bande de miniatures, fiche d'annonce éditable, pastille de confiance, liste « à confirmer », comparaison avant / après, interrupteur de simulation marquée IA, bibliothèque en grille, état vide avec une seule phrase et un bouton.

Les réglages actuels (longueur, hashtags, signature, règle de prix, génération automatique) restent. La clé API quitte cet écran dès que le compte existe.
