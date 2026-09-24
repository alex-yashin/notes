// Регистрация service worker и доставка обновлений: поиск новой версии, полоса «Обновить», переключение.
// Модель описана в sw.js и docs/DEPLOY.md.

const SW_URL = 'sw.js';
const MSG_SKIP_WAITING = 'SKIP_WAITING';
/** Как часто проверять обновления, пока приложение открыто (установленное PWA может жить днями). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Регистрирует SW и следит за обновлениями.
 * onUpdateReady(apply) вызывается, когда новая версия скачана и ждёт; apply() переключает на неё и перезагружает.
 */
export async function initUpdates({ onUpdateReady }) {
  if (!('serviceWorker' in navigator)) return;

  let registration;
  try {
    registration = await navigator.serviceWorker.register(SW_URL);
  } catch (error) {
    console.warn('[sw] регистрация не удалась', error);
    return;
  }

  // Первая установка (контроллера ещё не было) — не «обновление», перезагружать не нужно.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    console.info('[sw] новая версия активирована — перезагрузка');
    location.reload();
  });

  const notify = (worker) => {
    console.info('[sw] новая версия готова к установке');
    onUpdateReady(() => worker.postMessage({ type: MSG_SKIP_WAITING }));
  };

  // Новая версия могла скачаться ещё в прошлый визит и ждать.
  if (registration.waiting && hadController) notify(registration.waiting);

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) notify(worker);
    });
  });

  const checkForUpdate = () => registration.update().catch((error) => console.warn('[sw] проверка обновления', error));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkForUpdate());
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
}
