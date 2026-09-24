# Общие функции для скриптов, запускающих headless snap-Chromium. Подключается через `source`.
# Ожидает переменные PORT (DevTools-порт) и PROFILE (каталог профиля в ~/snap/chromium/common/).

CHROMIUM_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_RELEASE_ATTEMPTS=40   # × 0.25 с = до 10 с на завершение процессов браузера
PROFILE_RELEASE_STEP_S=0.25

# snap-Chromium нельзя завершить сигналом (AppArmor) — закрываем через DevTools (Browser.close).
close_browser() { php "$CHROMIUM_LIB_DIR/cdp-close.php" "$PORT" >/dev/null 2>&1 || true; }

# Удаляет профиль, только когда все процессы браузера с ним завершились:
# иначе они дописывают файлы после rm и каталог остаётся.
cleanup_browser() {
  close_browser
  for _ in $(seq 1 "$PROFILE_RELEASE_ATTEMPTS"); do
    pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null || break
    sleep "$PROFILE_RELEASE_STEP_S"
  done
  rm -rf "$PROFILE"
}
