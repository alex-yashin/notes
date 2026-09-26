// Настройки подключения и обработка возврата с OAuth (Яндекс, Google).

import { CONFIG } from './config.js';
import { YANDEX_AUTH_URL } from './sync/yandex.js';
import { GOOGLE_AUTH_URL, GOOGLE_SCOPE } from './sync/gdrive.js';
import { DEFAULT_S3_PREFIX } from './sync/s3.js';
import { t } from './i18n.js';
import { newId } from './notes.js';

const STORAGE_KEY = 'notes-settings';
const PENDING_AUTH_KEY = 'notes-pending-auth';
const MS_IN_SECOND = 1000;

// Режим «Регистрация» удалён: сохранённое provider: 'registration' при загрузке становится NONE (см. loadSettings).
export const PROVIDERS = Object.freeze({
  NONE: 'none', S3: 's3', YANDEX: 'yandex', GDRIVE: 'gdrive',
});

const defaultSettings = () => ({
  provider: PROVIDERS.NONE,
  s3: {
    endpoint: '', region: '', bucket: '', prefix: DEFAULT_S3_PREFIX,
    accessKeyId: '', secretAccessKey: '', virtualHosted: false, conditionalWrites: true,
  },
  yandex: { token: '', expiresAt: 0 },
  gdrive: { token: '', expiresAt: 0 },
});

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch (error) {
    console.warn('[settings] повреждённые настройки сброшены', error);
  }
  // Берём только известные разделы: устаревшие (например, registration с client_secret) отбрасываются
  // и при следующем сохранении исчезают из localStorage.
  const merged = defaultSettings();
  for (const [key, fallback] of Object.entries(merged)) {
    if (saved[key] === undefined) continue;
    merged[key] = typeof fallback === 'object' ? { ...fallback, ...saved[key] } : saved[key];
  }
  if (!Object.values(PROVIDERS).includes(merged.provider)) {
    console.info(`[settings] неизвестный провайдер «${merged.provider}» → только на этом устройстве`);
    merged.provider = PROVIDERS.NONE;
  }
  return merged;
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function updateSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}

/** Адрес, на который возвращается OAuth: текущая страница без query/hash. */
export const appReturnUrl = () => `${location.origin}${location.pathname}`;

export function isTokenValid({ token, expiresAt }) {
  return !!token && (!expiresAt || Date.now() < expiresAt);
}

// ---------- Старт авторизации ----------

function requireConfig(name) {
  if (!CONFIG[name]) throw new Error(t('auth.missingConfig', { name }));
  return CONFIG[name];
}

// Переход на страницу авторизации. Вынесен в переменную, чтобы тесты могли проверить адрес без ухода со страницы
// (location.assign переопределить нельзя — это неконфигурируемое свойство Location).
let navigateTo = (url) => location.assign(url);

/** Только для тестов: подменяет навигацию, возвращает функцию восстановления. */
export function setNavigator(fn) {
  const previous = navigateTo;
  navigateTo = fn;
  return () => { navigateTo = previous; };
}

function startRedirect(provider, url) {
  // newId(), а не crypto.randomUUID(): тот недоступен по http:// не с localhost (небезопасный контекст).
  // newId падает обратно на crypto.getRandomValues — криптостойкий и доступный везде.
  const state = newId();
  sessionStorage.setItem(PENDING_AUTH_KEY, JSON.stringify({ provider, state }));
  url.searchParams.set('state', state);
  navigateTo(url.toString());
}

export function startYandexAuth() {
  const clientId = requireConfig('YANDEX_CLIENT_ID');
  const url = new URL(YANDEX_AUTH_URL);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', appReturnUrl());
  startRedirect(PROVIDERS.YANDEX, url);
}

export function startGoogleAuth() {
  const clientId = requireConfig('GOOGLE_CLIENT_ID');
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', appReturnUrl());
  url.searchParams.set('scope', GOOGLE_SCOPE);
  url.searchParams.set('include_granted_scopes', 'true');
  startRedirect(PROVIDERS.GDRIVE, url);
}


// ---------- Обработка возврата ----------

/**
 * Разбирает параметры возврата из hash и query, сохраняет учётные данные и чистит URL.
 * Возвращает { provider } при успехе, { error } при ошибке или null, если это обычная загрузка.
 */
export function handleAuthRedirect() {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of new URLSearchParams(location.hash.slice(1))) params.set(k, v);
  if (!params.has('state')) return null;

  const pending = JSON.parse(sessionStorage.getItem(PENDING_AUTH_KEY) ?? 'null');
  sessionStorage.removeItem(PENDING_AUTH_KEY);
  history.replaceState(null, '', appReturnUrl()); // секреты не должны остаться в адресе/истории

  if (!pending || pending.state !== params.get('state')) {
    return { error: t('auth.stateMismatch') };
  }
  if (params.has('error')) {
    return { error: t('auth.denied', { reason: params.get('error_description') || params.get('error') }) };
  }

  const settings = loadSettings();
  if (pending.provider === PROVIDERS.YANDEX || pending.provider === PROVIDERS.GDRIVE) {
    const token = params.get('access_token');
    if (!token) return { error: t('auth.noToken') };
    const expiresIn = Number(params.get('expires_in')) || 0;
    settings[pending.provider] = { token, expiresAt: expiresIn ? Date.now() + expiresIn * MS_IN_SECOND : 0 };
  } else {
    return { error: t('auth.unknownProvider') };
  }
  settings.provider = pending.provider;
  saveSettings(settings);
  console.info(`[settings] подключено: ${pending.provider}`);
  return { provider: pending.provider };
}
