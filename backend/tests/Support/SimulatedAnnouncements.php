<?php

namespace Tests\Support;

class SimulatedAnnouncements
{
    /**
     * @return list<array<string, mixed>>
     */
    public static function articles(): array
    {
        return [
            self::article(
                'sweat',
                'Sweat taille M',
                'Sweat',
                '',
                'M',
                'Marine',
                'Satisfaisant',
                'Petit trou au coude gauche',
                ['Capuche doublée', 'Poche kangourou', 'Coton'],
                ['#sweat', '#coton', '#marine', '#secondeMain'],
                [
                    'court' => 'Marine, coupe ample.',
                    'normal' => 'Couleur marine, coupe ample.',
                    'detaille' => 'Il est marine, avec une coupe ample.',
                ],
                ['Nike', 'polyester', '90 cm', 'neuf avec étiquette'],
                'Taille M confirmée. Couleur marine. Coupe ample. Capuche doublée. Poche kangourou. Coton. Petit trou au coude gauche. Pas de marque lisible.'
            ),
            self::article(
                'robe',
                'Robe crème taille 38',
                'Robe',
                '',
                '38',
                'Crème',
                'Bon état',
                'Petite tache claire près de l\'ourlet',
                ['Bretelles fines', 'Taille élastiquée', 'Viscose'],
                ['#robe', '#viscose', '#fleurie', '#secondeMain'],
                [
                    'court' => 'Crème, à fleurs.',
                    'normal' => 'Robe crème à fleurs, fluide.',
                    'detaille' => 'Robe fluide, crème, avec des fleurs.',
                ],
                ['soie', 'Sézane', 'taille 36'],
                'Taille 38 confirmée. Fond crème, motif fleuri, ligne fluide. Bretelles fines. Taille élastiquée. Viscose. Petite tache claire près de l\'ourlet. Marque illisible.'
            ),
            self::article(
                'chaussures',
                'Baskets Nike blanches pointure 39',
                'Baskets',
                'Nike',
                '39',
                'Blanc',
                'Bon état',
                'Éraflure sur le bout droit',
                ['Fermeture à lacets', 'Semelle en caoutchouc', 'Cuir'],
                ['#baskets', '#nike', '#cuir', '#pointure39'],
                [
                    'court' => 'Blanches et basses.',
                    'normal' => 'Baskets blanches, basses.',
                    'detaille' => 'Baskets basses, en cuir blanc.',
                ],
                ['Adidas', 'pointure 40', 'neuves'],
                'Baskets Nike. Pointure 39. Blanc. Modèle bas. Lacets. Semelle en caoutchouc. Cuir. Éraflure sur le bout droit.',
                'pointure'
            ),
            self::article(
                'meuble',
                'Table d\'appoint en bois clair',
                'Table d\'appoint',
                '',
                '',
                'Bois clair',
                'Bon état',
                'Rayure sur le plateau',
                ['Un tiroir', 'Plateau carré'],
                ['#table', '#appoint', '#bois', '#secondeMain'],
                [
                    'court' => 'Bois clair, basse.',
                    'normal' => 'Petite table en bois clair.',
                    'detaille' => 'Table basse, en bois clair.',
                ],
                ['cm', 'chêne massif', 'IKEA'],
                'Table d\'appoint. Bois clair. Forme basse. Un tiroir. Plateau carré. Rayure sur le plateau. Dimensions non lisibles. Pas de marque.'
            ),
            self::article(
                'electronique',
                'Casque Sony filaire',
                'Casque',
                'Sony',
                '',
                'Noir',
                'Satisfaisant',
                'Mousse de l\'écouteur gauche usée',
                ['Filaire', 'Arceau réglable'],
                ['#casque', '#sony', '#filaire', '#secondeMain'],
                [
                    'court' => 'Noir et pliant.',
                    'normal' => 'Casque noir, pliant.',
                    'detaille' => 'Casque pliant, de couleur noire.',
                ],
                ['Bluetooth', 'batterie', 'garantie'],
                'Casque Sony. Noir. Filaire. Arceau réglable. Se replie. Mousse de l\'écouteur gauche usée. Fonctionnement non testé.',
                'taille',
                'Fonctionnement non testé.'
            ),
        ];
    }

    /**
     * @param  list<string>  $faits
     * @param  list<string>  $hashtags
     * @param  array{court: string, normal: string, detaille: string}  $phrases
     * @param  list<string>  $interdit
     * @return array<string, mixed>
     */
    private static function article(
        string $id,
        string $titre,
        string $type,
        string $marque,
        string $taille,
        string $couleur,
        string $etat,
        string $defaut,
        array $faits,
        array $hashtags,
        array $phrases,
        array $interdit,
        string $precisions,
        string $mesure = 'taille',
        string $note = '',
    ): array {
        return compact(
            'id', 'titre', 'type', 'marque', 'taille', 'couleur', 'etat', 'defaut',
            'faits', 'hashtags', 'phrases', 'interdit', 'precisions', 'mesure', 'note'
        );
    }

    /**
     * @param  array<string, mixed>  $article
     */
    public static function render(array $article, string $style, bool $hashtags = true, string $shipping = ''): string
    {
        $line = $article['type'];
        if ($article['marque'] !== '') {
            $line .= ' '.$article['marque'];
        }
        if ($article['taille'] !== '') {
            $label = ($article['mesure'] ?? 'taille') === 'pointure' ? 'pointure' : 'taille';
            $line .= ' '.$label.' '.$article['taille'];
        }

        $facts = $article['faits'];
        $bullets = implode("\n", array_map(static fn (string $fact): string => '• '.$fact, $facts));
        $parts = [
            $line,
            $article['phrases'][$style],
            $bullets,
        ];
        if (($article['note'] ?? '') !== '') {
            $parts[] = $article['note'];
        }
        $parts[] = 'État : '.$article['etat'].'. '.$article['defaut'].'.';
        if ($shipping !== '') {
            $parts[] = $shipping;
        }
        $text = implode("\n\n", $parts);
        if ($hashtags) {
            $text .= "\n\n".implode(' ', $article['hashtags']);
        }

        return $text;
    }
}
