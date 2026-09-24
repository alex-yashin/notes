// Доменная логика заметок: чистые функции без DOM и хранилищ.
// Функции представления по умолчанию используют текущий язык (i18n), но принимают локаль явно.

import { getLocale, t } from './i18n.js';

export const TAGS_FILE = 'tags.json';
export const FILE_FORMAT_VERSION = 1;
export const MAX_NOTE_LENGTH = 500;
export const MAX_TAG_LENGTH = 32;

const DAY_FILE_RE = /^day-(\d{4}-\d{2}-\d{2})\.json$/;
const DAY_FILE_PREFIX = 'day-';
const JSON_EXT = '.json';

// ---------- Дни и файлы синхронизации ----------

/** Ключ дня в локальном времени устройства: YYYY-MM-DD. */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const dayFileName = (day) => `${DAY_FILE_PREFIX}${day}${JSON_EXT}`;

/** Разбирает имя файла синхронизации. Возвращает null для чужих файлов. */
export function parseFileName(name) {
  if (name === TAGS_FILE) return { kind: 'tags' };
  const match = DAY_FILE_RE.exec(name);
  return match ? { kind: 'day', day: match[1] } : null;
}

/** Проверяет, что запись относится к указанному файлу (защита от мусора в удалённых данных). */
export function belongsToFile(name, record) {
  const parsed = parseFileName(name);
  if (!parsed || !isValidRecord(record)) return false;
  if (parsed.kind === 'tags') return record.deleted === true || typeof record.name === 'string';
  return record.day === parsed.day && (record.deleted === true || typeof record.text === 'string');
}

// ---------- Создание записей ----------

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeTagName(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .slice(0, MAX_TAG_LENGTH);
}

/**
 * id тега = нормализованное имя в нижнем регистре: одинаковые теги с разных устройств сливаются.
 * Намеренно без локали: у устройств с разным языком id должен совпадать (ср. турецкую I/ı).
 */
export const tagIdFromName = (name) => normalizeTagName(name).toLowerCase();

export function createNote(text, tagIds = [], now = new Date()) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
  if (!clean) throw new Error(t('error.emptyNote'));
  const ts = now.getTime();
  return { id: newId(), text: clean, tags: [...new Set(tagIds)], day: dayKey(now), createdAt: ts, updatedAt: ts };
}

export function createTag(rawName, now = new Date()) {
  const name = normalizeTagName(rawName);
  if (!name) throw new Error(t('error.emptyTag'));
  return { id: tagIdFromName(name), name, updatedAt: now.getTime() };
}

/** Надгробие (tombstone): нужно, чтобы удаление распространилось на другие устройства. */
export function tombstone(record, now = new Date()) {
  const base = { id: record.id, deleted: true, updatedAt: Math.max(now.getTime(), record.updatedAt + 1) };
  return record.day ? { ...base, day: record.day } : base;
}

// ---------- Слияние (CRDT: LWW-register на запись) ----------

export function isValidRecord(record) {
  return !!record && typeof record.id === 'string' && record.id !== '' && Number.isFinite(record.updatedAt);
}

/** Детерминированный выбор победителя: одинаковый результат на всех устройствах. */
export function pickWinner(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

export function mergeRecords(local, remote) {
  const byId = new Map();
  for (const record of [...local, ...remote]) {
    if (!isValidRecord(record)) continue;
    byId.set(record.id, pickWinner(byId.get(record.id), record));
  }
  return sortRecords([...byId.values()]);
}

/** Записи из merged, которых нет в local или которые отличаются. */
export function changedRecords(local, merged) {
  const localById = new Map(local.map((r) => [r.id, stableStringify(r)]));
  return merged.filter((r) => localById.get(r.id) !== stableStringify(r));
}

export function sortRecords(records) {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Каноничная сериализация файла: одинаковые данные дают одинаковый текст. */
export function serializeFile(records) {
  return stableStringify({ v: FILE_FORMAT_VERSION, records: sortRecords(records) });
}

/**
 * Файл записан более новой версией приложения, чем эта. Читать его можно не всегда, а перезаписывать нельзя:
 * старый код записал бы его в старом формате и потерял новые данные. Движок пропускает такой файл.
 */
export class FormatTooNewError extends Error {
  constructor(version, name = '') {
    super(t('error.formatTooNew', { name: name || '?', version }));
    this.name = 'FormatTooNewError';
    this.version = version;
  }
}

export function parseFile(text, name = '') {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.records)) throw new Error(t('error.badSyncFile'));
  // Старые файлы без поля v считаются v1.
  const version = Number.isFinite(data.v) ? data.v : FILE_FORMAT_VERSION;
  if (version > FILE_FORMAT_VERSION) throw new FormatTooNewError(version, name);
  return data.records.filter(isValidRecord);
}

// ---------- Представление ----------

/**
 * Неудалённые заметки, у которых есть ВСЕ теги из tagIds (логическое «И»). Пустой набор — без фильтра.
 * tagIds — любой итерируемый набор id (Set из формы, массив).
 */
export function visibleNotes(notes, tagIds = []) {
  const required = [...tagIds];
  return notes.filter((n) => !n.deleted
    && required.every((id) => Array.isArray(n.tags) && n.tags.includes(id)));
}

/** Хронологический порядок заметок: по времени создания, при равенстве — по id (одинаково на всех устройствах). */
const byCreation = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Группы [{ day, notes }]: дни — от новых к старым (сверху «Сегодня»), заметки внутри дня — от старой к новой,
 * то есть в порядке номеров dayOrdinals (1, 2, 3 …).
 */
export function groupByDay(notes) {
  const groups = new Map();
  for (const note of notes) {
    if (!groups.has(note.day)) groups.set(note.day, []);
    groups.get(note.day).push(note);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, items]) => ({ day, notes: items.sort(byCreation) }));
}

/**
 * Порядковые номера заметок в их дне: Map<id, номер>, 1 — самая ранняя заметка дня.
 * Заметки единственных в своём дне в Map не попадают (номер не показывается). Удалённые не считаются.
 * Считается по всем заметкам, а не по отфильтрованным: номер заметки не меняется от выбора тегов.
 */
export function dayOrdinals(notes) {
  const byDay = new Map();
  for (const note of notes) {
    if (note.deleted) continue;
    if (!byDay.has(note.day)) byDay.set(note.day, []);
    byDay.get(note.day).push(note);
  }
  const ordinals = new Map();
  for (const items of byDay.values()) {
    if (items.length < 2) continue;
    // Тот же порядок, что в списке дня: номера сверху вниз идут 1, 2, 3 …
    items.sort(byCreation).forEach((note, index) => ordinals.set(note.id, index + 1));
  }
  return ordinals;
}

export function activeTags(tags, locale = getLocale()) {
  return tags.filter((tag) => !tag.deleted).sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** «Сегодня» / «Вчера» / «12 марта» (год — только если не текущий). */
export function formatDayLabel(day, today = new Date(), locale = getLocale()) {
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day === dayKey(today)) return t('day.today');
  if (day === dayKey(yesterday)) return t('day.yesterday');
  const [y, m, d] = day.split('-').map(Number);
  const options = { day: 'numeric', month: 'long', ...(y !== today.getFullYear() ? { year: 'numeric' } : {}) };
  return new Date(y, m - 1, d).toLocaleDateString(locale, options);
}

export function formatTime(timestamp, locale = getLocale()) {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
