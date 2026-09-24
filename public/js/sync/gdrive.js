// Адаптер Google Drive (скрытая папка приложения appDataFolder, scope drive.appdata).
// Drive v3 не поддерживает If-Match, поэтому перед записью версия файла проверяется (оптимистичная блокировка).
// Если два устройства одновременно создали одноимённый файл, дубликаты сливаются при чтении и удаляются после записи.

import { AuthError, ConflictError } from './engine.js';
import { ensureOk, HTTP, JSON_TYPE, opContext, request } from './http.js';
import { mergeRecords, parseFile, serializeFile } from '../notes.js';
import { t } from '../i18n.js';

const PROVIDER_KEY = 'provider.gdrive';
const ctx = (opKey, name) => opContext(PROVIDER_KEY, opKey, { name });

const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const APP_FOLDER = 'appDataFolder';
const PAGE_SIZE = '1000';
const MULTIPART_BOUNDARY = 'notes-pwa-boundary';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** Версия набора одноимённых файлов: стабильна, пока ни один из них не изменился. */
const versionOf = (files) => files.map((f) => `${f.id}@${f.version}`).join(',');

export function createGoogleDriveRemote({ token }) {
  if (!token) throw new AuthError(t('error.notConnected', { provider: t(PROVIDER_KEY) }));
  const headers = { authorization: `Bearer ${token}` };

  /** name -> [{id, version}] (по возрастанию createdTime; первый — основной). */
  async function listByName(extraQuery = '') {
    const byName = new Map();
    let pageToken = null;
    do {
      const url = new URL(FILES_API);
      url.searchParams.set('spaces', APP_FOLDER);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,version)');
      url.searchParams.set('orderBy', 'createdTime');
      url.searchParams.set('pageSize', PAGE_SIZE);
      url.searchParams.set('q', `trashed = false${extraQuery}`);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const data = await (await ensureOk(await request(url, { headers }), ctx('op.list'))).json();
      for (const f of data.files ?? []) {
        if (!byName.has(f.name)) byName.set(f.name, []);
        byName.get(f.name).push({ id: f.id, version: f.version });
      }
      pageToken = data.nextPageToken ?? null;
    } while (pageToken);
    return byName;
  }

  const filesNamed = async (name) =>
    (await listByName(` and name = '${name.replace(/['\\]/g, '\\$&')}'`)).get(name) ?? [];

  async function download(id, name) {
    const res = await request(`${FILES_API}/${id}?alt=media`, { headers });
    if (res.status === HTTP.NOT_FOUND) return [];
    return parseFile(await (await ensureOk(res, ctx('op.download', name))).text());
  }

  async function create(name, text) {
    const metadata = { name, parents: [APP_FOLDER], mimeType: JSON_TYPE };
    const body = [
      `--${MULTIPART_BOUNDARY}`, `Content-Type: ${JSON_TYPE}; charset=UTF-8`, '', JSON.stringify(metadata),
      `--${MULTIPART_BOUNDARY}`, `Content-Type: ${JSON_TYPE}`, '', text,
      `--${MULTIPART_BOUNDARY}--`, '',
    ].join('\r\n');
    const res = await request(`${UPLOAD_API}?uploadType=multipart&fields=id,version`, {
      method: 'POST', body,
      headers: { ...headers, 'content-type': `multipart/related; boundary=${MULTIPART_BOUNDARY}` },
    });
    return (await ensureOk(res, ctx('op.create', name))).json();
  }

  async function update(id, text, name) {
    const res = await request(`${UPLOAD_API}/${id}?uploadType=media&fields=id,version`, {
      method: 'PATCH', body: text, headers: { ...headers, 'content-type': JSON_TYPE },
    });
    return (await ensureOk(res, ctx('op.update', name))).json();
  }

  async function remove(id) {
    const res = await request(`${FILES_API}/${id}`, { method: 'DELETE', headers });
    if (res.status !== HTTP.NOT_FOUND) await ensureOk(res, ctx('op.deleteDuplicate'));
  }

  return {
    id: 'gdrive',

    async list() {
      const result = new Map();
      for (const [name, files] of await listByName()) result.set(name, versionOf(files));
      return result;
    },

    async get(name) {
      const files = await filesNamed(name);
      if (!files.length) return null;
      const parts = await Promise.all(files.map((f) => download(f.id, name)));
      return { text: serializeFile(mergeRecords([], parts.flat())), version: versionOf(files) };
    },

    async put(name, text, version) {
      const files = await filesNamed(name);
      if ((files.length ? versionOf(files) : null) !== version) throw new ConflictError(name);
      if (!files.length) return { version: versionOf([await create(name, text)]) };

      const [primary, ...duplicates] = files;
      const updated = await update(primary.id, text, name);
      // Содержимое дубликатов уже вошло в text (слито в get), их можно удалить.
      await Promise.all(duplicates.map((d) => remove(d.id)));
      return { version: versionOf([updated]) };
    },
  };
}
