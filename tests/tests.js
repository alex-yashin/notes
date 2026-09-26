// Браузерные тесты без зависимостей. Открыть /tests/tests.html; итог — в #summary и document.title.
// Модули приложения импортируются от корня сайта: dev-сервер отдаёт public/ как «/», а tests/ как «/tests/».

import {
  FILE_FORMAT_VERSION, FormatTooNewError, changedRecords, createNote, createTag, dayKey, dayOrdinals, formatDayLabel,
  groupByDay, mergeRecords, newId, parseFile, parseFileName, pickWinner, serializeFile, tombstone, visibleNotes,
} from '/js/notes.js';
import { InsecureContextError, sha256Hex, signRequest, EMPTY_SHA256, encodeRfc3986 } from '/js/sync/sigv4.js';
import { ConflictError, syncAll } from '/js/sync/engine.js';
import { basicAuth } from '/js/sync/registration.js';
import { createS3Remote, normalizePrefix } from '/js/sync/s3.js';
import { createYandexRemote } from '/js/sync/yandex.js';
import { NetworkError } from '/js/sync/http.js';
import {
  DICTIONARIES, FALLBACK_LANGUAGE, applyTranslations, detectLanguage, getLanguage, getLocale, setLanguage, t,
} from '/js/i18n.js';

const APP_INDEX_URL = '/index.html';

const TEST_TIMEOUT_MS = 3000;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  ожидалось: ${e}\n  получено:  ${a}`);
}
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

/** Выполняет fn на указанном языке и восстанавливает прежний. */
function withLanguage(language, fn) {
  const previous = getLanguage();
  setLanguage(language);
  try {
    return fn();
  } finally {
    setLanguage(previous);
  }
}

/** Асинхронный вариант: язык восстанавливается после завершения промиса (тесты идут последовательно). */
async function withLanguageAsync(language, fn) {
  const previous = getLanguage();
  setLanguage(language);
  try {
    return await fn();
  } finally {
    setLanguage(previous);
  }
}

// ---------------- notes.js ----------------

test('dayKey использует локальную дату', () => {
  assertEqual(dayKey(new Date(2024, 0, 5, 23, 59)), '2024-01-05');
});

test('createNote нормализует текст и дедуплицирует теги', () => {
  const n = createNote('  привет \n  мир ', ['a', 'a', 'b'], new Date(2024, 5, 10, 12));
  assertEqual([n.text, n.tags, n.day], ['привет мир', ['a', 'b'], '2024-06-10']);
});

test('createNote отклоняет пустой текст', () => {
  let thrown = false;
  try { createNote('   '); } catch { thrown = true; }
  assert(thrown, 'должно быть исключение');
});

test('createTag: id — нормализованное имя в нижнем регистре', () => {
  const t = createTag('  #Работа Дом ');
  assertEqual([t.id, t.name], ['работа-дом', 'Работа-Дом']);
});

test('dayOrdinals: номер в дне по времени создания; единственная заметка дня — без номера', () => {
  const notes = [
    { id: 'c', day: '2024-06-10', createdAt: 30 },
    { id: 'a', day: '2024-06-10', createdAt: 10 },
    { id: 'b', day: '2024-06-10', createdAt: 20 },
    { id: 'x', day: '2024-06-09', createdAt: 5 },
    { id: 'y', day: '2024-06-08', createdAt: 1 }, { id: 'z', day: '2024-06-08', createdAt: 2, deleted: true },
  ];
  const ordinals = dayOrdinals(notes);
  assertEqual(['a', 'b', 'c'].map((id) => ordinals.get(id)), [1, 2, 3], 'ранняя заметка — 1');
  assertEqual([ordinals.has('x'), ordinals.has('y'), ordinals.has('z')], [false, false, false],
    'одна заметка в дне (удалённые не считаются) — без номера');
  // Список дня идёт от старой к новой, поэтому номера сверху вниз растут.
  assertEqual(groupByDay(visibleNotes(notes))[0].notes.map((n) => ordinals.get(n.id)), [1, 2, 3]);
});

test('dayOrdinals: равное время — детерминированно по id; не зависит от порядка входа', () => {
  const notes = [{ id: 'b', day: 'd', createdAt: 1 }, { id: 'a', day: 'd', createdAt: 1 }];
  assertEqual([...dayOrdinals(notes)], [['a', 1], ['b', 2]]);
  assertEqual([...dayOrdinals([...notes].reverse())], [['a', 1], ['b', 2]]);
});

test('groupByDay: дни от новых к старым, заметки внутри дня — от старой к новой', () => {
  const notes = [
    { id: '1', day: '2024-06-09', createdAt: 1 },
    { id: '3', day: '2024-06-10', createdAt: 3 },
    { id: '2', day: '2024-06-10', createdAt: 2 },
    { id: '4', day: '2024-06-10', createdAt: 2 }, // равное время — по id
  ];
  assertEqual(groupByDay(notes).map((g) => [g.day, g.notes.map((n) => n.id)]),
    [['2024-06-10', ['2', '4', '3']], ['2024-06-09', ['1']]]);
});

test('visibleNotes: скрывает удалённые; без выбранных тегов — без фильтра', () => {
  const notes = [
    { id: '1', tags: ['a'] }, { id: '2', tags: ['b'] }, { id: '3', deleted: true, tags: ['a'] }, { id: '4', tags: ['a', 'b'] },
    { id: '5' },
  ];
  assertEqual(visibleNotes(notes).map((n) => n.id), ['1', '2', '4', '5']);
  assertEqual(visibleNotes(notes, new Set()).map((n) => n.id), ['1', '2', '4', '5']);
});

test('visibleNotes: несколько тегов — заметки со ВСЕМИ тегами (И)', () => {
  const notes = [
    { id: '1', tags: ['work'] }, { id: '2', tags: ['home'] }, { id: '3', tags: ['work', 'home'] }, { id: '4' },
  ];
  assertEqual(visibleNotes(notes, new Set(['work'])).map((n) => n.id), ['1', '3']);
  assertEqual(visibleNotes(notes, new Set(['work', 'home'])).map((n) => n.id), ['3']);
  assertEqual(visibleNotes(notes, ['work', 'nope']).map((n) => n.id), [], 'несуществующий тег — пусто');
  // id тега из нескольких символов не должен разбиваться на буквы.
  assertEqual(visibleNotes([{ id: 'x', tags: ['w'] }], new Set(['work'])).map((n) => n.id), []);
});

test('formatDayLabel (ru): Сегодня / Вчера / дата', () => withLanguage('ru', () => {
  const today = new Date(2024, 5, 10);
  assertEqual(formatDayLabel('2024-06-10', today), 'Сегодня');
  assertEqual(formatDayLabel('2024-06-09', today), 'Вчера');
  assert(formatDayLabel('2024-03-01', today).includes('марта'), 'месяц словом');
  assert(formatDayLabel('2023-03-01', today).includes('2023'), 'другой год показан');
}));

test('formatDayLabel (en): Today / Yesterday / date', () => withLanguage('en', () => {
  const today = new Date(2024, 5, 10);
  assertEqual(formatDayLabel('2024-06-10', today), 'Today');
  assertEqual(formatDayLabel('2024-06-09', today), 'Yesterday');
  assert(formatDayLabel('2024-03-01', today).includes('March'), 'месяц словом');
}));

// ---------------- i18n ----------------

test('detectLanguage: первый поддержанный язык, иначе английский', () => {
  assertEqual(detectLanguage(['ru-RU', 'en']), 'ru');
  assertEqual(detectLanguage(['en-GB', 'ru']), 'en');
  assertEqual(detectLanguage(['de-DE', 'RU_ru']), 'ru', 'пропускает неподдержанные, регистр не важен');
  assertEqual(detectLanguage(['de', 'fr']), FALLBACK_LANGUAGE);
  assertEqual(detectLanguage([]), FALLBACK_LANGUAGE);
  assertEqual(detectLanguage([undefined, '']), FALLBACK_LANGUAGE);
});

test('i18n: наборы ключей ru и en совпадают, плейсхолдеры тоже', () => {
  const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
  assertEqual(Object.keys(DICTIONARIES.ru).sort(), Object.keys(DICTIONARIES.en).sort());
  for (const key of Object.keys(DICTIONARIES.en)) {
    assertEqual(placeholders(DICTIONARIES.ru[key]), placeholders(DICTIONARIES.en[key]), key);
  }
});

test('t: подстановка параметров, неизвестный ключ, локаль', () => {
  withLanguage('en', () => {
    assertEqual(t('sync.errors', { count: 2 }), 'errors: 2');
    assertEqual(t('sync.errors'), 'errors: {count}', 'без параметра плейсхолдер остаётся');
    assertEqual(getLocale(), 'en-US');
  });
  withLanguage('ru', () => {
    assertEqual(t('sync.errors', { count: 0 }), 'ошибки: 0');
    assertEqual(getLocale(), 'ru-RU');
  });
  assertEqual(t('no.such.key'), 'no.such.key');
  assertEqual(withLanguage('de', getLanguage), FALLBACK_LANGUAGE, 'setLanguage с неподдержанным языком');
});

test('applyTranslations: текст, атрибуты и <template>', () => withLanguage('ru', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <b data-i18n="note.add">Add</b>
    <input data-i18n-placeholder="note.placeholder" data-i18n-aria-label="note.textLabel">
    <template><i data-i18n-title="note.deleteShort"></i></template>`;
  applyTranslations(root);
  assertEqual(root.querySelector('b').textContent, 'Добавить');
  assertEqual(root.querySelector('input').placeholder, 'Новая заметка…');
  assertEqual(root.querySelector('input').getAttribute('aria-label'), 'Текст заметки');
  assertEqual(root.querySelector('template').content.querySelector('i').title, 'Удалить');
}));

test('i18n: все ключи из index.html есть в словаре', async () => {
  const html = await (await fetch(APP_INDEX_URL, { cache: 'no-store' })).text();
  const keys = [...html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert(keys.length > 20, `слишком мало ключей: ${keys.length}`);
  assertEqual(keys.filter((k) => !(k in DICTIONARIES.en)), []);
});

test('index.html: кнопка «Добавить» — круглая со стрелкой, текст только в aria-label/title', async () => {
  const html = await (await fetch(APP_INDEX_URL, { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const button = doc.getElementById('note-submit');
  assert(button && button.type === 'submit', 'нет кнопки отправки #note-submit');
  assert(button.classList.contains('round-btn'), 'кнопка должна быть круглой');
  assert(button.querySelector('svg path'), 'нет SVG-стрелки');
  assertEqual(button.textContent.trim(), '', 'видимого текста нет');
  assertEqual([button.dataset.i18nAriaLabel, button.dataset.i18nTitle], ['note.add', 'note.add'], 'доступное имя локализовано');
  assert(!button.hasAttribute('data-i18n'), 'data-i18n заменил бы иконку текстом');
  assert(!doc.getElementById('filter-bar'), 'отдельной плашки фильтра больше нет');
});

test('index.html: кнопка настроек — SVG-иконка без видимого текста', async () => {
  const html = await (await fetch(APP_INDEX_URL, { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const button = doc.getElementById('settings-btn');
  assert(button, 'нет #settings-btn');
  const path = button.querySelector('svg path');
  assert(path && path.getAttribute('d').length > 100, 'нет SVG-иконки шестерёнки');
  assertEqual(button.textContent.trim(), '', 'в кнопке не должно быть текста (иначе он виден вместо иконки)');
});

test('tagIdFromName не зависит от языка интерфейса', () => {
  const ids = ['ru', 'en'].map((lang) => withLanguage(lang, () => createTag('Работа Idea').id));
  assertEqual(ids, ['работа-idea', 'работа-idea']);
});

test('сообщения об ошибках локализованы', () => {
  const message = (lang) => withLanguage(lang, () => {
    try { createNote(' '); } catch (e) { return e.message; }
    return null;
  });
  assertEqual([message('ru'), message('en')], ['Пустая заметка', 'Empty note']);
  assertEqual(withLanguage('en', () => new ConflictError('tags.json').message), 'File version conflict: tags.json');
});

test('parseFileName', () => {
  assertEqual(parseFileName('day-2024-06-10.json'), { kind: 'day', day: '2024-06-10' });
  assertEqual(parseFileName('tags.json'), { kind: 'tags' });
  assertEqual(parseFileName('../etc/passwd'), null);
});

// ---------------- CRDT ----------------

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, day: '2024-06-10', text: `t${updatedAt}`, ...extra });

test('pickWinner: LWW, при равенстве побеждает удаление', () => {
  assertEqual(pickWinner(rec('x', 1), rec('x', 2)).updatedAt, 2);
  assert(pickWinner(rec('x', 5), { id: 'x', updatedAt: 5, deleted: true }).deleted, 'tombstone выигрывает');
});

test('mergeRecords коммутативен, ассоциативен и идемпотентен', () => {
  const a = [rec('1', 1), rec('2', 5), rec('3', 3)];
  const b = [rec('2', 4), rec('3', 3, { text: 'другой' }), rec('4', 1)];
  const c = [{ id: '1', updatedAt: 9, deleted: true, day: '2024-06-10' }];
  const s = (x) => serializeFile(x);
  assertEqual(s(mergeRecords(a, b)), s(mergeRecords(b, a)), 'коммутативность');
  assertEqual(s(mergeRecords(mergeRecords(a, b), c)), s(mergeRecords(a, mergeRecords(b, c))), 'ассоциативность');
  assertEqual(s(mergeRecords(a, a)), s(a), 'идемпотентность');
});

test('mergeRecords отбрасывает мусор', () => {
  assertEqual(mergeRecords([], [null, {}, { id: 'x' }, rec('ok', 1)]).map((r) => r.id), ['ok']);
});

test('tombstone всегда новее исходной записи', () => {
  const note = rec('1', Date.now() + 100000);
  const t = tombstone(note);
  assert(t.deleted && t.updatedAt > note.updatedAt && t.day === note.day, 'tombstone некорректен');
});

test('serializeFile каноничен и обратим', () => {
  const a = [{ updatedAt: 1, id: 'b', day: 'd', text: 'x' }, { text: 'y', id: 'a', updatedAt: 2, day: 'd' }];
  const text = serializeFile(a);
  assertEqual(text, serializeFile([...a].reverse()));
  assertEqual(parseFile(text).map((r) => r.id), ['a', 'b']);
});

test('changedRecords', () => {
  assertEqual(changedRecords([rec('1', 1), rec('2', 1)], [rec('1', 1), rec('2', 2), rec('3', 1)]).map((r) => r.id), ['2', '3']);
});

// ---------------- SigV4 ----------------

test('SigV4: эталонный пример AWS (GET Object)', async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  const headers = await signRequest({
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { range: 'bytes=0-9' },
    payloadHash: EMPTY_SHA256,
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    date: new Date(Date.UTC(2013, 4, 24)),
  });
  assertEqual(headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
    'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,' +
    'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert(!('host' in headers), 'host не должен передаваться в fetch');
});

test('encodeRfc3986 и normalizePrefix', () => {
  assertEqual(encodeRfc3986("a b!'()*"), 'a%20b%21%27%28%29%2A');
  assertEqual([normalizePrefix('/notes'), normalizePrefix(''), normalizePrefix('a/')], ['notes/', '', 'a/']);
});

// ---------------- S3-адаптер (fetch подменяется фейковым сервером) ----------------

const S3_TEST_CFG = Object.freeze({
  endpoint: 'https://s3.test', bucket: 'b', region: 'ru-1', prefix: 'notes/', accessKeyId: 'AK', secretAccessKey: 'SK',
});

/**
 * Подменяет globalThis.fetch на время fn. handler(request) → Response | Promise<Response> | throw.
 * Возвращает журнал запросов { method, path, headers }.
 */
async function withFakeFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call = {
      method: options.method ?? 'GET', url: String(url), path: new URL(url).pathname, headers, body: options.body,
      referrerPolicy: options.referrerPolicy, credentials: options.credentials,
    };
    calls.push(call);
    return handler(call);
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

/** Фейковый объект S3, который принимает If-Match только в заданном формате (как Ceph RGW / reg.ru). */
function fakeS3Object({ acceptsQuoted }) {
  const state = { etag: 'e1', body: '{"records":[],"v":1}' };
  const handler = ({ method, headers, body }) => {
    if (method === 'GET') return new Response(state.body, { status: 200, headers: { etag: `"${state.etag}"` } });
    const ifMatch = headers['if-match'];
    const expected = acceptsQuoted ? `"${state.etag}"` : state.etag;
    if (ifMatch !== undefined && ifMatch !== expected) return new Response('', { status: 412 });
    state.etag = `e${Number(state.etag.slice(1)) + 1}`;
    state.body = body;
    return new Response('', { status: 200, headers: { etag: `"${state.etag}"` } });
  };
  return { state, handler };
}

test('S3: If-Match без кавычек (Ceph/reg.ru) — определяется автоматически и запоминается', async () => {
  const { state, handler } = fakeS3Object({ acceptsQuoted: false });
  const remote = createS3Remote(S3_TEST_CFG);
  let v2;
  let v3;
  const calls = await withFakeFetch(handler, async () => {
    ({ version: v2 } = await remote.put('tags.json', 'x', 'e1'));
    ({ version: v3 } = await remote.put('tags.json', 'y', v2));
  });
  assertEqual([v2, v3, state.body], ['e2', 'e3', 'y']);
  const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.headers['if-match']);
  assertEqual(puts, ['"e1"', 'e1', 'e2'], 'после первого определения — сразу нужный формат');
});

test('S3: If-Match в кавычках (AWS) работает с первой попытки', async () => {
  const { handler } = fakeS3Object({ acceptsQuoted: true });
  const remote = createS3Remote(S3_TEST_CFG);
  const calls = await withFakeFetch(handler, () => remote.put('tags.json', 'x', 'e1'));
  assertEqual(calls.map((c) => `${c.method} ${c.headers['if-match'] ?? ''}`), ['PUT "e1"']);
});

test('S3: настоящий конфликт версий → ConflictError, файл не перезаписан', async () => {
  const { state, handler } = fakeS3Object({ acceptsQuoted: false });
  state.etag = 'e7'; // другое устройство уже записало новую версию
  const remote = createS3Remote(S3_TEST_CFG);
  let error = null;
  const calls = await withFakeFetch(handler, () => remote.put('tags.json', 'mine', 'e1').catch((e) => { error = e; }));
  assert(error instanceof ConflictError, `ожидался ConflictError, получено ${error}`);
  assertEqual(state.etag, 'e7');
  assertEqual(calls.map((c) => c.method), ['PUT', 'GET'], 'после 412 сверяется текущая версия, второй формат не пробуется');
});

test('S3: сетевая ошибка / CORS → понятное сообщение с адресом приложения', async () => {
  const remote = createS3Remote(S3_TEST_CFG);
  const messages = {};
  for (const lang of ['ru', 'en']) {
    await withFakeFetch(() => { throw new TypeError('Failed to fetch'); }, () => withLanguageAsync(lang, () =>
      remote.list().catch((e) => { messages[lang] = e; })));
  }
  for (const [lang, error] of Object.entries(messages)) {
    assert(error instanceof NetworkError, `${lang}: ожидался NetworkError`);
    assert(error.message.includes('s3.test') && error.message.includes(location.origin) && error.message.includes('CORS'),
      `${lang}: в сообщении нужны хост, origin и CORS: ${error.message}`);
  }
});

test('S3: нет ETag в ответе (CORS без ExposeHeader) → понятная ошибка', async () => {
  const remote = createS3Remote(S3_TEST_CFG);
  let error = null;
  await withFakeFetch(() => new Response('{"records":[],"v":1}', { status: 200 }), () => withLanguageAsync('en', () =>
    remote.get('tags.json').catch((e) => { error = e; })));
  assert(error && error.message.includes('ExposeHeader ETag'), `ожидалась подсказка про ETag: ${error?.message}`);
});

// ---------------- Небезопасный контекст (http:// не с localhost: нет randomUUID и subtle) ----------------

/** Выполняет fn с «урезанным» crypto, как в небезопасном контексте: есть только getRandomValues. */
async function withInsecureCrypto(fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (array) => real.getRandomValues(array) },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
}

test('небезопасный контекст: newId работает без crypto.randomUUID', () => withInsecureCrypto(() => {
  assert(typeof globalThis.crypto.randomUUID === 'undefined', 'подмена crypto не сработала');
  const ids = new Set(Array.from({ length: 100 }, newId));
  assertEqual(ids.size, 100, 'id уникальны');
  assert([...ids].every((id) => /^[0-9a-f]{32}$/.test(id)), '128 случайных бит в hex');
}));

/** Модули, которые генерируют id/state: вызывать crypto.randomUUID напрямую нельзя (только через newId). */
const NO_RANDOM_UUID_MODULES = ['/js/settings.js', '/js/app.js', '/js/repo.js', '/js/sync/engine.js'];
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('небезопасный контекст: модули не вызывают crypto.randomUUID() напрямую', async () => {
  const offenders = [];
  for (const url of NO_RANDOM_UUID_MODULES) {
    const code = stripComments(await (await fetch(url, { cache: 'no-store' })).text());
    if (/crypto\.randomUUID\s*\(/.test(code)) offenders.push(url);
  }
  assertEqual(offenders, [], 'используйте newId() из notes.js');
});

test('небезопасный контекст: без crypto.subtle — понятная InsecureContextError', () => withInsecureCrypto(async () => {
  let error = null;
  await withLanguageAsync('ru', () => sha256Hex('x').catch((e) => { error = e; }));
  assert(error instanceof InsecureContextError, `ожидалась InsecureContextError, получено ${error}`);
  assert(error.message.includes('https://') && error.message.includes('localhost'), `подсказка: ${error.message}`);
}));

// ---------------- Яндекс Диск ----------------

const YANDEX_DOWNLOAD_HREF = 'https://downloader.disk.yandex.ru/disk/abc?filename=day.json';
const YANDEX_UPLOAD_HREF = 'https://uploader.disk.yandex.net/upload-target/xyz';

/** Фейковый Яндекс Диск: cloud-api выдаёт одноразовые ссылки, downloader/uploader отдают и принимают файл. */
function fakeYandexDisk(fileText) {
  return ({ url, method }) => {
    const { host, pathname } = new URL(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (host === 'cloud-api.yandex.net' && pathname.endsWith('/download')) return json({ href: YANDEX_DOWNLOAD_HREF });
    if (host === 'cloud-api.yandex.net' && pathname.endsWith('/upload')) return json({ href: YANDEX_UPLOAD_HREF, method: 'PUT' });
    if (host === 'cloud-api.yandex.net' && method === 'PUT') return new Response('{}', { status: 201 }); // папка создана
    if (host === 'cloud-api.yandex.net') return new Response('{}', { status: 404 }); // метаданные: файла ещё нет
    if (url === YANDEX_DOWNLOAD_HREF && method === 'GET') return new Response(fileText, { status: 200 });
    if (url === YANDEX_UPLOAD_HREF && method === 'PUT') return new Response('', { status: 201 });
    return new Response('', { status: 500 });
  };
}

test('Яндекс Диск: скачивание и загрузка по одноразовой ссылке — без Referer и без токена', async () => {
  const remote = createYandexRemote({ token: 'secret-token' });
  const fileText = serializeFile([]);
  let got = null;
  const calls = await withFakeFetch(fakeYandexDisk(fileText), async () => {
    got = await remote.get('day-2026-09-26.json');
    await remote.put('day-2026-09-26.json', fileText, null);
  });
  assertEqual(got.text, fileText, 'файл скачан');

  const links = calls.filter((c) => c.url === YANDEX_DOWNLOAD_HREF || c.url === YANDEX_UPLOAD_HREF);
  assertEqual(links.map((c) => c.method), ['GET', 'PUT'], 'оба запроса по ссылкам выполнены');
  for (const c of links) {
    // downloader.disk.yandex.ru с Referer отвечает 403 без CORS → «Failed to fetch» в браузере.
    assertEqual(c.referrerPolicy, 'no-referrer', `${c.method}: Referer не отправляется`);
    assert(!('authorization' in c.headers), `${c.method}: токен не уходит на хосты хранилища`);
  }
  const api = calls.filter((c) => new URL(c.url).host === 'cloud-api.yandex.net');
  assert(api.length > 0 && api.every((c) => c.headers.authorization === 'OAuth secret-token'), 'к cloud-api — с токеном');
});

test('basicAuth поддерживает не-ASCII', () => {
  assertEqual(basicAuth('id', 'пароль'), `Basic ${btoa(unescape(encodeURIComponent('id:пароль')))}`);
});

// ---------------- Движок синхронизации ----------------

/** Хранилище в памяти с CAS; onBeforePut позволяет вклиниться «другому устройству». */
function memoryRemote() {
  const files = new Map();
  let counter = 0;
  const remote = {
    id: 'mem', files, puts: 0, onBeforePut: null,
    async list() {
      return new Map([...files].map(([n, f]) => [n, f.version]));
    },
    async get(name) {
      return files.get(name) ?? null;
    },
    async put(name, text, version) {
      if (remote.onBeforePut) {
        const hook = remote.onBeforePut;
        remote.onBeforePut = null;
        await hook();
      }
      if ((files.get(name)?.version ?? null) !== version) throw new ConflictError(name);
      remote.puts++;
      const next = { text, version: `v${++counter}` };
      files.set(name, next);
      return { version: next.version };
    },
  };
  return remote;
}

/** Локальный репозиторий в памяти с тем же интерфейсом, что и repo.js. */
function memoryRepo() {
  const notes = new Map();
  const tags = new Map();
  const dirty = {};
  const syncState = {};
  let stamp = 0;
  return {
    notes,
    async saveNote(n) { notes.set(n.id, n); dirty[`day-${n.day}.json`] = ++stamp; },
    async saveTag(t) { tags.set(t.id, t); dirty['tags.json'] = ++stamp; },
    async listFiles() {
      const names = new Set([...notes.values()].map((n) => `day-${n.day}.json`));
      if (tags.size) names.add('tags.json');
      return [...names];
    },
    async readFile(name) {
      const p = parseFileName(name);
      return p.kind === 'tags' ? [...tags.values()] : [...notes.values()].filter((n) => n.day === p.day);
    },
    async writeRecords(name, records) {
      const store = parseFileName(name).kind === 'tags' ? tags : notes;
      for (const r of records) if (pickWinner(store.get(r.id), r) === r) store.set(r.id, r);
    },
    async getDirty() { return { ...dirty }; },
    async clearDirty(name, s) { if (dirty[name] === s) delete dirty[name]; },
    async getSyncState(k) { return syncState[k] ? structuredClone(syncState[k]) : null; },
    async setSyncState(k, v) { syncState[k] = structuredClone(v); },
  };
}

const texts = (repo) => [...repo.notes.values()].filter((n) => !n.deleted).map((n) => n.text).sort();
const day = new Date(2024, 5, 10, 12);

test('sync: два устройства сходятся к одному состоянию', async () => {
  const remote = memoryRemote();
  const a = memoryRepo();
  const b = memoryRepo();
  await a.saveNote(createNote('A1', [], day));
  await b.saveNote(createNote('B1', [], day));
  await b.saveNote(createNote('B-old', [], new Date(2024, 5, 1)));
  await a.saveTag(createTag('дом'));
  await b.saveTag(createTag('Дом'));

  await syncAll(remote, a, remote.id);
  await syncAll(remote, b, remote.id);
  await syncAll(remote, a, remote.id);

  assertEqual(texts(a), ['A1', 'B-old', 'B1']);
  assertEqual(texts(a), texts(b));
  assertEqual([...remote.files.keys()].sort(), ['day-2024-06-01.json', 'day-2024-06-10.json', 'tags.json']);
  assertEqual(parseFile(remote.files.get('tags.json').text).length, 1, 'одинаковые теги слились');
});

test('sync: повторная синхронизация без изменений ничего не пишет', async () => {
  const remote = memoryRemote();
  const a = memoryRepo();
  await a.saveNote(createNote('x', [], day));
  await syncAll(remote, a, remote.id);
  const puts = remote.puts;
  const stats = await syncAll(remote, a, remote.id);
  assertEqual([remote.puts, stats.files], [puts, 0]);
});

test('sync: конфликт записи повторяется и не теряет данные', async () => {
  const remote = memoryRemote();
  const a = memoryRepo();
  const b = memoryRepo();
  await a.saveNote(createNote('A', [], day));
  await b.saveNote(createNote('B', [], day));
  // Пока A пишет файл дня, B успевает записать свой вариант.
  remote.onBeforePut = () => syncAll(remote, b, remote.id);
  const stats = await syncAll(remote, a, remote.id);
  assertEqual(stats.errors, []);
  assertEqual(parseFile(remote.files.get('day-2024-06-10.json').text).map((r) => r.text).sort(), ['A', 'B']);
});

test('sync: удаление распространяется на другое устройство', async () => {
  const remote = memoryRemote();
  const a = memoryRepo();
  const b = memoryRepo();
  const note = createNote('удали меня', [], day);
  await a.saveNote(note);
  await syncAll(remote, a, remote.id);
  await syncAll(remote, b, remote.id);
  await b.saveNote(tombstone(note));
  await syncAll(remote, b, remote.id);
  await syncAll(remote, a, remote.id);
  assertEqual(texts(a), []);
});

// ---------------- Совместимость версий (устройства с разными версиями приложения) ----------------

test('parseFile: файл без v — текущий формат, файл новее — FormatTooNewError', () => {
  assertEqual(parseFile('{"records":[]}'), []);
  let error = null;
  try {
    withLanguage('en', () => parseFile(JSON.stringify({ v: FILE_FORMAT_VERSION + 1, records: [] }), 'tags.json'));
  } catch (e) {
    error = e;
  }
  assert(error instanceof FormatTooNewError, `ожидался FormatTooNewError: ${error}`);
  assertEqual(error.version, FILE_FORMAT_VERSION + 1);
});

test('sync: файл нового формата не перезаписывается, локальные правки сохраняются', async () => {
  const remote = memoryRemote();
  const futureText = JSON.stringify({ v: FILE_FORMAT_VERSION + 1, records: [], extra: 'future' });
  remote.files.set('day-2024-06-10.json', { text: futureText, version: 'x' });
  const a = memoryRepo();
  await a.saveNote(createNote('local', [], day));
  const stats = await syncAll(remote, a, remote.id);
  assertEqual(remote.files.get('day-2024-06-10.json').text, futureText, 'файл на сервере не тронут');
  assertEqual(remote.puts, 0);
  assertEqual(stats.errors.map((e) => e.name), ['day-2024-06-10.json'], 'ошибка видна пользователю');
  assertEqual(texts(a), ['local']);
  assert((await a.getDirty())['day-2024-06-10.json'], 'флаг «изменён» сохранён — заметка уйдёт после обновления');
});

test('mergeRecords сохраняет неизвестные поля записей (добавленные будущими версиями)', () => {
  const future = rec('1', 5, { color: 'red', pinned: true });
  const merged = mergeRecords([rec('1', 1)], [future]);
  assertEqual(merged, [future]);
  assert(serializeFile(merged).includes('"color":"red"'), 'поле попадает обратно в файл');
});

test('sync: мусорные записи в чужом файле игнорируются', async () => {
  const remote = memoryRemote();
  remote.files.set('day-2024-06-10.json', {
    version: 'x', text: serializeFile([rec('evil', 1, { day: '1999-01-01' }), rec('ok', 1)]),
  });
  const a = memoryRepo();
  await syncAll(remote, a, remote.id);
  assertEqual([...a.notes.keys()], ['ok']);
});

// ---------------- IndexedDB (repo.js) ----------------

test('repo: запись, чтение файла дня и флаг изменений', async () => {
  const { repo } = await import('/js/repo.js');
  const note = createNote('idb-test', [], new Date(1999, 0, 1));
  await repo.saveNote(note);
  const file = 'day-1999-01-01.json';
  assert((await repo.readFile(file)).some((n) => n.id === note.id), 'заметка не найдена');
  const stamp = (await repo.getDirty())[file];
  assert(stamp, 'файл не помечен изменённым');
  // Старая версия с сервера не должна перезатирать свежую локальную.
  await repo.writeRecords(file, [{ ...note, text: 'old', updatedAt: note.updatedAt - 1 }]);
  assertEqual((await repo.readFile(file)).find((n) => n.id === note.id).text, 'idb-test');
  await repo.clearDirty(file, stamp);
  // Убираем за собой: tombstone скрывает тестовую запись.
  await repo.writeRecords(file, [tombstone(note)]);
  assert(!(await repo.getDirty())[file], 'флаг должен быть снят');
});

// ---------------- Запуск ----------------

// Раннер читает только document.title — кладём туда и причины падений (в пределах разумной длины).
const TITLE_FAILURES_LIMIT = 1500;

async function run() {
  const out = document.getElementById('results');
  const failures = [];
  for (const { name, fn } of tests) {
    const li = document.createElement('li');
    try {
      await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('таймаут')), TEST_TIMEOUT_MS))]);
      li.textContent = `✔ ${name}`;
      li.className = 'pass';
    } catch (error) {
      failures.push(`${name}: ${error.message}`.replace(/\s+/g, ' '));
      li.textContent = `✘ ${name}: ${error.message}`;
      li.className = 'fail';
      console.error(name, error);
    }
    out.append(li);
  }
  const failed = failures.length;
  const summary = `Tests: ${tests.length}, passed: ${tests.length - failed}, failed: ${failed}`;
  document.getElementById('summary').textContent = summary;
  document.title = failed
    ? `FAIL ${summary} | ${failures.join(' | ')}`.slice(0, TITLE_FAILURES_LIMIT)
    : `PASS ${summary}`;
}

run();
