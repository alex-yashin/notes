// Точка входа: состояние, рендер, обработчики событий.

import { CONFIG } from './config.js';
import { repo } from './repo.js';
import {
  DAY_CHOICE, activeTags, createNote, createTag, dayKey, dayOrdinals, formatDayLabel, formatTime, groupByDay,
  isValidDayKey, resolveNoteDay, tombstone, visibleNotes, yesterdayKey,
} from './notes.js';
import {
  PROVIDERS, handleAuthRedirect, isTokenValid, loadSettings, saveSettings,
  startGoogleAuth, startYandexAuth,
} from './settings.js';
import { createRemote } from './sync/index.js';
import { AuthError, syncAll } from './sync/engine.js';
import { applyTranslations, detectLanguage, getLanguage, getLocale, setLanguage, t } from './i18n.js';
import { initUpdates } from './update.js';
import { setVersionChangeHandler } from './db.js';
import { APP_VERSION } from './version.js';

const TOAST_MS = 4000;
const ERROR_TOAST_MS = 12000; // текст ошибки с инструкцией нужно успеть прочитать
const NEWLINE_RE = /[\r\n]/;
const NEWLINE_GLOBAL_RE = /\r\n|[\r\n]/g;

const $ = (selector, root = document) => root.querySelector(selector);

const el = {
  form: $('#note-form'),
  text: $('#note-text'),
  tagPicker: $('#tag-picker'),
  addTagBtn: $('#add-tag-btn'),
  newTagInput: $('#new-tag-input'),
  list: $('#notes-list'),
  clearTagsBtn: $('#clear-tags-btn'),
  dayPicker: $('#day-picker'),
  dayCustomBtn: $('#day-custom-btn'),
  dayInput: $('#day-input'),
  noteTemplate: $('#note-template'),
  syncStatus: $('#sync-status'),
  settingsBtn: $('#settings-btn'),
  dialog: $('#settings-dialog'),
  settingsForm: $('#settings-form'),
  syncInfo: $('#settings-sync-info'),

  settingsVersion: $('#settings-version'),
  toast: $('#toast'),
  updateBar: $('#update-bar'),
  updateBtn: $('#update-btn'),
};

const state = {
  notes: [],
  tags: [],
  // Выбранные в форме теги: прикрепляются к новой заметке И фильтруют список (заметки со всеми тегами).
  selectedTagIds: new Set(),
  // День новой заметки: выбор сохраняется между заметками, пока пользователь его не сменит.
  dayChoice: DAY_CHOICE.TODAY,
  customDay: null, // YYYY-MM-DD при dayChoice === CUSTOM
};

// ================= Данные =================

async function reload() {
  [state.notes, state.tags] = await Promise.all([repo.allNotes(), repo.allTags()]);
  render();
}

const tagName = (id) => state.tags.find((t) => t.id === id && !t.deleted)?.name ?? id;

// ================= Рендер =================

function render() {
  renderDayPicker();
  renderTagPicker();
  renderNotes();
}

/** Чипы дня: активный выбор, подпись «Дата» или выбранная дата, граница календаря (без будущих дней). */
function renderDayPicker() {
  for (const chip of el.dayPicker.querySelectorAll('[data-day-choice]')) {
    const active = chip.dataset.dayChoice === state.dayChoice;
    chip.classList.toggle('chip--active', active);
    chip.setAttribute('aria-pressed', String(active));
  }
  const custom = state.dayChoice === DAY_CHOICE.CUSTOM && state.customDay;
  el.dayCustomBtn.textContent = custom ? formatDayLabel(state.customDay) : t('noteDay.custom');
  el.dayInput.max = dayKey();
}

function tagChip(tag, { active = false, small = false } = {}) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `chip${active ? ' chip--active' : ''}${small ? ' chip--small' : ''}`;
  chip.dataset.tagId = tag.id;
  chip.textContent = `#${tag.name}`;
  chip.setAttribute('aria-pressed', String(active));
  return chip;
}

function renderTagPicker() {
  // Постоянные элементы: «＋ тег» и поле ввода (в начале), «✕ сбросить» (в конце); чипы тегов — между ними.
  for (const chip of el.tagPicker.querySelectorAll('[data-tag-id]')) chip.remove();
  const tags = activeTags(state.tags);
  for (const id of [...state.selectedTagIds]) {
    if (!tags.some((t) => t.id === id)) state.selectedTagIds.delete(id);
  }
  // Чипы тегов — перед кнопкой «сбросить», она всегда последняя.
  el.clearTagsBtn.before(...tags.map((tag) => tagChip(tag, { active: state.selectedTagIds.has(tag.id) })));
  el.clearTagsBtn.hidden = state.selectedTagIds.size === 0;
}

function renderNotes() {
  const groups = groupByDay(visibleNotes(state.notes, state.selectedTagIds));
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t(state.selectedTagIds.size ? 'notes.emptyFiltered' : 'notes.empty');
    el.list.replaceChildren(empty);
    return;
  }

  const today = new Date();
  const ordinals = dayOrdinals(state.notes);
  el.list.replaceChildren(...groups.map(({ day, notes }) => {
    const section = document.createElement('section');
    section.className = 'day';
    const title = document.createElement('h2');
    title.className = 'day__title';
    title.textContent = formatDayLabel(day, today);
    const list = document.createElement('ul');
    list.className = 'day__list';
    list.append(...notes.map((note) => renderNote(note, ordinals.get(note.id))));
    section.append(title, list);
    return section;
  }));
}

/** ordinal — номер заметки в дне; undefined, если заметка в дне одна (тогда номер не показывается). */
function renderNote(note, ordinal) {
  const item = el.noteTemplate.content.firstElementChild.cloneNode(true);
  item.dataset.noteId = note.id;
  const num = $('.note__num', item);
  num.textContent = ordinal ? String(ordinal) : '';
  num.dateTime = new Date(note.createdAt).toISOString();
  num.title = formatTime(note.createdAt);
  $('.note__text', item).textContent = note.text;
  $('.note__tags', item).append(...(note.tags ?? []).map((id) =>
    tagChip({ id, name: tagName(id) }, { small: true, active: state.selectedTagIds.has(id) })));
  return item;
}

// ================= Форма заметки =================

async function onSubmitNote(event) {
  event.preventDefault();
  const text = el.text.value.trim();
  if (!text) return;
  try {
    const now = new Date();
    const day = resolveNoteDay(state.dayChoice, state.customDay, now);
    await repo.saveNote(createNote(text, [...state.selectedTagIds], now, day));
    el.text.value = '';
    autoGrow();
    el.text.focus();
    await reload();
    scheduleSync();
  } catch (error) {
    showError(error);
  }
}

/** Высота поля — по тексту (сброс до auto нужен, чтобы поле и уменьшалось). После max-height — прокрутка. */
function autoGrow() {
  const field = el.text;
  field.style.height = 'auto';
  const border = field.offsetHeight - field.clientHeight;
  const maxHeight = parseFloat(getComputedStyle(field).maxHeight) || Infinity;
  const height = field.scrollHeight + border;
  field.style.height = `${Math.min(height, maxHeight)}px`;
  field.style.overflowY = height > maxHeight ? 'auto' : 'hidden';
}

/** Заметка однострочная: переводы строк (вставка, диктовка) сразу заменяем пробелами, курсор сохраняем. */
function onNoteInput() {
  const field = el.text;
  if (NEWLINE_RE.test(field.value)) {
    const caret = field.selectionStart;
    field.value = field.value.replace(NEWLINE_GLOBAL_RE, ' ');
    field.setSelectionRange(caret, caret);
  }
  autoGrow();
}

/** Enter — сохранить (как у прежнего input); не во время набора IME (подтверждение слова в азиатских раскладках). */
function onNoteKeydown(event) {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  el.form.requestSubmit();
}

// ================= День новой заметки =================

function setDayChoice(choice, customDay = null) {
  state.dayChoice = choice;
  state.customDay = choice === DAY_CHOICE.CUSTOM ? customDay : null;
  renderDayPicker();
}

/** Открывает календарь браузера. showPicker нет в старых браузерах — тогда фокус и клик по полю. */
function openDatePicker() {
  const input = el.dayInput;
  input.max = dayKey();
  input.value = state.customDay ?? (state.dayChoice === DAY_CHOICE.YESTERDAY ? yesterdayKey() : dayKey());
  try {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
  } catch (error) {
    console.warn('[app] showPicker недоступен', error);
  }
  input.focus();
  input.click();
}

function onDayPickerClick(event) {
  const chip = event.target.closest('[data-day-choice]');
  if (!chip) return;
  if (chip.dataset.dayChoice === DAY_CHOICE.CUSTOM) openDatePicker();
  else setDayChoice(chip.dataset.dayChoice);
}

/** Дата из календаря. Сегодня/вчера включают свои чипы, будущая (ввод вручную мимо max) отклоняется. */
function onDayInputChange() {
  const day = el.dayInput.value;
  if (!isValidDayKey(day)) return;
  if (day > dayKey()) {
    showToast(t('error.futureDay'));
    return;
  }
  if (day === dayKey()) setDayChoice(DAY_CHOICE.TODAY);
  else if (day === yesterdayKey()) setDayChoice(DAY_CHOICE.YESTERDAY);
  else setDayChoice(DAY_CHOICE.CUSTOM, day);
}

function showNewTagInput() {
  el.addTagBtn.hidden = true;
  el.newTagInput.hidden = false;
  el.newTagInput.value = '';
  el.newTagInput.focus();
}

function hideNewTagInput() {
  el.newTagInput.hidden = true;
  el.addTagBtn.hidden = false;
}

async function commitNewTag() {
  const raw = el.newTagInput.value;
  el.newTagInput.value = ''; // защита от повторного вызова из blur после Enter
  hideNewTagInput();
  if (!raw.trim()) return;
  try {
    const tag = createTag(raw);
    const existing = state.tags.find((t) => t.id === tag.id && !t.deleted);
    if (!existing) await repo.saveTag(tag);
    state.selectedTagIds.add(tag.id);
    await reload();
    scheduleSync();
  } catch (error) {
    showError(error);
  }
}

function onNewTagKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault(); // не отправлять форму заметки
    commitNewTag();
  } else if (event.key === 'Escape') {
    el.newTagInput.value = '';
    hideNewTagInput();
  }
}

/** Включает/выключает тег в форме — это же фильтр списка, поэтому перерисовываем всё. */
function toggleTag(id) {
  if (!state.selectedTagIds.delete(id)) state.selectedTagIds.add(id);
  render();
}

function onTagPickerClick(event) {
  const chip = event.target.closest('[data-tag-id]');
  if (chip) toggleTag(chip.dataset.tagId);
}

// ================= Список и фильтр =================

async function onListClick(event) {
  const chip = event.target.closest('[data-tag-id]');
  if (chip) {
    // Тег у заметки — тот же выбор, что и в форме: фильтрует список и будет прикреплён к новой заметке.
    toggleTag(chip.dataset.tagId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const del = event.target.closest('.note__delete');
  if (del) {
    const note = state.notes.find((n) => n.id === del.closest('.note').dataset.noteId);
    if (!note || !confirm(t('note.confirmDelete', { text: note.text }))) return;
    await repo.saveNote(tombstone(note));
    await reload();
    scheduleSync();
  }
}

function clearSelectedTags() {
  state.selectedTagIds.clear();
  render();
}

// ================= Синхронизация =================

let syncTimer = null;
let syncRunning = null;
let syncAgain = false;

/**
 * Статус в шапке. details — полный текст ошибки: показывается в подсказке и по нажатию на статус,
 * чтобы вместо безликого «ошибка синхронизации» была видна причина.
 */
function setSyncStatus(text, isError = false, details = '') {
  el.syncStatus.textContent = text;
  el.syncStatus.classList.toggle('sync-status--error', isError);
  el.syncStatus.title = details ? t('sync.details', { message: details }) : '';
  el.syncStatus.dataset.details = details;
}

function onSyncStatusClick() {
  const { details } = el.syncStatus.dataset;
  if (details) showToast(details, ERROR_TOAST_MS);
}

function scheduleSync(delay = CONFIG.AUTO_SYNC_DELAY_MS) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), delay);
}

/** Запускает синхронизацию; повторный вызов во время работы ставит ещё один проход в очередь. */
async function syncNow({ interactive = false } = {}) {
  if (syncRunning) {
    syncAgain = true;
    return syncRunning;
  }
  syncRunning = (async () => {
    try {
      do {
        syncAgain = false;
        await runSyncOnce(interactive);
      } while (syncAgain);
    } finally {
      syncRunning = null;
    }
  })();
  return syncRunning;
}

async function runSyncOnce(interactive) {
  const settings = loadSettings();
  if (settings.provider === PROVIDERS.NONE) {
    setSyncStatus('');
    return;
  }
  if (!navigator.onLine) {
    setSyncStatus(t('sync.offline'));
    return;
  }

  let remote;
  try {
    remote = createRemote(settings);
  } catch (error) {
    setSyncStatus(error.message, true, error.message);
    if (interactive) showError(error);
    return;
  }

  setSyncStatus(t('sync.running'));
  try {
    const stats = await syncAll(remote, repo, remote.id);
    console.info('[sync] готово', stats);
    if (stats.pulled) await reload();
    if (stats.errors.length) {
      const details = stats.errors.map((e) => `${e.name}: ${e.message}`).join('\n');
      setSyncStatus(t('sync.errors', { count: stats.errors.length }), true, details);
      if (interactive) showToast(details, ERROR_TOAST_MS);
    } else {
      setSyncStatus(t('sync.done', { time: formatTime(Date.now()) }));
      if (interactive) showToast(t('sync.doneToast', { pulled: stats.pulled, pushed: stats.pushed }));
    }
  } catch (error) {
    console.error('[sync]', error);
    setSyncStatus(t(error instanceof AuthError ? 'sync.authNeeded' : 'sync.failed'), true, error.message);
    if (interactive) showError(error);
  }
}

// ================= Настройки =================


function fillSettingsForm(settings) {
  const form = el.settingsForm;
  form.elements.provider.value = settings.provider;
  for (const [key, value] of Object.entries(settings.s3)) {
    const input = form.elements[`s3.${key}`];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!value;
    else input.value = value ?? '';
  }
  for (const provider of [PROVIDERS.YANDEX, PROVIDERS.GDRIVE]) {
    $(`[data-auth-state="${provider}"]`, form).textContent =
      t(isTokenValid(settings[provider]) ? 'auth.connected' : 'auth.notConnected');
  }
  el.settingsVersion.textContent = t('settings.version', { version: APP_VERSION });
  toggleProviderPanels();
  renderSyncInfo();
}


async function renderSyncInfo() {
  let text = '';
  try {
    const remote = createRemote(loadSettings());
    const syncState = remote && (await repo.getSyncState(remote.id));
    if (syncState?.lastSyncAt) {
      text = t('settings.lastSync', { time: new Date(syncState.lastSyncAt).toLocaleString(getLocale()) });
    }
  } catch {
    // не настроено — информации нет
  }
  el.syncInfo.textContent = text;
}

function toggleProviderPanels() {
  const provider = el.settingsForm.elements.provider.value;
  for (const panel of el.settingsForm.querySelectorAll('[data-provider]')) {
    panel.hidden = panel.dataset.provider !== provider;
  }
}

/** Сохраняет выбор провайдера и поля S3 из формы. */
function saveSettingsForm() {
  const form = el.settingsForm;
  const settings = loadSettings();
  settings.provider = form.elements.provider.value;
  for (const key of Object.keys(settings.s3)) {
    const input = form.elements[`s3.${key}`];
    if (!input) continue;
    settings.s3[key] = input.type === 'checkbox' ? input.checked : input.value.trim();
  }
  if (settings.provider === PROVIDERS.S3 && settings.s3.endpoint) {
    try {
      new URL(settings.s3.endpoint);
    } catch {
      throw new Error(t('settings.invalidEndpoint'));
    }
  }
  saveSettings(settings);
  return settings;
}

const SETTINGS_ACTIONS = {
  save() {
    saveSettingsForm();
    el.dialog.close();
    syncNow({ interactive: true });
  },
  'sync-now'() {
    saveSettingsForm();
    syncNow({ interactive: true }).then(renderSyncInfo);
  },
  'yandex-login'() {
    saveSettingsForm();
    startYandexAuth();
  },
  'gdrive-login'() {
    saveSettingsForm();
    startGoogleAuth();
  },

  'yandex-logout'() {
    resetCredentials(PROVIDERS.YANDEX, { token: '', expiresAt: 0 });
  },
  'gdrive-logout'() {
    resetCredentials(PROVIDERS.GDRIVE, { token: '', expiresAt: 0 });
  },

};

function resetCredentials(provider, empty) {
  const settings = saveSettingsForm();
  settings[provider] = empty;
  saveSettings(settings);
  fillSettingsForm(settings);
}

function onSettingsClick(event) {
  const button = event.target.closest('[data-action]');
  const action = button && SETTINGS_ACTIONS[button.dataset.action];
  if (!action) return;
  try {
    action();
  } catch (error) {
    showError(error);
  }
}

// ================= Уведомления =================

let toastTimer = null;

function showToast(message, duration = TOAST_MS) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), duration);
}

function showError(error) {
  console.error(error);
  showToast(error?.message ?? String(error), ERROR_TOAST_MS);
}

// ================= Инициализация =================

function bindEvents() {
  el.form.addEventListener('submit', onSubmitNote);
  el.text.addEventListener('input', onNoteInput);
  el.text.addEventListener('keydown', onNoteKeydown);
  // Ширина поля меняется при повороте экрана — меняется и число строк.
  window.addEventListener('resize', autoGrow);
  el.addTagBtn.addEventListener('click', showNewTagInput);
  el.newTagInput.addEventListener('keydown', onNewTagKey);
  el.newTagInput.addEventListener('blur', commitNewTag);
  el.tagPicker.addEventListener('click', onTagPickerClick);
  el.list.addEventListener('click', onListClick);
  el.clearTagsBtn.addEventListener('click', clearSelectedTags);
  el.dayPicker.addEventListener('click', onDayPickerClick);
  el.dayInput.addEventListener('change', onDayInputChange);
  el.syncStatus.addEventListener('click', onSyncStatusClick);

  el.settingsBtn.addEventListener('click', () => {
    fillSettingsForm(loadSettings());
    el.dialog.showModal();
  });
  el.settingsForm.addEventListener('change', (e) => e.target.name === 'provider' && toggleProviderPanels());
  el.settingsForm.addEventListener('click', onSettingsClick);

  window.addEventListener('online', () => scheduleSync(0));
  window.addEventListener('offline', () => setSyncStatus(t('sync.offline')));
  window.addEventListener('languagechange', onLanguageChange);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleSync(0));
  setInterval(() => document.visibilityState === 'visible' && syncNow().catch(() => {}), CONFIG.SYNC_INTERVAL_MS);
}

// ================= Обновления приложения =================

/** Новая версия скачана: показываем полосу. apply() переключает SW, страница перезагрузится по controllerchange. */
function showUpdateBar(apply) {
  el.updateBar.hidden = false;
  el.updateBtn.disabled = false;
  el.updateBtn.onclick = async () => {
    el.updateBtn.disabled = true;
    // Набранный, но не сохранённый текст не теряем: сохраняем его как заметку перед перезагрузкой.
    if (el.text.value.trim()) await onSubmitNote(new Event('submit'));
    apply();
  };
}

function onDatabaseVersionChange() {
  showToast(t('update.dbBlocked'), ERROR_TOAST_MS);
}

/** Браузер сменил предпочитаемый язык — переводим интерфейс без перезагрузки. */
function onLanguageChange() {
  const previous = getLanguage();
  if (setLanguage(detectLanguage()) === previous) return;
  console.info(`[i18n] язык: ${previous} → ${getLanguage()}`);
  applyTranslations();
  render();
  if (el.dialog.open) fillSettingsForm(loadSettings());
}

async function init() {
  applyTranslations();
  setVersionChangeHandler(onDatabaseVersionChange);
  const auth = handleAuthRedirect();
  bindEvents();
  await reload();
  initUpdates({ onUpdateReady: showUpdateBar });

  if (auth?.error) showToast(auth.error);
  if (auth?.provider) showToast(t('auth.success'));
  // По http:// не с localhost браузер отключает WebCrypto и service worker — предупреждаем сразу.
  if (!window.isSecureContext) {
    console.warn(`[app] небезопасный контекст: ${location.origin}`);
    showToast(t('warning.insecureContext', { origin: location.origin }), ERROR_TOAST_MS);
  }
  scheduleSync(0);
}

init().catch(showError);
