import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { hashPassword } from '../server/lib/passwords.js';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.OPENROUTER_CALLBACK_URL = 'http://localhost:3000/auth/callback';
process.env.OPENROUTER_AUTH_URL = 'https://openrouter.test/auth';
process.env.OPENROUTER_API_BASE = 'https://openrouter.test/api/v1';
process.env.OPENROUTER_MODEL = 'google/gemma-4-31b-it:free';
process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemma-4-26b-a4b-it:free';
process.env.OPENROUTER_TIMEOUT_MS = '60000';
process.env.OPENROUTER_KEY_LABEL = 'Dr.Health';
process.env.DATABASE_URL = '';
process.env.DATABASE_SSL = 'false';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters-long';
process.env.KEY_ENCRYPTION_SECRET = 'test-key-encryption-secret-that-is-at-least-32-characters';
process.env.ALLOWED_ORIGINS = 'https://allowed.example';
process.env.ALLOWED_HOSTS = '';
process.env.TRUST_PROXY = '0';
process.env.ENFORCE_HTTPS = 'false';
process.env.MAX_UPLOAD_MB = '1';
process.env.MAX_MESSAGE_CHARS = '4000';
process.env.MAX_HISTORY_TURNS = '20';
process.env.MAX_HISTORY_CHARS = '20000';
process.env.ADMIN_SESSION_TTL_MINUTES = '120';
process.env.USER_SESSION_TTL_MINUTES = '120';
process.env.CHAT_RATE_LIMIT = '1000';
process.env.GLOBAL_RATE_LIMIT = '10000';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.GUEST_MODE_ENABLED = 'true';
process.env.GUEST_API_URL = 'https://guest.test/v1/chat/completions';
process.env.GUEST_MODEL = 'Meta-Llama-3_3-70B-Instruct';
process.env.GUEST_API_KEY = '';
process.env.GUEST_TIMEOUT_MS = '5000';
process.env.GUEST_MAX_OUTPUT_TOKENS = '500';
process.env.GUEST_MAX_MESSAGE_CHARS = '2000';
process.env.GUEST_MAX_HISTORY_TURNS = '4';
process.env.GUEST_MAX_HISTORY_CHARS = '4000';
process.env.GUEST_MAX_RESPONSE_CHARS = '6000';
process.env.GUEST_DAILY_LIMIT = '2';
process.env.GUEST_IP_DAILY_LIMIT = '100';
process.env.GUEST_GLOBAL_DAILY_LIMIT = '100';
process.env.GUEST_RATE_LIMIT = '1000';
process.env.GUEST_RATE_WINDOW_MINUTES = '10';
process.env.GUEST_MAX_CONCURRENT = '2';
process.env.GUEST_SESSION_TTL_MINUTES = '60';

const ADMIN_PASSWORD = 'test-admin-password-123!';
process.env.ADMIN_PASSWORD_HASH = await hashPassword(ADMIN_PASSWORD);

const { createApp } = await import('../server/app.js');
const { decryptSecret, encryptSecret, hashSecret } = await import('../server/lib/keyVault.js');
const { getUser } = await import('../server/lib/store.js');
const app = createApp();

const TEST_KEY = 'sk-or-v1-test-key-1234567890abcdef';
const originalFetch = globalThis.fetch;
let lastAiRequest = null;
let lastGuestRequest = null;
let guestRequestCount = 0;
let authExchangeRequests = 0;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function chatResponse(text = 'Test reply from Dr.Health.') {
  return jsonResponse({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

function quotaResponse(retryAfter = '120') {
  return jsonResponse(
    { error: { message: 'rate limited', code: 429 } },
    429,
    { 'Retry-After': retryAfter },
  );
}

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const urlString = String(url);

    if (urlString.endsWith('/auth/keys')) {
      authExchangeRequests += 1;
      return jsonResponse({ key: TEST_KEY });
    }

    if (urlString.startsWith('https://guest.test/')) {
      guestRequestCount += 1;
      lastGuestRequest = { url: urlString, options };
      return chatResponse('Guest reply from Dr.Health.');
    }

    if (urlString.endsWith('/chat/completions')) {
      lastAiRequest = { url: urlString, options };
      return chatResponse();
    }

    throw new Error(`Unexpected fetch in test: ${urlString}`);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

async function withFetch(handler, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}

async function signIn() {
  const agent = request.agent(app);
  const start = await agent.get('/auth/openrouter').expect(302);
  const location = new URL(start.headers.location);
  const state = location.searchParams.get('state');

  assert.ok(state);
  const callback = await agent
    .get('/auth/callback')
    .query({ code: 'test-authorization-code', state })
    .expect(302);

  assert.match(callback.headers.location, /signed_in=1/);

  const setCookie = callback.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie));
  const userCookie = setCookie.find((value) => value.startsWith('dh_user='));
  assert.ok(userCookie);
  assert.match(userCookie, /HttpOnly/i);
  assert.match(userCookie, /SameSite=Lax/i);
  assert.match(userCookie, /Path=\//i);

  const token = userCookie.split(';')[0].slice('dh_user='.length);
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  agent.testUserId = payload.sub;

  return agent;
}

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);

test('health endpoint returns security headers and hides implementation details', async () => {
  const res = await request(app).get('/api/health').expect(200);

  assert.equal(res.body.status, 'ok');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(res.headers['content-security-policy'], /require-trusted-types-for 'script'/);
  assert.match(res.headers['content-security-policy'], /trusted-types 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.match(res.headers['permissions-policy'], /camera=\(\)/);
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('allowed origins are reflected while unknown origins are rejected', async () => {
  const allowed = await request(app)
    .get('/api/health')
    .set('Origin', 'https://allowed.example')
    .expect(200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.example');

  const denied = await request(app)
    .post('/api/chat')
    .set('Origin', 'https://evil.example')
    .field('message', 'hello')
    .expect(403);
  assert.equal(denied.body.error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('chat requires a signed-in user', async () => {
  const res = await request(app)
    .post('/api/chat')
    .send({ message: 'Is drinking water healthy?' })
    .expect(401);

  assert.equal(res.body.error.code, 'SIGN_IN_REQUIRED');
  assert.equal(lastAiRequest, null);
});

test('auth start redirects to the provider with PKCE and a state cookie', async () => {
  const res = await request(app).get('/auth/openrouter').expect(302);
  const location = new URL(res.headers.location);

  assert.equal(location.origin, 'https://openrouter.test');
  assert.equal(location.pathname, '/auth');
  assert.equal(location.searchParams.get('callback_url'), 'http://localhost:3000/auth/callback');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('code_challenge').length, 43);
  assert.ok(location.searchParams.get('state'));
  assert.equal(location.searchParams.get('key_label'), 'Dr.Health');

  const setCookie = res.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie) && setCookie.length === 1);
  assert.match(setCookie[0], /^dh_oauth=/);
  assert.match(setCookie[0], /HttpOnly/i);
  assert.match(setCookie[0], /SameSite=Lax/i);
  assert.match(setCookie[0], /Path=\/auth/i);
});

test('auth callback rejects a missing or mismatched state', async () => {
  const missing = await request(app)
    .get('/auth/callback')
    .query({ code: 'test-code' })
    .expect(302);
  assert.match(missing.headers.location, /auth_error=1/);

  const agent = request.agent(app);
  await agent.get('/auth/openrouter').expect(302);
  const mismatched = await agent
    .get('/auth/callback')
    .query({ code: 'test-code', state: 'wrong-state' })
    .expect(302);
  assert.match(mismatched.headers.location, /auth_error=1/);
});

test('auth callback fails closed when the code exchange is rejected', async () => {
  const agent = request.agent(app);
  const start = await agent.get('/auth/openrouter').expect(302);
  const state = new URL(start.headers.location).searchParams.get('state');

  await withFetch(
    async (url) => {
      assert.match(String(url), /\/auth\/keys$/);
      return jsonResponse({ error: { message: 'invalid code' } }, 403);
    },
    async () => {
      const res = await agent
        .get('/auth/callback')
        .query({ code: 'bad-code', state })
        .expect(302);
      assert.match(res.headers.location, /auth_error=1/);
      assert.equal(res.headers['set-cookie'].some((value) => value.startsWith('dh_user=')), false);
    },
  );
});

test('an unauthenticated session check returns false', async () => {
  const res = await request(app).get('/api/auth/session').expect(200);
  assert.equal(res.body.authenticated, false);
});

test('guest session is available without sign-in and uses a signed HttpOnly cookie', async () => {
  const anonymous = await request(app).get('/api/guest/session').expect(200);
  assert.equal(anonymous.body.available, true);
  assert.equal(anonymous.body.guest, false);
  assert.equal(anonymous.body.remaining, 2);
  assert.equal(anonymous.headers['set-cookie'], undefined);

  const agent = request.agent(app);
  const started = await agent.post('/api/guest/session').expect(200);
  assert.equal(started.body.available, true);
  assert.equal(started.body.guest, true);
  assert.equal(started.body.remaining, 2);
  assert.equal(started.headers['cache-control'], 'no-store');

  const setCookie = started.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie));
  const guestCookie = setCookie.find((value) => value.startsWith('dh_guest='));
  assert.ok(guestCookie);
  assert.match(guestCookie, /HttpOnly/i);
  assert.match(guestCookie, /SameSite=Lax/i);
  assert.match(guestCookie, /Path=\//i);

  const token = guestCookie.split(';')[0].slice('dh_guest='.length);
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.match(payload.sub, /^[0-9a-f-]{36}$/i);
  assert.equal(payload.aud, 'guest');

  const resumed = await agent.get('/api/guest/session').expect(200);
  assert.equal(resumed.body.guest, true);
  assert.equal(resumed.body.remaining, 2);
});

test('guest chat is text-only, keyless, bounded, and quota-limited', async () => {
  const agent = request.agent(app);
  await agent.post('/api/guest/session').expect(200);
  lastAiRequest = null;
  lastGuestRequest = null;
  guestRequestCount = 0;

  const first = await agent
    .post('/api/guest/chat')
    .send({
      message: 'And what about lunch?',
      history: [
        { role: 'user', text: 'Tell me about breakfast.' },
        { role: 'model', text: 'Breakfast matters.' },
      ],
    })
    .expect(200);

  assert.equal(first.body.reply, 'Guest reply from Dr.Health.');
  assert.equal(first.body.remaining, 1);
  assert.equal(lastAiRequest, null);
  assert.equal(guestRequestCount, 1);
  assert.ok(lastGuestRequest);
  assert.equal(lastGuestRequest.url, 'https://guest.test/v1/chat/completions');
  assert.equal(lastGuestRequest.options.headers.Authorization, undefined);
  assert.ok(!JSON.stringify(first.body).includes(TEST_KEY));

  const payload = JSON.parse(lastGuestRequest.options.body);
  assert.equal(payload.model, 'Meta-Llama-3_3-70B-Instruct');
  assert.equal(payload.max_tokens, 500);
  assert.equal(payload.temperature, 0.3);
  assert.equal(payload.stream, false);
  assert.equal(payload.messages.length, 4);
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /under 250 words/);
  assert.match(payload.messages[0].content, /Never disclose the underlying model name/);
  assert.equal(payload.messages[1].role, 'user');
  assert.equal(payload.messages[1].content, 'Tell me about breakfast.');
  assert.equal(payload.messages[2].role, 'assistant');
  assert.equal(payload.messages[2].content, 'Breakfast matters.');
  assert.equal(payload.messages[3].role, 'user');
  assert.equal(payload.messages[3].content, 'And what about lunch?');
  assert.equal(
    payload.messages.some((message) => Array.isArray(message.content)),
    false,
  );

  const second = await agent
    .post('/api/guest/chat')
    .send({ message: 'What is a balanced dinner?' })
    .expect(200);
  assert.equal(second.body.remaining, 0);
  assert.equal(guestRequestCount, 2);

  const blocked = await agent
    .post('/api/guest/chat')
    .send({ message: 'One more question?' })
    .expect(429);
  assert.equal(blocked.body.error.code, 'GUEST_LIMIT_REACHED');
  assert.equal(blocked.body.error.retryAfterSeconds > 0, true);
  assert.equal(guestRequestCount, 2);
});

test('guest chat rejects image payloads and malformed input', async () => {
  const agent = request.agent(app);
  await agent.post('/api/guest/session').expect(200);
  guestRequestCount = 0;

  const image = await agent
    .post('/api/guest/chat')
    .send({ message: 'What is in this image?', image: 'data:image/png;base64,abc' })
    .expect(400);
  assert.equal(image.body.error.code, 'GUEST_TEXT_ONLY');

  const missing = await agent.post('/api/guest/chat').send({}).expect(400);
  assert.equal(missing.body.error.code, 'MESSAGE_REQUIRED');

  const oversized = await agent
    .post('/api/guest/chat')
    .send({ message: 'x'.repeat(2001) })
    .expect(400);
  assert.equal(oversized.body.error.code, 'MESSAGE_TOO_LONG');

  const badHistory = await agent
    .post('/api/guest/chat')
    .send({ message: 'hello', history: '{not-json' })
    .expect(400);
  assert.equal(badHistory.body.error.code, 'INVALID_HISTORY');

  const tooManyTurns = await agent
    .post('/api/guest/chat')
    .send({
      message: 'hello',
      history: Array.from({ length: 5 }, () => ({ role: 'user', text: 'x' })),
    })
    .expect(400);
  assert.equal(tooManyTurns.body.error.code, 'INVALID_HISTORY');
  assert.equal(guestRequestCount, 0);
});

test('guest provider rate limits become a guest busy error without leaking details', async () => {
  const agent = request.agent(app);
  await agent.post('/api/guest/session').expect(200);

  await withFetch(
    async () => quotaResponse('30'),
    async () => {
      const res = await agent
        .post('/api/guest/chat')
        .send({ message: 'hello' })
        .expect(429);
      assert.equal(res.body.error.code, 'GUEST_BUSY');
      assert.equal(res.body.error.retryAfterSeconds, 30);
      assert.equal(res.headers['retry-after'], '30');
      assert.ok(!JSON.stringify(res.body).includes('guest.test'));
    },
  );
});

test('sign-in stores an encrypted key, sets an HttpOnly session, and exposes no key', async () => {
  const beforeCount = authExchangeRequests;
  const agent = await signIn();
  assert.equal(authExchangeRequests, beforeCount + 1);

  const session = await agent.get('/api/auth/session').expect(200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.key, undefined);
  assert.equal(session.body.user, undefined);
  assert.equal(session.headers['set-cookie'], undefined);

  const stored = await getUser(agent.testUserId);
  assert.ok(stored);
  assert.ok(!stored.keyCiphertext.includes(TEST_KEY));
  assert.ok(!stored.keyIv.includes(TEST_KEY));
  assert.equal(
    decryptSecret({
      ciphertext: stored.keyCiphertext,
      iv: stored.keyIv,
      tag: stored.keyTag,
    }),
    TEST_KEY,
  );
});

test('chat proxies to OpenRouter with the user key and never exposes it', async () => {
  const agent = await signIn();
  lastAiRequest = null;

  const res = await agent
    .post('/api/chat')
    .field('message', 'Is drinking water healthy?')
    .expect(200);

  assert.equal(res.body.reply, 'Test reply from Dr.Health.');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(!JSON.stringify(res.body).includes(TEST_KEY));
  assert.ok(lastAiRequest);
  assert.ok(!lastAiRequest.url.includes(TEST_KEY));
  assert.equal(lastAiRequest.options.headers.Authorization, `Bearer ${TEST_KEY}`);

  const payload = JSON.parse(lastAiRequest.options.body);
  assert.equal(payload.model, 'google/gemma-4-31b-it:free');
  assert.equal(payload.max_tokens, 2048);
  assert.equal(payload.temperature, 0.4);
  assert.equal(payload.stream, false);
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /Dr\.Health/);
  assert.match(payload.messages[0].content, /Never disclose the underlying model name/);
  assert.equal(payload.messages.at(-1).role, 'user');
  assert.equal(payload.messages.at(-1).content, 'Is drinking water healthy?');
});

test('chat falls back to the next free model when the primary is rate-limited', async () => {
  const agent = await signIn();
  const calls = [];

  await withFetch(
    async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      if (calls.length === 1) return quotaResponse('90');
      return chatResponse('Fallback reply.');
    },
    async () => {
      const res = await agent
        .post('/api/chat')
        .send({ message: 'Is drinking water healthy?' })
        .expect(200);
      assert.equal(res.body.reply, 'Fallback reply.');
    },
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /chat\/completions$/);
  assert.equal(calls[0].body.model, 'google/gemma-4-31b-it:free');
  assert.equal(calls[1].body.model, 'google/gemma-4-26b-a4b-it:free');
});

test('chat returns a quota error with Retry-After when every free model is exhausted', async () => {
  const agent = await signIn();
  const calls = [];

  await withFetch(
    async () => {
      calls.push('called');
      return quotaResponse('90');
    },
    async () => {
      const res = await agent
        .post('/api/chat')
        .send({ message: 'hello' })
        .expect(429);
      assert.equal(res.body.error.code, 'AI_QUOTA_EXHAUSTED');
      assert.equal(res.body.error.retryAfterSeconds, 90);
      assert.equal(res.headers['retry-after'], '90');
      assert.ok(!JSON.stringify(res.body).includes(TEST_KEY));
    },
  );

  assert.equal(calls.length, 2);
});

test('chat returns a sign-in error when the user key is rejected', async () => {
  const agent = await signIn();

  await withFetch(
    async () => jsonResponse({ error: { message: 'invalid key' } }, 401),
    async () => {
      const res = await agent
        .post('/api/chat')
        .send({ message: 'hello' })
        .expect(401);
      assert.equal(res.body.error.code, 'AI_KEY_INVALID');
      assert.ok(!JSON.stringify(res.body).includes(TEST_KEY));
    },
  );
});

test('chat accepts JSON text-only requests', async () => {
  const agent = await signIn();
  const res = await agent
    .post('/api/chat')
    .send({ message: 'What is a balanced breakfast?' })
    .expect(200);
  assert.equal(res.body.reply, 'Test reply from Dr.Health.');
});

test('chat rejects missing, oversized, and malformed input', async () => {
  const agent = await signIn();

  const missing = await agent.post('/api/chat').field('message', '   ').expect(400);
  assert.equal(missing.body.error.code, 'MESSAGE_REQUIRED');

  const oversized = await agent
    .post('/api/chat')
    .field('message', 'x'.repeat(4001))
    .expect(400);
  assert.equal(oversized.body.error.code, 'MESSAGE_TOO_LONG');

  const badHistory = await agent
    .post('/api/chat')
    .field('message', 'hello')
    .field('history', '{not-json')
    .expect(400);
  assert.equal(badHistory.body.error.code, 'INVALID_HISTORY');

  const tooManyTurns = await agent
    .post('/api/chat')
    .field('message', 'hello')
    .field(
      'history',
      JSON.stringify(Array.from({ length: 21 }, () => ({ role: 'user', text: 'x' }))),
    )
    .expect(400);
  assert.equal(tooManyTurns.body.error.code, 'INVALID_HISTORY');
});

test('chat validates history and maps assistant turns', async () => {
  const agent = await signIn();
  lastAiRequest = null;

  await agent
    .post('/api/chat')
    .field('message', 'And what about lunch?')
    .field(
      'history',
      JSON.stringify([
        { role: 'user', text: 'Tell me about breakfast.' },
        { role: 'model', text: 'Breakfast matters.' },
      ]),
    )
    .expect(200);

  const payload = JSON.parse(lastAiRequest.options.body);
  assert.equal(payload.messages.length, 4);
  assert.equal(payload.messages[1].role, 'user');
  assert.equal(payload.messages[1].content, 'Tell me about breakfast.');
  assert.equal(payload.messages[2].role, 'assistant');
  assert.equal(payload.messages[2].content, 'Breakfast matters.');
  assert.equal(payload.messages[3].content, 'And what about lunch?');
});

test('chat validates uploaded image content using magic bytes', async () => {
  const agent = await signIn();
  lastAiRequest = null;

  const valid = await agent
    .post('/api/chat')
    .field('message', 'What is in this image?')
    .attach('image', PNG_1X1, { filename: 'pixel.png', contentType: 'image/png' })
    .expect(200);
  assert.equal(valid.body.reply, 'Test reply from Dr.Health.');

  const payload = JSON.parse(lastAiRequest.options.body);
  const content = payload.messages.at(-1).content;
  assert.ok(Array.isArray(content));
  const imagePart = content.find((part) => part.type === 'image_url');
  assert.equal(imagePart.image_url.url, `data:image/png;base64,${PNG_1X1.toString('base64')}`);

  const invalid = await agent
    .post('/api/chat')
    .attach('image', Buffer.from('this is definitely not a png'), {
      filename: 'fake.png',
      contentType: 'image/png',
    })
    .expect(415);
  assert.equal(invalid.body.error.code, 'INVALID_IMAGE');

  const svg = await agent
    .post('/api/chat')
    .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
      filename: 'x.svg',
      contentType: 'image/svg+xml',
    })
    .expect(415);
  assert.equal(svg.body.error.code, 'UNSUPPORTED_IMAGE');
});

test('chat rejects images larger than the configured limit', async () => {
  const agent = await signIn();
  const res = await agent
    .post('/api/chat')
    .attach('image', Buffer.alloc(1024 * 1024 + 1024), {
      filename: 'large.png',
      contentType: 'image/png',
    })
    .expect(413);
  assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
});

test('logout revokes the local key and clears the session', async () => {
  const agent = await signIn();
  await agent.get('/api/auth/session').expect(200).expect((res) => {
    assert.equal(res.body.authenticated, true);
  });

  await agent.post('/api/auth/logout').expect(200);

  const afterLogout = await agent.get('/api/auth/session').expect(200);
  assert.equal(afterLogout.body.authenticated, false);

  const chat = await agent.post('/api/chat').send({ message: 'hello' }).expect(401);
  assert.equal(chat.body.error.code, 'SIGN_IN_REQUIRED');
});

test('admin login issues an HttpOnly cookie and protects routes', async () => {
  const badLogin = await request(app)
    .post('/api/admin/login')
    .send({ password: 'wrong-password' })
    .expect(401);
  assert.equal(badLogin.body.error.code, 'INVALID_CREDENTIALS');

  const unauthenticated = await request(app).get('/api/admin/stats').expect(401);
  assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED');

  const login = await request(app)
    .post('/api/admin/login')
    .send({ password: ADMIN_PASSWORD })
    .expect(200);
  assert.equal(login.body.authenticated, true);

  const setCookie = login.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie) && setCookie.length === 1);
  assert.match(setCookie[0], /HttpOnly/i);
  assert.match(setCookie[0], /SameSite=Strict/i);
  assert.match(setCookie[0], /Path=\//i);
  const cookie = setCookie[0].split(';')[0];

  const session = await request(app)
    .get('/api/admin/session')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(session.body.authenticated, true);

  const stats = await request(app)
    .get('/api/admin/stats')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(typeof stats.body.uptimeSeconds, 'number');
  assert.equal(stats.body.ai.configured, true);
  assert.equal(stats.body.ai.model, 'google/gemma-4-31b-it:free');
  assert.equal(stats.headers['cache-control'], 'no-store');

  await request(app).post('/api/admin/logout').set('Cookie', cookie).expect(200);

  const afterLogout = await request(app)
    .get('/api/admin/stats')
    .set('Cookie', cookie)
    .expect(401);
  assert.equal(afterLogout.body.error.code, 'SESSION_EXPIRED');
});

test('admin routes reject cross-site and malformed requests', async () => {
  await request(app)
    .post('/api/admin/login')
    .set('Origin', 'https://evil.example')
    .send({ password: ADMIN_PASSWORD })
    .expect(403);

  await request(app)
    .post('/api/admin/login')
    .set('Sec-Fetch-Site', 'cross-site')
    .send({ password: ADMIN_PASSWORD })
    .expect(403);

  const malformed = await request(app)
    .post('/api/admin/login')
    .set('Content-Type', 'application/json')
    .send('{"password":')
    .expect(400);
  assert.equal(malformed.body.error.code, 'INVALID_JSON');
});

test('unknown API routes return JSON 404s', async () => {
  const res = await request(app).get('/api/does-not-exist').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.match(res.headers['content-type'], /application\/json/);
});

test('static frontend is served without exposing dotfiles or secrets', async () => {
  const index = await request(app).get('/').expect(200);
  assert.match(index.text, /Dr\.Health/);
  assert.match(index.text, /Continue with Google/);
  assert.match(index.text, /href="\/auth\/openrouter"/);
  assert.ok(!index.text.includes('Messages are processed by an AI provider'));
  assert.match(index.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(index.headers['cache-control'], 'no-store');
  assert.ok(!index.text.includes('AIza'));
  assert.ok(!index.text.includes('openrouter.ai'));

  await request(app).get('/.env').expect(404);
  await request(app).get('/server/config.js').expect(404);
});

test('text responses are compressed and image assets are cached', async () => {
  const compressed = await request(app)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect(200);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.match(compressed.headers['vary'], /Accept-Encoding/);

  const poster = await request(app).get('/assets/health-hero-poster.jpg').expect(200);
  assert.match(poster.headers['cache-control'], /max-age=86400/);
});

test('per-user keys are encrypted at rest and tampering is rejected', () => {
  const encrypted = encryptSecret(TEST_KEY);
  assert.ok(!encrypted.ciphertext.includes(TEST_KEY));
  assert.equal(decryptSecret(encrypted), TEST_KEY);
  assert.equal(hashSecret(TEST_KEY), hashSecret(TEST_KEY));
  assert.notEqual(hashSecret(TEST_KEY), hashSecret(`${TEST_KEY}x`));

  const tampered = { ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') };
  assert.throws(() => decryptSecret(tampered));
});
