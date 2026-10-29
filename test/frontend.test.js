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

test('frontend stores only the theme and local chat history, and avoids HTML sinks', () => {
  assert.ok(!/sessionStorage|indexedDB/i.test(appJs));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/i.test(appJs));
  assert.ok(!/\beval\s*\(|new\s+Function\s*\(/i.test(appJs));
  assert.ok(!/document\.cookie/i.test(appJs));

  const storageCalls = appJs.match(/localStorage\.(?:getItem|setItem)\(([^)]*)\)/g) || [];
  assert.ok(storageCalls.length > 0);
  for (const call of storageCalls) {
    assert.match(call, /THEME_KEY|HISTORY_KEY/);
  }

  assert.match(appJs, /const HISTORY_KEY = 'dh-history-v1';/);
  assert.match(appJs, /localStorage\.setItem\(HISTORY_KEY/);
  assert.match(appJs, /localStorage\.getItem\(HISTORY_KEY/);
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
  assert.match(html, /id="historyButton"/);
  assert.match(html, /id="historyPanel"/);
  assert.match(html, /id="historyList"/);
  assert.match(html, /id="clearHistoryButton"/);
  assert.match(html, /No saved chats yet\./);
  assert.match(html, /I keep chats private in this browser\. I don't save files\./);
  assert.ok(!html.includes('Emergency? Call your local emergency number first.'));
  assert.ok(!html.includes('Messages are processed by an AI provider'));
  assert.ok(!html.includes('provider may use'));
});

test('example questions are loaded from the suggestions API, not hardcoded', () => {
  assert.match(html, /id="promptChips"/);
  assert.ok(!html.includes('data-prompt='));
  assert.ok(!html.includes('Why am I always tired?'));
  assert.ok(!html.includes('Recovery after a run'));
  assert.ok(!html.includes('First-aid kit'));
  assert.match(appJs, /API_BASE}\/suggestions/);
  assert.match(appJs, /promptChips/);
  assert.match(appJs, /loadSuggestions\(\);/);
  assert.ok(!appJs.includes('Why am I always tired?'));
});

test('public copy is confident and avoids generic disclaimers', () => {
  assert.ok(!html.includes('General health information'));
  assert.ok(!html.includes('General information only'));
  assert.ok(!html.includes('does not diagnose or prescribe'));
  assert.ok(!html.includes('evidence-led'));
  assert.ok(!html.includes('in memory'));
  assert.ok(!html.includes('nutrition'));
  assert.ok(!html.includes('wellness'));
  assert.match(html, /<title>Dr\.Health — Health advice is everywhere\. I'll give you one clear answer\.<\/title>/);
  assert.match(html, /<h1>Health advice is everywhere\. I'll give you one clear answer\.<\/h1>/);
  assert.ok(!html.includes("Let's talk about your health."));
  assert.ok(!html.includes('class="empty-copy"'));
  assert.ok(!html.includes('Clear answers for your health'));
  assert.ok(!html.includes('Health made clear'));
  assert.ok(!html.includes('Health, made clear'));
  assert.ok(!html.includes('Your health, explained simply'));
  assert.match(html, /<h2 id="about-title" class="eyebrow">Why Dr\.Health<\/h2>/);
  assert.match(html, /<ul class="topic-list">\s*<li>Ask anything\. I'm always here\.<\/li>/);
  assert.ok(!html.includes('class="chat-note"'));
  assert.match(html, /Health advice is everywhere\. I'll give you one clear answer\./);
  assert.match(html, /Free to use\. Just ask me\./);
  assert.match(html, /I'm friendly and easy to talk to\./);
  assert.match(html, /I remember your health story\./);
  assert.match(html, /I keep answers short and explain them as we go\./);
  assert.match(html, /<p id="attach-hint" class="attach-hint">\s*Attach a text file: health notes, a symptom diary, or code\. I'll read it\.\s*<\/p>/);
  assert.ok(html.indexOf('id="attach-hint"') > html.indexOf('id="chat-form"'));
  assert.match(html, /I keep chats private in this browser\. I don't save files\./);
  assert.match(html, /What do you want to ask me\?/);
  assert.ok(!html.includes('How it helps'));
  assert.ok(!html.includes('info-card'));
  assert.ok(!html.includes('info-copy'));
  assert.ok(!html.includes('<p class="section-label">Files</p>'));
  assert.ok(!html.includes('Plain words, not medical terms.'));
  assert.ok(!html.includes('Follow-ups remember what you said.'));
  assert.ok(!html.includes('Tells you when it is not sure.'));
  assert.ok(!html.includes('Free chat · no account'));
  assert.ok(!html.includes('Direct answers · No judgment'));
  assert.ok(!html.includes('medical log'));
  assert.ok(!html.includes('personal doctor'));
  assert.ok(!html.includes('Let me check your health'));
  assert.ok(!html.includes('All rights reserved'));
});

test('saved history stays local and does not persist attached file text', () => {
  assert.match(appJs, /currentChat\.messages\.push\(\{ role: 'user', text: userLabel \}\)/);
  assert.match(appJs, /currentChat\.messages\.push\(\{ role: 'assistant', text: reply \}\)/);
  assert.ok(!appJs.includes("currentChat.messages.push({ role: 'user', text: historyUserText })"));
  assert.match(html, /I save chats in this browser\. Clear them anytime\./);
  assert.match(html, /id="historyPanel"/);
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
  assert.ok(ignored.includes('.vercel/'));
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

test('the old single-file entrypoint is gone and the Vercel config is safe', async () => {
  await assert.rejects(() => access(new URL('../index.html', import.meta.url)));
  await assert.rejects(() => access(new URL('../index.js', import.meta.url)));

  const vercel = JSON.parse(await read('../vercel.json'));
  assert.equal(vercel.functions['src/index.js'].maxDuration, 60);
  assert.ok(Array.isArray(vercel.headers));
  const globalHeaders = vercel.headers.find((entry) => entry.source === '/(.*)');
  assert.ok(globalHeaders);
  assert.ok(globalHeaders.headers.some((header) => header.key === 'Content-Security-Policy'));
  assert.ok(globalHeaders.headers.some((header) => header.key === 'Strict-Transport-Security'));

  const vercelIgnore = await read('../.vercelignore');
  assert.match(vercelIgnore, /^\.env$/m);
  assert.match(vercelIgnore, /^\.env\.\*$/m);
  assert.match(vercelIgnore, /^node_modules\/$/m);
  assert.ok(!/API_KEY|SECRET|TOKEN/i.test(vercelIgnore));
});

test('the Vercel entrypoint exports the Express app without listening', async () => {
  const entry = await read('../src/index.js');
  assert.match(entry, /export default app/);
  assert.ok(!entry.includes('.listen('));

  const { default: app } = await import('../src/index.js');
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
});

test('the intro artwork is handcrafted inline SVG, not a generated image', () => {
  assert.match(html, /class="hero-art"/);
  assert.match(html, /<svg viewBox="0 0 480 270"/);
  assert.ok(!/<img\b/i.test(html));
  assert.ok(!html.includes('health-hero'));
  assert.ok(!/url\(['"]?\/assets\//.test(styles));
});
