<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class JpegPhoto implements ValidationRule
{
    public const MIN_EDGE = 32;

    public const MAX_EDGE = 2048;

    public const MAX_BYTES = 1_125_000;

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('Photo illisible.');

            return;
        }

        $binary = base64_decode($value, true);
        if ($binary === false) {
            $fail('Photo illisible.');

            return;
        }

        if (strlen($binary) > self::MAX_BYTES) {
            $fail('Photo trop volumineuse.');

            return;
        }

        if (! function_exists('getimagesizefromstring')) {
            $fail('Le contrôle des photos est indisponible.');

            return;
        }

        if (! str_starts_with($binary, "\xFF\xD8\xFF")) {
            $fail('Seuls les JPEG sont acceptés.');

            return;
        }

        $info = @getimagesizefromstring($binary);
        if ($info === false || ($info[2] ?? 0) !== IMAGETYPE_JPEG) {
            $fail('Seuls les JPEG sont acceptés.');

            return;
        }

        $width = (int) $info[0];
        $height = (int) $info[1];
        if ($width < self::MIN_EDGE || $height < self::MIN_EDGE || $width > self::MAX_EDGE || $height > self::MAX_EDGE) {
            $fail('Chaque photo doit mesurer entre 32 et 2048 pixels.');
        }
    }
}
