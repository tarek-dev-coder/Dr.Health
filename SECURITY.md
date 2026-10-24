# Security Policy and Hardening Notes

Dr.Health is a health-information app, so the security baseline is intentionally
strict: no shared AI key ships with the app, each user's key is encrypted at rest,
health content is not logged, uploads are validated by content, and privileged
access uses HttpOnly cookies.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Use the
repository's private security advisory feature, or contact the maintainer
privately through the contact method listed on the repository profile. Include
reproduction steps and the affected version. Do not include real health data.

## Supported versions

Security fixes are applied to the latest release on the default branch. Forks
and older copies do not receive backported fixes; redeploy from the current code
and rotate any secrets that were ever exposed.

## Architecture

```
Browser (public/)
   │  same-origin fetch, HttpOnly session cookie
   ▼
Node/Express (server/)
   ├─ OAuth PKCE + state validation
   ├─ per-user key vault (AES-256-GCM)
   ├─ validation / rate limits / CORS / CSRF checks
   ├─ upload inspection (memory only)
   ├─ admin sessions (HttpOnly cookie)
   └─ redacted structured logs
   │
   ├──► Postgres: encrypted user keys + local user IDs
   └──► OpenRouter: user's own bearer key (server-to-server)
```

The browser never receives an AI provider key and never calls the provider
directly. `public/` is the only directory served statically. There is no owner
API key in `.env` and no shared key in the browser.

## Checklist

| Requested item | Status | Implementation |
| -------------- | ------ | -------------- |
| Enable TLS/HTTPS | Done | HSTS in production, HTTPS redirect, `Secure` cookies, deployment guidance |
| Tighten CORS | Done | Same-origin by default, exact allowlist, unknown origins rejected server-side, no wildcard |
| Parameterized queries | Done | `pg` placeholders for every query; no string-concatenated SQL |
| Verify address | N/A* | No email/address is stored. OpenRouter handles account authentication; Host/Origin checks and no user-controlled outbound URLs are enforced |
| Keep tokens out of local storage | Done | No web storage; admin and user sessions are HttpOnly cookies; API keys stay server-side |
| Hide env from git | Done | `.gitignore`, `.env.example`, no secrets in tracked files |
| Validate form inputs | Done | Zod schemas, length limits, control-character stripping, strict JSON, bounded history |
| Protect admin routes | Done | Login + scrypt verification, signed server-side session, rate limit, Origin/CSRF checks |
| Disable production debugging | Done | Generic errors in production, no stack traces, no `X-Powered-By`, no upstream error bodies |
| Server-side API secrets | Done | Per-user keys encrypted with AES-256-GCM; decrypted only for that user's request; no owner key |
| Encrypt keys at rest | Done | AES-256-GCM with a random 96-bit IV and auth tag; scrypt-derived key from `KEY_ENCRYPTION_SECRET`/`SESSION_SECRET` |
| OAuth CSRF protection | Done | PKCE S256, signed short-lived `state` cookie, exact callback URL, one-time code |
| Rate limit requests | Done | Global, chat, OAuth, and login limiters with standard rate-limit headers |
| Validate file uploads | Done | In-memory multer, 1 file, size limit, MIME allowlist, magic-byte check, no disk writes, no SVG |
| Keep sensitive data from logs | Done | Request logger logs metadata only; recursive redaction; no prompts, replies, history, images, or API keys |
| Hash passwords securely | Done | scrypt (N=32768, r=8, p=1), 16-byte random salt, constant-time compare, min 12 chars |
| Verify webhook signature | Ready | No webhook endpoints exist; `server/lib/webhook.js` implements HMAC-SHA256 + replay window |
| Server-side permissions | Done | User key lookup is tied to a signed session and a local user record; admin authorization is server-side only |
| Block cross-site scripting | Done | Strict CSP, no inline script/style, `textContent` only, no HTML sinks, `nosniff`, frame denial |
| Update dependencies | Done | Current packages, lockfile, `npm audit` clean, Dependabot, CI audit |

\* “Verify address” is interpreted two ways: (1) email/account verification and
(2) request-address verification. No email or address is stored; OpenRouter
performs account authentication, and no account-existence information is exposed.
Request hosts and origins are validated as described below.

## What was fixed

### 1. No shared provider key

The original `index.html` built a Google API key from base64 fragments and called
`generativelanguage.googleapis.com` directly. That key was public to every
visitor and is now removed from the app and the local `.env`. It must be
**revoked** in Google AI Studio even though the file is gone, because it may
remain in browser caches, forks, or git history.

The current app does not use a shared AI key. Each user signs in through
OpenRouter OAuth; the server receives a key tied to that user's account and uses
it only for that user's requests.

### 2. Per-user key vault

- OpenRouter OAuth uses PKCE S256. The server generates a random verifier and
  challenge, stores the verifier in a signed, HttpOnly, `SameSite=Lax` cookie
  scoped to `/auth`, and validates the returned `state`.
- The one-time code is exchanged server-to-server at
  `POST /api/v1/auth/keys`. The key is validated, encrypted immediately, and
  never logged or returned to the browser.
- Encryption is AES-256-GCM with a random 96-bit IV and a 128-bit auth tag. The
  AES key is derived with scrypt from `KEY_ENCRYPTION_SECRET` (or
  `SESSION_SECRET` if the separate value is not set).
- Production requires Postgres (`DATABASE_URL`). Local development can use the
  in-memory fallback, which is encrypted but lost on restart.
- The database stores the ciphertext, IV, tag, a SHA-256 key hash, and a local
  user ID. It never stores plaintext keys or chat content.
- Logout deletes the local user record, so a replayed session cookie cannot
  decrypt a key. The user can also revoke the key from their OpenRouter account.

### 3. OAuth and session controls

- `GET /auth/openrouter` is rate limited and sets a short-lived state cookie.
- `GET /auth/callback` requires a matching signed state and a valid code; codes
  expire after 10 minutes at OpenRouter.
- The callback URL is fixed by configuration and must use HTTPS in production.
- The user session is a signed HttpOnly cookie (`SameSite=Lax`, `Secure` in
  production) with a local user ID. The server loads the user record on every
  request; a deleted record invalidates the session immediately.
- OAuth errors are logged without codes, keys, or provider response bodies, and
  the browser receives only `/?auth_error=1`.
- State-changing account routes require same-origin Fetch Metadata.

### 4. Input validation and upload inspection

`server/routes/chat.js` enforces:

- 1–4000 characters per message (configurable), after trimming and removing
  control/bidi-override characters.
- At most 20 history turns and 20,000 history characters.
- JSON-only bodies for JSON endpoints; multipart limits on fields and parts.
- One upload, 5 MB by default, JPEG/PNG/WebP only.
- Magic-byte detection (`server/lib/image.js`), so a renamed `.exe`, SVG, or HTML
  file cannot pass as an image.
- Files are held in memory and never written to disk or a public directory.
- Uploads are sent to the model as an OpenAI-compatible image data URL; original
  filenames are ignored.

### 5. Admin protection

- `POST /api/admin/login` is rate limited and requires JSON.
- Passwords are compared against an scrypt hash with `timingSafeEqual`.
- A successful login creates a signed session token with `sub=admin`, `iss`,
  `aud`, `iat`, `exp`, and a random session ID.
- The token is stored in a `__Host-` HttpOnly cookie in production
  (`SameSite=Strict`, `Secure`, `Path=/`). No token is returned in JSON.
- Session IDs are checked against a server-side registry on every request, so
  logout revokes the token immediately.
- `requireAdmin` guards `/session` and `/stats`; the role is never taken from the
  client.
- State-changing admin routes require same-origin Fetch Metadata and pass the
  global Origin allowlist check.
- If `ADMIN_PASSWORD_HASH` or `SESSION_SECRET` is missing, admin access fails
  closed with HTTP 503.

Generate a hash with `npm run hash-password`. Never put the plaintext password in
the repository, `.env`, or logs. Passwords shorter than 12 characters are
rejected.

### 6. CORS and request-origin checks

- Same-origin requests are always allowed.
- `ALLOWED_ORIGINS` accepts exact origins only (no `*`, no paths).
- Unknown browser origins are rejected before routing, not merely hidden by the
  browser's CORS enforcement.
- CORS credentials are enabled because sessions use cookies.
- `ALLOWED_HOSTS` optionally rejects Host-header manipulation; it is required in
  production when HTTPS is enforced.
- The HTTPS redirect only uses a syntactically valid Host header. There are no
  user-controlled redirects or outbound URLs in the app, so SSRF/open-redirect
  surface is minimal.

### 7. TLS

- Production responses include HSTS (`max-age=15552000; includeSubDomains`).
- Cookies are `Secure` when `NODE_ENV=production`.
- `ENFORCE_HTTPS` (default true in production) redirects plain HTTP and rejects
  non-GET requests sent over HTTP. Production startup requires `ALLOWED_HOSTS`
  when HTTPS enforcement is enabled, preventing Host-header redirect abuse.
- Terminate TLS at the hosting platform/reverse proxy and forward
  `X-Forwarded-Proto: https`. Set `TRUST_PROXY` to the exact number of proxy hops
  so IP-based rate limiting is not bypassed by spoofed forwarding headers.

### 8. Security headers and XSS

Helmet sets a strict Content Security Policy:

```
default-src 'self'; base-uri 'none'; frame-ancestors 'none';
script-src 'self'; script-src-attr 'none'; style-src 'self';
img-src 'self' data:; connect-src 'self'; object-src 'none';
form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'; ...
```

Additional controls:

- Scripts and styles are external files; there is no inline script, inline
  style, or inline event handler (enforced by tests).
- The frontend inserts model output with `textContent`, never `innerHTML`,
  `insertAdjacentHTML`, `document.write`, or `eval`.
- Trusted Types (`require-trusted-types-for 'script'; trusted-types 'none'`) add
  a browser-level guard against DOM XSS sinks in Chromium-based browsers.
- No third-party scripts, fonts, or background images are loaded. The OAuth
  redirect is a normal top-level navigation, not an embedded third-party script.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, COOP/CORP, and a restrictive
  `Permissions-Policy` are set.
- SVG uploads are rejected, so uploaded content cannot be rendered as active
  markup.
- Express JSON responses escape HTML-sensitive characters (`json escape`).
- The frontend has no web storage and keeps history in memory only, which
  reduces exposure on shared devices.

If Markdown rendering is ever added, sanitize it with a maintained library such
as DOMPurify and keep the same CSP.

### 9. Logging

- Request logs contain method, path, status, duration, IP, and request ID only.
- Query strings, headers, cookies, bodies, prompts, replies, history, image data,
  OAuth codes, and API keys are never logged.
- `server/lib/logger.js` recursively redacts sensitive keys and truncates long
  strings.
- Upstream errors log only the HTTP status and timing, never the response body.
- Production error responses do not include stack traces or internal messages.
  Development-only `debug` output is suppressed when `NODE_ENV=production`.
- `X-Powered-By` is removed.

### 10. Rate limits and abuse resistance

| Scope | Default |
| ----- | ------- |
| All `/api` | 300 requests / 15 min per IP |
| `/api/chat` | 20 requests / 10 min per IP |
| OAuth start/callback | 30 requests / 15 min per IP |
| Admin login | 5 failed attempts / 15 min per IP |

Responses use standard `RateLimit`/`RateLimit-Policy` headers and return HTTP
429 with a request ID. These are per-process in-memory counters; use a shared
store (Redis) for multi-instance deployments.

Chat now requires a signed-in user, which removes the old public-cost-abuse
surface. The per-user OpenRouter account also carries its own free-model limits.

### 11. Database and parameterized queries

Postgres stores only the encrypted key vault and local user IDs:

```sql
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  key_ciphertext text NOT NULL,
  key_iv text NOT NULL,
  key_tag text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
```

Every query uses `pg` placeholders:

```js
await pool.query('SELECT id, key_ciphertext FROM users WHERE id = $1', [userId]);
```

Use a least-privilege database user and restrict network access to the app. The
schema is created idempotently on startup. There is no ORM and no user-supplied
SQL.

### 12. Webhook signature verification (ready, not mounted)

The project has no webhook consumers, so no webhook route is exposed. A reusable
verifier is provided in `server/lib/webhook.js`:

- HMAC-SHA256 over `<unix-timestamp>.<raw-body>`.
- Header format `t=<timestamp>,v1=<hex signature>`.
- Constant-time comparison.
- Configurable replay window (default 300 seconds).
- Raw body required; do not verify after JSON re-serialization.

Mount a webhook router before any JSON body parser for that path. In this app,
JSON parsing is scoped to `/api/chat` and `/api/admin`, so a new raw webhook route
can be added safely.

### 13. Dependencies

- Versions are pinned with caret ranges and a committed `package-lock.json`.
- `npm audit --omit=dev --audit-level=high` currently reports 0 vulnerabilities.
- `.github/dependabot.yml` opens weekly update PRs.
- CI runs tests and a production dependency audit on every push/PR.
- `npm ci` is used in deployment/CI for reproducible installs.

## Residual risks and limitations

- **AI provider processing:** prompts and images are sent to OpenRouter using the
  signed-in user's key. Free models may have their own data policies. This app is
  not HIPAA/GDPR-compliant out of the box and must not be used for protected
  health information without appropriate agreements, retention controls, and
  legal review.
- **AI output:** model responses are not medically validated. The system prompt
  adds safety rules and emergency guidance, but it is not a clinical device.
  Gemma 4 is a general model, not a medical-specific model.
- **Prompt injection:** users can try to override the system prompt. The model has
  no tools, secrets, or privileged access, and output is rendered as plain text,
  but it can still produce unsafe or inaccurate health information.
- **Free-model availability:** free models can be rate-limited, changed, or
  removed. The app falls back across configured models but cannot guarantee
  uptime or medical quality.
- **Remote key lifecycle:** logout deletes the local encrypted key and user
  record, but the key remains in the user's OpenRouter account until they revoke
  it there. Users should manage keys from their OpenRouter account.
- **Session theft:** the user session is a signed HttpOnly cookie. HTTPS,
  `SameSite=Lax`, and a seven-day default lifetime limit exposure, but a stolen
  cookie can be used until it expires or the user record is deleted. Shorten
  `USER_SESSION_TTL_MINUTES` for higher-risk deployments.
- **Single-process state:** rate limits, metrics, and admin sessions are in
  memory. Restarting invalidates admin sessions; multiple instances require a
  shared session/rate-limit store. User keys persist in Postgres.
- **Database availability:** a database outage prevents sign-in and chat. Use
  Neon/Render health checks and monitor `store_init_failed` / `request_failed`
  logs. The current `pg` SSL setting uses `rejectUnauthorized: false` for Neon
  compatibility; tighten this if your provider supplies a trusted CA.
- **No persistent audit log:** request IDs are returned for support, but logs are
  process output and depend on your platform's retention policy.
- **No email verification:** no email or address is stored. OpenRouter handles
  account authentication; the app does not expose account-existence information.
- **Single admin:** there is no user management, MFA, or admin audit trail. Add
  MFA and persistent audit logging before exposing admin functionality at scale.

## Rotation checklist after a leak

1. Revoke the old Google API key in Google AI Studio. It was removed from the app
   and the local `.env`, but removal does not revoke it.
2. Rotate `SESSION_SECRET` and `KEY_ENCRYPTION_SECRET`. This invalidates existing
   user sessions and makes saved encrypted keys unreadable; users must sign in
   again to create new keys.
3. Rotate the Postgres password/connection string and update `DATABASE_URL`.
4. Change the admin password and regenerate `ADMIN_PASSWORD_HASH`.
5. If a user key was exposed, revoke it from the user's OpenRouter account.
6. If any secret was committed, remove it from git history and force-rotate it;
   deleting the file in a later commit is not enough.
