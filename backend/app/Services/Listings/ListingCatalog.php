<?php

namespace App\Services\Listings;

class ListingCatalog
{
    public const STATES = [
        'Neuf avec étiquette',
        'Neuf sans étiquette',
        'Très bon état',
        'Bon état',
        'Satisfaisant',
    ];

    public const COLORS = [
        'Noir', 'Marron', 'Gris', 'Beige', 'Rose', 'Violet', 'Rouge', 'Jaune', 'Bleu', 'Vert',
        'Orange', 'Blanc', 'Argenté', 'Doré', 'Multicolore', 'Kaki', 'Turquoise', 'Crème',
        'Abricot', 'Corail', 'Bordeaux', 'Lila', 'Bleu clair', 'Marine', 'Vert foncé',
        'Moutarde', 'Menthe',
    ];

    /**
     * Schéma strict. Les contraintes de longueur sont revérifiées en PHP :
     * elles ne sont pas toutes acceptées par les sorties structurées.
     *
     * @return array<string, mixed>
     */
    public static function schema(): array
    {
        return [
            'type' => 'object',
            'additionalProperties' => false,
            'properties' => [
                'titre' => ['type' => 'string'],
                'description' => ['type' => 'string'],
                'categorie' => ['type' => 'string'],
                'sous_categorie' => ['type' => 'string'],
                'marque' => ['type' => 'string'],
                'taille' => ['type' => 'string'],
                'etat' => ['type' => 'string', 'enum' => array_merge(self::STATES, [''])],
                'couleurs' => [
                    'type' => 'array',
                    'items' => ['type' => 'string', 'enum' => self::COLORS],
                ],
                'matiere' => ['type' => 'string'],
                'prix_suggere' => ['type' => 'number'],
                'a_verifier' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                ],
            ],
            'required' => [
                'titre', 'description', 'categorie', 'sous_categorie', 'marque', 'taille',
                'etat', 'couleurs', 'matiere', 'prix_suggere', 'a_verifier',
            ],
        ];
    }
}
