import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.ALLOWED_ORIGINS = 'https://allowed.example';
process.env.ALLOWED_HOSTS = '';
process.env.TRUST_PROXY = '0';
process.env.ENFORCE_HTTPS = 'false';
process.env.GLOBAL_RATE_LIMIT = '10000';
process.env.GLOBAL_RATE_WINDOW_MINUTES = '15';
process.env.CHAT_RATE_LIMIT = '1000';
process.env.CHAT_RATE_WINDOW_MINUTES = '1';
process.env.CHAT_MAX_CONCURRENT = '1';
process.env.CHAT_MAX_OUTPUT_TOKENS = '500';
process.env.CHAT_MAX_MESSAGE_CHARS = '2000';
process.env.CHAT_MAX_HISTORY_TURNS = '4';
process.env.CHAT_MAX_HISTORY_CHARS = '48000';
process.env.CHAT_MAX_RESPONSE_CHARS = '6000';
process.env.CHAT_MAX_FILE_MB = '0.25';
process.env.CHAT_MAX_FILE_CHARS = '2000';
process.env.CHAT_TIMEOUT_MS = '8000';
process.env.OVH_BASE_URL = 'https://ovh.test/v1';
process.env.OVH_MODEL = 'Meta-Llama-3_3-70B-Instruct';
process.env.OVH_API_KEY = 'empty-if-anonymous';
process.env.OVH_TIMEOUT_MS = '1000';
process.env.OVH_RPM = '2';
process.env.LLM7_BASE_URL = 'https://llm7.test/v1';
process.env.LLM7_MODEL = 'codestral-latest';
process.env.LLM7_API_KEY = 'test-llm7-placeholder';
process.env.LLM7_TIMEOUT_MS = '1000';
process.env.LLM7_RPM = '25';
process.env.LLM7_RETRY_DELAY_MS = '10';
process.env.LLM7_MAX_RETRIES = '1';

const { createApp } = await import('../server/app.js');
const { resetChatProvidersForTests } = await import('../server/services/chat.js');

const app = createApp();
const originalFetch = globalThis.fetch;

let calls = [];
let providerHandler = null;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function completion(text = 'Test reply from Dr.Health.') {
  return jsonResponse({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
}

function rateLimited(retryAfter = '30') {
  return jsonResponse(
    { error: { message: 'rate limited', code: 429 } },
    429,
    { 'Retry-After': retryAfter },
  );
}

function providerFor(url) {
  const value = String(url);
  if (value.startsWith('https://ovh.test/')) return 'ovh';
  if (value.startsWith('https://llm7.test/')) return 'llm7';
  return null;
}

function callsFor(provider) {
  return calls.filter((call) => call.provider === provider);
}

function headerValue(options, name) {
  const headers = options?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  return headers[name] ?? headers[name.toLowerCase()];
}

function lastBody(provider) {
  const providerCalls = callsFor(provider);
  assert.ok(providerCalls.length > 0, `expected a ${provider} call`);
  return providerCalls[providerCalls.length - 1].body;
}

async function withProviderHandler(handler, fn) {
  const previous = providerHandler;
  providerHandler = handler;
  try {
    return await fn();
  } finally {
    providerHandler = previous;
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

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const provider = providerFor(url);
    if (!provider) throw new Error(`Unexpected fetch in test: ${url}`);

    calls.push({
      provider,
      url: String(url),
      options,
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (providerHandler) return providerHandler(provider, options);
    return completion();
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  resetChatProvidersForTests();
  calls = [];
  providerHandler = null;
});

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
    .send({ message: 'hello' })
    .expect(403);
  assert.equal(denied.body.error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.equal(calls.length, 0);
});

test('chat uses OVH first for health questions and never leaks provider details', async () => {
  const res = await request(app)
    .post('/api/chat')
    .send({
      message: 'And what about lunch?',
      history: [
        { role: 'user', text: 'Tell me about breakfast.' },
        { role: 'model', text: 'Breakfast matters.' },
      ],
    })
    .expect(200);

  assert.deepEqual(Object.keys(res.body), ['reply']);
  assert.equal(res.body.reply, 'Test reply from Dr.Health.');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(calls.length, 1);

  const call = calls[0];
  assert.equal(call.provider, 'ovh');
  assert.equal(call.url, 'https://ovh.test/v1/chat/completions');
  assert.equal(headerValue(call.options, 'authorization'), undefined);

  const payload = call.body;
  assert.equal(payload.model, 'Meta-Llama-3_3-70B-Instruct');
  assert.equal(payload.max_tokens, 500);
  assert.equal(payload.temperature, 0.3);
  assert.equal(payload.stream, false);
  assert.equal(payload.messages.length, 4);
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /under 300 words/);
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
  assert.ok(!JSON.stringify(res.body).includes('ovh.test'));
  assert.ok(!JSON.stringify(res.body).includes('Meta-Llama'));
});

test('long history turns are accepted up to the configured cap', async () => {
  const history = [
    { role: 'user', text: 'h'.repeat(5000) },
    { role: 'model', text: 'Previous answer.' },
  ];

  const res = await request(app)
    .post('/api/chat')
    .send({ message: 'Continue.', history })
    .expect(200);

  assert.equal(res.body.reply, 'Test reply from Dr.Health.');
  const payload = lastBody('ovh');
  assert.equal(payload.messages[1].content.length, 5000);
  assert.equal(payload.messages[2].content, 'Previous answer.');
  assert.equal(payload.messages[3].content, 'Continue.');
});

test('an OVH 429 falls back to LLM7 and still returns a reply', async () => {
  await withProviderHandler(
    async (provider) => (provider === 'ovh' ? rateLimited('30') : completion('Fallback reply.')),
    async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: 'What is a balanced dinner?' })
        .expect(200);

      assert.equal(res.body.reply, 'Fallback reply.');
      assert.deepEqual(calls.map((call) => call.provider), ['ovh', 'llm7']);
      assert.equal(lastBody('llm7').model, 'codestral-latest');
      assert.equal(
        headerValue(calls[1].options, 'authorization'),
        'Bearer test-llm7-placeholder',
      );
      assert.ok(!JSON.stringify(res.body).includes('ovh.test'));
      assert.ok(!JSON.stringify(res.body).includes('rate limited'));
    },
  );
});

test('an OVH timeout falls back to LLM7', async () => {
  await withProviderHandler(
    async (provider, options) => {
      if (provider === 'llm7') return completion('Fallback after timeout.');

      return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        );
      });
    },
    async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ message: 'How much water should I drink?' })
        .expect(200);

      assert.equal(res.body.reply, 'Fallback after timeout.');
      assert.deepEqual(calls.map((call) => call.provider), ['ovh', 'llm7']);
    },
  );
});

test('code attachments prefer LLM7 and include the file as untrusted text', async () => {
  const source = [
    'export function add(a, b) {',
    '  return a + b;',
    '}',
  ].join('\n');

  const res = await request(app)
    .post('/api/chat')
    .field('message', 'Review this function.')
    .attach('file', Buffer.from(source, 'utf8'), 'sample.js')
    .expect(200);

  assert.equal(res.body.reply, 'Test reply from Dr.Health.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'llm7');

  const userContent = lastBody('llm7').messages.at(-1).content;
  assert.match(userContent, /Review this function\./);
  assert.match(userContent, /Attached file: sample\.js/);
  assert.match(userContent, /```javascript/);
  assert.match(userContent, /export function add/);
});

test('text attachments are accepted and sent to the health provider', async () => {
  const notes = 'Breakfast: oats, yogurt, and berries.';

  const res = await request(app)
    .post('/api/chat')
    .field('message', 'Summarize these notes.')
    .attach('file', Buffer.from(notes, 'utf8'), 'notes.txt')
    .expect(200);

  assert.equal(res.body.reply, 'Test reply from Dr.Health.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'ovh');
  const userContent = lastBody('ovh').messages.at(-1).content;
  assert.match(userContent, /Attached file: notes\.txt/);
  assert.match(userContent, /Breakfast: oats, yogurt, and berries\./);
});

test('binary and unsafe files are rejected before any provider call', async () => {
  const png = await request(app)
    .post('/api/chat')
    .field('message', 'What is in this image?')
    .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image.png')
    .expect(415);
  assert.equal(png.body.error.code, 'UNSUPPORTED_FILE');

  const pdf = await request(app)
    .post('/api/chat')
    .attach('file', Buffer.from('%PDF-1.7\n'), 'report.pdf')
    .expect(415);
  assert.equal(pdf.body.error.code, 'UNSUPPORTED_FILE');

  const envFile = await request(app)
    .post('/api/chat')
    .attach('file', Buffer.from('SECRET=value\n'), '.env')
    .expect(415);
  assert.equal(envFile.body.error.code, 'UNSUPPORTED_FILE');

  const privateKey = await request(app)
    .post('/api/chat')
    .attach('file', Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\n'), 'id_rsa')
    .expect(415);
  assert.equal(privateKey.body.error.code, 'UNSUPPORTED_FILE');

  const imageField = await request(app)
    .post('/api/chat')
    .send({ message: 'Look at this', image: 'data:image/png;base64,abc' })
    .expect(415);
  assert.equal(imageField.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');

  assert.equal(calls.length, 0);
});

test('file size, length, emptiness, and binary content are bounded', async () => {
  const oversized = await request(app)
    .post('/api/chat')
    .field('message', 'Summarize this.')
    .attach('file', Buffer.alloc(300 * 1024, 0x61), 'large.txt')
    .expect(413);
  assert.equal(oversized.body.error.code, 'FILE_TOO_LARGE');

  const tooLong = await request(app)
    .post('/api/chat')
    .field('message', 'Summarize this.')
    .attach('file', Buffer.from('a'.repeat(2001), 'utf8'), 'long.txt')
    .expect(413);
  assert.equal(tooLong.body.error.code, 'FILE_TOO_LONG');

  const empty = await request(app)
    .post('/api/chat')
    .field('message', 'Summarize this.')
    .attach('file', Buffer.alloc(0), 'empty.txt')
    .expect(400);
  assert.equal(empty.body.error.code, 'EMPTY_FILE');

  const binary = await request(app)
    .post('/api/chat')
    .field('message', 'Summarize this.')
    .attach('file', Buffer.from([0x61, 0x00, 0x62]), 'binary.txt')
    .expect(415);
  assert.equal(binary.body.error.code, 'UNSUPPORTED_FILE');

  assert.equal(calls.length, 0);
});

test('chat rejects missing, oversized, and malformed input', async () => {
  const missing = await request(app).post('/api/chat').send({}).expect(400);
  assert.equal(missing.body.error.code, 'MESSAGE_REQUIRED');

  const nonString = await request(app)
    .post('/api/chat')
    .send({ message: 42 })
    .expect(400);
  assert.equal(nonString.body.error.code, 'INVALID_MESSAGE');

  const oversized = await request(app)
    .post('/api/chat')
    .send({ message: 'x'.repeat(2001) })
    .expect(400);
  assert.equal(oversized.body.error.code, 'MESSAGE_TOO_LONG');

  const badHistory = await request(app)
    .post('/api/chat')
    .send({ message: 'hello', history: '{not-json' })
    .expect(400);
  assert.equal(badHistory.body.error.code, 'INVALID_HISTORY');

  const tooManyTurns = await request(app)
    .post('/api/chat')
    .send({
      message: 'hello',
      history: Array.from({ length: 5 }, () => ({ role: 'user', text: 'x' })),
    })
    .expect(400);
  assert.equal(tooManyTurns.body.error.code, 'INVALID_HISTORY');

  assert.equal(calls.length, 0);
});

test('provider rate limits become a generic busy error without leaking details', async () => {
  await withSilencedConsole(() =>
    withProviderHandler(
      async (provider) => rateLimited(provider === 'llm7' ? '7' : '30'),
      async () => {
        const res = await request(app)
          .post('/api/chat')
          .send({ message: 'hello' })
          .expect(503);

        assert.equal(res.body.error.code, 'CHAT_UNAVAILABLE');
        assert.equal(res.body.error.retryAfterSeconds, 7);
        assert.equal(res.headers['retry-after'], '7');
        assert.ok(!JSON.stringify(res.body).includes('ovh.test'));
        assert.ok(!JSON.stringify(res.body).includes('llm7.test'));
        assert.ok(!JSON.stringify(res.body).includes('rate limited'));
        assert.deepEqual(calls.map((call) => call.provider), ['ovh', 'llm7', 'llm7']);
      },
    ),
  );
});

test('provider outages return a generic error without leaking details', async () => {
  await withSilencedConsole(() =>
    withProviderHandler(
      async () => jsonResponse({ error: { message: 'upstream detail' } }, 500),
      async () => {
        const res = await request(app)
          .post('/api/chat')
          .send({ message: 'hello' })
          .expect(503);

        assert.equal(res.body.error.code, 'CHAT_UNAVAILABLE');
        assert.ok(!JSON.stringify(res.body).includes('upstream detail'));
        assert.ok(!JSON.stringify(res.body).includes('ovh.test'));
        assert.ok(!JSON.stringify(res.body).includes('llm7.test'));
      },
    ),
  );
});

test('concurrent chats are bounded with a friendly busy response', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });

  await withProviderHandler(
    async () => {
      started();
      await gate;
      return completion('Slow reply.');
    },
    async () => {
      const first = request(app)
        .post('/api/chat')
        .send({ message: 'first' })
        .then((response) => response);
      await startedPromise;

      const second = await request(app)
        .post('/api/chat')
        .send({ message: 'second' })
        .expect(429);
      assert.equal(second.body.error.code, 'CHAT_BUSY');
      assert.equal(second.body.error.retryAfterSeconds, 10);

      release();
      const firstResponse = await first;
      assert.equal(firstResponse.status, 200);
      assert.equal(firstResponse.body.reply, 'Slow reply.');
    },
  );
});

test('cross-site chat requests are rejected', async () => {
  const res = await request(app)
    .post('/api/chat')
    .set('Sec-Fetch-Site', 'cross-site')
    .send({ message: 'hello' })
    .expect(403);
  assert.equal(res.body.error.code, 'CSRF_REJECTED');
  assert.equal(calls.length, 0);
});

test('oversized JSON bodies are rejected before routing', async () => {
  const res = await request(app)
    .post('/api/chat')
    .set('Content-Type', 'application/json')
    .send({ message: 'x'.repeat(300000) })
    .expect(413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('removed guest, sign-in, and admin routes are gone', async () => {
  await request(app).get('/api/guest/session').expect(404);
  await request(app).post('/api/guest/chat').send({ message: 'hello' }).expect(404);
  await request(app).get('/auth/openrouter').expect(404);
  await request(app).get('/auth/callback').expect(404);

  const authSession = await request(app).get('/api/auth/session').expect(404);
  assert.equal(authSession.body.error.code, 'NOT_FOUND');

  const admin = await request(app).get('/api/admin/stats').expect(404);
  assert.equal(admin.body.error.code, 'NOT_FOUND');
});

test('unknown API routes return JSON 404s', async () => {
  const res = await request(app).get('/api/does-not-exist').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.match(res.headers['content-type'], /application\/json/);
});

test('static frontend has no sign-in surface and exposes the attachment control', async () => {
  const index = await request(app).get('/').expect(200);
  assert.match(index.text, /Dr\.Health/);
  assert.match(index.text, /id="chat-form"/);
  assert.match(index.text, /id="textInput"/);
  assert.match(index.text, /id="fileInput"/);
  assert.match(index.text, /data-theme="dark"/);
  assert.ok(!index.text.includes('guestRemaining'));
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

test('text responses are compressed and static images are cached', async () => {
  const compressed = await request(app)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect(200);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.match(compressed.headers['vary'], /Accept-Encoding/);

  const favicon = await request(app).get('/favicon.svg').expect(200);
  assert.match(favicon.headers['cache-control'], /max-age=86400/);
});
