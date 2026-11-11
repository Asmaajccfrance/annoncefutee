<?php

namespace Tests\Unit;

use App\Services\Listings\ListingCatalog;
use Tests\TestCase;

class ListingSchemaTest extends TestCase
{
    public function test_the_schema_stays_inside_strict_structured_outputs(): void
    {
        $schema = ListingCatalog::schema();
        $encoded = json_encode($schema);
        $this->assertIsString($encoded);

        foreach (['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern', 'format'] as $keyword) {
            $this->assertStringNotContainsString('"'.$keyword.'"', $encoded);
        }

        $this->assertSame('object', $schema['type']);
        $this->assertFalse($schema['additionalProperties']);
        $this->assertEqualsCanonicalizing(array_keys($schema['properties']), $schema['required']);
        $this->assertContains('', $schema['properties']['etat']['enum']);
    }
}
