// Проверка поведения в небезопасном контексте (http:// не с localhost). Результат — JSON
// { secure, uuid, subtle, sha, auth, redirectTo } в document.title («RESULT {…}»), раннер читает его через DevTools.
// Реального перехода на oauth.yandex.ru нет: settings.js уходит через подменяемый navigateTo().

import { setNavigator } from '/js/settings.js';

const NAVIGATE_STUB = { url: null };

const result = {
  secure: window.isSecureContext,
  uuid: typeof globalThis.crypto?.randomUUID,
  subtle: typeof globalThis.crypto?.subtle,
  sha: 'ok',
  auth: 'ok',
  redirectTo: null,
};

// Без WebCrypto криптофункции должны бросать понятную InsecureContextError, а не TypeError.
try {
  const { sha256Hex } = await import('/js/sync/sigv4.js');
  await sha256Hex('x');
} catch (error) {
  result.sha = error.name;
}

try {
  const { startYandexAuth } = await import('/js/settings.js');
  const restore = setNavigator((url) => { NAVIGATE_STUB.url = url; });
  try {
    startYandexAuth();
  } finally {
    restore();
  }
  result.redirectTo = NAVIGATE_STUB.url;
} catch (error) {
  result.auth = `${error.name}: ${error.message}`;
}

document.title = `RESULT ${JSON.stringify(result)}`;
