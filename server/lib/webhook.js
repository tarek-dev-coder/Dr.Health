import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * Create a Stripe-style signature header for a raw request body.
 * Format: t=<unix-seconds>,v1=<hex hmac-sha256 of "t.body">
 */
export function signWebhookPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Webhook secret is required');
  }
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const timestampValue = String(timestamp);
  const signature = createHmac('sha256', secret)
    .update(`${timestampValue}.`)
    .update(body)
    .digest('hex');
  return `t=${timestampValue},v1=${signature}`;
}

/**
 * Verify a webhook signature and enforce a replay window.
 * The raw request body must be used, before JSON parsing.
 */
export function verifyWebhookSignature({
  payload,
  signatureHeader,
  secret,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
}) {
  if (typeof signatureHeader !== 'string' || typeof secret !== 'string' || secret.length === 0) {
    return false;
  }

  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const parts = signatureHeader.split(',').map((part) => part.trim());

  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === 't' && /^\d{1,12}$/.test(value)) {
      timestamp = Number(value);
    } else if (key === 'v1' && SIGNATURE_PATTERN.test(value)) {
      signatures.push(value);
    }
  }

  if (!Number.isInteger(timestamp) || signatures.length === 0) return false;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest();

  return signatures.some((signature) => {
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
