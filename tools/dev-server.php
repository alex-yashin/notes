<?php
// Роутер для встроенного сервера PHP (только для разработки).
//   /tests/*  → tests/   (браузерные тесты; в прод не публикуются)
//   /*        → public/  (корень сайта)
// Запуск из корня проекта: php -S localhost:8000 tools/dev-server.php

declare(strict_types=1);

const PUBLIC_DIR = __DIR__ . '/../public';
const TESTS_DIR = __DIR__ . '/../tests';
const TESTS_PREFIX = '/tests/';
const INDEX_FILE = 'index.html';

const MIME_TYPES = [
    'html' => 'text/html; charset=UTF-8',
    'js' => 'text/javascript; charset=UTF-8',
    'css' => 'text/css; charset=UTF-8',
    'json' => 'application/json',
    'webmanifest' => 'application/manifest+json',
    'svg' => 'image/svg+xml',
    'png' => 'image/png',
];

/** Возвращает абсолютный путь к файлу внутри $root или null (защита от выхода за пределы каталога). */
function resolveFile(string $root, string $relative): ?string
{
    $base = realpath($root);
    $path = realpath($base . '/' . ltrim($relative, '/'));
    if ($path !== false && is_dir($path)) {
        $path = realpath($path . '/' . INDEX_FILE);
    }
    if ($path === false || $base === false || strpos($path, $base . DIRECTORY_SEPARATOR) !== 0 || !is_file($path)) {
        return null;
    }
    return $path;
}

$uriPath = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
[$root, $relative] = strpos($uriPath, TESTS_PREFIX) === 0
    ? [TESTS_DIR, substr($uriPath, strlen(TESTS_PREFIX))]
    : [PUBLIC_DIR, $uriPath];

$file = resolveFile($root, $relative);
if ($file === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "404 Not Found\n";
    error_log("[dev-server] 404 $uriPath");
    return true;
}

$extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
header('Content-Type: ' . (MIME_TYPES[$extension] ?? 'application/octet-stream'));
header('Cache-Control: no-cache');
readfile($file);
return true;
