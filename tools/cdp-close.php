<?php
// Закрывает браузер через Chrome DevTools Protocol (Browser.close).
// Нужен, потому что snap-Chromium нельзя завершить сигналом из-за песочницы AppArmor.
// Запуск: php tools/cdp-close.php <port>

declare(strict_types=1);

const HOST = 'localhost';
// Chromium слушает либо 127.0.0.1, либо ::1 — пробуем оба.
const ADDRESSES = ['127.0.0.1', '[::1]'];
const TIMEOUT_S = 3;
const WS_OPCODE_TEXT = 0x81;
const WS_MASK_BIT = 0x80;
const WS_LEN_16 = 126;
const WS_MASK_BYTES = 4;

$port = (int) ($argv[1] ?? 0);
if ($port <= 0) {
    fwrite(STDERR, "Usage: php cdp-close.php <port>\n");
    exit(2);
}

/** Открывает TCP-соединение или возвращает null, если на порту никто не слушает. */
function connect(int $port)
{
    foreach (ADDRESSES as $address) {
        $socket = @stream_socket_client(sprintf('tcp://%s:%d', $address, $port), $errno, $errstr, TIMEOUT_S);
        if ($socket) {
            stream_set_timeout($socket, TIMEOUT_S);
            return $socket;
        }
    }
    return null;
}

// Chromium отвечает на /json/* с переводами строк \n вместо \r\n — HTTP-обёртка PHP его не разбирает,
// и игнорирует «Connection: close». Поэтому читаем сырой ответ ровно по Content-Length (без ожидания EOF).
$http = connect($port);
if (!$http) {
    exit(0); // браузер на этом порту не запущен
}
fwrite($http, "GET /json/version HTTP/1.1\r\nHost: " . HOST . ":$port\r\nConnection: close\r\n\r\n");
$length = null;
while (($line = fgets($http)) !== false && trim($line) !== '') {
    if (preg_match('/^content-length:\s*(\d+)/i', $line, $m)) {
        $length = (int) $m[1];
    }
}
$json = $length === null ? (string) stream_get_contents($http) : (string) fread($http, $length);
fclose($http);
$wsUrl = json_decode($json, true)['webSocketDebuggerUrl'] ?? null;
if (!$wsUrl) {
    fwrite(STDERR, "На порту $port не DevTools\n");
    exit(1);
}
$path = parse_url($wsUrl, PHP_URL_PATH);

$socket = connect($port);
if (!$socket) {
    fwrite(STDERR, "Нет соединения с портом $port\n");
    exit(1);
}

// WebSocket-рукопожатие (RFC 6455).
$key = base64_encode(random_bytes(16));
fwrite($socket, "GET $path HTTP/1.1\r\nHost: " . HOST . ":$port\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    . "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n");
$response = '';
while (($line = fgets($socket)) !== false && trim($line) !== '') {
    $response .= $line;
}
if (strpos($response, ' 101 ') === false) {
    fwrite(STDERR, "Рукопожатие не удалось: " . strtok($response, "\r\n") . "\n");
    exit(1);
}

// Клиентский кадр обязан быть замаскирован.
$payload = json_encode(['id' => 1, 'method' => 'Browser.close']);
$length = strlen($payload);
$header = chr(WS_OPCODE_TEXT) . ($length < WS_LEN_16
    ? chr(WS_MASK_BIT | $length)
    : chr(WS_MASK_BIT | WS_LEN_16) . pack('n', $length));
$mask = random_bytes(WS_MASK_BYTES);
$masked = '';
for ($i = 0; $i < $length; $i++) {
    $masked .= $payload[$i] ^ $mask[$i % WS_MASK_BYTES];
}
fwrite($socket, $header . $mask . $masked);
fread($socket, 1024); // ответ или закрытие соединения
fclose($socket);
echo "Browser on port $port closed\n";
