<?php

namespace App\Services\Photos;

/**
 * Consignes données au modèle d'image. Le vêtement doit rester celui de la photo :
 * l'image sert à présenter l'article, pas à l'embellir.
 */
class PhotoBrief
{
    public const MODES = [
        'studio', 'mannequin_femme', 'mannequin_homme',
        'enfant', 'bebe', 'chien', 'chat', 'objet', 'fond_blanc',
    ];

    public static function write(string $mode, string $consigne = ''): string
    {
        $fidelite = 'Reproduis exactement l\'article de la photo fournie : même forme, mêmes couleurs, même matière, '
            .'mêmes logos, inscriptions, motifs, coutures, boutons et étiquettes visibles, sans rien ajouter ni retirer. '
            .'Conserve les défauts visibles (taches, usure, accrocs) : ne les corrige pas. '
            .'N\'ajoute aucun texte, logo, filigrane, accessoire ni autre article.';
        $base = 'Photo de présentation pour une annonce de seconde main. ';

        if ($mode === 'studio') {
            $texte = $base
                .'Montre l\'article seul, bien à plat et bien droit, centré, entier dans le cadre, '
                .'avec une lumière douce et homogène et une ombre très légère sous l\'article. '
                .'Lisse seulement les faux plis dus à la pose. Cadrage vertical. '
                .'Sans demande écrite, le fond est clair et uni. '
                .$fidelite;
        } elseif ($mode === 'fond_blanc') {
            $texte = $base
                .'Montre l\'article seul, posé droit et centré, entier dans le cadre, sur un fond blanc uni. '
                .'Convient à un vêtement, un objet, un accessoire ou tout article. '
                .'Lumière douce et homogène, ombre très légère. Cadrage vertical. Aucune personne, aucun animal. '
                .$fidelite;
        } elseif ($mode === 'objet') {
            $texte = $base
                .'Montre l\'article seul, posé droit et centré, entier dans le cadre, sur un fond clair uni. '
                .'Convient à un objet, un accessoire ou tout article qui ne se porte pas. '
                .'Lumière douce et homogène, ombre très légère. Cadrage vertical. Aucune personne, aucun animal. '
                .$fidelite;
        } elseif ($mode === 'enfant' || $mode === 'bebe') {
            $personne = $mode === 'bebe' ? 'un bébé' : 'un enfant';

            $texte = $base
                .'Montre l\'article porté par '.$personne.', modèle fictif à l\'allure ordinaire, pose simple et naturelle, '
                .'devant un fond clair uni, lumière douce de studio, cadrage vertical. '
                .self::cadrageCorps()
                .'Les autres vêtements, s\'ils sont dans le cadre, sont neutres, unis et sans marque. Tenue correcte et sobre. '
                .'Quand le visage est dans le cadre, il est inventé, bien visible, et ne ressemble à aucun enfant réel. '
                .'Si le cadre ne montre qu\'un bras, une main, un cou ou des pieds, ne montre pas le reste du corps. '
                .$fidelite;
        } elseif ($mode === 'chien' || $mode === 'chat') {
            $animal = $mode === 'chien' ? 'un chien adulte' : 'un chat adulte';

            $texte = $base
                .'Montre l\'article avec '.$animal.' à l\'allure ordinaire, de face, devant un fond clair uni, lumière douce, cadrage vertical. '
                .'Si l\'article est clairement fait pour cet animal, il le porte. Sinon l\'article reste posé à côté, entier, et l\'animal ne le porte pas. '
                .'Aucun être humain. L\'animal ne doit pas pouvoir être reconnu comme un animal réel. '
                .$fidelite;
        } else {
            $personne = $mode === 'mannequin_homme' ? 'un homme adulte' : 'une femme adulte';

            $texte = $base
                .'Montre l\'article porté par '.$personne.', mannequin fictif à l\'allure ordinaire, pose simple et naturelle, '
                .'devant un fond clair uni, lumière douce de studio, cadrage vertical. '
                .self::cadrageCorps()
                .'Les autres vêtements portés, s\'ils sont dans le cadre, sont neutres, unis et sans marque. Tenue correcte et sobre. '
                .'Le mannequin ne ressemble à aucune personne réelle. '
                .'Si le visage est dans le cadre, il est inventé. Si le cadre ne montre qu\'un bras, une main, un cou ou des pieds, ne montre pas le reste du corps. '
                .'Si l\'article est un vêtement pour enfant ou pour bébé, ne représente aucune personne : '
                .'présente-le sur un buste de vitrine sans visage ou sur un cintre, devant le même fond clair. '
                .$fidelite;
        }

        return self::avecConsigne($texte, $mode === 'fond_blanc' ? '' : $consigne);
    }

    /**
     * La demande libre ne remplace pas la consigne : elle ne peut pas changer l'article.
     */
    private static function avecConsigne(string $texte, string $consigne): string
    {
        $consigne = trim(preg_replace('/\s+/u', ' ', $consigne) ?? '');
        if ($consigne === '') {
            return $texte;
        }

        return $texte
            .' La vendeuse demande un autre fond ou une autre présentation. Remplace le fond prévu ci-dessus par celui-ci, sans modifier l\'article : '
            .$consigne
            .'. Si cette demande change l\'article lui-même, ignore seulement cette partie.';
    }

    /**
     * Le modèle voit l'article sur la photo et ne garde que la zone du corps qui le porte.
     */
    private static function cadrageCorps(): string
    {
        return 'Cadre seulement la partie du corps qui porte l\'article, et garde cet article entier dans l\'image. '
            .'Haut de vêtement (t-shirt, chemise, pull, sweat, veste, blouson, gilet, débardeur, blouse, top) : seulement le haut du corps, de la tête à la taille, sans les jambes. '
            .'Pantalon, jean, jupe, short ou legging : seulement le bas du corps, de la taille aux pieds. '
            .'Robe, combinaison ou manteau long : la personne en entier, car l\'article couvre tout le corps. '
            .'Chaussures, bottes, baskets ou sandales : seulement les pieds. '
            .'Collier ou sautoir : seulement le cou. '
            .'Bracelet, montre ou gourmette : seulement le bras. '
            .'Bague : seulement la main. '
            .'Boucles d\'oreilles : seulement l\'oreille. '
            .'Chapeau, casquette, bonnet ou bandeau : seulement la tête. '
            .'Écharpe ou foulard : seulement le cou et les épaules. '
            .'Ceinture : seulement la taille. '
            .'Gants ou mitaines : seulement les mains. '
            .'Sac : seulement le bras ou l\'épaule qui le porte, avec le sac entier. '
            .'Chaussettes ou collants : seulement les jambes et les pieds. '
            .'Lunettes : seulement le visage. '
            .'Si l\'article se porte sur une autre zone, cadre seulement cette zone. ';
    }
}
