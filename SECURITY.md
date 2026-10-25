# Security Policy and Hardening Notes

Dr.Health is a text-only health-information app. There are no accounts, no
sign-in, no database, and no image uploads. The security baseline focuses on
keeping the provider token server-side, bounding free usage, validating text
input, and rendering model output safely.

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
   │  same-origin fetch, signed HttpOnly guest cookie
   ▼
Node/Express (server/)
   ├─ signed guest sessions (HMAC-SHA256)
   ├─ text validation / quotas / rate limits
   ├─ origin, Host, and CSRF checks
   └─ redacted structured logs
   │
   └──► OpenAI-compatible chat endpoint (server-to-server)
```

The browser never receives a provider token and never calls a provider
directly. `public/` is the only directory served statically. The server keeps
no database and no user records.

## Checklist

| Requested item | Status | Implementation |
| -------------- | ------ | -------------- |
| Enable TLS/HTTPS | Done | HSTS in production, HTTPS redirect, `Secure` cookies, deployment guidance |
| Tighten CORS | Done | Same-origin by default, exact allowlist, unknown origins rejected server-side, no wildcard |
| Keep tokens out of local storage | Done | No web storage; guest session is an HttpOnly cookie; provider token stays server-side |
| Hide env from git | Done | `.gitignore`, `.env.example`, no secrets in tracked files |
| Validate form inputs | Done | Zod schemas, length limits, control-character stripping, strict JSON, bounded history |
| Disable production debugging | Done | Generic errors in production, no stack traces, no `X-Powered-By`, no upstream error bodies |
| Server-side API secrets | Done | Optional provider token is read from the environment and sent only to the upstream endpoint |
| Rate limit requests | Done | Global and guest limiters with standard rate-limit headers |
| Bound guest usage | Done | Signed HttpOnly guest cookie; per-guest/IP/global daily quotas; 5/10-min IP limit; 500-token output cap; 4-turn/4,000-char history; text-only |
| Keep sensitive data from logs | Done | Request logger logs metadata only; recursive redaction; no prompts, replies, history, or tokens |
| Block cross-site scripting | Done | Strict CSP, no inline script/style, `textContent` only, no HTML sinks, `nosniff`, frame denial |
| Update dependencies | Done | Current packages, lockfile, `npm audit` clean, Dependabot, CI audit |

## Controls

### 1. No browser-side provider secrets

The original single-file app built a Google API key from base64 fragments and
called `generativelanguage.googleapis.com` directly. That key was public to
every visitor and is not present in this repository. It should be **revoked** in
Google AI Studio, and any old static deployment that still serves it should be
taken down.

The current app calls one OpenAI-compatible endpoint from the server. An
optional `GUEST_API_KEY` is read from the environment and is never returned to
the browser, embedded in HTML, or written to logs.

### 2. Guest session cookie

- The session ID is a random UUID signed with HMAC-SHA256 using
  `GUEST_SESSION_SECRET`.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in
  production. In production it uses the `__Host-` prefix.
- The token includes `iss`, `aud`, `iat`, and `exp` claims. Signature
  verification is constant-time, and expired or tampered tokens are rejected.
- No account, email address, or profile is created.

### 3. Input validation

`server/routes/guest.js` enforces:

- A JSON object with a 1–2,000 character message and at most 4 history turns
  (4,000 characters total), using a shared sanitizer and strict schema.
- Any `image` field is rejected with `GUEST_TEXT_ONLY`; the API has no multipart
  upload path.
- A signed HttpOnly guest cookie, same-origin Fetch Metadata, and an IP rate
  limiter are required.
- Per-guest, per-IP, and global daily quotas are reserved before the upstream
  call. Output is capped at 500 tokens and 6,000 characters; the upstream
  timeout is 45 seconds and at most two requests run concurrently.
- Provider error bodies are never forwarded; only a generic
  `GUEST_BUSY`/`GUEST_UNAVAILABLE` error and request ID are returned.

### 4. CORS and request-origin checks

- Same-origin requests are always allowed.
- `ALLOWED_ORIGINS` accepts exact origins only (no `*`, no paths).
- Unknown browser origins are rejected before routing, not merely hidden by the
  browser's CORS enforcement.
- CORS credentials are enabled because the guest session uses a cookie.
- `ALLOWED_HOSTS` optionally rejects Host-header manipulation; it is required in
  production when HTTPS is enforced.
- The HTTPS redirect only uses a syntactically valid Host header. There are no
  user-controlled redirects or outbound URLs in the app, so SSRF/open-redirect
  surface is minimal.

### 5. TLS

- Production responses include HSTS (`max-age=15552000; includeSubDomains`).
- Cookies are `Secure` when `NODE_ENV=production`.
- `ENFORCE_HTTPS` (default true in production) redirects plain HTTP and rejects
  non-GET requests sent over HTTP. Production startup requires `ALLOWED_HOSTS`
  when HTTPS enforcement is enabled, preventing Host-header redirect abuse.
- Terminate TLS at the hosting platform/reverse proxy and forward
  `X-Forwarded-Proto: https`. Set `TRUST_PROXY` to the exact number of proxy hops
  so IP-based rate limiting is not bypassed by spoofed forwarding headers.

### 6. Security headers and XSS

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
- No third-party scripts, fonts, or background images are loaded.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, COOP/CORP, and a restrictive
  `Permissions-Policy` are set.
- Express JSON responses escape HTML-sensitive characters (`json escape`).
- The frontend has no web storage and keeps history in memory only, which
  reduces exposure on shared devices.

### 7. Logging

- Request logs contain method, path, status, duration, IP, and request ID only.
- Query strings, headers, cookies, bodies, prompts, replies, history, and
  provider tokens are never logged.
- `server/lib/logger.js` recursively redacts sensitive keys and truncates long
  strings.
- Upstream errors log only the HTTP status and timing, never the response body.
- Production error responses do not include stack traces or internal messages.
  Development-only `debug` output is suppressed when `NODE_ENV=production`.
- `X-Powered-By` is removed.

### 8. Rate limits and abuse resistance

| Scope | Default |
| ----- | ------- |
| All `/api` | 300 requests / 15 min per IP |
| `/api/guest/chat` | 5 requests / 10 min per IP |
| Guest daily budget | 5 per guest, 10 per IP, 200 per process |
| Concurrent upstream calls | 2 |

Responses use standard `RateLimit`/`RateLimit-Policy` headers and return HTTP
429 with a request ID. These are per-process in-memory counters; use a shared
store (Redis) for multi-instance deployments.

Clearing a guest cookie does not bypass the per-IP limit or the global budget.
The provider call is bounded by a timeout, a circuit breaker, and a concurrency
limit.

### 9. Dependencies

- Versions are pinned with caret ranges and a committed `package-lock.json`.
- `npm audit --omit=dev --audit-level=high` currently reports 0 vulnerabilities.
- `.github/dependabot.yml` opens weekly update PRs.
- CI runs tests and a production dependency audit on every push/PR.
- `npm ci` is used in deployment/CI for reproducible installs.

## Residual risks and limitations

- **AI provider processing:** prompts are sent from the server to the configured
  provider. Free endpoints may have their own data policies. This app is not
  HIPAA/GDPR-compliant out of the box and must not be used for protected health
  information without appropriate agreements, retention controls, and legal
  review.
- **Provider availability:** the default endpoint is a free public endpoint with
  no SLA and no guaranteed model quality. If an LLM7 token is configured, guest
  traffic consumes that shared free allowance and may hit its daily/rate limits.
  Use a provider and credentials you control for production.
- **AI output:** model responses are not medically validated. The system prompt
  adds safety rules and emergency guidance, but it is not a clinical device.
- **Prompt injection:** users can try to override the system prompt. The model
  has no tools, secrets, or privileged access, and output is rendered as plain
  text, but it can still produce unsafe or inaccurate health information.
- **Single-process state:** rate limits and guest quota counters are in memory.
  Restarting resets guest daily counters. Multiple instances require a shared
  store for strict global limits. The signed guest cookie survives restarts, but
  its daily counter does not.
- **Cookie theft:** the guest session is a signed HttpOnly cookie. HTTPS,
  `SameSite=Lax`, and a one-day default lifetime limit exposure, but a stolen
  cookie can be used until it expires. The cookie carries no personal data.
- **No persistent audit log:** request IDs are returned for support, but logs are
  process output and depend on your platform's retention policy.
- **No accounts or email verification:** by design. There is no user record,
  password, or account-existence information.

## Rotation checklist after a leak

1. Revoke the old Google API key in Google AI Studio. It is not in this
   repository, but removal does not revoke it.
2. Rotate `GUEST_SESSION_SECRET`. This invalidates existing guest cookies; new
   visitors get a new session automatically.
3. If `GUEST_API_KEY` was exposed, revoke/rotate the provider token and update
   the deployment environment variable.
4. If any secret was committed, remove it from git history and force-rotate it;
   deleting the file in a later commit is not enough.
