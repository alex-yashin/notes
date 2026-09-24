#!/usr/bin/env bash
# Запуск браузерных тестов в headless Chromium (через DevTools-порт: в режиме --dump-dom IndexedDB не работает).
# Требует запущенный dev-сервер: php -S localhost:8000 tools/dev-server.php
set -euo pipefail

APP_URL="${APP_URL:-http://localhost:8000}"
PORT="${DEVTOOLS_PORT:-9333}"
TIMEOUT_S="${TIMEOUT_S:-20}"
# Отдельный профиль на каждый запуск: иначе новый процесс подключается к ещё не завершившемуся старому.
PROFILE="${HOME}/snap/chromium/common/notes-test-$$"   # snap-chromium видит только свой каталог
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ATTEMPTS=20
# shellcheck source=chromium-lib.sh
source "$SCRIPT_DIR/chromium-lib.sh"

port_busy() { curl -sf "localhost:$PORT/json/version" >/dev/null; }
trap cleanup_browser EXIT

# Версия релиза и APP_SHELL должны соответствовать public/: иначе обновление не дойдёт до пользователей.
php "$SCRIPT_DIR/release.php" --check

# Ждём, пока предыдущий запуск освободит порт.
for _ in $(seq 1 "$ATTEMPTS"); do port_busy || break; close_browser; sleep 0.5; done
if port_busy; then
  echo "Порт $PORT занят другим процессом — задайте DEVTOOLS_PORT" >&2
  exit 1
fi

chromium --headless --no-sandbox --disable-gpu --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  about:blank >/dev/null 2>&1 &
for _ in $(seq 1 "$ATTEMPTS"); do port_busy && break; sleep 0.5; done

# id созданной вкладки — чтобы читать заголовок именно её, а не чужих вкладок.
TESTS_PATH="/tests/tests.html"
TARGET_ID=$(curl -sf -X PUT "localhost:$PORT/json/new?$APP_URL$TESTS_PATH?run=$(date +%s%N)" \
  | grep -oE '"id": *"[^"]+"' | cut -d'"' -f4)

for _ in $(seq 1 "$TIMEOUT_S"); do
  TITLE=$(curl -s "localhost:$PORT/json/list" \
    | tr -d '\n' | grep -oE "\{[^{}]*\"id\": *\"$TARGET_ID\"[^{}]*\}" \
    | grep -oE '"title": *"(PASS|FAIL)[^"]*"' | cut -d'"' -f4 || true)
  if [[ -n "$TITLE" ]]; then echo "$TITLE"; [[ "$TITLE" == PASS* ]]; exit $?; fi
  sleep 1
done
echo "Тесты не завершились за ${TIMEOUT_S}s" >&2
exit 1
