<?php
// Минимальный клиент Chrome DevTools Protocol для E2E-скриптов (без зависимостей, PHP 7.4).
// Подключается через require: tools/update-e2e.php, tools/ui-e2e.php.

declare(strict_types=1);

const CDP_WAIT_STEP_US = 250000;
const CDP_WAIT_LIMIT_S = 20;
const CDP_WS_TEXT = 0x81;
const CDP_WS_MASK = 0x80;
const CDP_WS_LEN16 = 126;
const CDP_WS_LEN64 = 127;
// DevTools слушает либо 127.0.0.1, либо ::1 — пробуем оба.
const CDP_ADDRESSES = ['127.0.0.1', '[::1]'];

function cdpFail(string $message): void
{
    fwrite(STDERR, "FAIL $message\n");
    exit(1);
}

/** @return resource|null */
function cdpConnect(int $port)
{
    foreach (CDP_ADDRESSES as $address) {
        $socket = @stream_socket_client("tcp://$address:$port", $errno, $errstr, 3);
        if ($socket) {
            stream_set_timeout($socket, CDP_WAIT_LIMIT_S);
            return $socket;
        }
    }
    return null;
}

/**
 * Читает тело HTTP-ответа по Content-Length. DevTools игнорирует «Connection: close» и держит соединение,
 * поэтому чтение до EOF висло бы до таймаута. Заголовки бывают с \n вместо \r\n.
 *
 * @param resource $socket
 */
function cdpReadHttpBody($socket): string
{
    $length = null;
    while (($line = fgets($socket)) !== false && trim($line) !== '') {
        if (preg_match('/^content-length:\s*(\d+)/i', $line, $m)) {
            $length = (int) $m[1];
        }
    }
    if ($length === null) {
        return (string) stream_get_contents($socket);
    }
    $body = '';
    while (strlen($body) < $length && !feof($socket)) {
        $chunk = fread($socket, $length - strlen($body));
        if ($chunk === false || $chunk === '') {
            break;
        }
        $body .= $chunk;
    }
    return $body;
}

function cdpHttp(int $port, string $path, string $method = 'GET'): string
{
    $socket = cdpConnect($port);
    if (!$socket) {
        cdpFail("DevTools на порту $port недоступен");
    }
    fwrite($socket, "$method $path HTTP/1.1\r\nHost: localhost:$port\r\nConnection: close\r\n\r\n");
    $body = cdpReadHttpBody($socket);
    fclose($socket);
    return $body;
}

/** Минимальный WebSocket-клиент для CDP. */
final class Cdp
{
    /** @var resource */
    private $socket;
    private int $id = 0;

    public function __construct(int $port, string $path)
    {
        $socket = cdpConnect($port);
        if (!$socket) {
            cdpFail('нет соединения с DevTools');
        }
        $this->socket = $socket;
        $key = base64_encode(random_bytes(16));
        fwrite($this->socket, "GET $path HTTP/1.1\r\nHost: localhost:$port\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            . "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n");
        while (($line = fgets($this->socket)) !== false && trim($line) !== '') {
        }
    }

    public function call(string $method, array $params = []): array
    {
        $id = ++$this->id;
        $this->send((string) json_encode(['id' => $id, 'method' => $method, 'params' => (object) $params]));
        while (true) {
            $msg = json_decode($this->receive(), true);
            if (($msg['id'] ?? null) === $id) {
                if (isset($msg['error'])) {
                    cdpFail("$method: " . json_encode($msg['error']));
                }
                return $msg['result'] ?? [];
            }
        }
    }

    /** Выполняет JS в странице и возвращает значение (промисы дожидаются). Исключение в странице → null. */
    public function evaluate(string $expression)
    {
        $result = $this->call('Runtime.evaluate', ['expression' => $expression, 'awaitPromise' => true, 'returnByValue' => true]);
        if (isset($result['exceptionDetails'])) {
            return null; // страница перезагружается или ещё не готова — вызывающий код повторит
        }
        return $result['result']['value'] ?? null;
    }

    private function send(string $payload): void
    {
        $len = strlen($payload);
        if ($len < CDP_WS_LEN16) {
            $header = chr(CDP_WS_TEXT) . chr(CDP_WS_MASK | $len);
        } elseif ($len < 65536) {
            $header = chr(CDP_WS_TEXT) . chr(CDP_WS_MASK | CDP_WS_LEN16) . pack('n', $len);
        } else {
            $header = chr(CDP_WS_TEXT) . chr(CDP_WS_MASK | CDP_WS_LEN64) . pack('J', $len);
        }
        $mask = random_bytes(4);
        $masked = '';
        for ($i = 0; $i < $len; $i++) {
            $masked .= $payload[$i] ^ $mask[$i % 4];
        }
        fwrite($this->socket, $header . $mask . $masked);
    }

    private function readExact(int $n): string
    {
        $data = '';
        while (strlen($data) < $n) {
            $chunk = fread($this->socket, $n - strlen($data));
            if ($chunk === false || $chunk === '') {
                cdpFail('DevTools закрыл соединение');
            }
            $data .= $chunk;
        }
        return $data;
    }

    private function receive(): string
    {
        $message = '';
        do {
            [$b1, $b2] = array_values(unpack('C2', $this->readExact(2)));
            $fin = ($b1 & 0x80) !== 0;
            $len = $b2 & 0x7f;
            if ($len === CDP_WS_LEN16) {
                $len = unpack('n', $this->readExact(2))[1];
            } elseif ($len === CDP_WS_LEN64) {
                $len = unpack('J', $this->readExact(8))[1];
            }
            $message .= $len > 0 ? $this->readExact($len) : '';
        } while (!$fin);
        return $message;
    }
}

/** Открывает новую вкладку с url и возвращает подключённый к ней клиент. */
function cdpOpenTab(int $port, string $url): Cdp
{
    $target = json_decode(cdpHttp($port, '/json/new?' . rawurlencode($url), 'PUT'), true);
    if (!isset($target['webSocketDebuggerUrl'])) {
        cdpFail('не удалось открыть вкладку');
    }
    $cdp = new Cdp($port, (string) parse_url($target['webSocketDebuggerUrl'], PHP_URL_PATH));
    $cdp->call('Runtime.enable');
    return $cdp;
}

/** Ждёт, пока выражение в странице станет истинным; возвращает его значение. */
function cdpWaitFor(Cdp $cdp, string $expression, string $what)
{
    $deadline = microtime(true) + CDP_WAIT_LIMIT_S;
    while (microtime(true) < $deadline) {
        $value = $cdp->evaluate($expression);
        if ($value) {
            return $value;
        }
        usleep(CDP_WAIT_STEP_US);
    }
    cdpFail("не дождались: $what");
    return null;
}
