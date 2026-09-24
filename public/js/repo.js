// Локальный репозиторий: заметки/теги + состояние синхронизации.
// Интерфейс «файлов» (listFiles/readFile/writeRecords/...) используется движком синхронизации.

import * as db from './db.js';
import { STORES, DAY_INDEX } from './db.js';
import { TAGS_FILE, dayFileName, parseFileName, pickWinner } from './notes.js';

const DIRTY_KEY = 'dirty';
const SYNC_STATE_PREFIX = 'sync:';

const newStamp = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function markDirty(name) {
  await db.update(STORES.META, DIRTY_KEY, (row) => {
    const value = { ...(row?.value ?? {}), [name]: newStamp() };
    return { key: DIRTY_KEY, value };
  });
}

export const repo = {
  allNotes: () => db.getAll(STORES.NOTES),
  allTags: () => db.getAll(STORES.TAGS),

  async saveNote(note) {
    await db.putMany(STORES.NOTES, [note]);
    await markDirty(dayFileName(note.day));
  },

  async saveTag(tag) {
    await db.putMany(STORES.TAGS, [tag]);
    await markDirty(TAGS_FILE);
  },

  // ----- интерфейс для движка синхронизации -----

  async listFiles() {
    const [notes, tags] = await Promise.all([this.allNotes(), this.allTags()]);
    const names = new Set(notes.map((n) => dayFileName(n.day)));
    if (tags.length) names.add(TAGS_FILE);
    return [...names];
  },

  async readFile(name) {
    const parsed = parseFileName(name);
    if (!parsed) return [];
    return parsed.kind === 'tags'
      ? db.getAll(STORES.TAGS)
      : db.getAllByIndex(STORES.NOTES, DAY_INDEX, parsed.day);
  },

  /** Записывает пришедшие с сервера записи (LWW по каждой записи). Не помечает файл «грязным». */
  async writeRecords(name, records) {
    const parsed = parseFileName(name);
    if (!parsed || !records.length) return;
    const store = parsed.kind === 'tags' ? STORES.TAGS : STORES.NOTES;
    await db.putIf(store, records, (existing, incoming) => pickWinner(existing, incoming) === incoming);
  },

  async getDirty() {
    return (await db.get(STORES.META, DIRTY_KEY))?.value ?? {};
  },

  /** Снимает флаг, только если файл не менялся во время синхронизации. */
  async clearDirty(name, stamp) {
    await db.update(STORES.META, DIRTY_KEY, (row) => {
      const value = { ...(row?.value ?? {}) };
      if (value[name] === stamp) delete value[name];
      return { key: DIRTY_KEY, value };
    });
  },

  async getSyncState(key) {
    return (await db.get(STORES.META, SYNC_STATE_PREFIX + key))?.value ?? null;
  },

  async setSyncState(key, value) {
    await db.putMany(STORES.META, [{ key: SYNC_STATE_PREFIX + key, value }]);
  },
};
