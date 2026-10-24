import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const ISSUER = 'drhealth';
const AUDIENCE = 'admin';
const CLOCK_SKEW_SECONDS = 60;
const MAX_ACTIVE_SESSIONS = 100;

// Server-side session registry. This makes logout revoke the token immediately.
// For multi-instance deployments, replace this with a shared store (e.g. Redis).
const activeSessions = new Map();

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function pruneExpired(now) {
  for (const [sid, expiresAt] of activeSessions) {
    if (expiresAt <= now) activeSessions.delete(sid);
  }
  while (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldest = activeSessions.keys().next().value;
    activeSessions.delete(oldest);
  }
}

/**
 * Create a signed admin session token and register its ID server-side.
 * The token is only ever stored in an HttpOnly cookie.
 */
export function createSessionToken(ttlSeconds = config.adminSessionTtlSeconds) {
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET is not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  pruneExpired(now);

  const payload = {
    sub: 'admin',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
    sid: randomUUID(),
  };

  activeSessions.set(payload.sid, payload.exp);
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, config.sessionSecret)}`;
}

/**
 * Verify signature, issuer, audience, expiry, and server-side session state.
 * Returns the payload or null.
 */
export function verifySessionToken(token) {
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
    payload.sub !== 'admin' ||
    payload.iss !== ISSUER ||
    payload.aud !== AUDIENCE ||
    typeof payload.sid !== 'string' ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp)
  ) {
    return null;
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) return null;
  if (payload.exp <= now) return null;
  if (payload.exp - payload.iat > config.adminSessionTtlSeconds + CLOCK_SKEW_SECONDS) return null;

  pruneExpired(now);
  const registeredExpiry = activeSessions.get(payload.sid);
  if (!registeredExpiry || registeredExpiry <= now) return null;

  return payload;
}

export function revokeSession(sid) {
  if (typeof sid === 'string') activeSessions.delete(sid);
}

export function revokeToken(token) {
  if (typeof token !== 'string') return;
  const session = verifySessionToken(token);
  if (session) activeSessions.delete(session.sid);
}
