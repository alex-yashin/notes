// Service worker: оболочка приложения доступна офлайн, обновления доставляются атомарно.
//
// Модель обновления:
//   1. Браузер при каждом открытии/проверке сверяет sw.js с сервером. CACHE_VERSION — хеш содержимого public/
//      (проставляет tools/release.php), поэтому любое изменение кода меняет sw.js.
//   2. Новый SW при установке скачивает ВЕСЬ APP_SHELL в свой кэш в обход HTTP-кэша и ждёт (waiting).
//   3. Страница показывает «Доступна новая версия — Обновить»; по нажатию шлёт SKIP_WAITING и перезагружается.
//      Без нажатия новая версия активируется, когда закроются все вкладки приложения.
//   4. Запросы оболочки отдаются только из кэша своей версии — смешения старых и новых файлов не бывает.
// Запросы к внешним API (S3, Диск, Drive, регистрация) SW не трогает.

const CACHE_VERSION = 'notes-4f9b7c17cca1';
const CACHE_PREFIX = 'notes-';
const INDEX_URL = 'index.html';
const MSG_SKIP_WAITING = 'SKIP_WAITING';
const MSG_GET_VERSION = 'GET_VERSION';
const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/config.js',
  'js/db.js',
  'js/i18n.js',
  'js/notes.js',
  'js/repo.js',
  'js/settings.js',
  'js/sync/engine.js',
  'js/sync/gdrive.js',
  'js/sync/http.js',
  'js/sync/index.js',
  'js/sync/registration.js',
  'js/sync/s3.js',
  'js/sync/sigv4.js',
  'js/sync/yandex.js',
  'js/update.js',
  'js/version.js',
];

// cache: 'reload' — мимо HTTP-кэша браузера (GitHub Pages отдаёт файлы с max-age=600),
// иначе новая версия могла бы собраться из старых файлов.
const freshRequest = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL.map(freshRequest))),
  );
  // skipWaiting не вызываем: переключение — по команде пользователя (MSG_SKIP_WAITING).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === MSG_SKIP_WAITING) {
    console.info(`[sw] активация ${CACHE_VERSION} по запросу страницы`);
    self.skipWaiting();
  } else if (event.data?.type === MSG_GET_VERSION) {
    event.ports[0]?.postMessage(CACHE_VERSION);
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Навигация (в т.ч. возврат с OAuth/регистрации с ?query и #hash) — всегда оболочка этой версии.
  const isNavigation = request.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = isNavigation
      ? await cache.match(INDEX_URL)
      : await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Не из оболочки (или кэш повреждён) — сеть без записи в кэш: версия остаётся неизменной.
    try {
      return await fetch(request);
    } catch {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
