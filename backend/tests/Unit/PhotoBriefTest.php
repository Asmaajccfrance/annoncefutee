<?php

namespace Tests\Unit;

use App\Services\Photos\PhotoBrief;
use Tests\TestCase;

class PhotoBriefTest extends TestCase
{
    public function test_worn_modes_crop_to_the_body_part_that_wears_the_item(): void
    {
        foreach (['mannequin_femme', 'mannequin_homme', 'enfant', 'bebe'] as $mode) {
            $text = PhotoBrief::write($mode);
            $this->assertStringContainsString('seulement le haut du corps', $text, $mode);
            $this->assertStringContainsString('seulement le bras', $text, $mode);
            $this->assertStringContainsString('seulement le cou', $text, $mode);
            $this->assertStringContainsString('seulement les pieds', $text, $mode);
            $this->assertStringContainsString('sans les jambes', $text, $mode);
        }
    }

    public function test_flat_modes_keep_the_whole_item_and_no_person(): void
    {
        foreach (['studio', 'fond_blanc', 'objet'] as $mode) {
            $text = PhotoBrief::write($mode);
            $this->assertStringNotContainsString('seulement le bras', $text, $mode);
            $this->assertStringContainsString('entier dans le cadre', $text, $mode);
        }
    }

    public function test_a_free_request_is_added_without_replacing_the_item_rules(): void
    {
        $text = PhotoBrief::write('studio', "  fond\nbleu   ciel  ");
        $this->assertStringNotContainsString('fond blanc uni', $text);
        $this->assertStringContainsString('Reproduis exactement', $text);
        $this->assertStringContainsString('Remplace le fond prévu ci-dessus par celui-ci, sans modifier l\'article : fond bleu ciel.', $text);
        $blanc = PhotoBrief::write('fond_blanc', 'chambre d\'ado');
        $this->assertStringContainsString('fond blanc uni', $blanc);
        $this->assertStringNotContainsString('chambre', $blanc);
        $this->assertStringContainsString('ignore seulement cette partie.', $text);
        $this->assertSame(PhotoBrief::write('studio'), PhotoBrief::write('studio', '   '));
    }

    public function test_child_face_stays_fictional_when_it_is_in_frame(): void
    {
        foreach (['enfant', 'bebe'] as $mode) {
            $text = PhotoBrief::write($mode);
            $this->assertStringContainsString('ne ressemble à aucun enfant réel', $text);
            $this->assertStringContainsString('ne montre pas le reste du corps', $text);
        }
    }
}
