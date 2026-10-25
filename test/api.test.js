import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GUEST_SESSION_SECRET = 'test-guest-session-secret-that-is-at-least-32-characters';
process.env.ALLOWED_ORIGINS = 'https://allowed.example';
process.env.ALLOWED_HOSTS = '';
process.env.TRUST_PROXY = '0';
process.env.ENFORCE_HTTPS = 'false';
process.env.GLOBAL_RATE_LIMIT = '10000';
process.env.GLOBAL_RATE_WINDOW_MINUTES = '15';
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

const { createApp } = await import('../server/app.js');
const { resetGuestQuotaForTests } = await import('../server/lib/guestQuota.js');
const { resetGuestCircuitForTests } = await import('../server/services/guest.js');

const app = createApp();

const originalFetch = globalThis.fetch;
let lastGuestRequest = null;
let guestRequestCount = 0;

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
    if (urlString.startsWith('https://guest.test/')) {
      guestRequestCount += 1;
      lastGuestRequest = { url: urlString, options };
      return chatResponse('Guest reply from Dr.Health.');
    }
    throw new Error(`Unexpected fetch in test: ${urlString}`);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  resetGuestQuotaForTests();
  resetGuestCircuitForTests();
  lastGuestRequest = null;
  guestRequestCount = 0;
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

async function withSilencedConsole(fn) {
  const previous = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = previous;
  }
}

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
    .post('/api/guest/chat')
    .set('Origin', 'https://evil.example')
    .send({ message: 'hello' })
    .expect(403);
  assert.equal(denied.body.error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.equal(guestRequestCount, 0);
});

test('guest session is signed, HttpOnly, and resumable', async () => {
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

test('a tampered guest cookie is rejected', async () => {
  const agent = request.agent(app);
  const started = await agent.post('/api/guest/session').expect(200);
  const guestCookie = started.headers['set-cookie'].find((value) => value.startsWith('dh_guest='));
  const token = guestCookie.split(';')[0].slice('dh_guest='.length);
  const replacement = token.endsWith('A') ? 'B' : 'A';
  const tampered = `${token.slice(0, -1)}${replacement}`;

  const res = await request(app)
    .get('/api/guest/session')
    .set('Cookie', `dh_guest=${tampered}`)
    .expect(200);
  assert.equal(res.body.guest, false);
});

test('guest chat is text-only, keyless, bounded, and quota-limited', async () => {
  const agent = request.agent(app);
  await agent.post('/api/guest/session').expect(200);

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
  assert.equal(guestRequestCount, 1);
  assert.ok(lastGuestRequest);
  assert.equal(lastGuestRequest.url, 'https://guest.test/v1/chat/completions');
  assert.equal(lastGuestRequest.options.headers.Authorization, undefined);

  const payload = JSON.parse(lastGuestRequest.options.body);
  assert.equal(payload.model, 'Meta-Llama-3_3-70B-Instruct');
  assert.equal(payload.max_tokens, 500);
  assert.equal(payload.temperature, 0.3);
  assert.equal(payload.stream, false);
  assert.equal(payload.messages.length, 4);
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /under 250 words/);
  assert.match(payload.messages[0].content, /text-only/);
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

test('guest provider outages return a generic error without leaking details', async () => {
  const agent = request.agent(app);
  await agent.post('/api/guest/session').expect(200);

  await withSilencedConsole(() =>
    withFetch(
      async () => jsonResponse({ error: { message: 'upstream detail' } }, 500),
      async () => {
        const res = await agent
          .post('/api/guest/chat')
          .send({ message: 'hello' })
          .expect(503);
        assert.equal(res.body.error.code, 'GUEST_UNAVAILABLE');
        assert.ok(!JSON.stringify(res.body).includes('upstream detail'));
        assert.ok(!JSON.stringify(res.body).includes('guest.test'));
      },
    ),
  );
});

test('guest session mutations reject cross-site requests', async () => {
  const res = await request(app)
    .post('/api/guest/session')
    .set('Sec-Fetch-Site', 'cross-site')
    .expect(403);
  assert.equal(res.body.error.code, 'CSRF_REJECTED');
});

test('oversized JSON bodies are rejected before routing', async () => {
  const agent = request.agent(app);
  await agent.post('/api/guest/session').expect(200);

  const res = await agent
    .post('/api/guest/chat')
    .send({ message: 'x'.repeat(20000) })
    .expect(413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('removed sign-in, user-chat, and admin routes are gone', async () => {
  await request(app).get('/auth/openrouter').expect(404);
  await request(app).get('/auth/callback').expect(404);

  const authSession = await request(app).get('/api/auth/session').expect(404);
  assert.equal(authSession.body.error.code, 'NOT_FOUND');

  const userChat = await request(app).post('/api/chat').send({ message: 'hello' }).expect(404);
  assert.equal(userChat.body.error.code, 'NOT_FOUND');

  const admin = await request(app).get('/api/admin/stats').expect(404);
  assert.equal(admin.body.error.code, 'NOT_FOUND');
});

test('unknown API routes return JSON 404s', async () => {
  const res = await request(app).get('/api/does-not-exist').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.match(res.headers['content-type'], /application\/json/);
});

test('static frontend has no sign-in or upload surface', async () => {
  const index = await request(app).get('/').expect(200);
  assert.match(index.text, /Dr\.Health/);
  assert.match(index.text, /id="chat-form"/);
  assert.match(index.text, /id="textInput"/);
  assert.match(index.text, /id="guestRemaining"/);
  assert.ok(!index.text.includes('/auth/'));
  assert.ok(!index.text.includes('Sign in'));
  assert.ok(!index.text.includes('Continue with Google'));
  assert.ok(!index.text.includes('imageInput'));
  assert.ok(!index.text.includes('uploadButton'));
  assert.ok(!index.text.includes('Messages are processed by an AI provider'));
  assert.ok(!index.text.includes('openrouter'));
  assert.ok(!index.text.includes('AIza'));
  assert.match(index.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(index.headers['cache-control'], 'no-store');

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
