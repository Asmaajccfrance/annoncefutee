<?php

namespace Tests\Support;

class DescriptionReview
{
    /**
     * @param  array<string, mixed>  $article
     * @return list<string>
     */
    public static function problems(string $description, array $article, string $style, bool $hashtags, string $shipping): array
    {
        $problems = [];
        $plain = mb_strtolower($description);

        if (str_contains($description, '*')) {
            $problems[] = 'asterisque';
        }
        if (preg_match('/[\x{1F300}-\x{1FAFF}]/u', $description) === 1) {
            $problems[] = 'emoji';
        }
        if (! str_contains($description, 'État : '.$article['etat'])) {
            $problems[] = 'etat';
        }
        if (! str_contains($description, $article['defaut'])) {
            $problems[] = 'defaut';
        }
        if (! str_contains($description, $shipping)) {
            $problems[] = 'expedition';
        }

        $first = strtok($description, "\n") ?: '';
        if (! str_starts_with($first, $article['type'])) {
            $problems[] = 'premiere_ligne';
        }
        if ($article['marque'] !== '' && ! str_contains($first, $article['marque'])) {
            $problems[] = 'marque';
        }
        if ($article['marque'] === '' && preg_match('/\b(nike|sony|adidas|ikea|sézane)\b/iu', $first) === 1) {
            $problems[] = 'marque_inventee';
        }
        if ($article['taille'] !== '') {
            $mesure = $article['mesure'] ?? 'taille';
            if (! str_contains(mb_strtolower($first), $mesure)) {
                $problems[] = 'mesure';
            }
            if (! str_contains($first, $article['taille'])) {
                $problems[] = 'taille';
            }
            if ($mesure === 'pointure' && preg_match('/\btaille\b/iu', $first) === 1) {
                $problems[] = 'taille_au_lieu_de_pointure';
            }
        }
        if (($article['note'] ?? '') !== '' && ! str_contains($description, $article['note'])) {
            $problems[] = 'note';
        }

        preg_match_all('/^• .+$/m', $description, $bullets);
        $count = count($bullets[0]);
        $expected = count($article['faits']);
        if ($count !== $expected || $count < 1 || $count > 5) {
            $problems[] = 'puces:'.$count;
        }

        if ($shipping === '') {
            foreach (['livraison rapide', 'sous 24', 'sous 48', 'transporteur'] as $promise) {
                if (str_contains($plain, $promise)) {
                    $problems[] = 'promesse';
                }
            }
        } elseif (! str_contains($description, $shipping)) {
            $problems[] = 'expedition';
        }

        preg_match_all('/#[^\s#]+/u', $description, $tags);
        $tagCount = count($tags[0]);
        if ($hashtags && ($tagCount < 3 || $tagCount > 5)) {
            $problems[] = 'hashtags:'.$tagCount;
        }
        if (! $hashtags && $tagCount !== 0) {
            $problems[] = 'hashtags_presents';
        }

        foreach ($article['interdit'] as $word) {
            if (str_contains($plain, mb_strtolower($word))) {
                $problems[] = 'invente:'.$word;
            }
        }

        $sentences = preg_split('/\n+/', $description) ?: [];
        $seen = [];
        foreach ($sentences as $sentence) {
            $sentence = trim($sentence);
            if ($sentence === '' || str_starts_with($sentence, '•') || str_starts_with($sentence, '#')) {
                continue;
            }
            if (isset($seen[$sentence])) {
                $problems[] = 'repetition';
                break;
            }
            $seen[$sentence] = true;
        }

        return $problems;
    }

    /**
     * @param  list<string>  $descriptions
     * @return list<string>
     */
    public static function sharedProse(array $descriptions): array
    {
        $seen = [];
        $shared = [];
        foreach ($descriptions as $description) {
            foreach (preg_split('/\n+/', $description) ?: [] as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '•') || str_starts_with($line, 'État :') || str_starts_with($line, 'Envoi ') || str_starts_with($line, '#')) {
                    continue;
                }
                if (isset($seen[$line])) {
                    $shared[] = $line;
                }
                $seen[$line] = true;
            }
        }

        return array_values(array_unique($shared));
    }
}
