// Адаптер собственного API (режим «Регистрация»). Протокол: docs/PROTOCOL.md.
// Сервер поддерживает условную запись (If-Match / If-None-Match → 412), поэтому конфликты исключены полностью.

import { AuthError } from './engine.js';
import { ensureOk, HTTP, JSON_TYPE, normalizeEtag, opContext, quoteEtag, request } from './http.js';
import { t } from '../i18n.js';

const PROVIDER_KEY = 'provider.api';

export function basicAuth(clientId, clientSecret) {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

export function createRegistrationRemote({ apiUrl, clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw new AuthError(t('error.registrationIncomplete'));
  const base = apiUrl.replace(/\/+$/, '');
  const headers = { authorization: basicAuth(clientId, clientSecret) };
  const fileUrl = (name) => `${base}/files/${encodeURIComponent(name)}`;

  return {
    id: `registration:${base}:${clientId}`,

    async list() {
      const res = await ensureOk(await request(`${base}/files`, { headers }), opContext(PROVIDER_KEY, 'op.list'));
      const { files = [] } = await res.json();
      return new Map(files.map((f) => [f.name, normalizeEtag(f.version)]));
    },

    async get(name) {
      const res = await request(fileUrl(name), { headers });
      if (res.status === HTTP.NOT_FOUND) return null;
      await ensureOk(res, opContext(PROVIDER_KEY, 'op.read', { name }));
      return { text: await res.text(), version: normalizeEtag(res.headers.get('etag')) };
    },

    async put(name, text, version) {
      const res = await request(fileUrl(name), {
        method: 'PUT',
        body: text,
        headers: {
          ...headers,
          'content-type': JSON_TYPE,
          ...(version ? { 'if-match': quoteEtag(version) } : { 'if-none-match': '*' }),
        },
      });
      await ensureOk(res, opContext(PROVIDER_KEY, 'op.write', { name }), { name });
      return { version: normalizeEtag(res.headers.get('etag')) };
    },
  };
}
