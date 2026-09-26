// Конфигурация приложения. Заполните под своё окружение перед деплоем.
export const CONFIG = Object.freeze({
  // Внешний сервис регистрации: пользователь уходит сюда и возвращается с client_id/client_secret.
  REGISTRATION_URL: 'https://auth.example.com/register',
  // API хранения заметок для режима «Регистрация» (протокол — docs/PROTOCOL.md).
  REGISTRATION_API_URL: 'https://api.example.com/v1',

  // OAuth client_id приложений (redirect URI = адрес index.html этого сайта; см. docs/CONFIGURATION.md).
  YANDEX_CLIENT_ID: 'd47feb9268904115a2696b31e337054a',
  GOOGLE_CLIENT_ID: '608012088849-2qahjpfs91qp14iucc0ufaquv5kfm0l4.apps.googleusercontent.com',

  // Автосинхронизация.
  AUTO_SYNC_DELAY_MS: 2000,
  SYNC_INTERVAL_MS: 5 * 60 * 1000,
});
