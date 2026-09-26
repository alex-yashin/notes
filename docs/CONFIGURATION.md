# Настройка и деплой

## Деплой

Корень сайта — каталог `public/`. Сборка не нужна: достаточно выложить `public/` как есть на любой статический хостинг
с HTTPS (service worker работает только на `https://` или `localhost`).

Перед деплоем:
1. Заполните `public/js/config.js` (см. ниже).
2. Выполните `php tools/release.php`: скрипт проставляет версию, иначе пользователи не получат обновление.

Порядок выкладки на GitHub Pages, доставка обновлений и откат описаны в [DEPLOY.md](DEPLOY.md).

Каталоги `tests/`, `tools/`, `docs/`, `spec/` на прод не выкладываются.

### Только https:// или localhost

На `http://` с любого адреса, кроме `localhost` / `127.0.0.1` (например, `http://192.168.0.175:8000` с телефона
в локальной сети), браузер считает контекст небезопасным и отключает часть API:

| Что отключается      | Что перестаёт работать |
|-------------------------|----------------------------|
| `crypto.subtle`         | синхронизация с S3 (подпись SigV4) и Яндекс Диском (sha256 версий) |
| service worker          | офлайн-режим и доставка обновлений |
| `crypto.randomUUID`     | ничего: везде используется `newId()` с запасным вариантом на `crypto.getRandomValues` |

При таком открытии приложение показывает предупреждение. Заметки на устройстве, вход через Яндекс и Google,
режим «Регистрация» и Google Drive продолжают работать.

Для проверки с телефона:
- **GitHub Pages** (https) — проще всего;
- **проброс порта по USB** для Android: `chrome://inspect` → Port forwarding `8000 → localhost:8000`, затем на телефоне
  открыть `http://localhost:8000`;
- **HTTPS-туннель** к dev-серверу.

Проверка: `./tools/secure-context-check.sh` открывает приложение по LAN-адресу и убеждается, что вход через Яндекс
стартует, а без `crypto.subtle` выдаётся понятная ошибка.

## `public/js/config.js`

| Параметр               | Назначение |
|------------------------|------------|
| `REGISTRATION_URL`     | внешний сервис регистрации; приложение передаёт `return_url` и `state` |
| `REGISTRATION_API_URL` | API хранения для режима «Регистрация» (см. [PROTOCOL.md](PROTOCOL.md)) |
| `YANDEX_CLIENT_ID`     | client_id OAuth-приложения Яндекса |
| `GOOGLE_CLIENT_ID`     | client_id OAuth-клиента Google |
| `AUTO_SYNC_DELAY_MS`   | задержка автосинхронизации после локального изменения |
| `SYNC_INTERVAL_MS`     | период фоновой синхронизации, пока вкладка видима |

Redirect URI для всех провайдеров — адрес `index.html` приложения, например `https://notes.example.com/index.html`.
Если приложение открыто по адресу `/`, redirect придёт на `/`: зарегистрируйте оба варианта.

### Яндекс Диск

1. Создайте приложение на https://oauth.yandex.ru.
2. Платформа — «Веб-сервисы», Redirect URI — адрес приложения.
3. Права: `cloud_api:disk.app_folder` (доступ только к папке приложения).
4. Укажите client_id в `YANDEX_CLIENT_ID`.

Используется implicit flow: токен приходит в `#access_token=…`.

Файлы скачиваются и загружаются по одноразовым ссылкам (`href` из `/download` и `/upload`). Эти запросы
уходят **без `Referer`** и без токена. `downloader.disk.yandex.ru` на запрос с `Referer` стороннего сайта отвечает
`403` без CORS-заголовков, и браузер показывает это как «Failed to fetch». Без `Referer` цепочка работает:
`302` → `*.storage.yandex.net` → `200` с `Access-Control-Allow-Origin: *`.

Redirect URI должен точно совпадать с адресом, с которого открыто приложение (схема, хост, порт, путь).
Для разработки добавьте, например, `http://localhost:8000/` и `http://localhost:8000/index.html`, для прода — адреса на GitHub Pages.

### Google Drive

1. В Google Cloud Console включите Google Drive API.
2. Создайте OAuth-клиент типа «Web application», Authorized JavaScript origins — origin приложения,
   Authorized redirect URIs — адрес приложения.
3. Scope: `https://www.googleapis.com/auth/drive.appdata` (скрытая папка приложения).
4. Укажите client_id в `GOOGLE_CLIENT_ID`.

### S3-совместимое хранилище

Параметры (endpoint, регион, бакет, префикс, ключи) пользователь вводит в настройках приложения.

**CORS обязателен.** Приложение работает в браузере и обращается к S3 напрямую. Браузер пропустит
запросы, только если правило CORS бакета разрешает адрес (origin) приложения. Обойти это из кода страницы нельзя.
Если CORS не настроен, приложение покажет ошибку с точным origin, который нужно добавить. Она видна в подсказке
и по нажатию на статус синхронизации в шапке.

Требуемое правило (формат S3 XML; существующие правила бакета сохраните):

```xml
<CORSRule>
  <AllowedOrigin>https://your-app.example</AllowedOrigin>   <!-- и http://localhost:8000 для разработки -->
  <AllowedMethod>GET</AllowedMethod>
  <AllowedMethod>PUT</AllowedMethod>
  <AllowedMethod>HEAD</AllowedMethod>
  <AllowedHeader>*</AllowedHeader>
  <ExposeHeader>ETag</ExposeHeader>                          <!-- без него не работает отслеживание версий -->
  <MaxAgeSeconds>3000</MaxAgeSeconds>
</CORSRule>
```

Применить можно в панели хранилища или запросом `PUT /<bucket>?cors`: нужен заголовок `Content-MD5`, запрос
подписывается SigV4. Пример с curl ≥ 7.75:

```bash
curl -X PUT --aws-sigv4 "aws:amz:<region>:s3" --user "$KEY:$SECRET" \
  -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" -H "Content-Type: application/xml" \
  -H "Content-MD5: $(openssl md5 -binary cors.xml | base64)" \
  --data-binary @cors.xml "https://<endpoint>/<bucket>/?cors"
```

Запрос заменяет всю конфигурацию CORS бакета. Сначала скачайте текущую (`GET ?cors`) и добавьте к ней правило.

**Условная запись.** Если хранилище не поддерживает `If-Match` / `If-None-Match` при PUT (ответ 501), снимите в настройках
галочку «Условная запись». Тогда защита от одновременной записи опирается только на слияние
(см. [PROTOCOL.md](PROTOCOL.md)).

Формат ETag в `If-Match` определяется автоматически. AWS и MinIO ожидают ETag в кавычках (RFC 7232), а Ceph RGW
(в т.ч. `s3.regru.cloud`) при PUT принимает только без кавычек. Если на `If-Match` пришёл 412, а версия объекта
не изменилась, адаптер повторяет запись в другом формате и запоминает его.

### Проверка на реальном бакете

```bash
S3_KEY=… S3_SECRET=… ./tools/s3-live-check.sh https://s3.regru.cloud <bucket> [region]
```

Скрипт прогоняет в headless Chromium с origin `http://localhost:8000` полный цикл: list, условная запись,
синхронизация двух устройств. Он пишет только в префикс `notes-selftest/`. После проверки этот префикс можно удалить.

### Режим «Регистрация»

Нужны внешний сервис регистрации и API хранения, реализующие [PROTOCOL.md](PROTOCOL.md).
Для локальной разработки есть эталонная реализация `tools/mock-api.php`:

```js
// public/js/config.js
export const CONFIG = Object.freeze({
  REGISTRATION_URL: 'http://localhost:8081/register',
  REGISTRATION_API_URL: 'http://localhost:8081/v1',
  // ...
});
```
