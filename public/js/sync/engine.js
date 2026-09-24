// Движок синхронизации.
//
// Данные разбиты на файлы: day-YYYY-MM-DD.json (заметки одного дня) и tags.json.
// Устройства пишут в основном в файл «сегодня», поэтому пересечения редки, а старые дни не трогаются.
// Внутри файла — набор записей с updatedAt; слияние по id (LWW + tombstones) коммутативно и идемпотентно,
// поэтому результат одинаков на всех устройствах независимо от порядка синхронизаций.
//
// Адаптер удалённого хранилища (remote) реализует:
//   list()                      -> Map<name, version>
//   get(name)                   -> { text, version } | null
//   put(name, text, version)    -> { version }   (version=null — файл создаётся)
//                                  бросает ConflictError, если поддерживает CAS и версия устарела.

import { belongsToFile, changedRecords, mergeRecords, parseFile, parseFileName, serializeFile } from '../notes.js';
import { t } from '../i18n.js';

export class ConflictError extends Error {
  constructor(name) {
    super(t('error.conflict', { name }));
    this.name = 'ConflictError';
  }
}

export class AuthError extends Error {
  constructor(message = t('error.reauth')) {
    super(message);
    this.name = 'AuthError';
  }
}

const MAX_CONFLICT_RETRIES = 3;

/**
 * Синхронизирует все изменённые файлы. Возвращает статистику.
 * stateKey идентифицирует конкретное хранилище (известные версии файлов хранятся отдельно для каждого).
 */
export async function syncAll(remote, repo, stateKey) {
  const state = (await repo.getSyncState(stateKey)) ?? { files: {} };
  const [remoteList, dirty, localNames] = await Promise.all([remote.list(), repo.getDirty(), repo.listFiles()]);

  const names = new Set();
  // 1) изменились на сервере с прошлой синхронизации (или новые с других устройств)
  for (const [name, version] of remoteList) {
    if (parseFileName(name) && state.files[name] !== version) names.add(name);
  }
  // 2) изменились локально
  for (const name of Object.keys(dirty)) names.add(name);
  // 3) есть локально, но отсутствуют на сервере (новое хранилище, удалённый файл)
  for (const name of localNames) if (!remoteList.has(name)) names.add(name);

  const stats = { files: names.size, pulled: 0, pushed: 0, errors: [] };
  for (const name of [...names].sort()) {
    try {
      const result = await syncFile(remote, repo, name, dirty[name]);
      state.files[name] = result.version;
      stats.pulled += result.pulled;
      stats.pushed += result.pushed ? 1 : 0;
      await repo.setSyncState(stateKey, state); // прогресс сохраняется пофайлово
    } catch (error) {
      if (error instanceof AuthError) throw error; // дальше нет смысла
      console.error(`[sync] ${name}:`, error);
      stats.errors.push({ name, message: error.message });
    }
  }
  state.lastSyncAt = Date.now();
  await repo.setSyncState(stateKey, state);
  return stats;
}

/** Цикл «скачать → слить → записать локально → выгрузить, если на сервере чего-то не хватает». */
export async function syncFile(remote, repo, name, dirtyStamp) {
  for (let attempt = 1; ; attempt++) {
    const remoteFile = await remote.get(name);
    // Файл нового формата → FormatTooNewError: ничего не пишем ни локально, ни на сервер (см. notes.js).
    const remoteRecords = remoteFile ? parseFile(remoteFile.text, name).filter((r) => belongsToFile(name, r)) : [];
    const local = await repo.readFile(name);
    const merged = mergeRecords(local, remoteRecords);

    const toLocal = changedRecords(local, merged);
    await repo.writeRecords(name, toLocal);

    let version = remoteFile?.version ?? null;
    const needPush = merged.length > 0 && (!remoteFile || changedRecords(remoteRecords, merged).length > 0);
    if (needPush) {
      try {
        ({ version } = await remote.put(name, serializeFile(merged), remoteFile?.version ?? null));
      } catch (error) {
        if (error instanceof ConflictError && attempt < MAX_CONFLICT_RETRIES) {
          console.info(`[sync] ${name}: конфликт, повтор ${attempt}`);
          continue;
        }
        throw error;
      }
    }
    if (dirtyStamp) await repo.clearDirty(name, dirtyStamp);
    return { version, pulled: toLocal.length, pushed: needPush };
  }
}
