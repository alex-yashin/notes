<?php
// Эталонная (dev) реализация API режима «Регистрация» и страницы внешней регистрации. См. docs/PROTOCOL.md.
// Запуск: php -S localhost:8081 tools/mock-api.php
//   /register?return_url=…&state=…  — «внешний сервис регистрации»
//   /v1/files, /v1/files/{name}     — API хранения
// Данные: sys_get_temp_dir()/notes-mock-api/<client_id>/

declare(strict_types=1);

const API_PREFIX = '/v1/files';
const NAME_RE = '/^(day-\d{4}-\d{2}-\d{2}|tags)\.json$/';
const MAX_BODY_BYTES = 1048576;
const ID_BYTES = 8;
const SECRET_BYTES = 24;

$dataDir = sys_get_temp_dir() . '/notes-mock-api';

function respond(int $status, $body = null, array $headers = []): void
{
    http_response_code($status);
    foreach ($headers as $name => $value) {
        header("$name: $value");
    }
    if (is_array($body)) {
        header('Content-Type: application/json');
        echo json_encode($body, JSON_UNESCAPED_UNICODE);
    } elseif ($body !== null) {
        echo $body;
    }
    exit;
}

function etagOf(string $content): string
{
    return hash('sha256', $content);
}

function stripEtag(string $value): string
{
    return trim(preg_replace('/^W\//', '', trim($value)), '"');
}

// ---------- CORS ----------
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type, If-Match, If-None-Match');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Expose-Headers: ETag');

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($method === 'OPTIONS') {
    respond(204);
}

// ---------- «Внешняя» регистрация ----------
if ($path === '/register') {
    $returnUrl = $_GET['return_url'] ?? '';
    if (!preg_match('#^https?://#', $returnUrl)) {
        respond(400, 'return_url is required');
    }
    $clientId = bin2hex(random_bytes(ID_BYTES));
    $secret = bin2hex(random_bytes(SECRET_BYTES));
    @mkdir("$dataDir/$clientId", 0700, true);
    file_put_contents("$dataDir/$clientId/.secret", password_hash($secret, PASSWORD_DEFAULT));
    $query = http_build_query(['client_id' => $clientId, 'client_secret' => $secret, 'state' => $_GET['state'] ?? '']);
    respond(302, null, ['Location' => $returnUrl . (strpos($returnUrl, '?') === false ? '?' : '&') . $query]);
}

// ---------- Авторизация ----------
if (strpos($path, API_PREFIX) !== 0) {
    respond(404, ['error' => 'not_found']);
}
$clientId = $_SERVER['PHP_AUTH_USER'] ?? '';
$secret = $_SERVER['PHP_AUTH_PW'] ?? '';
if (!preg_match('/^[a-f0-9]+$/', $clientId)) {
    [$clientId, $secret] = array_pad(explode(':', base64_decode(substr($_SERVER['HTTP_AUTHORIZATION'] ?? '', 6)) ?: '', 2), 2, '');
}
$dir = "$dataDir/$clientId";
if (!preg_match('/^[a-f0-9]+$/', $clientId) || !is_file("$dir/.secret") || !password_verify($secret, (string) file_get_contents("$dir/.secret"))) {
    respond(401, ['error' => 'unauthorized'], ['WWW-Authenticate' => 'Basic realm="notes"']);
}

// ---------- Список ----------
if ($path === API_PREFIX && $method === 'GET') {
    $files = [];
    foreach (glob("$dir/*.json") as $file) {
        $files[] = ['name' => basename($file), 'version' => etagOf((string) file_get_contents($file))];
    }
    respond(200, ['files' => $files]);
}

// ---------- Файл ----------
$name = rawurldecode(substr($path, strlen(API_PREFIX) + 1));
if (!preg_match(NAME_RE, $name)) {
    respond(400, ['error' => 'bad_name']);
}
$file = "$dir/$name";

if ($method === 'GET') {
    if (!is_file($file)) {
        respond(404, ['error' => 'not_found']);
    }
    $content = (string) file_get_contents($file);
    respond(200, $content, ['Content-Type' => 'application/json', 'ETag' => '"' . etagOf($content) . '"', 'Cache-Control' => 'no-store']);
}

if ($method === 'PUT') {
    $body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($body === false || strlen($body) > MAX_BODY_BYTES) {
        respond(413, ['error' => 'too_large']);
    }
    $decoded = json_decode($body, true);
    if (!is_array($decoded) || !isset($decoded['records']) || !is_array($decoded['records'])) {
        respond(400, ['error' => 'bad_format']);
    }

    // Проверка версии и запись под эксклюзивной блокировкой (CAS).
    $lock = fopen("$dir/.lock", 'c');
    flock($lock, LOCK_EX);
    $exists = is_file($file);
    $current = $exists ? etagOf((string) file_get_contents($file)) : null;
    $ifMatch = $_SERVER['HTTP_IF_MATCH'] ?? null;
    $ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? null;
    $conflict = ($ifNoneMatch === '*' && $exists) || ($ifMatch !== null && stripEtag($ifMatch) !== $current);
    if ($conflict) {
        flock($lock, LOCK_UN);
        respond(412, ['error' => 'version_mismatch']);
    }
    file_put_contents("$file.tmp", $body);
    rename("$file.tmp", $file);
    flock($lock, LOCK_UN);
    respond($exists ? 200 : 201, ['ok' => true], ['ETag' => '"' . etagOf($body) . '"']);
}

respond(405, ['error' => 'method_not_allowed']);
