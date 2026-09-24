// AWS Signature Version 4 на WebCrypto (без зависимостей).
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html

import { t } from '../i18n.js';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const TERMINATOR = 'aws4_request';
const encoder = new TextEncoder();

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** encodeURIComponent + экранирование !'()* — требование SigV4 (RFC 3986). */
export const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * WebCrypto доступен только в безопасном контексте (https:// или localhost). По http:// с другого адреса
 * crypto.subtle === undefined — вместо непонятного TypeError объясняем, что делать.
 */
export class InsecureContextError extends Error {
  constructor() {
    super(t('error.insecureContext', { origin: globalThis.location?.origin ?? '' }));
    this.name = 'InsecureContextError';
  }
}

function subtle() {
  if (!globalThis.crypto?.subtle) throw new InsecureContextError();
  return globalThis.crypto.subtle;
}

export async function sha256Hex(data) {
  return toHex(await subtle().digest('SHA-256', toBytes(data)));
}

async function hmac(key, data) {
  const cryptoKey = await subtle().importKey('raw', toBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return subtle().sign('HMAC', cryptoKey, toBytes(data));
}

/** 2013-05-24T00:00:00.000Z -> 20130524T000000Z */
export const amzDate = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function canonicalQuery(searchParams) {
  return [...searchParams]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([ak, av], [bk, bv]) => compare(ak, bk) || compare(av, bv))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * Подписывает запрос. Возвращает заголовки для fetch (без host — его выставляет браузер).
 * url должен содержать уже закодированный путь (encodeRfc3986 по сегментам).
 */
export async function signRequest({
  method, url, headers = {}, payloadHash = EMPTY_SHA256,
  accessKeyId, secretAccessKey, region, service = 's3', date = new Date(),
}) {
  const u = new URL(url);
  const datetime = amzDate(date);
  const day = datetime.slice(0, 8);

  const all = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': datetime };
  for (const [name, value] of Object.entries(headers)) all[name.toLowerCase()] = value;

  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, u.pathname || '/', canonicalQuery(u.searchParams), canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${day}/${region}/${service}/${TERMINATOR}`;
  const stringToSign = [ALGORITHM, datetime, scope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(`AWS4${secretAccessKey}`, day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, TERMINATOR);
  const signature = toHex(await hmac(kSigning, stringToSign));

  const { host, ...fetchHeaders } = all;
  fetchHeaders.authorization = `${ALGORITHM} Credential=${accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return fetchHeaders;
}
