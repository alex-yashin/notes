# Заметки — PWA для однострочных заметок с тегами

Однострочные заметки с тегами, сгруппированные по дням, с фильтром по тегу.
Работает офлайн: данные хранятся в IndexedDB. По желанию можно включить синхронизацию между устройствами через
Яндекс Диск, S3 или Google Drive.
Интерфейс на русском и английском, язык выбирается по настройкам браузера.
Сборка не нужна: это чистые ES-модули.

## Быстрый старт

```bash
php -S localhost:8000 tools/dev-server.php     # приложение: http://localhost:8000/
./tools/run-tests.sh                           # автотесты в headless Chromium
php tools/release.php                          # перед коммитом: версия релиза (иначе обновление не дойдёт)
```

Публикация: push в `main` → GitHub Actions выкладывает `public/` на GitHub Pages, пользователи видят
«Доступна новая версия — Обновить» (см. [docs/DEPLOY.md](docs/DEPLOY.md)).

## Структура

```
public/   корень сайта (деплоится как есть): index.html, manifest, sw.js, css/, icons/, js/
tests/    браузерные тесты (в прод не попадают)
tools/    dev-сервер, запуск тестов, генератор иконок
docs/     техническая документация
spec/     бизнес-требования
```

## Документация

- [spec/BUSINESS_REQUIREMENTS.md](spec/BUSINESS_REQUIREMENTS.md) — бизнес-требования и критерии приёмки
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — запуск, тесты, инструменты, структура кода
- [docs/DEPLOY.md](docs/DEPLOY.md) — выкладка на GitHub Pages, доставка обновлений, совместимость версий, откат
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — `config.js`, OAuth Яндекса и Google, CORS для S3
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — протокол синхронизации
- [docs/I18N.md](docs/I18N.md) — локализация
- [AGENTS.md](AGENTS.md) — правила для AI-агентов
