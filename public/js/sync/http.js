// Общие HTTP-хелперы для адаптеров синхронизации.

import { AuthError, ConflictError } from './engine.js';
import { t } from '../i18n.js';

export const HTTP = Object.freeze({
  NOT_FOUND: 404, CONFLICT: 409, PRECONDITION_FAILED: 412, UNAUTHORIZED: 401, NOT_IMPLEMENTED: 501,
});

const ERROR_BODY_PREVIEW = 300;

/**
 * Запрос не дошёл до сервера или ответ скрыт браузером: нет сети, DNS, TLS или CORS.
 * Браузер намеренно не сообщает причину (всегда TypeError «Failed to fetch»), поэтому текст перечисляет варианты.
 */
export class NetworkError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

/** fetch без кэша: браузерный HTTP-кэш не должен подсовывать старые версии файлов. */
export async function request(url, options = {}) {
  try {
    return await fetch(url, { cache: 'no-store', ...options });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new NetworkError(t('error.network', { host: hostOf(url) }), error);
  }
}

/** Локализованный контекст ошибки: «Яндекс Диск: скачивание day-…json». */
export const opContext = (providerKey, opKey, params = {}) => `${t(providerKey)}: ${t(opKey, params)}`;

/** Бросает типизированную ошибку для неуспешного ответа. context — уже локализованная строка. */
export async function ensureOk(response, context, { name } = {}) {
  if (response.ok) return response;
  if (response.status === HTTP.UNAUTHORIZED) throw new AuthError(t('error.reauthContext', { context }));
  if (response.status === HTTP.PRECONDITION_FAILED) throw new ConflictError(name ?? context);
  const body = (await response.text().catch(() => '')).slice(0, ERROR_BODY_PREVIEW);
  throw new Error(`${context}: HTTP ${response.status}${body ? ` — ${body}` : ''}`);
}

/** Убирает W/ и кавычки у ETag, чтобы версии из разных ответов сравнивались корректно. */
export const normalizeEtag = (etag) => (etag ? etag.replace(/^W\//, '').replace(/"/g, '') : null);
export const quoteEtag = (etag) => `"${etag}"`;

export const JSON_TYPE = 'application/json';
