<?php
// E2E-проверка доставки обновлений через Chrome DevTools Protocol (без внешних зависимостей).
// Сценарий: открыть приложение → дождаться SW → поменять код и выполнить release → проверить, что появилась
// полоса «Обновить» и старая страница продолжает работать на старой версии → нажать «Обновить» → проверить новую версию.
// Исходные файлы восстанавливаются в любом случае.
//
// Запуск: php tools/update-e2e.php [devtools-port]   (dev-сервер на :8000 и Chromium с DevTools должны быть запущены,
// обычно через tools/update-e2e.sh)

declare(strict_types=1);

require __DIR__ . '/cdp-client.php';

const APP_URL = 'http://localhost:8000/';
const MARKER_FILE = __DIR__ . '/../public/css/app.css';
const MARKER_TEXT = "\n/* update-e2e marker */\n";
const RELEASE = __DIR__ . '/release.php';
$port = (int) ($argv[1] ?? 9337);

function release(): string
{
    exec('php ' . escapeshellarg(RELEASE) . ' 2>&1', $out, $code);
    if ($code !== 0) {
        cdpFail('release.php: ' . implode(' ', $out));
    }
    return implode(' ', $out);
}

function step(string $message): void
{
    static $started = null;
    $started = $started ?? microtime(true);
    printf("OK   %s (%.1fs)\n", $message, microtime(true) - $started);
}

// ---------- сценарий ----------

$originalCss = (string) file_get_contents(MARKER_FILE);
register_shutdown_function(static function () use ($originalCss): void {
    file_put_contents(MARKER_FILE, $originalCss);
    exec('php ' . escapeshellarg(RELEASE));
});

$cdp = cdpOpenTab($port, APP_URL);

$versionA = cdpWaitFor($cdp, "document.querySelector('#settings-version') && import('/js/version.js').then(m => m.APP_VERSION)", 'загрузка A');
cdpWaitFor($cdp, 'navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller)', 'SW v1 управляет страницей');
step("версия A загружена и под управлением SW: $versionA");

// Повторная загрузка — из кэша SW (офлайн-оболочка работает).
$cdp->call('Page.reload');
cdpWaitFor($cdp, "document.readyState === 'complete' && !!navigator.serviceWorker.controller", 'перезагрузка под SW');
$hasBar = $cdp->evaluate("!document.getElementById('update-bar').hidden");
if ($hasBar) {
    cdpFail('полоса обновления показана без обновления');
}
step('без нового релиза полоса обновления не показывается');

// Выпускаем версию B.
file_put_contents(MARKER_FILE, $originalCss . MARKER_TEXT);
$releaseOut = release();
$versionB = substr((string) strrchr($releaseOut, ' '), 1);
if ($versionB === $versionA) {
    cdpFail('release не сменил версию');
}
step("выпущена версия B: $versionB");

// Приложение само проверяет обновления при возврате на вкладку; эмулируем это вызовом update().
$cdp->evaluate('navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => true)');
cdpWaitFor($cdp, "!document.getElementById('update-bar').hidden", 'полоса «Обновить»');
step('появилась полоса «Доступна новая версия — Обновить»');

$stillA = $cdp->evaluate("import('/js/version.js').then(m => m.APP_VERSION)");
if ($stillA !== $versionA) {
    cdpFail("до нажатия страница должна оставаться на A, а получено $stillA");
}
$cssA = $cdp->evaluate("fetch('/css/app.css').then(r => r.text()).then(t => !t.includes('update-e2e marker'))");
if (!$cssA) {
    cdpFail('до нажатия файлы должны отдаваться из кэша версии A (смешение версий)');
}
step('до нажатия: страница и все файлы — версии A (смешения версий нет)');

// Несохранённый текст в поле не должен потеряться.
$draft = 'e2e-draft-' . bin2hex(random_bytes(3));
$cdp->evaluate("(() => { document.getElementById('note-text').value = " . json_encode($draft) . "; return true; })()");
$cdp->evaluate("(() => { document.getElementById('update-btn').click(); return true; })()");

cdpWaitFor($cdp, "document.readyState === 'complete' && document.querySelector('#settings-version') && "
    . "import('/js/version.js').then(m => m.APP_VERSION === " . json_encode($versionB) . ')', 'переключение на B');
step('после «Обновить» страница перезагружена на версии B');

$cssB = cdpWaitFor($cdp, "fetch('/css/app.css').then(r => r.text()).then(t => t.includes('update-e2e marker'))", 'файлы версии B');
$barHidden = $cdp->evaluate("document.getElementById('update-bar').hidden");
if (!$cssB || !$barHidden) {
    cdpFail('после обновления: файлы B и скрытая полоса');
}
step('файлы версии B, полоса скрыта');

$caches = $cdp->evaluate("caches.keys().then(k => k.filter(n => n.startsWith('notes-')).join(','))");
if ($caches !== "notes-$versionB") {
    cdpFail("старый кэш не удалён: $caches");
}
step("старый кэш удалён, остался только notes-$versionB");

$draftSaved = cdpWaitFor($cdp, "document.getElementById('notes-list').textContent.includes(" . json_encode($draft) . ')', 'сохранение черновика');
step('несохранённый текст из поля сохранён заметкой перед перезагрузкой');

// Чистим за собой тестовую заметку (tombstone через UI-путь не нужен: удаляем через repo, как пользователь).
$cdp->evaluate("(async () => { const { repo } = await import('/js/repo.js'); const { tombstone } = await import('/js/notes.js');"
    . " for (const n of await repo.allNotes()) if (n.text === " . json_encode($draft) . ") await repo.saveNote(tombstone(n)); return true; })()");

echo "PASS update-e2e\n";
