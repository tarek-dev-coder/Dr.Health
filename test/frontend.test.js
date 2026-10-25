import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

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
  assert.ok(!combined.includes('oai.endpoints.kepler.ai.cloud.ovh.net'));
  assert.ok(!combined.includes('api.llm7.io'));
  assert.ok(!/api[_-]?key/i.test(appJs));
  assert.ok(!/sk-or-v1/i.test(combined));
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{8,}/.test(combined));
});

test('frontend stores only the theme preference and avoids HTML sinks', () => {
  assert.ok(!/sessionStorage|indexedDB/i.test(appJs));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/i.test(appJs));
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(/i.test(appJs));
  assert.ok(!/document\.cookie/i.test(appJs));

  const storageCalls = appJs.match(/localStorage\.(?:getItem|setItem)\(([^)]*)\)/g) || [];
  assert.ok(storageCalls.length > 0);
  for (const call of storageCalls) {
    assert.match(call, /THEME_KEY/);
  }
});

test('the UI has no sign-in surface and supports text/code attachments', () => {
  assert.ok(!html.includes('/auth/'));
  assert.ok(!html.includes('Sign in'));
  assert.ok(!html.includes('Continue with Google'));
  assert.ok(!html.includes('authGate'));
  assert.ok(!html.includes('imageInput'));
  assert.ok(!html.includes('uploadButton'));
  assert.ok(!html.includes('guestRemaining'));
  assert.ok(!appJs.includes('/api/auth'));
  assert.ok(!appJs.includes('/api/guest'));
  assert.ok(!appJs.includes('signOut'));
  assert.ok(!appJs.includes('authGate'));

  assert.match(html, /id="chat-form"/);
  assert.match(html, /id="textInput"/);
  assert.match(html, /id="fileInput"/);
  assert.match(html, /id="attachButton"/);
  assert.match(html, /accept="[^"]*\.js/);
  assert.match(html, /accept="[^"]*\.md/);
  assert.ok(!/accept="[^"]*image\//.test(html));
  assert.match(html, /Chat history and files: in memory, never stored\./);
  assert.ok(!html.includes('Emergency? Call your local emergency number first.'));
  assert.ok(!html.includes('Messages are processed by an AI provider'));
  assert.ok(!html.includes('provider may use'));
});

test('public copy is confident and avoids generic disclaimers', () => {
  assert.ok(!html.includes('General health information'));
  assert.ok(!html.includes('General information only'));
  assert.ok(!html.includes('does not diagnose or prescribe'));
  assert.match(html, /Health, made clear\./);
});

test('HTML uses external scripts/styles and no inline handlers', () => {
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!/<style[\s>]/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  assert.ok(!/style\s*=/i.test(html));
  assert.match(html, /<script src="\/app\.js" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css">/);
});

test('the dark theme is the default and the light theme is available', () => {
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /id="themeToggle"/);
  assert.match(styles, /\[data-theme="light"\]/);
  assert.match(appJs, /saved === 'light' \? 'light' : 'dark'/);
  assert.match(appJs, /localStorage\.setItem\(THEME_KEY, next\)/);
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
  assert.ok(!/^GUEST_SESSION_SECRET=\S+/m.test(envExample));
  assert.ok(!/^GUEST_API_KEY=\S+/m.test(envExample));
  assert.ok(!/^DATABASE_URL=/m.test(envExample));
  assert.ok(!/^OPENROUTER_/m.test(envExample));
  assert.ok(!/^SUPABASE_/m.test(envExample));
  assert.ok(!/^VERCEL_/m.test(envExample));
  assert.ok(!/^ADMIN_/m.test(envExample));
  assert.match(envExample, /^OVH_BASE_URL=https:\/\/oai\.endpoints\.kepler\.ai\.cloud\.ovh\.net\/v1$/m);
  assert.match(envExample, /^LLM7_BASE_URL=https:\/\/api\.llm7\.io\/v1$/m);
  assert.match(envExample, /^OVH_API_KEY=empty-if-anonymous$/m);
  assert.match(envExample, /^LLM7_API_KEY=unused$/m);
});

test('the vulnerable single-file entrypoint and deployment files are gone', async () => {
  await assert.rejects(() => access(new URL('../index.html', import.meta.url)));
  await assert.rejects(() => access(new URL('../index.js', import.meta.url)));
  await assert.rejects(() => access(new URL('../vercel.json', import.meta.url)));
  await assert.rejects(() => access(new URL('../.vercelignore', import.meta.url)));
});

test('the intro artwork is handcrafted inline SVG, not a generated image', () => {
  assert.match(html, /class="hero-art"/);
  assert.match(html, /<svg viewBox="0 0 480 270"/);
  assert.ok(!/<img\b/i.test(html));
  assert.ok(!html.includes('health-hero'));
  assert.ok(!/url\(['"]?\/assets\//.test(styles));
});
