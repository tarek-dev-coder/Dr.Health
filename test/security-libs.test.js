import test from 'node:test';
import assert from 'node:assert/strict';
import { signWebhookPayload, verifyWebhookSignature } from '../server/lib/webhook.js';
import { hashPassword, verifyPassword } from '../server/lib/passwords.js';

const SECRET = 'whsec_test_secret_value_1234567890';
const NOW = 1_700_000_000;

test('webhook signatures verify only for the exact payload and secret', () => {
  const payload = JSON.stringify({ event: 'appointment.created', id: 'evt_123' });
  const header = signWebhookPayload(payload, SECRET, NOW);

  assert.equal(verifyWebhookSignature({ payload, signatureHeader: header, secret: SECRET, now: NOW }), true);
  assert.equal(
    verifyWebhookSignature({ payload: `${payload} `, signatureHeader: header, secret: SECRET, now: NOW }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({ payload, signatureHeader: header, secret: `${SECRET}x`, now: NOW }),
    false,
  );
});

test('webhook signatures reject expired timestamps and malformed headers', () => {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  const header = signWebhookPayload(payload, SECRET, NOW);

  assert.equal(
    verifyWebhookSignature({ payload, signatureHeader: header, secret: SECRET, now: NOW + 301 }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({ payload, signatureHeader: header, secret: SECRET, now: NOW + 299 }),
    true,
  );
  assert.equal(
    verifyWebhookSignature({ payload, signatureHeader: 'garbage', secret: SECRET, now: NOW }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({
      payload,
      signatureHeader: `t=${NOW},v1=${'0'.repeat(64)}`,
      secret: SECRET,
      now: NOW,
    }),
    false,
  );
});

test('password hashes use unique salts and verify in constant time', async () => {
  const password = 'a-long-test-password-123';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong-password-000', first), false);
  assert.equal(await verifyPassword(password, 'not-a-valid-hash'), false);
  assert.equal(await verifyPassword(password, 'scrypt$999999$8$1$AAAA$AAAA'), false);
});

test('password hashing rejects short passwords', async () => {
  await assert.rejects(() => hashPassword('short'), /at least 12 characters/);
});