<?php

namespace Tests\Support;

final class Jpeg
{
    public static function make(int $width = 64, int $height = 64): string
    {
        $image = imagecreatetruecolor($width, $height);
        $color = imagecolorallocate($image, 18, 42, 92);
        imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, $color);
        ob_start();
        imagejpeg($image, null, 80);
        $binary = ob_get_clean();
        imagedestroy($image);

        return base64_encode($binary === false ? '' : $binary);
    }
}
