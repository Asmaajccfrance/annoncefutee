<?php

namespace Tests\Unit;

use App\Services\Listings\DescriptionBrief;
use App\Services\OpenAI\OpenAIListingClient;
use ReflectionMethod;
use Tests\TestCase;

class DescriptionBriefTest extends TestCase
{
    public function test_the_default_brief_uses_the_mobile_listing_format(): void
    {
        $text = DescriptionBrief::write([
            'style' => 'normal',
            'hashtags' => true,
            'signature' => "Envoi rapide.\nMaison non-fumeur.",
        ], '  coton confirmé  ');

        $positions = [
            '1. Première ligne',
            '2. Une courte phrase',
            '3. Caractéristiques',
            '4. Une ligne d\'état',
            '5. Expédition',
            '6. Termine par trois à cinq hashtags',
            'Précisions du vendeur',
        ];
        $cursor = -1;
        foreach ($positions as $part) {
            $at = strpos($text, $part);
            $this->assertNotFalse($at, $part);
            $this->assertGreaterThan($cursor, $at);
            $cursor = $at;
        }

        $this->assertStringContainsString('Trois à cinq puces.', $text);
        $this->assertStringContainsString('« • »', $text);
        $this->assertStringContainsString('pointure', $text);
        $this->assertStringContainsString('Fonctionnement non testé', $text);
        $this->assertStringContainsString('État :', $text);
        $this->assertStringContainsString('Envoi rapide. Maison non-fumeur.', $text);
        $this->assertStringContainsString('Vêtement :', $text);
        $this->assertStringContainsString('Chaussure :', $text);
        $this->assertStringContainsString('Meuble :', $text);
        $this->assertStringContainsString('Électronique :', $text);
        $this->assertStringContainsString('coton confirmé', $text);
        $this->assertStringNotContainsString('*', $text);
        $this->assertStringContainsString('N\'invente aucune marque', $text);
        $this->assertStringContainsString('N\'ouvre pas deux descriptions par la même phrase.', $text);
    }

    public function test_short_style_and_disabled_hashtags_stay_inside_the_format(): void
    {
        $text = DescriptionBrief::write([
            'style' => 'court',
            'hashtags' => false,
        ], '');

        $this->assertStringContainsString('Garde chaque défaut et chaque information importante.', $text);
        $this->assertStringContainsString('N\'écris aucun hashtag', $text);
        $this->assertStringContainsString('Ne promets ni délai', $text);
        $this->assertStringNotContainsString('Envoi soigné.', $text);
        $this->assertStringNotContainsString('non-fumeur', $text);
        $this->assertStringNotContainsString('Précisions du vendeur', $text);
    }

    public function test_an_unknown_style_falls_back_to_the_normal_density(): void
    {
        $text = DescriptionBrief::write(['style' => 'poeme', 'hashtags' => true], '');

        $this->assertStringContainsString('Trois à cinq puces.', $text);
    }

    public function test_the_openai_client_sends_this_brief_unchanged(): void
    {
        $prefs = ['style' => 'detaille', 'hashtags' => true, 'signature' => 'Envoi le jour même.'];
        $method = new ReflectionMethod(OpenAIListingClient::class, 'instructions');
        $sent = $method->invoke(new OpenAIListingClient, 'taille M', $prefs);

        $this->assertSame(DescriptionBrief::write($prefs, 'taille M'), $sent);
        $this->assertStringContainsString('sans rallonger pour meubler', $sent);
        $this->assertStringContainsString('sans promettre une livraison', $sent);
    }
}
