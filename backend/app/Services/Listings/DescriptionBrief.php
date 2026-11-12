<?php

namespace App\Services\Listings;

class DescriptionBrief
{
    /**
     * @param  array{style?: string, hashtags?: bool, signature?: string}  $prefs
     */
    public static function write(array $prefs, string $precisions): string
    {
        $style = $prefs['style'] ?? '';
        if (! in_array($style, ['court', 'normal', 'detaille'], true)) {
            $style = 'normal';
        }

        $density = [
            'court' => 'Phrases très courtes. Garde chaque défaut et chaque information importante.',
            'normal' => 'Trois à cinq puces. Aucun défaut ni information importante ne disparaît.',
            'detaille' => 'Puces un peu plus précises, sans rallonger pour meubler. Aucun défaut ni information importante ne disparaît.',
        ][$style];

        $signature = trim(preg_replace('/\s+/', ' ', (string) ($prefs['signature'] ?? '')) ?? '');
        if (mb_strlen($signature) > 300) {
            $signature = mb_substr($signature, 0, 300);
        }

        $lines = [
            'Tu rédiges la description d\'une annonce de seconde main pour un particulier.',
            'Elle doit sembler écrite par un vendeur expérimenté : claire, structurée, élégante, attractive et facile à lire sur un téléphone.',
            'Français naturel, sans faute. Phrases simples, naturelles et commerciales, comme celles d\'un vendeur. Pas de formulation artificielle ni précieuse.',
            'Pas de slogan, pas de superlatif creux, pas de répétition, pas d\'information inutile.',
            'Varie les tournures d\'une annonce à l\'autre. N\'ouvre pas deux descriptions par la même phrase.',
            'N\'invente aucune marque, taille, pointure, matière, composition, état ou historique d\'utilisation. Si une information n\'est pas visible ou confirmée, omets-la et signale-la dans a_verifier.',
            'Ne masque pas un défaut visible. Garde chaque défaut et chaque information importante dans tous les modes. Le mode change seulement la longueur des phrases.',
            'N\'utilise aucun emoji. N\'utilise ni astérisque ni titre Markdown : la plateforme les affiche tels quels.',
            'Adapte les caractéristiques à la catégorie. Vêtement : coupe et détails, et le mot « taille ». Chaussure : fermeture et semelle si elles sont visibles, et le mot « pointure », jamais « taille ». Meuble : usage, et dimensions seulement si elles sont lisibles. Électronique : si le fonctionnement n\'a pas été testé, écris exactement « Fonctionnement non testé ». Ne le remplace pas et n\'affirme pas qu\'il fonctionne. N\'emploie pas le vocabulaire d\'une autre catégorie.',
            'Format obligatoire :',
            '1. Première ligne : type d\'article, puis la marque si elle est connue, puis la mesure confirmée. Vêtement : « taille ». Chaussure : « pointure ». N\'écris pas « sans marque » ni « taille inconnue ».',
            '2. Une courte phrase simple sur la couleur et le style.',
            '3. Caractéristiques : '.$density.' Chaque puce commence par « • », jamais par une étoile. Coupe, détails, matière et composition seulement lorsqu\'ils sont connus.',
            '4. Une ligne d\'état qui commence par « État : ». Mentionne tous les défauts visibles.',
        ];

        if ($signature !== '') {
            $lines[] = '5. Expédition : recopie exactement cette formule du vendeur, sans rien y ajouter et sans promettre une livraison qu\'elle ne contient pas : '.$signature;
        } else {
            $lines[] = '5. Expédition : le vendeur n\'a pas donné de formule. N\'en invente pas. Ne promets ni délai, ni transporteur, ni livraison.';
        }

        if ($prefs['hashtags'] ?? true) {
            $lines[] = '6. Termine par trois à cinq hashtags utiles pour cette catégorie sur Vinted. Pas davantage, et aucun espace à l\'intérieur d\'un hashtag.';
        } else {
            $lines[] = '6. N\'écris aucun hashtag, nulle part dans la description.';
        }

        $precisions = trim($precisions);
        if ($precisions !== '') {
            $lines[] = 'Précisions du vendeur, prioritaires sur les photos : '.$precisions;
        }

        return implode("\n", $lines);
    }
}
