<?php
// E2E главного экрана в headless Chromium через DevTools Protocol:
// выбор тега в форме фильтрует список (И по нескольким тегам), тег прикрепляется к новой заметке,
// клик по тегу у заметки переключает тот же выбор, «сбросить» снимает всё, кнопка отправки — круглая со стрелкой.
// Работает в свежем профиле (пустая IndexedDB). Запуск: tools/ui-e2e.sh (он поднимает Chromium).

declare(strict_types=1);

require __DIR__ . '/cdp-client.php';

const APP_URL = 'http://localhost:8000/';

$port = (int) ($argv[1] ?? 9343);
$cdp = cdpOpenTab($port, APP_URL);

/** Состояние экрана одной строкой JSON: выбранные теги формы, видимые заметки, кнопка сброса. */
const SNAPSHOT_JS = <<<'JS'
JSON.stringify({
  selected: [...document.querySelectorAll('#tag-picker [data-tag-id].chip--active')].map((c) => c.dataset.tagId),
  notes: [...document.querySelectorAll('#notes-list .note__text')].map((n) => n.textContent),
  clearVisible: !document.getElementById('clear-tags-btn').hidden,
  empty: document.querySelector('#notes-list .empty')?.textContent ?? null,
})
JS;

function snapshot(Cdp $cdp): array
{
    return json_decode((string) $cdp->evaluate(SNAPSHOT_JS), true);
}

function js(Cdp $cdp, string $code): void
{
    $cdp->evaluate("(async () => { $code; await new Promise((r) => setTimeout(r, 150)); return true; })()");
}

/** Создать тег через поле «＋ тег» (как пользователь). */
function addTag(Cdp $cdp, string $name): void
{
    js($cdp, "document.getElementById('add-tag-btn').click();"
        . " const i = document.getElementById('new-tag-input'); i.value = " . json_encode($name) . ";"
        . " i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
}

function addNote(Cdp $cdp, string $text): void
{
    js($cdp, "document.getElementById('note-text').value = " . json_encode($text) . ";"
        . " document.getElementById('note-submit').click()");
}

function clickFormTag(Cdp $cdp, string $id): void
{
    js($cdp, "document.querySelector('#tag-picker [data-tag-id=\"$id\"]').click()");
}

function expect(bool $ok, string $message, array $state = []): void
{
    if (!$ok) {
        cdpFail("$message\n  state: " . json_encode($state, JSON_UNESCAPED_UNICODE));
    }
    echo "OK   $message\n";
}

cdpWaitFor($cdp, "document.readyState === 'complete' && !!document.getElementById('note-submit')", 'загрузка приложения');

// Кнопка отправки: круглая, со стрелкой, без видимого текста, с доступным именем.
$btn = json_decode((string) $cdp->evaluate(<<<'JS'
JSON.stringify((() => {
  const b = document.getElementById('note-submit'); const s = getComputedStyle(b);
  return { text: b.textContent.trim(), svg: !!b.querySelector('svg'), aria: b.getAttribute('aria-label'),
           round: s.borderRadius === '50%' || parseFloat(s.borderRadius) >= b.offsetWidth / 2, w: b.offsetWidth, h: b.offsetHeight };
})())
JS), true);
expect($btn['text'] === '' && $btn['svg'] && $btn['aria'] && $btn['round'] && $btn['w'] === $btn['h'],
    "кнопка отправки — круглая {$btn['w']}×{$btn['h']} со стрелкой, aria-label «{$btn['aria']}»", $btn);

// Попап настроек: порядок провайдеров, версия заполнена, ссылка на разработчика в той же строке и тем же шрифтом.
$cdp->evaluate("(() => { document.getElementById('settings-btn').click(); return true; })()");
$about = json_decode((string) cdpWaitFor($cdp, <<<'JS'
document.getElementById('settings-dialog').open && JSON.stringify((() => {
  const dlg = document.getElementById('settings-dialog');
  const ver = document.getElementById('settings-version');
  const a = dlg.querySelector('a.settings__author');
  const vr = ver.getBoundingClientRect(); const ar = a.getBoundingClientRect();
  const cs = (e) => getComputedStyle(e);
  return {
    providers: [...dlg.querySelectorAll('.settings__providers input[name="provider"]')]
      .filter((i) => i.closest('label').offsetParent !== null).map((i) => i.value),
    version: ver.textContent, link: a.textContent, href: a.href,
    sameLine: Math.abs(vr.top - ar.top) < 2 && ar.left > vr.right,
    sameFont: cs(ver).color === cs(a).color && cs(ver).fontSize === cs(a).fontSize,
  };
})())
JS, 'попап настроек'), true);
expect($about['providers'] === ['none', 'yandex', 's3', 'gdrive'],
    'настройки: устройство → Яндекс → S3 → Google Drive, «Регистрации» нет', $about);
expect(preg_match('/[0-9a-f]{12}|dev/', (string) $about['version']) === 1 && $about['link'] === 'Alex Yashin'
    && $about['href'] === 'https://alex-yashin.ru/' && $about['sameLine'] && $about['sameFont'],
    "внизу настроек: «{$about['version']}» и ссылка «{$about['link']}» одной строкой, тем же бледным шрифтом", $about);
$cdp->evaluate("(() => { document.getElementById('settings-dialog').close(); return true; })()");

// Данные: 3 заметки с разными наборами тегов.
addNote($cdp, 'без тегов');
addTag($cdp, 'work');                       // тег создаётся и сразу выбирается
addNote($cdp, 'только work');
addTag($cdp, 'home');                       // выбраны work + home
addNote($cdp, 'work и home');
$s = snapshot($cdp);
expect($s['selected'] === ['home', 'work'] && $s['notes'] === ['work и home'],
    'выбраны work+home: список отфильтрован до заметок со ВСЕМИ тегами (И)', $s);
expect($s['clearVisible'], 'при выбранных тегах видна кнопка «сбросить»', $s);

clickFormTag($cdp, 'home');                 // остаётся только work
$s = snapshot($cdp);
expect($s['selected'] === ['work'] && $s['notes'] === ['только work', 'work и home'],
    'снят home в форме: список по одному тегу work', $s);

addNote($cdp, 'новая с work');
$s = snapshot($cdp);
expect(in_array('новая с work', $s['notes'], true) && count($s['notes']) === 3,
    'новая заметка получила выбранный тег и сразу видна в отфильтрованном списке', $s);

// Клик по тегу у заметки — тот же выбор, что в форме.
js($cdp, "[...document.querySelectorAll('#notes-list .note')].find((n) => n.textContent.includes('work и home'))"
    . ".querySelector('[data-tag-id=\"home\"]').click()");
$s = snapshot($cdp);
expect($s['selected'] === ['home', 'work'] && $s['notes'] === ['work и home'],
    'клик по тегу у заметки включил его в форме и в фильтре', $s);

// Пустой результат.
addTag($cdp, 'idea');
$s = snapshot($cdp);
expect($s['notes'] === [] && is_string($s['empty']), "нет заметок со всеми тегами — сообщение «{$s['empty']}»", $s);

js($cdp, "document.getElementById('clear-tags-btn').click()");
$s = snapshot($cdp);
expect($s['selected'] === [] && count($s['notes']) === 4 && !$s['clearVisible'],
    '«сбросить»: выбор снят, видны все 4 заметки, кнопка скрыта', $s);

// Порядок и номера в дне: сверху самая старая (№ 1), внизу новая (№ 4); время — в подсказке.
$nums = json_decode((string) $cdp->evaluate("JSON.stringify([...document.querySelectorAll('#notes-list .note')].map((n) => ({"
    . " text: n.querySelector('.note__text').textContent, num: n.querySelector('.note__num').textContent,"
    . " title: n.querySelector('.note__num').title })))"), true);
expect(array_column($nums, 'num') === ['1', '2', '3', '4']
    && array_column($nums, 'text') === ['без тегов', 'только work', 'work и home', 'новая с work']
    && preg_match('/^\d{1,2}:\d{2}/', (string) $nums[0]['title']) === 1,
    'в дне: от старой к новой, номера 1→4 вместо времени, время в подсказке', ['notes' => $nums]);

// Дни — как раньше: сверху «Сегодня», ниже более старые (проверяется ниже после добавления вчерашней заметки).

// Единственная заметка дня — без номера (заметка вчерашним днём через repo, как пришедшая с другого устройства).
js($cdp, "const { repo } = await import('/js/repo.js'); const { createNote } = await import('/js/notes.js');"
    . " const d = new Date(); d.setDate(d.getDate() - 1); await repo.saveNote(createNote('вчерашняя', [], d));"
    . " document.getElementById('clear-tags-btn').click()");
$js = "JSON.stringify((() => { const n = [...document.querySelectorAll('#notes-list .note')].find((x) => x.textContent.includes('вчерашняя'));"
    . " return n ? { num: n.querySelector('.note__num').textContent, shown: getComputedStyle(n.querySelector('.note__num')).display !== 'none' } : null; })())";
$cdp->call('Page.reload');
$single = json_decode((string) cdpWaitFor($cdp, "document.readyState === 'complete' && $js !== 'null' && $js", 'вчерашняя заметка'), true);
expect($single['num'] === '' && !$single['shown'], 'единственная заметка дня — без номера', $single);
$days = json_decode((string) $cdp->evaluate("JSON.stringify([...document.querySelectorAll('#notes-list .day')].map((d) => d.querySelector('.note__text').textContent))"), true);
expect($days === ['без тегов', 'вчерашняя'], 'дни как раньше: сверху сегодня, ниже вчера', ['firstNoteOfEachDay' => $days]);

// Мобильная ширина: ✕ справа на уровне первой строки даже у длинной многострочной заметки с тегами.
$cdp->call('Emulation.setDeviceMetricsOverride', ['width' => 360, 'height' => 740, 'deviceScaleFactor' => 2, 'mobile' => true]);
js($cdp, "document.querySelector('#tag-picker [data-tag-id=\"work\"]').click()");
addNote($cdp, str_repeat('длинный текст заметки ', 8));
js($cdp, "document.getElementById('clear-tags-btn').click()");
$layout = json_decode((string) $cdp->evaluate(<<<'JS'
JSON.stringify([...document.querySelectorAll('#notes-list .note')].map((n) => {
  const r = (el) => el.getBoundingClientRect();
  const text = n.querySelector('.note__text');
  const del = r(n.querySelector('.note__delete'));
  const line = parseFloat(getComputedStyle(text).lineHeight);
  const t = r(text);
  return {
    lines: Math.round(t.height / line),
    delCenterOffset: Math.round((del.top + del.height / 2) - (t.top + line / 2)),  // 0 = по центру первой строки
    delRightGap: Math.round(r(n).right - del.right),                                 // 0 = у правого края
    delRightOfText: del.left >= t.right - 1,
  };
}))
JS), true);
$multiline = array_filter($layout, static function (array $l): bool {
    return $l['lines'] > 1;
});
$bad = array_filter($layout, static function (array $l): bool {
    return abs($l['delCenterOffset']) > 2 || $l['delRightGap'] !== 0 || !$l['delRightOfText'];
});
expect(count($multiline) >= 1 && count($bad) === 0,
    '360px: ✕ у всех ' . count($layout) . ' заметок справа на уровне первой строки (в т.ч. у многострочной)',
    ['layout' => $layout]);

// ---------- Поле ввода растёт вниз (360px). Ввод — как с клавиатуры, через CDP Input.* ----------

const FIELD_JS = <<<'JS'
JSON.stringify((() => {
  const f = document.getElementById('note-text');
  const btn = document.getElementById('note-submit').getBoundingClientRect();
  const r = f.getBoundingClientRect();
  return { h: Math.round(r.height), scroll: f.scrollHeight, client: f.clientHeight, value: f.value,
           tag: f.tagName, btnBottomGap: Math.round(r.bottom - btn.bottom) };
})())
JS;
$field = static function () use ($cdp): array {
    return json_decode((string) $cdp->evaluate(FIELD_JS), true);
};

$cdp->evaluate("(() => { const f = document.getElementById('note-text'); f.focus(); return true; })()");
$empty = $field();
expect($empty['tag'] === 'TEXTAREA' && $empty['value'] === '', "поле — пустой textarea высотой в одну строку ({$empty['h']}px)", $empty);

$long = str_repeat('очень длинная строка заметки ', 6);
$cdp->call('Input.insertText', ['text' => $long]);
usleep(150000);
$grown = $field();
expect($grown['h'] > $empty['h'] * 2 && $grown['scroll'] <= $grown['client'] + 1,
    "при наборе длинной строки поле выросло вниз ({$empty['h']} → {$grown['h']}px), текст виден целиком без прокрутки", $grown);
expect(abs($grown['btnBottomGap']) <= 1, 'кнопка отправки прижата к нижнему краю растущего поля', $grown);

// Enter — сохраняет (как раньше), поле сжимается обратно до одной строки.
foreach (['keyDown', 'keyUp'] as $type) {
    $cdp->call('Input.dispatchKeyEvent', ['type' => $type, 'key' => 'Enter', 'code' => 'Enter',
        'windowsVirtualKeyCode' => 13, 'text' => $type === 'keyDown' ? "\r" : '']);
}
usleep(300000);
$afterEnter = $field();
$saved = $cdp->evaluate('[...document.querySelectorAll("#notes-list .note__text")].some((n) => n.textContent === '
    . json_encode(trim($long)) . ')');
expect($saved && $afterEnter['value'] === '' && $afterEnter['h'] === $empty['h'],
    "Enter сохранил заметку целиком, поле очищено и снова в одну строку ({$afterEnter['h']}px)", $afterEnter);

// Вставка с переводами строк: заметка остаётся однострочной — переводы заменяются пробелами.
$cdp->call('Input.insertText', ['text' => "первая\nвторая\r\nтретья"]);
usleep(150000);
$pasted = $field();
expect($pasted['value'] === 'первая вторая третья', "вставка с переводами строк → «{$pasted['value']}»", $pasted);

// Очень длинный текст — поле ограничено max-height и прокручивается, а не вытесняет список.
$cdp->call('Input.insertText', ['text' => str_repeat(' слово', 90)]);
usleep(150000);
$huge = $field();
$vh40 = (int) round(740 * 0.4);
expect($huge['h'] <= $vh40 + 1 && $huge['scroll'] > $huge['client'],
    "очень длинный текст: высота ограничена ({$huge['h']}px ≤ 40vh = {$vh40}px), внутри — прокрутка", $huge);
$cdp->evaluate("(() => { const f = document.getElementById('note-text'); f.value = ''; f.dispatchEvent(new Event('input')); return true; })()");

// ---------- Выбор дня новой заметки ----------

const DAY_JS = <<<'JS'
JSON.stringify((() => {
  const picker = document.getElementById('day-picker');
  const form = document.getElementById('note-form');
  const input = document.getElementById('day-input');
  const chips = [...picker.querySelectorAll('[data-day-choice]')];
  return {
    labels: chips.map((c) => c.textContent.trim()),
    active: chips.filter((c) => c.classList.contains('chip--active')).map((c) => c.dataset.dayChoice),
    aboveField: picker.getBoundingClientRect().bottom <= document.getElementById('note-text').getBoundingClientRect().top,
    firstInForm: form.firstElementChild === picker,
    max: input.max,
    today: (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })(),
  };
})())
JS;
$dayState = static function () use ($cdp): array {
    return json_decode((string) $cdp->evaluate(DAY_JS), true);
};
/** Группа (заголовок дня) и номер заметки с текстом $text. */
$placeOf = static function (string $text) use ($cdp): ?array {
    return json_decode((string) $cdp->evaluate("JSON.stringify((() => { for (const d of document.querySelectorAll('#notes-list .day')) {"
        . " const n = [...d.querySelectorAll('.note')].find((x) => x.querySelector('.note__text').textContent === " . json_encode($text) . ");"
        . " if (n) return { day: d.querySelector('.day__title').textContent, last: d.querySelector('.note:last-child') === n }; } return null; })())"), true);
};

$cdp->call('Page.reload');
cdpWaitFor($cdp, "document.readyState === 'complete' && !!document.getElementById('day-picker')", 'перезагрузка');
$d = $dayState();
expect($d['active'] === ['today'] && $d['labels'] === ['Today', 'Yesterday', 'Date'] && $d['aboveField'] && $d['firstInForm'],
    'над полем: «' . implode(' | ', $d['labels']) . '», по умолчанию выбрано «Сегодня»', $d);
expect($d['max'] === $d['today'], "в календаре нельзя выбрать будущее (max = {$d['max']})", $d);

// «Вчера»: две заметки подряд — выбор сохраняется, обе в группе «Вчера», в конце дня.
js($cdp, "document.querySelector('[data-day-choice=\"yesterday\"]').click()");
addNote($cdp, 'e2e-вчера-1');
addNote($cdp, 'e2e-вчера-2');
$p1 = $placeOf('e2e-вчера-1');
$p2 = $placeOf('e2e-вчера-2');
$d = $dayState();
expect($p1['day'] === 'Yesterday' && $p2['day'] === 'Yesterday' && $p2['last'] && $d['active'] === ['yesterday'],
    '«Вчера»: две заметки подряд попали во вчерашний день (в конец), выбор сохранился', ['p1' => $p1, 'p2' => $p2, 'day' => $d]);

// «Дата»: календарь. Выбор даты — как пользователь: значение поля + change (headless не рисует нативный попап).
$picked = $cdp->evaluate("(() => { const i = document.getElementById('day-input'); let opened = false;"
    . " const orig = i.showPicker; i.showPicker = function () { opened = true; };"
    . " document.getElementById('day-custom-btn').click(); i.showPicker = orig; return opened; })()");
expect($picked === true, 'нажатие «Дата» открывает календарь (showPicker)', ['opened' => $picked]);

$customDay = date('Y-m-d', strtotime('-10 days'));
$setDay = static function (string $day) use ($cdp): void {
    js($cdp, "const i = document.getElementById('day-input'); i.value = " . json_encode($day) . "; i.dispatchEvent(new Event('change', { bubbles: true }))");
};
$setDay($customDay);
$d = $dayState();
expect($d['active'] === ['custom'] && $d['labels'][2] !== 'Date',
    "выбрана дата {$customDay}: активен чип «{$d['labels'][2]}»", $d);
addNote($cdp, 'e2e-дата');
$p = $placeOf('e2e-дата');
expect($p !== null && $p['day'] === $d['labels'][2], "заметка попала в группу выбранного дня «{$p['day']}»", ['place' => $p]);

// В календаре выбрали сегодня → чип «Сегодня», подпись «Дата» вернулась; будущая дата отклоняется.
$setDay($d['today']);
$d = $dayState();
expect($d['active'] === ['today'] && $d['labels'][2] === 'Date', 'в календаре выбрано сегодня → активен «Сегодня»', $d);
$setDay(date('Y-m-d', strtotime('+3 days')));
$d = $dayState();
expect($d['active'] === ['today'], 'будущая дата (введена мимо календаря) отклонена, выбор не изменился', $d);

// После перезагрузки — снова «Сегодня».
js($cdp, "document.querySelector('[data-day-choice=\"yesterday\"]').click()");
$cdp->call('Page.reload');
cdpWaitFor($cdp, "document.readyState === 'complete' && !!document.getElementById('day-picker')", 'перезагрузка');
$d = $dayState();
expect($d['active'] === ['today'], 'после перезагрузки снова «Сегодня»', $d);

echo "PASS ui-e2e\n";
