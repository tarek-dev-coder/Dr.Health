import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, stat } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

const html = await read('../public/index.html');
const appJs = await read('../public/app.js');
const styles = await read('../public/styles.css');
const gitignore = await read('../.gitignore');
const envExample = await read('../.env.example');

test('frontend contains no API keys or direct provider calls', () => {
  const combined = `${html}\n${appJs}\n${styles}`;
  assert.ok(!/\bAIza[0-9A-Za-z_-]{20,}\b/.test(combined));
  assert.ok(!combined.includes('generativelanguage.googleapis.com'));
  assert.ok(!combined.includes('openrouter.ai'));
  assert.ok(!/api[_-]?key/i.test(appJs));
  assert.ok(!/sk-or-v1/i.test(combined));
});

test('frontend keeps session data out of web storage and avoids HTML sinks', () => {
  assert.ok(!/localStorage|sessionStorage|indexedDB/i.test(appJs));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/i.test(appJs));
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(/i.test(appJs));
  assert.ok(!/document\.cookie/i.test(appJs));
});

test('the sign-in gate is same-origin and the provider-disclosure sentence is gone', () => {
  assert.match(html, /id="authGate"/);
  assert.match(html, /href="\/auth\/openrouter"/);
  assert.match(html, /Continue with Google/);
  assert.ok(!html.includes('Messages are processed by an AI provider'));
  assert.ok(!html.includes('provider may use'));
  assert.match(html, /Chat history is kept in this tab's memory only/);
});

test('HTML uses external scripts/styles and no inline handlers', () => {
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!/<style[\s>]/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  assert.ok(!/style\s*=/i.test(html));
  assert.match(html, /<script src="\/app\.js" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css">/);
});

test('frontend has no third-party resource URLs', () => {
  const combined = `${html}\n${styles}`;
  assert.ok(!/(?:src|href)="https?:\/\//i.test(combined));
  assert.ok(!/url\(['"]?https?:\/\//i.test(styles));
});

test('environment files are protected from accidental commits', () => {
  const ignored = gitignore.split(/\r?\n/).map((line) => line.trim());
  assert.ok(ignored.includes('.env'));
  assert.ok(ignored.includes('.env.*'));
  assert.ok(ignored.includes('node_modules/'));
  assert.ok(!/AIza/.test(envExample));
  assert.ok(!/^GEMINI_API_KEY=\S+/m.test(envExample));
  assert.ok(!/^OPENROUTER_API_KEY=\S+/m.test(envExample));
  assert.ok(!/^DATABASE_URL=\S+/m.test(envExample));
  assert.ok(!/^SESSION_SECRET=\S+/m.test(envExample));
  assert.ok(!/^KEY_ENCRYPTION_SECRET=\S+/m.test(envExample));
  assert.ok(!/^ADMIN_PASSWORD_HASH=\S+/m.test(envExample));
});

test('the vulnerable single-file entrypoint no longer exists', async () => {
  await assert.rejects(() => access(new URL('../index.html', import.meta.url)));
});

test('the hero animation has a compressed source and a poster fallback', async () => {
  const webp = await stat(new URL('../public/assets/health-hero.webp', import.meta.url));
  await access(new URL('../public/assets/health-hero.gif', import.meta.url));
  await access(new URL('../public/assets/health-hero-poster.jpg', import.meta.url));
  assert.ok(webp.size < 2 * 1024 * 1024, 'animated WebP should stay below 2 MB');
  assert.match(html, /<source srcset="\/assets\/health-hero\.webp" type="image\/webp">/);
  assert.match(html, /src="\/assets\/health-hero\.gif"/);
});
