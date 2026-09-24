#!/usr/bin/env bash
# Проверка работы в небезопасном контексте: приложение открыто по http:// с LAN-адреса (не localhost),
# где браузер отключает crypto.randomUUID и crypto.subtle. Поднимает временный dev-сервер на LAN-адресе.
# Ожидается: вход через Яндекс стартует (редирект на oauth.yandex.ru с state), а без crypto.subtle
# криптофункции бросают InsecureContextError. Итог: "PASS secure-context" или "FAIL …" (код 0/1).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAN_IP="${LAN_IP:-$(hostname -I | awk '{print $1}')}"
APP_PORT="${APP_PORT:-8002}"
PORT="${DEVTOOLS_PORT:-9339}"
PROFILE="${HOME}/snap/chromium/common/notes-insecure-$$"
TIMEOUT_S=15
ATTEMPTS=20
YANDEX_AUTHORIZE='https://oauth.yandex.ru/authorize?'
# shellcheck source=chromium-lib.sh
source "$SCRIPT_DIR/chromium-lib.sh"

if [[ -z "$LAN_IP" || "$LAN_IP" == 127.* ]]; then
  echo "Нет LAN-адреса (задайте LAN_IP) — небезопасный контекст не воспроизвести" >&2
  exit 1
fi

php -S "$LAN_IP:$APP_PORT" "$SCRIPT_DIR/dev-server.php" >/dev/null 2>&1 &
SERVER_PID=$!
stop_server() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
cleanup() { cleanup_browser; stop_server; }
trap cleanup EXIT

for _ in $(seq 1 "$ATTEMPTS"); do curl -sf -o /dev/null "http://$LAN_IP:$APP_PORT/" && break; sleep 0.25; done

chromium --headless --no-sandbox --disable-gpu --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  about:blank >/dev/null 2>&1 &
for _ in $(seq 1 "$ATTEMPTS"); do curl -sf "localhost:$PORT/json/version" >/dev/null && break; sleep 0.5; done

TARGET_ID=$(curl -sf -X PUT "localhost:$PORT/json/new?http://$LAN_IP:$APP_PORT/tests/secure-context.html" \
  | grep -oE '"id": *"[^"]+"' | cut -d'"' -f4)

# Заголовок вкладки по id — через настоящий JSON-разбор (в заголовке сам JSON, grep/cut его режут).
tab_title() {
  curl -s "localhost:$PORT/json/list" | php -r '
    foreach ((array) json_decode(stream_get_contents(STDIN), true) as $tab) {
      if (($tab["id"] ?? "") === $argv[1]) { echo $tab["title"] ?? ""; }
    }' "$TARGET_ID"
}

RESULT=''
for _ in $(seq 1 "$TIMEOUT_S"); do
  TITLE=$(tab_title)
  [[ "$TITLE" == RESULT\ * ]] && { RESULT="${TITLE#RESULT }"; break; }
  sleep 1
done
[[ -n "$RESULT" ]] || { echo "FAIL secure-context: страница не сообщила результат за ${TIMEOUT_S}s" >&2; exit 1; }

# Разбор JSON — через php, без зависимостей. DevTools отдаёт заголовок вкладки с HTML-сущностями (&quot; &amp;).
php -r '
$r = json_decode(html_entity_decode($argv[1], ENT_QUOTES | ENT_HTML5), true);
if (!is_array($r)) { fwrite(STDERR, "FAIL secure-context: не разобран результат: $argv[1]\n"); exit(1); }
printf("context: secure=%s randomUUID=%s subtle=%s\n", var_export($r["secure"], true), $r["uuid"], $r["subtle"]);
$errors = [];
if ($r["secure"] !== false) $errors[] = "контекст оказался безопасным — проверка не имеет смысла";
if ($r["auth"] !== "ok") $errors[] = "старт входа упал: " . $r["auth"];
if (strpos((string) $r["redirectTo"], $argv[2]) !== 0 || strpos((string) $r["redirectTo"], "state=") === false)
    $errors[] = "нет редиректа на oauth.yandex.ru со state: " . var_export($r["redirectTo"], true);
if ($r["subtle"] === "undefined" && $r["sha"] !== "InsecureContextError")
    $errors[] = "без crypto.subtle ожидалась InsecureContextError, получено: " . $r["sha"];
if ($errors) { fwrite(STDERR, "FAIL secure-context: " . implode("; ", $errors) . "\n"); exit(1); }
echo "redirect: ", preg_replace("/(state=)[^&]+/", "$1…", $r["redirectTo"]), "\n";
echo "sha256 без subtle: ", $r["sha"], "\n";
echo "PASS secure-context\n";
' "$RESULT" "$YANDEX_AUTHORIZE"
