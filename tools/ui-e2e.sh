#!/usr/bin/env bash
# E2E главного экрана: совмещённые форма и фильтр по тегам, круглая кнопка отправки (tools/ui-e2e.php).
# Требует запущенный dev-сервер: php -S localhost:8000 tools/dev-server.php. Профиль браузера — свежий на каждый запуск.
set -euo pipefail

PORT="${DEVTOOLS_PORT:-9343}"
PROFILE="${HOME}/snap/chromium/common/notes-ui-$$"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ATTEMPTS=20
# shellcheck source=chromium-lib.sh
source "$SCRIPT_DIR/chromium-lib.sh"
trap cleanup_browser EXIT

chromium --headless --no-sandbox --disable-gpu --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  about:blank >/dev/null 2>&1 &
for _ in $(seq 1 "$ATTEMPTS"); do curl -sf "localhost:$PORT/json/version" >/dev/null && break; sleep 0.5; done

php "$SCRIPT_DIR/ui-e2e.php" "$PORT"
