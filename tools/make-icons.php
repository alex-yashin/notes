<?php
// Генерирует PNG-иконки PWA (повторяет public/icons/icon.svg). Запуск: php tools/make-icons.php

declare(strict_types=1);

const SIZES = [192, 512];
const BASE = 512;
const BG = [0x4f, 0x46, 0xe5];
const OUT_DIR = __DIR__ . '/../public/icons';
// [x, y, ширина, высота, непрозрачность] в координатах 512x512
const BARS = [[112, 150, 288, 36, 1.0], [112, 238, 220, 36, 0.85], [112, 326, 150, 36, 0.7]];
const CORNER = 96;

function roundedRect($img, int $x, int $y, int $w, int $h, int $r, int $color): void
{
    imagefilledrectangle($img, $x + $r, $y, $x + $w - $r, $y + $h, $color);
    imagefilledrectangle($img, $x, $y + $r, $x + $w, $y + $h - $r, $color);
    foreach ([[$x + $r, $y + $r], [$x + $w - $r, $y + $r], [$x + $r, $y + $h - $r], [$x + $w - $r, $y + $h - $r]] as [$cx, $cy]) {
        imagefilledellipse($img, $cx, $cy, 2 * $r, 2 * $r, $color);
    }
}

foreach (SIZES as $size) {
    $k = $size / BASE;
    $img = imagecreatetruecolor($size, $size);
    imagesavealpha($img, true);
    imagefill($img, 0, 0, imagecolorallocatealpha($img, 0, 0, 0, 127));
    roundedRect($img, 0, 0, $size - 1, $size - 1, (int) round(CORNER * $k), imagecolorallocate($img, ...BG));

    foreach (BARS as [$x, $y, $w, $h, $opacity]) {
        // Смешиваем белый с фоном вручную — так нет артефактов на скруглениях.
        $mix = array_map(static fn (int $c): int => (int) round($c + (255 - $c) * $opacity), BG);
        $hk = (int) round($h * $k);
        roundedRect($img, (int) round($x * $k), (int) round($y * $k), (int) round($w * $k), $hk, intdiv($hk, 2), imagecolorallocate($img, ...$mix));
    }

    $file = sprintf('%s/icon-%d.png', OUT_DIR, $size);
    imagepng($img, $file) || fwrite(STDERR, "Не удалось записать $file\n");
    imagedestroy($img);
    echo "OK $file\n";
}
