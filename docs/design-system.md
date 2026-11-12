# Design system — Annonce Futée

Identité visuelle définitive du produit. Elle s'applique, quand la refonte sera lancée, au site `annoncefutee.fr`, à l'extension Chrome et à l'application mobile.

Cette direction remplace les anciennes propositions beige, sable et vert. Le site en ligne, l'extension et le mobile gardent leur apparence actuelle tant que les étapes techniques en cours ne sont pas validées. Aucun écran n'est restylé par ce document.

Le fichier maître du logo n'est pas encore dans le dépôt. On n'en redessine pas une approximation. L'icône décrite ci-dessous sert de référence jusqu'à l'ajout du fichier source.

## Identité

- Nom : Annonce Futée.
- Signature : « Des annonces plus malignes. »
- Icône : étiquette stylisée, en blanc, sur un carré violet aux coins arrondis. Le fond de l'icône reste `#6D28D9`. On ne la pose pas sur turquoise ni sur anthracite.
- Le rayon du fond d'icône est d'environ 22 % du côté. La zone de protection est égale à la hauteur de l'étiquette, sur les quatre côtés.
- Tailles minimales : 24 px dans l'interface, 16 px pour le favicon. En dessous, seule la forme de l'étiquette reste lisible.
- La signature accompagne le nom sur le site et les écrans d'ouverture. Elle ne se répète pas dans le panneau compact de l'extension.

## Principes

- Une annonce se prépare en trois temps visibles : photos, relecture, publication manuelle.
- La photo occupe la place principale. Les champs sont une colonne de relecture.
- Une seule action forte à la fois. Le reste est secondaire.
- L'interface est épurée, rapide, et lisible au premier coup d'œil sur mobile.
- Les simulations générées portent un marquage visible. Elles ne se présentent pas comme la photo du produit.
- Le mouvement confirme une action. Il ne décore pas.

## Couleurs de marque

| Jeton | Valeur | Rôle |
| --- | --- | --- |
| `violet` | `#6D28D9` | Action principale, fond de l'icône |
| `turquoise` | `#149388` | Accent, repères, illustrations |
| `white` | `#FFFFFF` | Surface et texte sur violet |
| `lavender` | `#F0EBFF` | Fond clair, halos |
| `anthracite` | `#242037` | Texte, fond du mode sombre |

Contrastes mesurés :

| Couple | Ratio | Usage permis |
| --- | --- | --- |
| Blanc sur violet | 7,10:1 | Libellé de bouton, texte sur fond violet |
| Violet sur blanc | 7,10:1 | Titre ou lien court |
| Violet sur lavande | 6,10:1 | Titre sur le fond clair |
| Anthracite sur blanc | 15,71:1 | Texte courant |
| Anthracite sur lavande | 13,49:1 | Texte courant |
| Lavande sur anthracite | 13,49:1 | Texte secondaire en mode sombre |
| Turquoise sur blanc | 3,78:1 | Trait, icône, grand signe. Pas le texte courant |
| Blanc sur turquoise | 3,78:1 | Pas un bouton avec un libellé de taille normale |
| Turquoise sur lavande | 3,24:1 | Trait et icône seulement |
| Violet sur anthracite | 2,21:1 | Interdit pour le texte et les icônes fines |

Le turquoise de marque reste visible dans les aplats larges, les filets et les illustrations. Il ne porte pas un paragraphe, un lien en petit corps, ni le libellé d'un bouton.

## Jetons fonctionnels

Ces tons sont dérivés des teintes de marque pour atteindre WCAG 2.2 AA. Ils ne forment pas une seconde palette.

| Jeton | Valeur | Rôle | Contraste utile |
| --- | --- | --- | --- |
| `turquoise-ink` | `#116E66` | Lien, petit libellé turquoise, succès | 6,09:1 sur blanc, 5,23:1 sur lavande |
| `turquoise-bright` | `#5EE0D4` | Lien et icône en mode sombre | 9,79:1 sur anthracite |
| `violet-bright` | `#A78BFA` | Accent textuel en mode sombre | 5,77:1 sur anthracite |
| `violet-press` | `#4C1D95` | Action principale pressée | Blanc dessus, au-dessus de 7:1 |
| `danger` | `#B42318` | Erreur | 6,57:1 sur blanc |
| `danger-bright` | `#FDA29B` | Erreur en mode sombre | 8,09:1 sur anthracite |
| `line` | `#E4DCFC` | Séparation sur fond clair | Décoratif |
| `surface-dark` | `#3F3860` | Carte en mode sombre | Blanc dessus à 10,79:1 |

Le focus visible utilise un anneau `turquoise-ink` de 2 px sur fond clair, et `turquoise-bright` sur fond anthracite. La couleur n'est jamais le seul signal : l'anneau s'ajoute au changement de bord ou de soulignement.

## Modes

Clair :

- Page en lavande, cartes en blanc, texte en anthracite.
- Bouton principal : fond violet, libellé blanc.
- Bouton secondaire : fond blanc, texte anthracite, bord `#E4DCFC`.
- Lien : `turquoise-ink`.

Sombre, prévu et non activé :

- Page en anthracite, carte en `#3F3860`, texte en blanc.
- Texte secondaire en lavande.
- Le bouton principal reste violet avec un libellé blanc.
- Lien : `turquoise-bright`.
- On n'écrit pas en `#6D28D9` sur l'anthracite.
- Le choix suit `prefers-color-scheme`, avec un réglage explicite ensuite.

## Typographie

- Titres : Plus Jakarta Sans, graisse 600, interlettrage légèrement resserré.
- Interface : Outfit, graisse 400 pour le texte et 500 pour les libellés.
- Les deux familles couvrent les accents français.
- Site : titre 40 / 32, section 24, texte 16, métadonnée 13. Le titre passe à 32 sur un écran étroit.
- Extension : titre 22, texte 15, métadonnée 13. Le panneau reste compact.
- Hauteur de ligne : 1,15 pour les titres, 1,5 pour le texte.
- Longueur de ligne visée : 66 caractères sur le site.

## Rythme et forme

- Espacements : 4, 8, 12, 16, 24, 32, 48, 64.
- Rayon : 10 px pour un champ, 14 px pour un bouton, 20 px pour une carte, 22 % pour le fond de l'icône.
- Ombres très courtes, teintées d'anthracite à faible opacité. Pas d'ombre portée large.
- Les cibles tactiles font au moins 24 px par 24 px, avec un espacement suffisant. Les actions principales du site visent 44 px de haut.
- Mobile d'abord pour le site. Le panneau de l'extension se conçoit à sa largeur réelle, puis se vérifie en fenêtre étroite.

## Mouvement

- Durée : 160 ms pour un contrôle, 220 ms pour un panneau.
- Courbe : ease-out. Propriétés limitées à l'opacité et à la transformation.
- Aucune animation si `prefers-reduced-motion` est demandé.
- L'analyse d'une photo montre un skeleton stable, pas un spinner qui déplace la mise en page.

## Composants

Les noms suivent les jetons ci-dessus. Ils seront introduits lors de la refonte, pas avant.

- Marque : icône, nom, signature.
- Bouton principal, bouton secondaire, bouton discret.
- Champ, message d'erreur, anneau de focus.
- Carte d'annonce : photo, titre, prix, état.
- Bande de miniatures et skeleton.
- Pastille « à confirmer » et marquage d'une simulation.
- État vide : une phrase et une seule action.
- Toast bref, en bas, qui ne couvre pas l'action en cours.

L'extension garde une page de réglages et un panneau sur le formulaire Vinted. Le site porte la marque, la promesse et le compte. Le mobile reprend les mêmes jetons et la même API.

## Accessibilité

- Texte courant au moins à 4,5:1. Grand texte et éléments d'interface non textuels au moins à 3:1.
- Le turquoise de marque `#149388` ne sert pas de texte sur blanc, lavande ou bouton.
- L'information ne repose pas sur la seule couleur.
- Le nom accessible de l'icône est « Annonce Futée ».
- L'ordre de tabulation suit l'ordre visuel. Le focus reste visible.
- Les contrastes ci-dessus se revérifient à chaque nouvel assemblage de couleurs.
