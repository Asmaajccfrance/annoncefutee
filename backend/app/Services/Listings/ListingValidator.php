<?php

namespace App\Services\Listings;

use App\Exceptions\ApiException;

class ListingValidator
{
    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    public function validate(array $raw): array
    {
        $title = $this->text($raw['titre'] ?? null, 150);
        $description = $this->text($raw['description'] ?? null, 4000);
        if ($title === '' || $description === '') {
            throw new ApiException('invalid_listing', 'L\'annonce reçue est incomplète.', 502);
        }

        $colors = [];
        foreach ((array) ($raw['couleurs'] ?? []) as $color) {
            if (! is_string($color) || ! in_array($color, ListingCatalog::COLORS, true)) {
                continue;
            }
            if (! in_array($color, $colors, true)) {
                $colors[] = $color;
            }
            if (count($colors) === 2) {
                break;
            }
        }

        $checks = [];
        foreach ((array) ($raw['a_verifier'] ?? []) as $item) {
            $line = $this->text($item, 200);
            if ($line !== '') {
                $checks[] = $line;
            }
            if (count($checks) === 8) {
                break;
            }
        }

        $price = is_numeric($raw['prix_suggere'] ?? null) ? (float) $raw['prix_suggere'] : 0.0;
        $state = is_string($raw['etat'] ?? null) ? $raw['etat'] : '';

        return [
            'titre' => $title,
            'description' => $description,
            'categorie' => $this->text($raw['categorie'] ?? null, 200),
            'sous_categorie' => $this->text($raw['sous_categorie'] ?? null, 120),
            'marque' => $this->text($raw['marque'] ?? null, 80),
            'taille' => $this->text($raw['taille'] ?? null, 40),
            'etat' => in_array($state, ListingCatalog::STATES, true) ? $state : '',
            'couleurs' => $colors,
            'matiere' => $this->text($raw['matiere'] ?? null, 60),
            'prix_suggere' => $price > 0 ? round($price, 2) : null,
            'a_verifier' => $checks,
        ];
    }

    private function text(mixed $value, int $max): string
    {
        if (! is_string($value)) {
            return '';
        }

        $clean = str_replace("\0", '', trim($value));

        return mb_substr($clean, 0, $max);
    }
}
