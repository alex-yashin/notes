// Локализация: словари, определение языка браузера, перевод разметки.
// Язык берётся из navigator.languages (по порядку предпочтения); если ни один не поддержан — английский.

export const FALLBACK_LANGUAGE = 'en';

const LOCALES = Object.freeze({ en: 'en-US', ru: 'ru-RU' });
const PLACEHOLDER_RE = /\{(\w+)\}/g;
/** data-i18n-<attr> → атрибут элемента. */
const TRANSLATABLE_ATTRS = Object.freeze(['placeholder', 'aria-label', 'title', 'content']);

const en = {
  'app.title': 'Notes',
  'app.description': 'One-line notes with tags',

  'note.placeholder': 'New note…',
  'note.textLabel': 'Note text',
  'note.add': 'Add',
  'note.tagsLabel': 'Note tags',
  'note.delete': 'Delete note',
  'note.deleteShort': 'Delete',
  'note.confirmDelete': 'Delete note “{text}”?',
  'tag.add': '＋ tag',
  'tag.new': 'New tag',
  'tag.namePlaceholder': 'tag name',
  'tag.nameLabel': 'New tag name',
  'filter.clear': '✕ clear',
  'filter.clearTitle': 'Clear selected tags and filter',
  'notes.empty': 'No notes yet — add the first one',
  'notes.emptyFiltered': 'No notes with the selected tags',
  'day.today': 'Today',
  'day.yesterday': 'Yesterday',

  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.storage': 'Where to store notes',
  'settings.syncNow': 'Sync now',
  'settings.save': 'Save',
  'settings.lastSync': 'Last sync: {time}',
  'settings.invalidEndpoint': 'Invalid S3 endpoint',

  'provider.none': 'Only on this device',
  'provider.s3': 'S3 storage',
  'provider.yandex': 'Yandex Disk',
  'provider.gdrive': 'Google Drive',
  'provider.registration': 'Registration',
  'provider.api': 'API',

  's3.endpoint': 'Endpoint',
  's3.region': 'Region',
  's3.bucket': 'Bucket',
  's3.prefix': 'Prefix',
  's3.accessKeyId': 'Access Key ID',
  's3.secretAccessKey': 'Secret Access Key',
  's3.virtualHosted': 'Bucket in subdomain (virtual-hosted)',
  's3.conditionalWrites': 'Conditional writes (If-Match), protects against races',
  's3.corsHint': 'The bucket needs CORS: GET and PUT methods, headers *, ExposeHeaders: ETag.',

  'auth.yandexLogin': 'Sign in with Yandex',
  'auth.googleLogin': 'Sign in with Google',
  'auth.logout': 'Sign out',
  'auth.connected': 'Connected',
  'auth.notConnected': 'Not connected',
  'auth.success': 'Connected successfully',
  'auth.missingConfig': '{name} is not set in js/config.js',
  'auth.stateMismatch': 'Authorization response failed the state check — please connect again',
  'auth.denied': 'Authorization denied: {reason}',
  'auth.noCredentials': 'Registration service did not return client_id / client_secret',
  'auth.noToken': 'access_token was not received',
  'auth.unknownProvider': 'Unknown authorization provider',

  'registration.hint': 'You will be redirected to {host} and come back with credentials.',
  'registration.notConfigured': 'not configured',
  'registration.register': 'Sign up',
  'registration.reset': 'Reset',
  'registration.done': 'Device registered (client_id: {clientId})',
  'registration.none': 'Not registered',
  'registration.confirmReset': 'Reset client_id / client_secret on this device?',

  'sync.offline': 'offline',
  'sync.running': 'syncing…',
  'sync.errors': 'errors: {count}',
  'sync.done': '✓ {time}',
  'sync.doneToast': 'Synced. Records received: {pulled}, files sent: {pushed}',
  'sync.authNeeded': 'sign-in required',
  'sync.failed': 'sync error',

  'error.emptyNote': 'Empty note',
  'error.emptyTag': 'Empty tag name',
  'error.badSyncFile': 'Invalid sync file format',
  'error.conflict': 'File version conflict: {name}',
  'error.reauth': 'Please sign in again',
  'error.reauthContext': '{context}: please sign in again (401)',
  'error.fillS3': 'Fill in the S3 settings',
  'error.signIn': 'Sign in to {provider}',
  'error.notConnected': '{provider} is not connected',
  'error.registrationIncomplete': 'Registration is not completed',
  'error.s3NoConditional': 'The storage does not support conditional writes — turn them off in the S3 settings',
  'error.network': 'No connection to {host}: check the network or the server CORS settings',
  'error.s3Network': 'Cannot reach {host}. Most likely the bucket CORS does not allow {origin}: add it to AllowedOrigin (methods GET, PUT, HEAD; AllowedHeader *; ExposeHeader ETag)',
  'error.s3NoEtag': 'The storage does not expose the ETag header: add ExposeHeader ETag to the bucket CORS rule for {origin}',
  'sync.details': 'Details: {message}',
  'update.available': 'A new version is available',
  'update.apply': 'Update',
  'update.dbBlocked': 'The app was updated in another tab — reload this page',
  'settings.version': 'Version: {version}',
  'error.formatTooNew': '{name} was written by a newer version of the app (format v{version}) — update the app on this device',
  'error.insecureContext': 'The browser disables cryptography on {origin}: open the app via https:// or http://localhost',
  'warning.insecureContext': 'The app is opened over insecure http ({origin}): sync with S3 and Yandex Disk and offline mode are unavailable. Open it via https:// or http://localhost',

  'op.list': 'file list',
  'op.read': 'reading {name}',
  'op.write': 'writing {name}',
  'op.meta': 'metadata of {name}',
  'op.download': 'downloading {name}',
  'op.downloadLink': 'download link for {name}',
  'op.upload': 'uploading {name}',
  'op.uploadLink': 'upload link for {name}',
  'op.createFolder': 'creating folder',
  'op.create': 'creating {name}',
  'op.update': 'updating {name}',
  'op.deleteDuplicate': 'deleting duplicate',
};

const ru = {
  'app.title': 'Заметки',
  'app.description': 'Однострочные заметки с тегами',

  'note.placeholder': 'Новая заметка…',
  'note.textLabel': 'Текст заметки',
  'note.add': 'Добавить',
  'note.tagsLabel': 'Теги заметки',
  'note.delete': 'Удалить заметку',
  'note.deleteShort': 'Удалить',
  'note.confirmDelete': 'Удалить заметку «{text}»?',
  'tag.add': '＋ тег',
  'tag.new': 'Новый тег',
  'tag.namePlaceholder': 'имя тега',
  'tag.nameLabel': 'Имя нового тега',
  'filter.clear': '✕ сбросить',
  'filter.clearTitle': 'Снять выбор тегов и фильтр',
  'notes.empty': 'Заметок пока нет — добавьте первую',
  'notes.emptyFiltered': 'Нет заметок с выбранными тегами',
  'day.today': 'Сегодня',
  'day.yesterday': 'Вчера',

  'settings.title': 'Настройки',
  'settings.close': 'Закрыть',
  'settings.storage': 'Где хранить заметки',
  'settings.syncNow': 'Синхронизировать',
  'settings.save': 'Сохранить',
  'settings.lastSync': 'Последняя синхронизация: {time}',
  'settings.invalidEndpoint': 'Некорректный Endpoint S3',

  'provider.none': 'Только на этом устройстве',
  'provider.s3': 'Хранилище S3',
  'provider.yandex': 'Яндекс Диск',
  'provider.gdrive': 'Google Drive',
  'provider.registration': 'Регистрация',
  'provider.api': 'API',

  's3.endpoint': 'Endpoint',
  's3.region': 'Регион',
  's3.bucket': 'Бакет',
  's3.prefix': 'Префикс',
  's3.accessKeyId': 'Access Key ID',
  's3.secretAccessKey': 'Secret Access Key',
  's3.virtualHosted': 'Бакет в поддомене (virtual-hosted)',
  's3.conditionalWrites': 'Условная запись (If-Match), защищает от гонок',
  's3.corsHint': 'Для бакета нужен CORS: методы GET и PUT, заголовки *, ExposeHeaders: ETag.',

  'auth.yandexLogin': 'Войти через Яндекс',
  'auth.googleLogin': 'Войти через Google',
  'auth.logout': 'Выйти',
  'auth.connected': 'Подключено',
  'auth.notConnected': 'Не подключено',
  'auth.success': 'Подключение выполнено',
  'auth.missingConfig': 'Не задан {name} в js/config.js',
  'auth.stateMismatch': 'Ответ авторизации не прошёл проверку state — повторите подключение',
  'auth.denied': 'Авторизация отклонена: {reason}',
  'auth.noCredentials': 'Сервис регистрации не вернул client_id / client_secret',
  'auth.noToken': 'Не получен access_token',
  'auth.unknownProvider': 'Неизвестный провайдер авторизации',

  'registration.hint': 'Вы перейдёте на {host} и вернётесь с учётными данными.',
  'registration.notConfigured': 'не настроено',
  'registration.register': 'Зарегистрироваться',
  'registration.reset': 'Сбросить',
  'registration.done': 'Устройство зарегистрировано (client_id: {clientId})',
  'registration.none': 'Не зарегистрировано',
  'registration.confirmReset': 'Сбросить client_id / client_secret на этом устройстве?',

  'sync.offline': 'офлайн',
  'sync.running': 'синхронизация…',
  'sync.errors': 'ошибки: {count}',
  'sync.done': '✓ {time}',
  'sync.doneToast': 'Синхронизировано. Получено записей: {pulled}, отправлено файлов: {pushed}',
  'sync.authNeeded': 'нужен вход',
  'sync.failed': 'ошибка синхронизации',

  'error.emptyNote': 'Пустая заметка',
  'error.emptyTag': 'Пустое имя тега',
  'error.badSyncFile': 'Неверный формат файла синхронизации',
  'error.conflict': 'Конфликт версий файла {name}',
  'error.reauth': 'Требуется повторный вход',
  'error.reauthContext': '{context}: требуется повторный вход (401)',
  'error.fillS3': 'Заполните параметры S3',
  'error.signIn': 'Войдите в {provider}',
  'error.notConnected': '{provider} не подключён',
  'error.registrationIncomplete': 'Регистрация не завершена',
  'error.s3NoConditional': 'Хранилище не поддерживает условную запись — отключите её в настройках S3',
  'error.network': 'Нет соединения с {host}: проверьте сеть или настройки CORS сервера',
  'error.s3Network': 'Нет доступа к {host}. Скорее всего, CORS бакета не разрешает {origin}: добавьте его в AllowedOrigin (методы GET, PUT, HEAD; AllowedHeader *; ExposeHeader ETag)',
  'error.s3NoEtag': 'Хранилище не отдаёт заголовок ETag: добавьте ExposeHeader ETag в правило CORS бакета для {origin}',
  'sync.details': 'Подробности: {message}',
  'update.available': 'Доступна новая версия',
  'update.apply': 'Обновить',
  'update.dbBlocked': 'Приложение обновилось в другой вкладке — перезагрузите эту страницу',
  'settings.version': 'Версия: {version}',
  'error.formatTooNew': '{name} записан более новой версией приложения (формат v{version}) — обновите приложение на этом устройстве',
  'error.insecureContext': 'Браузер отключает криптографию на {origin}: откройте приложение по https:// или через http://localhost',
  'warning.insecureContext': 'Приложение открыто по незащищённому http ({origin}): синхронизация с S3 и Яндекс Диском и офлайн-режим недоступны. Откройте его по https:// или через http://localhost',

  'op.list': 'список файлов',
  'op.read': 'чтение {name}',
  'op.write': 'запись {name}',
  'op.meta': 'метаданные {name}',
  'op.download': 'скачивание {name}',
  'op.downloadLink': 'ссылка на {name}',
  'op.upload': 'загрузка {name}',
  'op.uploadLink': 'ссылка загрузки {name}',
  'op.createFolder': 'создание папки',
  'op.create': 'создание {name}',
  'op.update': 'обновление {name}',
  'op.deleteDuplicate': 'удаление дубликата',
};

export const DICTIONARIES = Object.freeze({ en, ru });
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(DICTIONARIES));

/** Первый поддерживаемый язык из списка предпочтений ('ru-RU' → 'ru'), иначе английский. */
export function detectLanguage(preferred = browserLanguages()) {
  for (const tag of preferred) {
    const base = String(tag ?? '').toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LANGUAGES.includes(base)) return base;
  }
  return FALLBACK_LANGUAGE;
}

function browserLanguages() {
  const nav = globalThis.navigator;
  if (!nav) return [];
  return nav.languages?.length ? nav.languages : [nav.language];
}

let current = detectLanguage();

export const getLanguage = () => current;
/** BCP 47 локаль для Intl/toLocale*: форматы дат, сортировка. */
export const getLocale = () => LOCALES[current];

export function setLanguage(language) {
  current = SUPPORTED_LANGUAGES.includes(language) ? language : FALLBACK_LANGUAGE;
  return current;
}

/** Перевод по ключу с подстановкой {параметров}. Нет ключа в языке — английский; нет и там — сам ключ. */
export function t(key, params = {}) {
  const template = DICTIONARIES[current][key] ?? DICTIONARIES[FALLBACK_LANGUAGE][key];
  if (template === undefined) {
    console.warn(`[i18n] нет перевода для ключа "${key}"`);
    return key;
  }
  return template.replace(PLACEHOLDER_RE, (match, name) => (params[name] !== undefined ? String(params[name]) : match));
}

/**
 * Переводит разметку: data-i18n → textContent, data-i18n-<attr> → атрибут (placeholder, aria-label, title, content).
 * Обрабатывает и содержимое <template>. Для корня-документа выставляет <html lang> и заголовок вкладки.
 */
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attr of TRANSLATABLE_ATTRS) {
    const dataAttr = `data-i18n-${attr}`;
    for (const node of root.querySelectorAll(`[${dataAttr}]`)) node.setAttribute(attr, t(node.getAttribute(dataAttr)));
  }
  for (const template of root.querySelectorAll('template')) applyTranslations(template.content);

  if (root === document) {
    document.documentElement.lang = current;
    document.title = t('app.title');
  }
}
