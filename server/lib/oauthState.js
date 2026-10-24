import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const MAX_COOKIE_LENGTH = 4096;

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createOAuthState() {
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET is not configured');
  }

  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const payload = {
    state,
    verifier,
    exp: Math.floor(Date.now() / 1000) + config.oauthStateTtlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

  return {
    state,
    challenge,
    cookieValue: `${encodedPayload}.${sign(encodedPayload, config.sessionSecret)}`,
  };
}

export function verifyOAuthState(cookieValue, receivedState) {
  if (!config.sessionSecret || typeof cookieValue !== 'string') return null;
  if (cookieValue.length > MAX_COOKIE_LENGTH) return null;
  if (typeof receivedState !== 'string' || receivedState.length > 512) return null;

  const parts = cookieValue.split('.');
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

  if (
    !payload ||
    typeof payload.state !== 'string' ||
    typeof payload.verifier !== 'string' ||
    !Number.isInteger(payload.exp)
  ) {
    return null;
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (payload.state !== receivedState) return null;

  return { verifier: payload.verifier };
}
