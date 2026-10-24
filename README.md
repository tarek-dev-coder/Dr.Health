# Dr.Health

Dr.Health is an AI health information assistant. Ask health questions in any
language, or upload a photo of a meal, fridge, or medical image.

> **Important:** the old single-file app shipped a Google API key inside
> `index.html`. That key must be treated as compromised. It has been removed from
> this project and from the local `.env`; revoke it in Google AI Studio. The app
> now uses OpenRouter OAuth and each signed-in user's own key, so the owner does
> not pay for other people's requests.

## How it works

1. The user clicks **Continue with Google**.
2. OpenRouter handles sign-in and creates an API key tied to that user's account.
3. The server receives the key once, encrypts it with AES-256-GCM, and stores it
   in Postgres. The browser never receives the key.
4. Every chat request uses the signed-in user's decrypted key. The owner's key is
   not used, and there is no shared API key in `.env`.
5. The default free model is Google Gemma 4 31B (multimodal), with free fallback
   models. Free-model usage is limited by the user's OpenRouter account (currently
   about 50 requests/day). This is a general model, not a clinically validated
   medical model, and not Gemini 3.6 Flash.

The UI is a light editorial layout with a serif display face and one teal accent.
The hero animation is opt-in: a 24 KB poster loads first, and the animated WebP
loads only after Play.

## Requirements

- Node.js **20.19+** (Node 22/24 recommended)
- An OpenRouter account for each user (Google/GitHub/email sign-in is available
  on OpenRouter's page)
- Postgres for production (Neon Free is sufficient); local development can use
  the in-memory fallback

## Quick start

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Generate a session secret and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```dotenv
SESSION_SECRET=...
```

Start the server:

```bash
npm start
```

Open <http://localhost:3000> and click **Continue with Google**. The OAuth
callback defaults to `http://localhost:3000/auth/callback`; localhost callbacks
are supported by OpenRouter on any port. No OpenRouter API key is stored in
`.env`.

For development with automatic restarts:

```bash
npm run dev
```

Without `DATABASE_URL`, the server uses an encrypted in-memory key store. Keys
are lost on restart and the user must sign in again. This is only for local
development; production requires Postgres.

### Optional admin API

Generate the admin password hash (the password is not stored anywhere):

```bash
npm run hash-password
```

Put the hash in `.env`:

```dotenv
ADMIN_PASSWORD_HASH=scrypt$...
```

Admin endpoints:

| Method | Path                 | Purpose                               |
| ------ | -------------------- | ------------------------------------- |
| POST   | `/api/admin/login`   | Set the HttpOnly admin session cookie |
| POST   | `/api/admin/logout`  | Revoke the session and clear cookie   |
| GET    | `/api/admin/session` | Check the current session             |
| GET    | `/api/admin/stats`   | Basic in-memory usage counters        |

Admin access is disabled (HTTP 503) when `ADMIN_PASSWORD_HASH` or
`SESSION_SECRET` is missing. Admin cookies use `HttpOnly`, `SameSite=Strict`, and
`Secure` in production. Admin stats expose the configured model only to an
authenticated admin, never in chat.

### User authentication

| Method | Path                  | Purpose                                      |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/auth/openrouter`    | Start PKCE sign-in and set the state cookie  |
| GET    | `/auth/callback`      | Exchange the code for the user's API key     |
| GET    | `/api/auth/session`   | Check whether the user is signed in          |
| POST   | `/api/auth/logout`    | Delete the local encrypted key and clear cookie |

The OAuth flow uses PKCE S256 and a signed, short-lived `state` cookie. The user
session is a signed HttpOnly cookie (`SameSite=Lax`) plus a user record in the
key store. Logout deletes the local user record, so a replayed cookie cannot read
the key. The OpenRouter key itself can be revoked separately from the user's
OpenRouter account.

### Chat API

`POST /api/chat` requires a signed-in user. It accepts either:

- `multipart/form-data`: `message` (text), optional `image` (JPEG/PNG/WebP,
  max 5 MB), optional `history` (JSON string of previous turns)
- `application/json`: `{ "message": "...", "history": [...] }`

```json
{ "reply": "..." }
```

Errors have the shape:

```json
{ "error": { "code": "MESSAGE_REQUIRED", "message": "...", "requestId": "..." } }
```

Common codes:

| Code | Meaning |
| ---- | ------- |
| `SIGN_IN_REQUIRED` | No valid user session |
| `AI_KEY_INVALID` | The user's OpenRouter key was rejected; sign in again |
| `AI_QUOTA_EXHAUSTED` | Free-model allowance or upstream capacity is exhausted |
| `AI_CREDITS_EXHAUSTED` | The user's OpenRouter account needs credits |
| `AI_TIMEOUT` / `AI_UNAVAILABLE` | Upstream timeout or outage |

## Configuration

All settings live in `.env`; see [.env.example](.env.example). The most
important ones:

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `NODE_ENV` | `development` | Use `production` in deployment |
| `APP_ORIGIN` | `http://localhost:3000` | Public origin; required and HTTPS in production |
| `OPENROUTER_CALLBACK_URL` | `APP_ORIGIN/auth/callback` | Must match the URL used at OpenRouter; HTTPS in production |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it:free` | Free multimodal primary model |
| `OPENROUTER_FALLBACK_MODELS` | `google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3.5-super-vl:free` | Tried on quota/outage |
| `OPENROUTER_TIMEOUT_MS` | `60000` | Maximum wait for a model response |
| `DATABASE_URL` | — | Required in production; Neon/Postgres connection string |
| `DATABASE_SSL` | `auto` | `auto` uses TLS in production |
| `SESSION_SECRET` | — | Required in production; signs OAuth state and user sessions |
| `KEY_ENCRYPTION_SECRET` | `SESSION_SECRET` | Optional separate AES key; rotating it invalidates saved keys |
| `USER_SESSION_TTL_MINUTES` | `10080` | User session lifetime (7 days) |
| `ALLOWED_ORIGINS` | same-origin only | Exact additional browser API origins |
| `ALLOWED_HOSTS` | any | Required in production when HTTPS is enforced |
| `TRUST_PROXY` | `0` | Set to `1` behind one reverse proxy (Render) |
| `ENFORCE_HTTPS` | `true` in prod | Redirect plain HTTP; requires `ALLOWED_HOSTS` |
| `MAX_UPLOAD_MB` | `5` | Upload limit (also enforced client-side) |
| `MAX_MESSAGE_CHARS` | `4000` | Per-message limit |
| `CHAT_RATE_LIMIT` | `20` per 10 min | Per-IP chat requests |
| `GLOBAL_RATE_LIMIT` | `300` per 15 min | Per-IP API requests |
| `AUTH_RATE_LIMIT` | `30` per 15 min | Per-IP OAuth starts/callbacks |
| `LOGIN_RATE_LIMIT` | `5` per 15 min | Per-IP failed admin logins |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |

> **Model note (October 2026):** the free OpenRouter catalog includes
> `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`, and
> `nvidia/nemotron-3.5-super-vl:free`. They accept image input. Free-model limits
> are per OpenRouter account and can change. The system prompt forbids disclosing
> the model, provider, vendor, or architecture in chat.

## Performance notes

- The hero starts as a 24 KB poster. The animated WebP (about 1 MB) is loaded
  only when the play control is used, so it does not affect first paint or LCP.
  The original GIF is the fallback for browsers without WebP support, and
  reduced-motion users keep the poster.
- Images larger than 1.5 MB are resized to a maximum dimension of 1600 px in the
  browser before upload. This reduces mobile data use and keeps requests inside
  the server's 5 MB limit.
- Text responses are gzip-compressed. The app shell is `no-store`; images are
  cached for one day. There is no service worker or CDN dependency.
- The UI is intentionally a light, editorial layout with one accent colour, a
  serif display face, and no gradients, glass effects, or decorative animation.
  The chat is the primary control; the hero loop is a framed visual, not a
  full-screen background.
- Postgres is used only for the encrypted per-user key vault. Queries use
  parameter placeholders; there is no ORM, pagination, or unbounded list.

## Troubleshooting

- **`AUTH_NOT_CONFIGURED` / HTTP 503:** `SESSION_SECRET` is missing. Generate one
  and restart.
- **OAuth callback returns `auth_error=1`:** check that
  `OPENROUTER_CALLBACK_URL` exactly matches the public URL, that `APP_ORIGIN` is
  correct, and that cookies are not blocked. OAuth codes expire after 10 minutes.
- **`AI_KEY_INVALID`:** the user's OpenRouter key was revoked or rejected. Sign in
  again to create a new key.
- **`AI_QUOTA_EXHAUSTED` / HTTP 429:** the free-model allowance is exhausted or
  upstream capacity is busy. Check the `Retry-After` header and try later, or add
  credits to the user's OpenRouter account.
- **`AI_TIMEOUT` / HTTP 504:** the model took longer than
  `OPENROUTER_TIMEOUT_MS`. Try again or raise the timeout.
- **`AI_UNAVAILABLE` / HTTP 502:** the server could not reach OpenRouter. Check
  the `ai_request_failed` log line and network access.
- **`store_init_failed` at startup:** check `DATABASE_URL`, the database's TLS
  settings, and that the database accepts connections from Render.
- **Changes to `.env` require a server restart.** Configuration is read once.

## Testing

```bash
npm test
npm run audit
```

The tests cover security headers, CORS/origin enforcement, input and upload
validation, OAuth state/PKCE, encrypted key storage, per-user chat proxying,
fallback models, quota errors, logout, admin sessions, and frontend
secret/storage checks.

## Deployment: Render Free + Neon

1. Create a **private** GitHub repository and push this project. Do not commit
   `.env`.
2. Create a free Neon Postgres project. Copy the pooled connection string. It
   should include `sslmode=require`.
3. In Render, create a **Web Service** from the private repository. You can use
   the included `render.yaml` blueprint, or set:
   - Runtime: Node
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check: `/api/health`
   - Instance type: Free
4. Set these Render environment variables:

   ```dotenv
   NODE_ENV=production
   APP_ORIGIN=https://your-app.onrender.com
   OPENROUTER_CALLBACK_URL=https://your-app.onrender.com/auth/callback
   DATABASE_URL=postgresql://...sslmode=require
   DATABASE_SSL=true
   SESSION_SECRET=<48-byte-random-base64url>
   KEY_ENCRYPTION_SECRET=<another-48-byte-random-base64url>
   ALLOWED_HOSTS=your-app.onrender.com
   TRUST_PROXY=1
   ENFORCE_HTTPS=true
   ```

5. Deploy. Render's first request after inactivity may be slow because Free
   instances spin down. Postgres and encrypted keys persist across restarts.
6. Open the Render URL, click **Continue with Google**, and complete the
   OpenRouter flow. The callback URL must match exactly, without a trailing
   slash.

The built-in rate-limit store, metrics, and admin session registry are in memory,
so they assume a single Node process. Encrypted user keys and user records are in
Postgres and survive restarts. For multiple instances, move rate limits and admin
sessions to a shared store such as Redis.

## Privacy and medical safety

- Requests are sent to OpenRouter using the signed-in user's own key. Free
  models may have their own data policies; do not enter identifying information
  or protected health information.
- Chat history is kept in the browser's memory only and is lost on reload.
- The server stores the encrypted OpenRouter key, a local user ID, a key hash,
  and timestamps. It does not store chat history, prompts, replies, or images.
- Dr.Health is not a doctor, does not diagnose, and does not replace professional
  care. In an emergency, call your local emergency number.

## License

Licensed under the **MIT License**. See [LICENSE](LICENSE).
