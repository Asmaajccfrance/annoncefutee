<?php

namespace Tests\Unit;

use App\Exceptions\ApiException;
use App\Services\Listings\ListingValidator;
use App\Services\OpenAI\OpenAIListingClient;
use Tests\TestCase;

class ListingValidatorTest extends TestCase
{
    public function test_it_drops_unknown_attributes_and_keeps_visible_facts(): void
    {
        $annonce = (new ListingValidator)->validate([
            'titre' => "  Robe noire \0",
            'description' => 'Ourlet décousu.',
            'categorie' => 'Femmes',
            'sous_categorie' => 'Robes',
            'marque' => 'Marque inventée trop longue '.str_repeat('x', 100),
            'taille' => '',
            'etat' => 'Comme neuf',
            'couleurs' => ['Noir', 'Inexistante', 'Blanc', 'Bleu'],
            'matiere' => 'Coton',
            'prix_suggere' => 18.2,
            'a_verifier' => ['Taille illisible', '', 12],
        ]);

        $this->assertSame('Robe noire', $annonce['titre']);
        $this->assertSame('', $annonce['etat']);
        $this->assertSame(['Noir', 'Blanc'], $annonce['couleurs']);
        $this->assertSame(18.2, $annonce['prix_suggere']);
        $this->assertSame(['Taille illisible'], $annonce['a_verifier']);
        $this->assertLessThanOrEqual(80, mb_strlen($annonce['marque']));
    }

    public function test_it_rejects_an_empty_listing(): void
    {
        $this->expectException(ApiException::class);
        (new ListingValidator)->validate(['titre' => ' ', 'description' => '']);
    }

    public function test_cost_uses_the_configured_prices(): void
    {
        config([
            'openai.input_cost_per_million' => 0.20,
            'openai.output_cost_per_million' => 1.20,
        ]);

        $micros = app(OpenAIListingClient::class)->estimateMicros([
            'prompt_tokens' => 1000,
            'completion_tokens' => 200,
        ]);

        $this->assertSame(440, $micros);
    }
}
