# Разработка

## Требования

- PHP ≥ 7.4 — dev-сервер, mock-API и служебные скрипты (`tools/`).
- Chromium — автотесты в headless-режиме (поддерживается snap-версия).
- Node.js и сборка не нужны: приложение написано на чистых ES-модулях.

## Запуск

```bash
php -S localhost:8000 tools/dev-server.php     # приложение: http://localhost:8000/, тесты: /tests/tests.html
php -S localhost:8081 tools/mock-api.php       # dev-сервис регистрации и API (по желанию)
```

`tools/dev-server.php` отдаёт `/tests/*` из `tests/`, всё остальное — из `public/`. Выйти за пределы этих
каталогов нельзя: `tools/`, `docs/` и `spec/` по HTTP недоступны.

## Тесты

```bash
./tools/run-tests.sh            # PASS Tests: N, passed: N, failed: 0 (код возврата 0/1)
./tools/render-check.sh ru-RU   # заголовок вкладки при заданном языке браузера: «Заметки»
./tools/render-check.sh de-DE   # fallback: «Notes»
./tools/update-e2e.sh           # E2E доставки обновлений: SW → полоса «Обновить» → новая версия (PASS update-e2e)
./tools/ui-e2e.sh               # E2E главного экрана: теги формы = фильтр (И), круглая кнопка (PASS ui-e2e)
```

`run-tests.sh` сначала выполняет `php tools/release.php --check`. После любой правки в `public/` запустите
`php tools/release.php`, иначе тесты упадут с подсказкой (см. [DEPLOY.md](DEPLOY.md)).

Тесты (`tests/tests.js`) выполняются в браузере и покрывают:
- доменную логику: заметки, теги, группировку, фильтр;
- CRDT-слияние;
- подпись SigV4 на эталонном векторе AWS;
- IndexedDB-репозиторий;
- движок синхронизации на двух виртуальных устройствах, включая гонку записи;
- локализацию.

Для быстрой отладки откройте http://localhost:8000/tests/tests.html в обычном браузере.

### Особенности headless Chromium (snap)

- В режиме `--dump-dom` IndexedDB не работает, поэтому скрипты открывают вкладку через DevTools-порт
  и читают `document.title`.
- snap-Chromium не завершается сигналом (AppArmor), поэтому браузер закрывается через CDP `Browser.close`
  (`tools/cdp-close.php`). DevTools может слушать только `::1`: скрипт пробует оба адреса.
- Профиль браузера создаётся на каждый запуск в `~/snap/chromium/common/`, потому что snap не видит `/tmp`.
  После работы профиль удаляется.

## Прочие инструменты

| Скрипт                  | Назначение |
|-------------------------|------------|
| `tools/make-icons.php`  | генерирует `public/icons/icon-{192,512}.png` (повторяет `icon.svg`, нужен GD) |
| `tools/mock-api.php`    | эталонный сервис регистрации и API хранения, см. [PROTOCOL.md](PROTOCOL.md) |
| `tools/cdp-close.php`   | закрывает Chromium через DevTools Protocol |
| `tools/release.php`     | версия релиза = хеш `public/` → `CACHE_VERSION` и `APP_VERSION`; `--check` — только проверка (и `APP_SHELL`) |
| `tools/secure-context-check.sh` | проверка работы по http:// с LAN-адреса (небезопасный контекст), см. [CONFIGURATION.md](CONFIGURATION.md) |
| `tools/ui-e2e.sh`       | E2E главного экрана в свежем профиле (`tools/ui-e2e.php`) |
| `tools/cdp-client.php`  | общий клиент Chrome DevTools Protocol для E2E-скриптов |
| `tools/update-e2e.sh`   |
| `tools/s3-live-check.sh`| интеграционная проверка S3-адаптера на реальном бакете (`tests/s3-live.html`), см. [CONFIGURATION.md](CONFIGURATION.md) |

## Структура `public/js`

```
app.js          UI, события, планирование синхронизации
notes.js        доменная логика: чистые функции, CRDT-слияние, форматирование
db.js, repo.js  IndexedDB и локальный репозиторий (флаги изменённых файлов, состояние синхронизации)
settings.js     настройки, старт OAuth/регистрации, обработка возврата
i18n.js         словари ru/en, определение языка, перевод разметки
update.js       регистрация SW, проверка обновлений, переключение на новую версию
version.js      версия релиза (проставляет tools/release.php, вручную не править)
config.js       конфигурация окружения
sync/engine.js  движок синхронизации (файлы по дням, повтор при конфликте)
sync/*.js       адаптеры: s3 (+ sigv4), yandex, gdrive, registration; http.js — общие хелперы
```

## Service worker

`public/sw.js` кэширует оболочку по списку `APP_SHELL`, каждую версию в отдельном кэше `notes-<хеш>`.
- При добавлении, удалении или переименовании файлов в `public/` обновите `APP_SHELL` вручную:
  `release.php --check` покажет, чего не хватает.
- `CACHE_VERSION` вручную не редактируется: его ставит `php tools/release.php`.

Модель обновления, гарантии и откат описаны в [DEPLOY.md](DEPLOY.md).
