<?php
// Версия релиза = хеш содержимого public/. Проставляет её в public/sw.js (CACHE_VERSION) и public/js/version.js
// (APP_VERSION) и сверяет APP_SHELL с реальным набором файлов. Сборки нет: public/ по-прежнему деплоится как есть.
//
//   php tools/release.php          — пересчитать и записать версию (перед коммитом/деплоем)
//   php tools/release.php --check  — только проверить (код 1, если версия устарела или APP_SHELL неполон)

declare(strict_types=1);

const PUBLIC_DIR = __DIR__ . '/../public';
const SW_FILE = 'sw.js';
const VERSION_FILE = 'js/version.js';
const CACHE_PREFIX = 'notes-';
const HASH_ALGO = 'sha256';
const HASH_LENGTH = 12;
// Файлы, которые не входят в хеш: сами носители версии (иначе хеш зависел бы от себя) и служебные.
const EXCLUDED_FROM_HASH = [SW_FILE, VERSION_FILE];
// Файлы, которые не должны быть в APP_SHELL: service worker не кэширует сам себя.
const EXCLUDED_FROM_SHELL = [SW_FILE];
const IGNORED_NAMES = ['.DS_Store', 'Thumbs.db', '.nojekyll', 'CNAME', '404.html'];

const CACHE_VERSION_RE = "/const CACHE_VERSION = '[^']*';/";
const APP_VERSION_RE = "/export const APP_VERSION = '[^']*';/";
const APP_SHELL_RE = '/const APP_SHELL = \[(.*?)\];/s';
const SHELL_ITEM_RE = "/'([^']+)'/";

/** Относительные пути всех файлов public/ (разделитель «/», сортировка стабильная). */
function publicFiles(): array
{
    $root = realpath(PUBLIC_DIR);
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if (!$file->isFile() || in_array($file->getFilename(), IGNORED_NAMES, true)) {
            continue;
        }
        $files[] = str_replace(DIRECTORY_SEPARATOR, '/', substr($file->getPathname(), strlen($root) + 1));
    }
    sort($files, SORT_STRING);
    return $files;
}

/** Хеш путей и содержимого: меняется при любом изменении, добавлении или удалении файла. */
function contentHash(array $files): string
{
    $ctx = hash_init(HASH_ALGO);
    foreach ($files as $path) {
        if (in_array($path, EXCLUDED_FROM_HASH, true)) {
            continue;
        }
        hash_update($ctx, $path . "\0" . hash_file(HASH_ALGO, PUBLIC_DIR . '/' . $path) . "\n");
    }
    // sw.js тоже влияет на поведение: учитываем его без строки с версией.
    $sw = (string) file_get_contents(PUBLIC_DIR . '/' . SW_FILE);
    hash_update($ctx, SW_FILE . "\0" . hash(HASH_ALGO, (string) preg_replace(CACHE_VERSION_RE, '', $sw)));
    return substr(hash_final($ctx), 0, HASH_LENGTH);
}

/** Файлы из APP_SHELL (без './'). */
function shellFiles(string $sw): array
{
    if (!preg_match(APP_SHELL_RE, $sw, $m)) {
        fail('В sw.js не найден APP_SHELL');
    }
    preg_match_all(SHELL_ITEM_RE, $m[1], $items);
    return array_values(array_filter($items[1], static function (string $p): bool {
        return $p !== './';
    }));
}

function fail(string $message): void
{
    fwrite(STDERR, "[release] $message\n");
    exit(1);
}

function replaceOnce(string $pattern, string $replacement, string $subject, string $file): string
{
    $result = preg_replace($pattern, $replacement, $subject, 1, $count);
    if ($result === null || $count !== 1) {
        fail("Не найдена строка версии в $file");
    }
    return $result;
}

$checkOnly = in_array('--check', $argv, true);
$files = publicFiles();
$swPath = PUBLIC_DIR . '/' . SW_FILE;
$versionPath = PUBLIC_DIR . '/' . VERSION_FILE;
$sw = (string) file_get_contents($swPath);
$versionJs = (string) file_get_contents($versionPath);

// 1) APP_SHELL должен точно совпадать с файлами public/ (кроме sw.js).
$expectedShell = array_values(array_diff($files, EXCLUDED_FROM_SHELL));
$actualShell = shellFiles($sw);
$missing = array_diff($expectedShell, $actualShell);
$extra = array_diff($actualShell, $expectedShell);
$problems = [];
if ($missing) {
    $problems[] = 'нет в APP_SHELL: ' . implode(', ', $missing);
}
if ($extra) {
    $problems[] = 'в APP_SHELL, но нет в public/: ' . implode(', ', $extra);
}

// 2) Версия.
$version = contentHash($files);
$cacheVersion = CACHE_PREFIX . $version;
$swNew = replaceOnce(CACHE_VERSION_RE, "const CACHE_VERSION = '$cacheVersion';", $sw, SW_FILE);
$versionNew = replaceOnce(APP_VERSION_RE, "export const APP_VERSION = '$version';", $versionJs, VERSION_FILE);
$outdated = $swNew !== $sw || $versionNew !== $versionJs;

if ($checkOnly) {
    if ($outdated) {
        $problems[] = "версия устарела (должна быть $version) — выполните: php tools/release.php";
    }
    if ($problems) {
        fail(implode("\n[release] ", $problems));
    }
    echo "[release] OK $version\n";
    exit(0);
}

if ($problems) {
    fail(implode("\n[release] ", $problems));
}
if ($outdated) {
    file_put_contents($swPath, $swNew);
    file_put_contents($versionPath, $versionNew);
    echo "[release] версия обновлена: $version\n";
} else {
    echo "[release] версия актуальна: $version\n";
}
