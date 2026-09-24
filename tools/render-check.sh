#!/usr/bin/env bash
# Проверка локализации UI: открывает index.html в headless Chromium с заданным языком браузера
# и печатает заголовок вкладки (он переводится через i18n).
# Использование: tools/render-check.sh ru-RU|en-GB|de-DE
# Требует запущенный dev-сервер: php -S localhost:8000 tools/dev-server.php
set -euo pipefail

LANG_ARG="${1:?укажите язык, например ru-RU}"
APP_URL="${APP_URL:-http://localhost:8000}"
PORT="${DEVTOOLS_PORT:-9335}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Отдельный профиль на каждый запуск: иначе новый процесс подключается к ещё не завершившемуся старому.
PROFILE="${HOME}/snap/chromium/common/notes-render-$$"   # snap-chromium видит только свой каталог
WAIT_S=4
ATTEMPTS=20
# shellcheck source=chromium-lib.sh
source "$SCRIPT_DIR/chromium-lib.sh"
trap cleanup_browser EXIT

port_busy() { curl -sf "localhost:$PORT/json/version" >/dev/null; }

# Ждём, пока предыдущий запуск освободит порт.
for _ in $(seq 1 "$ATTEMPTS"); do port_busy || break; close_browser; sleep 0.5; done
if port_busy; then
  echo "Порт $PORT занят — задайте DEVTOOLS_PORT" >&2
  exit 1
fi

chromium --headless --no-sandbox --disable-gpu --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --lang="$LANG_ARG" --accept-lang="$LANG_ARG" about:blank >/dev/null 2>&1 &
for _ in $(seq 1 "$ATTEMPTS"); do port_busy && break; sleep 0.5; done

TARGET_ID=$(curl -sf -X PUT "localhost:$PORT/json/new?$APP_URL/index.html" | grep -oE '"id": *"[^"]+"' | cut -d'"' -f4)
sleep "$WAIT_S"
curl -s "localhost:$PORT/json/list" | tr -d '\n' \
  | grep -oE "\{[^{}]*\"id\": *\"$TARGET_ID\"[^{}]*\}" \
  | grep -oE '"title": *"[^"]*"' | cut -d'"' -f4
