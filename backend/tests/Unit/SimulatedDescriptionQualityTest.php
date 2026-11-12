<?php

namespace Tests\Unit;

use App\Services\Listings\DescriptionBrief;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DescriptionReview;
use Tests\Support\SimulatedAnnouncements;
use Tests\TestCase;

class SimulatedDescriptionQualityTest extends TestCase
{
    #[DataProvider('articlesAndStyles')]
    public function test_a_simulated_listing_respects_the_format_and_the_known_facts(string $id, string $style): void
    {
        $article = $this->article($id);
        $brief = DescriptionBrief::write(['style' => $style, 'hashtags' => true], $article['precisions']);
        $description = SimulatedAnnouncements::render($article, $style);

        $this->assertStringContainsString('N\'ouvre pas deux descriptions par la même phrase.', $brief);
        $this->assertStringContainsString($article['precisions'], $brief);
        $this->assertSame([], DescriptionReview::problems($description, $article, $style, true, ''));
        $this->assertStringContainsString($article['type'], $article['titre']);
        if ($article['marque'] !== '') {
            $this->assertStringContainsString($article['marque'], $article['titre']);
            $this->assertStringContainsString($article['marque'], $description);
        }
        if ($article['taille'] !== '') {
            $this->assertStringContainsString($article['taille'], $description);
        }
    }

    public function test_density_changes_the_wording_without_adding_facts(): void
    {
        $article = $this->article('sweat');
        $court = SimulatedAnnouncements::render($article, 'court');
        $normal = SimulatedAnnouncements::render($article, 'normal');
        $detaille = SimulatedAnnouncements::render($article, 'detaille');

        $this->assertLessThan(strlen($normal), strlen($court));
        $this->assertLessThan(strlen($detaille), strlen($normal));
        $this->assertStringContainsString('Petit trou au coude gauche', $court);
        $this->assertStringContainsString('Capuche doublée', $court);
        $this->assertStringContainsString('Poche kangourou', $court);
        $this->assertStringContainsString('Coton', $court);
        $this->assertStringContainsString('Petit trou au coude gauche', $detaille);
        $this->assertStringContainsString('pointure 39', SimulatedAnnouncements::render($this->article('chaussures'), 'court'));
        $this->assertStringNotContainsString('taille', strtok(SimulatedAnnouncements::render($this->article('chaussures'), 'normal'), "\n") ?: '');
        $this->assertStringContainsString('Fonctionnement non testé.', SimulatedAnnouncements::render($this->article('electronique'), 'court'));
        $this->assertStringNotContainsString('Nike', $detaille);
    }

    public function test_hashtags_can_be_removed(): void
    {
        $description = SimulatedAnnouncements::render($this->article('robe'), 'normal', false);

        $this->assertSame([], DescriptionReview::problems($description, $this->article('robe'), 'normal', false, ''));
    }

    public function test_the_five_descriptions_do_not_share_a_prose_sentence(): void
    {
        $descriptions = [];
        foreach (SimulatedAnnouncements::articles() as $article) {
            $descriptions[] = SimulatedAnnouncements::render($article, 'normal');
        }

        $this->assertSame([], DescriptionReview::sharedProse($descriptions));
        $this->assertCount(5, array_unique($descriptions));
    }

    public function test_the_review_rejects_an_invented_brand_and_a_hidden_defect(): void
    {
        $article = $this->article('sweat');
        $invented = SimulatedAnnouncements::render($article, 'normal');
        $invented = str_replace('Sweat taille M', 'Sweat Nike taille M', $invented);
        $hidden = str_replace('Petit trou au coude gauche', 'Aucun défaut', $invented);

        $this->assertContains('marque_inventee', DescriptionReview::problems($invented, $article, 'normal', true, ''));
        $this->assertContains('defaut', DescriptionReview::problems($hidden, $article, 'normal', true, ''));
    }

    /**
     * @return list<array{0: string, 1: string}>
     */
    public static function articlesAndStyles(): array
    {
        $cases = [];
        foreach (SimulatedAnnouncements::articles() as $article) {
            foreach (['court', 'normal', 'detaille'] as $style) {
                $cases[] = [$article['id'], $style];
            }
        }

        return $cases;
    }

    /**
     * @return array<string, mixed>
     */
    private function article(string $id): array
    {
        foreach (SimulatedAnnouncements::articles() as $article) {
            if ($article['id'] === $id) {
                return $article;
            }
        }

        $this->fail($id);
    }
}
