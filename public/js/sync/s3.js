// Адаптер S3-совместимого хранилища (AWS S3, Yandex Object Storage, MinIO, ...).
// Требует CORS на бакете (см. docs/CONFIGURATION.md). Условная запись (If-Match / If-None-Match) — опционально.

import { encodeRfc3986, sha256Hex, signRequest } from './sigv4.js';
import {
  ensureOk, HTTP, JSON_TYPE, NetworkError, normalizeEtag, opContext, quoteEtag, request,
} from './http.js';
import { ConflictError } from './engine.js';
import { t } from '../i18n.js';

const PROVIDER_KEY = 'provider.s3';

const S3_XML_NS = 'http://s3.amazonaws.com/doc/2006-03-01/';
const LIST_PAGE_SIZE = '1000';
export const DEFAULT_S3_PREFIX = 'notes/';
export const DEFAULT_S3_REGION = 'us-east-1';

const encodePath = (path) => path.split('/').map(encodeRfc3986).join('/');

/**
 * Форматы ETag в If-Match. По RFC 7232 — в кавычках (AWS, MinIO). Часть S3-совместимых хранилищ
 * (Ceph RGW, в т.ч. s3.regru.cloud) при PUT сравнивает строку буквально и принимает только ETag без кавычек.
 */
const ETAG_FORMS = Object.freeze([
  { id: 'quoted', format: quoteEtag },
  { id: 'bare', format: (etag) => etag },
]);

export function normalizePrefix(prefix) {
  const clean = String(prefix ?? '').trim().replace(/^\/+/, '');
  return clean && !clean.endsWith('/') ? `${clean}/` : clean;
}

export function createS3Remote(cfg) {
  const endpoint = new URL(cfg.endpoint);
  const prefix = normalizePrefix(cfg.prefix ?? DEFAULT_S3_PREFIX);
  const region = cfg.region || DEFAULT_S3_REGION;
  const conditional = cfg.conditionalWrites !== false;

  /** Бакет в пути (path-style) или в поддомене (virtual-hosted). */
  function bucketUrl(key = '') {
    const base = endpoint.pathname.replace(/\/+$/, '');
    const path = encodePath(key);
    return cfg.virtualHosted
      ? `${endpoint.protocol}//${cfg.bucket}.${endpoint.host}${base}/${path}`
      : `${endpoint.protocol}//${endpoint.host}${base}/${encodeRfc3986(cfg.bucket)}/${path}`;
  }

  async function s3fetch(method, url, { body = null, headers = {} } = {}) {
    const payloadHash = await sha256Hex(body ?? '');
    const signed = await signRequest({
      method, url, headers, payloadHash, region,
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    });
    try {
      return await request(url, { method, headers: signed, body });
    } catch (error) {
      // Чаще всего — CORS бакета не разрешает адрес приложения: подсказываем, что именно настроить.
      if (error instanceof NetworkError) {
        throw new NetworkError(t('error.s3Network', { host: endpoint.host, origin: location.origin }), error.cause);
      }
      throw error;
    }
  }

  /** ETag из ответа. Без него версии файлов не отследить: обычно в CORS не указан ExposeHeaders: ETag. */
  function etagOf(res) {
    const etag = normalizeEtag(res.headers.get('etag'));
    if (!etag) throw new Error(t('error.s3NoEtag', { origin: location.origin }));
    return etag;
  }

  /** Одна попытка PUT. Возвращает новый ETag или null, если не выполнено условие (412). */
  async function putOnce(name, text, headers) {
    const res = await s3fetch('PUT', bucketUrl(prefix + name), { body: text, headers: { 'content-type': JSON_TYPE, ...headers } });
    if (res.status === HTTP.PRECONDITION_FAILED) return null;
    if (res.status === HTTP.NOT_IMPLEMENTED) throw new Error(t('error.s3NoConditional'));
    // 409 ConditionalRequestConflict: параллельная запись того же ключа — повторяем цикл слияния.
    if (res.status === HTTP.CONFLICT) throw new ConflictError(name);
    await ensureOk(res, opContext(PROVIDER_KEY, 'op.write', { name }), { name });
    return etagOf(res);
  }

  // Индекс формата ETag, который понял сервер (определяется при первом расхождении, см. put).
  let etagForm = 0;

  const remote = {
    id: `s3:${endpoint.host}/${cfg.bucket}/${prefix}`,

    async list() {
      const files = new Map();
      let token = null;
      do {
        const url = new URL(bucketUrl());
        url.searchParams.set('list-type', '2');
        url.searchParams.set('prefix', prefix);
        url.searchParams.set('max-keys', LIST_PAGE_SIZE);
        if (token) url.searchParams.set('continuation-token', token);

        const res = await ensureOk(await s3fetch('GET', url.toString()), opContext(PROVIDER_KEY, 'op.list'));
        const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
        const text = (el, tag) => el.getElementsByTagNameNS(S3_XML_NS, tag)[0]?.textContent ?? null;

        for (const item of xml.getElementsByTagNameNS(S3_XML_NS, 'Contents')) {
          const key = text(item, 'Key');
          if (key?.startsWith(prefix)) files.set(key.slice(prefix.length), normalizeEtag(text(item, 'ETag')));
        }
        token = text(xml.documentElement, 'IsTruncated') === 'true' ? text(xml.documentElement, 'NextContinuationToken') : null;
      } while (token);
      return files;
    },

    async get(name) {
      const res = await s3fetch('GET', bucketUrl(prefix + name));
      if (res.status === HTTP.NOT_FOUND) return null;
      await ensureOk(res, opContext(PROVIDER_KEY, 'op.read', { name }));
      return { text: await res.text(), version: etagOf(res) };
    },

    async put(name, text, version) {
      if (!conditional) return { version: await putOnce(name, text, {}) };

      if (!version) {
        const created = await putOnce(name, text, { 'if-none-match': '*' });
        if (created === null) throw new ConflictError(name);
        return { version: created };
      }

      // 412 на If-Match означает либо настоящий конфликт, либо что сервер не понял формат ETag.
      // Различаем по текущей версии объекта: если она совпадает с нашей — пробуем другой формат.
      for (let attempt = 0; attempt < ETAG_FORMS.length; attempt++) {
        const form = (etagForm + attempt) % ETAG_FORMS.length;
        const written = await putOnce(name, text, { 'if-match': ETAG_FORMS[form].format(version) });
        if (written !== null) {
          if (form !== etagForm) {
            console.info(`[sync] S3 ${endpoint.host}: If-Match в формате «${ETAG_FORMS[form].id}»`);
            etagForm = form;
          }
          return { version: written };
        }
        const current = await remote.get(name);
        if (current?.version !== version) throw new ConflictError(name);
      }
      throw new ConflictError(name);
    },
  };
  return remote;
}
