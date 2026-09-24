// Ручная интеграционная проверка S3-адаптера против реального бакета (не входит в автотесты).
// Пишет в отдельный префикс, чтобы не трогать данные пользователя. Секреты не логируются.

import { createS3Remote } from '/js/sync/s3.js';
import { syncAll } from '/js/sync/engine.js';
import { createNote, parseFile } from '/js/notes.js';

const TEST_PREFIX = 'notes-selftest/';
const LOG_TITLE_LIMIT = 2000;
const logEl = document.getElementById('log');
const lines = [];
const log = (msg) => {
  lines.push(msg);
  logEl.textContent = lines.join('\n');
};

/** Минимальный in-memory репозиторий с интерфейсом repo.js. */
function memoryRepo() {
  const notes = new Map();
  const dirty = {};
  const state = {};
  let stamp = 0;
  return {
    notes,
    async saveNote(n) { notes.set(n.id, n); dirty[`day-${n.day}.json`] = ++stamp; },
    async listFiles() { return [...new Set([...notes.values()].map((n) => `day-${n.day}.json`))]; },
    async readFile(name) { return [...notes.values()].filter((n) => `day-${n.day}.json` === name); },
    async writeRecords(name, records) { for (const r of records) notes.set(r.id, r); },
    async getDirty() { return { ...dirty }; },
    async clearDirty(name, s) { if (dirty[name] === s) delete dirty[name]; },
    async getSyncState(k) { return state[k] ?? null; },
    async setSyncState(k, v) { state[k] = structuredClone(v); },
  };
}

async function step(name, fn) {
  try {
    const result = await fn();
    log(`OK   ${name}${result !== undefined ? `: ${result}` : ''}`);
    return result;
  } catch (error) {
    log(`FAIL ${name}: ${error.name}: ${error.message}`);
    throw error;
  }
}

async function run() {
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname); // убрать секреты из адресной строки
  const cfg = {
    endpoint: p.get('endpoint'), bucket: p.get('bucket'), region: p.get('region') || '',
    accessKeyId: p.get('key'), secretAccessKey: p.get('secret'), prefix: TEST_PREFIX,
    conditionalWrites: p.get('conditional') !== '0',
  };
  log(`origin=${location.origin} endpoint=${cfg.endpoint} bucket=${cfg.bucket} conditional=${cfg.conditionalWrites}`);
  const remote = createS3Remote(cfg);

  await step('list', async () => `${(await remote.list()).size} files`);
  const name = `day-2000-01-01.json`;
  const first = await step('put (If-None-Match or plain)', async () => {
    const existing = await remote.get(name);
    return (await remote.put(name, '{"records":[],"v":1}', existing?.version ?? null)).version;
  });
  await step('get', async () => `version=${(await remote.get(name)).version} (put returned ${first})`);

  // Полный цикл движка: два «устройства» сходятся через реальный бакет.
  const a = memoryRepo();
  const b = memoryRepo();
  await a.saveNote(createNote('A-live', [], new Date(2000, 0, 1, 12)));
  await b.saveNote(createNote('B-live', [], new Date(2000, 0, 1, 13)));
  await step('sync A', async () => JSON.stringify(await syncAll(remote, a, 'a')));
  await step('sync B', async () => JSON.stringify(await syncAll(remote, b, 'b')));
  await step('sync A again', async () => JSON.stringify(await syncAll(remote, a, 'a')));
  await step('converged', async () => {
    const texts = (repo) => [...repo.notes.values()].map((n) => n.text).sort().join(',');
    const remoteTexts = parseFile((await remote.get(name)).text).map((r) => r.text).sort().join(',');
    if (texts(a) !== texts(b) || texts(a) !== remoteTexts) throw new Error(`A=${texts(a)} B=${texts(b)} S3=${remoteTexts}`);
    return remoteTexts;
  });
}

run()
  .then(() => { document.title = 'PASS s3-live'; })
  // В заголовок — весь лог: раннер читает только document.title.
  .catch(() => { document.title = `FAIL s3-live | ${lines.join(' | ')}`.slice(0, LOG_TITLE_LIMIT); });
