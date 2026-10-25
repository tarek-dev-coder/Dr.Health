# Dr.Health

Dr.Health is a free, text-only health information assistant. Ask a question and
get a short, evidence-aligned answer. There is no account, no sign-in, no
database, and no image upload.

> **Important:** Dr.Health is an information tool, not a doctor. It does not
> diagnose or prescribe. In an emergency, contact your local emergency number.

## How it works

1. The browser starts a signed guest session. The session ID lives in an
   HttpOnly cookie; no account or personal profile is created.
2. The browser sends a text question to the server. The server calls one
   OpenAI-compatible chat endpoint. The endpoint and any provider token stay on
   the server and are never sent to the browser.
3. Each question is bounded by a per-guest, per-IP, and per-process daily quota,
   plus an IP rate limit. Messages are capped at 2,000 characters, history at
   four turns, output at 500 tokens, and returned text at 6,000 characters.
4. Chat history is kept in the browser tab's memory only. The server does not
   store questions, replies, or sessions.
5. The assistant is text-only. Requests that include an `image` field are
   rejected with `GUEST_TEXT_ONLY`.

The UI is a light editorial layout with a serif display face and one teal
accent. The hero animation is opt-in: a small poster loads first, and the
animated WebP loads only after Play.

## Requirements

- Node.js **20.19+** (Node 22/24 recommended)
- An OpenAI-compatible chat endpoint. The default endpoint is keyless; you can
  use LLM7 or another provider with a server-side token.

No database or external account is required.

## Quick start

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Generate the guest-cookie secret and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```dotenv
GUEST_SESSION_SECRET=...
```

Start the server:

```bash
npm start
```

Open <http://localhost:3000>. The app starts a free session automatically.

For development with automatic restarts:

```bash
npm run dev
```

## Configuration

All settings live in `.env`; see [.env.example](.env.example). The most
important ones:

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `NODE_ENV` | `development` | Use `production` in deployment |
| `PORT` | `3000` | HTTP port |
| `GUEST_SESSION_SECRET` | - | Required; at least 32 characters; signs the guest cookie |
| `GUEST_SESSION_TTL_MINUTES` | `1440` | Guest cookie lifetime |
| `GUEST_API_URL` | keyless OVH endpoint | OpenAI-compatible chat endpoint |
| `GUEST_MODEL` | `Meta-Llama-3_3-70B-Instruct` | Model id used by the server |
| `GUEST_API_KEY` | unset | Optional server-side provider token |
| `GUEST_TIMEOUT_MS` | `45000` | Upstream timeout |
| `GUEST_MAX_OUTPUT_TOKENS` | `500` | Output token cap |
| `GUEST_MAX_MESSAGE_CHARS` | `2000` | Per-message character cap |
| `GUEST_MAX_HISTORY_TURNS` | `4` | Conversation turns sent upstream |
| `GUEST_MAX_HISTORY_CHARS` | `4000` | Total history character cap |
| `GUEST_MAX_RESPONSE_CHARS` | `6000` | Returned text cap |
| `GUEST_DAILY_LIMIT` | `5` | Questions per guest per UTC day |
| `GUEST_IP_DAILY_LIMIT` | `10` | Questions per IP per UTC day |
| `GUEST_GLOBAL_DAILY_LIMIT` | `200` | Questions per process per UTC day |
| `GUEST_RATE_LIMIT` | `5` per 10 min | Per-IP guest chat limiter |
| `GUEST_MAX_CONCURRENT` | `2` | Maximum concurrent upstream requests |
| `ALLOWED_ORIGINS` | same-origin only | Exact additional browser API origins |
| `ALLOWED_HOSTS` | any | Required in production when HTTPS is enforced |
| `TRUST_PROXY` | `0` | Set to `1` behind one reverse proxy |
| `ENFORCE_HTTPS` | `true` in production | Redirect plain HTTP; requires `ALLOWED_HOSTS` |
| `GLOBAL_RATE_LIMIT` | `300` per 15 min | Per-IP API requests |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |

### Using LLM7 or another provider

The default endpoint is keyless. To use LLM7 instead, set:

```dotenv
GUEST_API_URL=https://api.llm7.io/v1/chat/completions
GUEST_MODEL=<LLM7 free model id>
GUEST_API_KEY=<LLM7 free token>
```

The token stays on the server and is never sent to the browser. If the provider
is rate-limited or unavailable, the API returns `GUEST_BUSY` or
`GUEST_UNAVAILABLE`; provider error bodies are never forwarded.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/guest/session` | Check session and remaining quota |
| `POST` | `/api/guest/session` | Start or resume a signed guest session |
| `POST` | `/api/guest/chat` | Send a text question; returns `reply` and `remaining` |

`POST /api/guest/chat` accepts JSON:

```json
{
  "message": "What is a balanced breakfast?",
  "history": [
    { "role": "user", "text": "..." },
    { "role": "model", "text": "..." }
  ]
}
```

Success:

```json
{ "reply": "...", "remaining": 4 }
```

Errors have the shape:

```json
{ "error": { "code": "MESSAGE_REQUIRED", "message": "...", "requestId": "..." } }
```

Common codes:

| Code | Meaning |
| ---- | ------- |
| `MESSAGE_REQUIRED` | No non-empty message |
| `MESSAGE_TOO_LONG` | Message exceeds the configured limit |
| `INVALID_HISTORY` | History is not a valid, bounded turn list |
| `GUEST_TEXT_ONLY` | An `image` field was supplied |
| `GUEST_LIMIT_REACHED` | Daily guest/IP/global quota exhausted |
| `GUEST_BUSY` | Provider rate limit or concurrency limit |
| `GUEST_UNAVAILABLE` / `GUEST_TIMEOUT` | Provider outage or timeout |
| `RATE_LIMITED` | Too many requests from this IP |

The guest cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. In
production it uses the `__Host-` prefix.

## Privacy and medical safety

- Questions and replies are sent from the server to the configured provider.
  Free endpoints may have their own data policies; do not enter identifying
  information or protected health information.
- The server does not store chat history, prompts, replies, or images. Guest
  quota counters are in process memory and reset on restart or at UTC midnight.
- The server logs request metadata only. It does not log message bodies,
  replies, cookies, or provider tokens.
- Dr.Health is not a doctor, does not diagnose, and does not replace
  professional care.

## Testing

```bash
npm test
npm run audit
```

The tests cover security headers, origin enforcement, guest session cookies,
cookie tampering, text-only validation, quotas, provider errors, removed
sign-in/admin routes, frontend secret/storage checks, and static asset caching.

## Deployment

Any Node host works. The included `render.yaml` describes a free Render web
service with no database:

1. Push this repository to GitHub. Do not commit `.env`.
2. In Render, create a **Web Service** from the repository, or use the
   `render.yaml` blueprint.
3. Set:
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check: `/api/health`
4. Set these environment variables:

   ```dotenv
   NODE_ENV=production
   GUEST_SESSION_SECRET=<48-byte-random-base64url>
   ALLOWED_HOSTS=your-app.onrender.com
   TRUST_PROXY=1
   ENFORCE_HTTPS=true
   ```

   Add `GUEST_API_URL`, `GUEST_MODEL`, and `GUEST_API_KEY` only if you are not
   using the keyless default.

5. Deploy and open the public URL. Render Free instances spin down after
   inactivity, so the first request may be slow.

Guest quotas and rate limits are per process. Restarting resets them. For a
multi-instance deployment, move the counters to a shared store.

## Security note

The original single-file version of this project exposed a Google API key in
client-side code. That key is not present in this repository, but it should be
revoked in Google AI Studio, and any old static deployment that still serves it
should be taken down.

## License

Licensed under the **MIT License**. See [LICENSE](LICENSE).
