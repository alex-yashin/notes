// Минимальная обёртка над IndexedDB.

const DB_NAME = 'notes-pwa';
const DB_VERSION = 1;

export const STORES = Object.freeze({ NOTES: 'notes', TAGS: 'tags', META: 'meta' });
export const DAY_INDEX = 'day';

let dbPromise = null;
let onVersionChange = () => {};

/**
 * Новая версия приложения в другой вкладке хочет обновить схему базы (DB_VERSION). Эта вкладка закрывает
 * соединение, чтобы не блокировать миграцию, и сообщает UI, что нужна перезагрузка.
 */
export function setVersionChangeHandler(handler) {
  onVersionChange = handler;
}

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // Миграции — по версиям: if (event.oldVersion < 2) {...}. Сейчас есть только v1.
      const db = req.result;
      const notes = db.createObjectStore(STORES.NOTES, { keyPath: 'id' });
      notes.createIndex(DAY_INDEX, 'day');
      db.createObjectStore(STORES.TAGS, { keyPath: 'id' });
      db.createObjectStore(STORES.META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        console.warn('[db] схема обновляется другой вкладкой — соединение закрыто');
        db.close();
        dbPromise = null;
        onVersionChange();
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null; // следующий вызов попробует снова
      reject(req.error);
    };
    // Старая вкладка ещё держит базу старой версии: запрос дождётся её закрытия.
    req.onblocked = () => console.warn('[db] открытие заблокировано другой вкладкой');
  });
  return dbPromise;
}

/**
 * Выполняет fn(store) в одной транзакции. fn может вернуть IDBRequest —
 * тогда промис разрешится его результатом после коммита.
 */
async function withStore(name, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = (store) => withStore(store, 'readonly', (s) => s.getAll());

export const getAllByIndex = (store, index, value) =>
  withStore(store, 'readonly', (s) => s.index(index).getAll(value));

export const get = (store, key) => withStore(store, 'readonly', (s) => s.get(key));

export const putMany = (store, values) =>
  withStore(store, 'readwrite', (s) => {
    for (const value of values) s.put(value);
  });

/**
 * Для каждой записи атомарно решает, заменять ли существующую: shouldReplace(existing, incoming).
 * Защищает свежие локальные правки от перезаписи данными, пришедшими при синхронизации.
 */
export const putIf = (store, values, shouldReplace) =>
  withStore(store, 'readwrite', (s) => {
    for (const value of values) {
      const req = s.get(value.id);
      req.onsuccess = () => {
        if (shouldReplace(req.result, value)) s.put(value);
      };
    }
  });

/** Атомарное чтение-изменение-запись одной записи. */
export const update = (store, key, updater) =>
  withStore(store, 'readwrite', (s) => {
    const req = s.get(key);
    req.onsuccess = () => s.put(updater(req.result));
  });
