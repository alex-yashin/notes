// Фабрика адаптера по текущим настройкам.

import { CONFIG } from '../config.js';
import { PROVIDERS, isTokenValid } from '../settings.js';
import { AuthError } from './engine.js';
import { createS3Remote } from './s3.js';
import { createYandexRemote } from './yandex.js';
import { createGoogleDriveRemote } from './gdrive.js';
import { createRegistrationRemote } from './registration.js';
import { t } from '../i18n.js';

/** Возвращает адаптер или null, если синхронизация выключена. Бросает AuthError, если нужен вход. */
export function createRemote(settings) {
  switch (settings.provider) {
    case PROVIDERS.S3: {
      const { endpoint, bucket, accessKeyId, secretAccessKey } = settings.s3;
      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new AuthError(t('error.fillS3'));
      return createS3Remote(settings.s3);
    }
    case PROVIDERS.YANDEX:
      if (!isTokenValid(settings.yandex)) throw new AuthError(t('error.signIn', { provider: t('provider.yandex') }));
      return createYandexRemote(settings.yandex);
    case PROVIDERS.GDRIVE:
      if (!isTokenValid(settings.gdrive)) throw new AuthError(t('error.signIn', { provider: t('provider.gdrive') }));
      return createGoogleDriveRemote(settings.gdrive);
    case PROVIDERS.REGISTRATION:
      return createRegistrationRemote({ apiUrl: CONFIG.REGISTRATION_API_URL, ...settings.registration });
    default:
      return null;
  }
}
