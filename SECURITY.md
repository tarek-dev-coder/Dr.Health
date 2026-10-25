# Security Policy and Hardening Notes

Dr.Health is a free health-information app with text/code attachments. There are
no accounts, no sign-in, no database, no cookies, and no user records. Chat
history can be saved in the browser's `localStorage`; attached file text is not
saved. The security baseline focuses on keeping provider credentials
server-side, bounding free usage, validating text and files, and rendering model
output safely.

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
   │  same-origin multipart fetch; no chat cookies; theme + local history
   ▼
Node/Express (server/)
   ├─ text and file validation / size bounds
   ├─ origin, Host, and Fetch-Metadata checks
   ├─ per-IP rate limits and provider cooldowns
   ├─ provider selection + automatic fallback
   └─ redacted structured logs
   │
   ├──► OVHcloud AI Endpoints (server-to-server)
   └──► LLM7.io (server-to-server)
```

The browser never receives a provider token and never calls a provider directly.
`public/` is the only directory served statically. The server keeps no database
and no user records.

## Checklist

| Requested item | Status | Implementation |
| -------------- | ------ | -------------- |
| Enable TLS/HTTPS | Done | HSTS in production, HTTPS redirect, deployment guidance |
| Tighten CORS | Done | Same-origin by default, exact allowlist, unknown origins rejected server-side, no wildcard |
| Keep tokens out of local storage | Done | Provider tokens and file contents never enter web storage; only the theme preference and optional chat text are stored locally |
| Hide env from git | Done | `.gitignore`, `.env.example`, no secrets in tracked files |
| Validate form inputs | Done | Zod schemas, length limits, control-character stripping, strict JSON, bounded history |
| Validate attachments | Done | One file, 256 KB / 24,000-char caps, UTF-8 validation, blocked binary and secret-file types |
| Disable production debugging | Done | Generic errors in production, no stack traces, no `X-Powered-By`, no upstream error bodies |
| Server-side API secrets | Done | Provider placeholders/tokens are read from the environment and sent only to the upstream endpoint |
| Rate limit requests | Done | Global and chat limiters with standard rate-limit headers |
| Bound upstream usage | Done | Per-minute local provider budgets, 429 cooldowns, retries, 60-second deadline, 3 concurrent requests |
| Keep sensitive data from logs | Done | Request logger logs metadata only; recursive redaction; no prompts, replies, files, or tokens |
| Block cross-site scripting | Done | Strict CSP, no inline script/style, `textContent` only, no HTML sinks, `nosniff`, frame denial |
| Update dependencies | Done | Current packages, lockfile, `npm audit` clean, Dependabot, CI audit |

## Controls

### 1. No browser-side provider secrets

The original single-file app built a Google API key from base64 fragments and
called `generativelanguage.googleapis.com` directly. That key was public to
every visitor and is not present in this repository. It should be **revoked** in
Google AI Studio, and any old static deployment that still serves it should be
taken down.

The current app calls two OpenAI-compatible endpoints from the server. The
`OVH_API_KEY` and `LLM7_API_KEY` values are read from the environment and are
never returned to the browser, embedded in HTML, or written to logs. The OVH
anonymous placeholder (`empty-if-anonymous`) is stripped at the transport layer
so the request is genuinely keyless; the LLM7 anonymous placeholder (`unused`)
is not a secret either.

### 2. Stateless design

- There is no session cookie, account, email address, or profile.
- Chat history is held in browser memory and optionally saved to
  `localStorage`; recent turns are sent back with each request. The server does
  not store them.
- Saved chats contain message text and the attached file name only. File
  contents are held in memory for the duration of the request and are not
  persisted.
- Provider cooldowns and rate-limit counters are in process memory and reset on
  restart.

### 3. Input and attachment validation

`server/routes/chat.js` enforces:

- One optional file plus `message` and `history` fields, using a shared
  sanitizer and strict schema.
- A message of up to 4,000 characters; at most 12 history turns (48,000
  characters total).
- One file, up to 256 KB and 24,000 characters.
- UTF-8 validation (UTF-16 with a BOM is also accepted); NUL-containing and
  invalid-byte files are rejected.
- Images, PDFs, office documents, audio, video, archives, executables, `.env`
  files, and private-key files are rejected before any provider call.
- An explicit `image` field is rejected with `UNSUPPORTED_MEDIA_TYPE`.
- Provider error bodies are never forwarded; only a generic
  `CHAT_BUSY`/`CHAT_UNAVAILABLE` error and request ID are returned.

### 4. CORS and request-origin checks

- Same-origin requests are always allowed.
- `ALLOWED_ORIGINS` accepts exact origins only (no `*`, no paths).
- Unknown browser origins are rejected before routing, not merely hidden by the
  browser's CORS enforcement.
- Fetch Metadata (`Sec-Fetch-Site`) rejects cross-site mutations.
- `ALLOWED_HOSTS` optionally rejects Host-header manipulation; it is required in
  production when HTTPS is enforced.
- The HTTPS redirect only uses a syntactically valid Host header. There are no
  user-controlled redirects or outbound URLs in the app, so SSRF/open-redirect
  surface is minimal.

### 5. TLS

- Production responses include HSTS (`max-age=15552000; includeSubDomains`).
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
- The frontend keeps chat history in memory and, when the user sends a message,
  in `localStorage`. Model output is inserted with `textContent`, never as
  HTML, and the app has no third-party scripts.
- Saved chats are visible to anyone who can use the same browser profile. The
  History panel has per-chat delete and a two-step "Clear all" control.

### 7. Logging

- Request logs contain method, path, status, duration, IP, and request ID only.
- Query strings, headers, cookies, bodies, prompts, replies, history, files, and
  provider tokens are never logged.
- `server/lib/logger.js` recursively redacts sensitive keys and truncates long
  strings.
- Provider logs include the provider id, timing, attempt, and HTTP status so
  reliability can be monitored. They never include response bodies.
- Production error responses do not include stack traces or internal messages.
  Development-only `debug` output is suppressed when `NODE_ENV=production`.
- `X-Powered-By` is removed.

### 8. Rate limits and abuse resistance

| Scope | Default |
| ----- | ------- |
| All `/api` | 300 requests / 15 min per IP |
| `/api/chat` | 30 requests / 1 min per IP |
| OVH local budget | 2 requests / min |
| LLM7 local budget | 25 requests / min |
| Concurrent upstream calls | 3 |
| Total request deadline | 60 seconds |

Responses use standard `RateLimit`/`RateLimit-Policy` headers and return HTTP
429 with a request ID. These are per-process in-memory counters; use a shared
store (Redis) for multi-instance deployments.

The provider call is bounded by a timeout, a local rate budget, a 429 cooldown,
and a concurrency limit. If one provider is rate-limited or unavailable, the
other is tried before returning a generic busy error.

### 9. Dependencies

- Versions are pinned with caret ranges and a committed `package-lock.json`.
- `npm audit --omit=dev --audit-level=high` currently reports 0 vulnerabilities.
- `.github/dependabot.yml` opens weekly update PRs.
- CI runs tests and a production dependency audit on every push/PR.
- `npm ci` is used in deployment/CI for reproducible installs.

## Residual risks and limitations

- **AI provider processing:** prompts and attached text are sent from the server
  to the selected provider. Free endpoints may have their own data policies.
  This app is not HIPAA/GDPR-compliant out of the box and must not be used for
  protected health information without appropriate agreements, retention
  controls, and legal review.
- **Browser-local history:** saved chats are stored unencrypted in
  `localStorage`. Anyone with access to the browser profile can read them, and
  clearing browser data removes them. On shared devices, use "Clear all" after
  a conversation. Attached file text is not saved.
- **Provider availability:** both default endpoints are free public endpoints
  with no SLA and no guaranteed model quality. OVH is intentionally slow and
  limited to 2 RPM per IP, and its public quota may return `403` when exhausted.
  LLM7 is faster but frequently rate-limits at peak times. The app falls back
  automatically, but use providers and credentials you control for production.
- **AI output:** model responses are not medically validated. The system prompt
  adds safety rules and emergency guidance, but it is not a clinical device.
- **Prompt injection:** users can try to override the system prompt, including
  through attached files. The model has no tools, secrets, or privileged access,
  and output is rendered as plain text, but it can still produce unsafe or
  inaccurate health information.
- **Single-process state:** rate limits and provider cooldowns are in memory.
  Multiple instances require a shared store for strict global limits.
- **No persistent audit log:** request IDs are returned for support, but logs are
  process output and depend on your platform's retention policy.
- **No accounts or email verification:** by design. There is no user record,
  password, or account-existence information.

## Rotation checklist after a leak

1. Revoke the old Google API key in Google AI Studio. It is not in this
   repository, but removal does not revoke it.
2. If a provider token was exposed, revoke/rotate it and update the deployment
   environment variable. Anonymous placeholders do not need rotation.
3. If any secret was committed, remove it from git history and force-rotate it;
   deleting the file in a later commit is not enough.
4. Review provider dashboards for unexpected usage and tighten
   `CHAT_RATE_LIMIT`, `OVH_RPM`, or `LLM7_RPM` if needed.
