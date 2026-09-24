// Адаптер Яндекс Диска (REST API, папка приложения app:/).
// API не поддерживает условную запись, поэтому перед записью версия проверяется
// (оптимистичная блокировка) — окно гонки сводится к долям секунды.

import { AuthError, ConflictError } from './engine.js';
import { ensureOk, HTTP, opContext, request } from './http.js';
import { sha256Hex } from './sigv4.js';
import { t } from '../i18n.js';

const PROVIDER_KEY = 'provider.yandex';
const ctx = (opKey, name) => opContext(PROVIDER_KEY, opKey, { name });

const API = 'https://cloud-api.yandex.net/v1/disk/resources';
const FOLDER = 'app:/notes';
const PAGE_SIZE = 1000;
const LIST_FIELDS = '_embedded.items.name,_embedded.items.sha256,_embedded.items.type,_embedded.total';

export const YANDEX_AUTH_URL = 'https://oauth.yandex.ru/authorize';

export function createYandexRemote({ token }) {
  if (!token) throw new AuthError(t('error.notConnected', { provider: t(PROVIDER_KEY) }));
  const headers = { authorization: `OAuth ${token}` };
  const pathOf = (name) => `${FOLDER}/${name}`;
  const api = (suffix, params) => `${API}${suffix}?${new URLSearchParams(params)}`;

  async function ensureFolder() {
    const res = await request(api('', { path: FOLDER }), { method: 'PUT', headers });
    // 201 — создана, 409 — уже существует
    if (res.status !== HTTP.CONFLICT) await ensureOk(res, ctx('op.createFolder'));
  }

  async function currentVersion(name) {
    const res = await request(api('', { path: pathOf(name), fields: 'sha256' }), { headers });
    if (res.status === HTTP.NOT_FOUND) return null;
    await ensureOk(res, ctx('op.meta', name));
    return (await res.json()).sha256 ?? null;
  }

  return {
    id: 'yandex',

    async list() {
      const files = new Map();
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const res = await request(api('', { path: FOLDER, limit: PAGE_SIZE, offset, fields: LIST_FIELDS }), { headers });
        if (res.status === HTTP.NOT_FOUND) return files; // папки ещё нет
        await ensureOk(res, ctx('op.list'));
        const embedded = (await res.json())._embedded ?? { items: [], total: 0 };
        for (const item of embedded.items) if (item.type === 'file') files.set(item.name, item.sha256 ?? null);
        if (offset + PAGE_SIZE >= embedded.total) return files;
      }
    },

    async get(name) {
      const res = await request(api('/download', { path: pathOf(name) }), { headers });
      if (res.status === HTTP.NOT_FOUND) return null;
      const { href } = await (await ensureOk(res, ctx('op.downloadLink', name))).json();
      const file = await ensureOk(await request(href), ctx('op.download', name));
      const text = await file.text();
      return { text, version: await sha256Hex(text) };
    },

    async put(name, text, version) {
      if ((await currentVersion(name)) !== version) throw new ConflictError(name);
      if (!version) await ensureFolder();

      const res = await request(api('/upload', { path: pathOf(name), overwrite: 'true' }), { headers });
      const { href, method } = await (await ensureOk(res, ctx('op.uploadLink', name))).json();
      await ensureOk(await request(href, { method: method || 'PUT', body: text }), ctx('op.upload', name));
      return { version: await sha256Hex(text) };
    },
  };
}
