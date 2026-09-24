#!/usr/bin/env bash
# Интеграционная проверка S3-адаптера в headless Chromium против реального бакета (пишет в префикс notes-selftest/).
# Использование: S3_KEY=… S3_SECRET=… tools/s3-live-check.sh <endpoint> <bucket> [region] [conditional=1|0]
# Требует запущенный dev-сервер: php -S localhost:8000 tools/dev-server.php
set -euo pipefail

ENDPOINT="${1:?endpoint}"; BUCKET="${2:?bucket}"; REGION="${3:-}"; CONDITIONAL="${4:-1}"
: "${S3_KEY:?задайте S3_KEY}"; : "${S3_SECRET:?задайте S3_SECRET}"
APP_URL="${APP_URL:-http://localhost:8000}"
PORT="${DEVTOOLS_PORT:-9336}"
TIMEOUT_S="${TIMEOUT_S:-40}"
PROFILE="${HOME}/snap/chromium/common/notes-s3live-$$"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=chromium-lib.sh
source "$SCRIPT_DIR/chromium-lib.sh"
trap cleanup_browser EXIT

enc() { php -r 'echo rawurlencode($argv[1]);' "$1"; }
HASH="endpoint=$(enc "$ENDPOINT")&bucket=$(enc "$BUCKET")&region=$(enc "$REGION")&key=$(enc "$S3_KEY")&secret=$(enc "$S3_SECRET")&conditional=$CONDITIONAL"

chromium --headless --no-sandbox --disable-gpu --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  about:blank >/dev/null 2>&1 &
for _ in $(seq 1 20); do curl -sf "localhost:$PORT/json/version" >/dev/null && break; sleep 0.5; done

# URL вкладки передаём через CDP /json/new — hash в нём надо закодировать целиком.
TARGET_ID=$(curl -sf -X PUT "localhost:$PORT/json/new?$(enc "$APP_URL/tests/s3-live.html#$HASH")" \
  | grep -oE '"id": *"[^"]+"' | cut -d'"' -f4)

for _ in $(seq 1 "$TIMEOUT_S"); do
  TITLE=$(curl -s "localhost:$PORT/json/list" | tr -d '\n' \
    | grep -oE "\{[^{}]*\"id\": *\"$TARGET_ID\"[^{}]*\}" \
    | grep -oE '"title": *"(PASS|FAIL)[^"]*"' | cut -d'"' -f4 || true)
  if [[ -n "$TITLE" ]]; then echo "$TITLE"; [[ "$TITLE" == PASS* ]]; exit $?; fi
  sleep 1
done
echo "Проверка не завершилась за ${TIMEOUT_S}s" >&2
exit 1
