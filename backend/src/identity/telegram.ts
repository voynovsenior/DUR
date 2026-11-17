import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedTelegramInitData {
  user: TelegramWebAppUser;
  authDate: number;
  queryId?: string;
}

export type TelegramVerificationOptions = {
  botToken: string;
  nowSeconds?: number;
  maxAgeSeconds?: number;
  futureSkewSeconds?: number;
};

/**
 * Verifies Telegram Web App initData using Telegram's documented HMAC scheme.
 * Pass the raw initData string from Telegram.WebApp.initData, never initDataUnsafe.
 */
export function verifyTelegramInitData(
  rawInitData: string,
  options: TelegramVerificationOptions,
): VerifiedTelegramInitData {
  const {
    botToken,
    nowSeconds = Math.floor(Date.now() / 1000),
    maxAgeSeconds = 60 * 60,
    futureSkewSeconds = 30,
  } = options;

  if (!botToken || !rawInitData || rawInitData.length > 16_384) {
    throw new Error('invalid_init_data');
  }

  const params = new URLSearchParams(rawInitData);
  const entries = [...params.entries()];
  if (entries.length === 0 || params.getAll('hash').length !== 1) {
    throw new Error('invalid_init_data');
  }

  // Reject duplicate keys to avoid parser differentials between services.
  const keys = entries.map(([key]) => key);
  if (new Set(keys).size !== keys.length) {
    throw new Error('invalid_init_data');
  }

  const receivedHash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error('invalid_signature');
  }

  const dataCheckString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const expectedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();

  const suppliedHash = Buffer.from(receivedHash, 'hex');
  if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
    throw new Error('invalid_signature');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new Error('invalid_auth_date');
  }

  const authDate = Number(authDateRaw);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + futureSkewSeconds) {
    throw new Error('invalid_auth_date');
  }
  if (nowSeconds - authDate > maxAgeSeconds) {
    throw new Error('expired_init_data');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('missing_user');

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new Error('invalid_user');
  }

  if (!user || typeof user !== 'object' || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') {
    throw new Error('invalid_user');
  }

  return {
    user,
    authDate,
    ...(params.get('query_id') ? { queryId: params.get('query_id')! } : {}),
  };
}
