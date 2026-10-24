import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const ISSUER = 'drhealth';
const AUDIENCE = 'guest';
const CLOCK_SKEW_SECONDS = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createGuestSessionToken(ttlSeconds = config.guestSessionTtlSeconds) {
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET is not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: randomUUID(),
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, config.sessionSecret)}`;
}

export function verifyGuestSessionToken(token) {
  if (!config.sessionSecret || typeof token !== 'string') return null;
  if (token.length > 4096) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!/^[A-Za-z0-9_-]{1,4000}$/.test(encodedPayload)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;

  const expected = Buffer.from(sign(encodedPayload, config.sessionSecret), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !payload ||
    typeof payload.sub !== 'string' ||
    !UUID_PATTERN.test(payload.sub) ||
    payload.iss !== ISSUER ||
    payload.aud !== AUDIENCE ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp)
  ) {
    return null;
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) return null;
  if (payload.exp <= now) return null;
  if (payload.exp - payload.iat > config.guestSessionTtlSeconds + CLOCK_SKEW_SECONDS) return null;

  return payload;
}
