# Dr.Health

Dr.Health is a free health-information assistant with a dark-first, hand-built
interface. Ask a question or attach a text/code file and get a concise answer.
There is no account, no sign-in, no database, and no daily message quota.

> **Important:** Dr.Health is an information tool, not a doctor. It does not
> diagnose or prescribe. In an emergency, contact your local emergency number.

## How it works

1. The browser sends a text question and, optionally, one text/code file to the
   server as `multipart/form-data`.
2. The server chooses a provider:
   - **OVHcloud AI Endpoints** (`Meta-Llama-3_3-70B-Instruct`) for general
     health questions.
   - **LLM7.io** (`codestral-latest`) for source-code files and code-style
     questions.
3. If the first provider returns `429`, times out, or is unavailable, the server
   automatically tries the other provider. OVH gets a 30-second cooldown after a
   `429`; LLM7 is retried twice with a short backoff.
4. Provider names, model ids, tokens, and error bodies stay on the server. The
   browser only receives the reply text.
5. Chat history is kept in the browser tab's memory only. The server does not
   store questions, replies, or files.

The app is stateless. There is no cookie, session, user record, or database.
Per-IP rate limits and in-process provider cooldowns are the only state.

## Requirements

- Node.js **20.19+** (Node 22/24 recommended)
- No paid provider account is required. The default endpoints are keyless; OVH
  may return `403` when its public quota is unavailable, and the server then
  falls back to LLM7. For stable OVH use, set `OVH_API_KEY` to a free token from
  the OVHcloud AI Endpoints console.

## Quick start

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm start
```

Open <http://localhost:3000>. The defaults work without an API key.

For development with automatic restarts:

```bash
npm run dev
```

## Configuration

All settings live in `.env`; see [.env.example](.env.example). The defaults are
safe for local development.

### Providers

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `OVH_BASE_URL` | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` | OVHcloud OpenAI-compatible base URL |
| `OVH_MODEL` | `Meta-Llama-3_3-70B-Instruct` | OVH model id |
| `OVH_API_KEY` | `empty-if-anonymous` | Anonymous-tier placeholder (stripped before the request) |
| `OVH_TIMEOUT_MS` | `40000` | OVH request timeout |
| `OVH_RPM` | `2` | Local per-minute budget for OVH |
| `LLM7_BASE_URL` | `https://api.llm7.io/v1` | LLM7 OpenAI-compatible base URL |
| `LLM7_MODEL` | `codestral-latest` | LLM7 model id |
| `LLM7_API_KEY` | `unused` | Anonymous-tier placeholder; a free token from <https://dash.llm7.io> raises limits |
| `LLM7_TIMEOUT_MS` | `20000` | LLM7 request timeout |
| `LLM7_RPM` | `25` | Local per-minute budget for LLM7 |
| `LLM7_RETRY_DELAY_MS` | `2000` | First retry delay after a `429` |
| `LLM7_MAX_RETRIES` | `2` | Extra attempts after a `429` |

OVH's anonymous tier allows about **2 requests per minute per IP per model**.
The placeholder key is stripped so the request is genuinely anonymous; OVH can
still return `403` when its public quota is unavailable, and the server then
falls back to LLM7. For stable OVH use, set `OVH_API_KEY` to a free token from
the OVHcloud AI Endpoints console. LLM7's anonymous tier allows about **30
requests per minute** but is less reliable at peak times. A free LLM7 token
raises the limit to 60 requests/min and 250/hour. Do not rely on either free
tier for high-throughput production use.

### Chat limits

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `CHAT_TIMEOUT_MS` | `60000` | Total time budget across both providers |
| `CHAT_MAX_OUTPUT_TOKENS` | `800` | Output token cap |
| `CHAT_MAX_MESSAGE_CHARS` | `4000` | Per-message character cap |
| `CHAT_MAX_HISTORY_TURNS` | `12` | Conversation turns sent upstream |
| `CHAT_MAX_HISTORY_CHARS` | `48000` | Total history character cap |
| `CHAT_MAX_RESPONSE_CHARS` | `12000` | Returned text cap |
| `CHAT_MAX_FILE_MB` | `0.25` | Upload size cap (256 KB) |
| `CHAT_MAX_FILE_CHARS` | `24000` | Extracted file character cap |
| `CHAT_MAX_CONCURRENT` | `3` | Concurrent upstream requests |
| `CHAT_RATE_LIMIT` | `30` per minute | Per-IP chat limiter |
| `CHAT_RATE_WINDOW_MINUTES` | `1` | Chat limiter window |

### Network and logging

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `ALLOWED_ORIGINS` | same-origin only | Exact additional browser API origins |
| `ALLOWED_HOSTS` | any | Required in production when HTTPS is enforced |
| `TRUST_PROXY` | `0` | Set to `1` behind one reverse proxy |
| `ENFORCE_HTTPS` | `true` in production | Redirect plain HTTP; requires `ALLOWED_HOSTS` |
| `GLOBAL_RATE_LIMIT` | `300` per 15 min | Per-IP API requests |
| `GLOBAL_RATE_WINDOW_MINUTES` | `15` | Global limiter window |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |

The server logs request metadata and which provider served each reply. It does
not log prompts, replies, files, cookies, or provider tokens.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/chat` | Send a message and/or one text/code file |

`POST /api/chat` accepts `multipart/form-data` with:

- `message` — text, up to `CHAT_MAX_MESSAGE_CHARS` characters.
- `history` — optional JSON string containing up to `CHAT_MAX_HISTORY_TURNS`
  turns: `[{ "role": "user" | "model", "text": "..." }]`.
- `file` — optional single text/code file.

A JSON body with `message` and `history` also works when no file is attached.

Success:

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
| `MESSAGE_REQUIRED` | No non-empty message or file |
| `INVALID_MESSAGE` | Message is not text |
| `MESSAGE_TOO_LONG` | Message exceeds the configured limit |
| `INVALID_HISTORY` | History is not a valid, bounded turn list |
| `UNSUPPORTED_FILE` | Binary, unsafe, or unsupported file |
| `FILE_TOO_LARGE` / `FILE_TOO_LONG` | File exceeds the size or character limit |
| `UNSUPPORTED_MEDIA_TYPE` | An image field was supplied |
| `CHAT_BUSY` | Too many concurrent chats |
| `CHAT_UNAVAILABLE` | Both providers are rate-limited or unavailable |
| `RATE_LIMITED` | Too many requests from this IP |

## Attachments

The models are text models. The server accepts any valid UTF-8 text file, plus
UTF-16 text with a BOM. Common source-code, Markdown, CSV, JSON, YAML, logs, and
configuration files are detected for syntax-aware prompting.

Images, PDFs, office documents, audio, video, archives, executables, `.env`
files, and private-key files are rejected. Attached files are held in memory,
sent to the provider as untrusted text, and never written to disk.

## Privacy and medical safety

- Questions, history, and file text are sent from the server to the selected
  provider. Free endpoints may have their own data policies; do not enter
  identifying information or protected health information.
- The server does not store chat history, prompts, replies, or files. Provider
  cooldowns and rate limits are in process memory.
- Dr.Health is not a doctor, does not diagnose, and does not replace
  professional care.
- If you describe a possible emergency, the assistant is instructed to direct
  you to local emergency services.

## Testing

```bash
npm test
npm run audit
```

The tests cover security headers, origin and CSRF enforcement, provider
selection, fallback on `429` and timeout, text/code attachments, binary file
rejection, input bounds, concurrency, generic provider errors, removed routes,
frontend secret/storage checks, and static asset caching.

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
   ALLOWED_HOSTS=your-app.onrender.com
   TRUST_PROXY=1
   ENFORCE_HTTPS=true
   ```

   The provider defaults are keyless. Add `OVH_API_KEY` or `LLM7_API_KEY` only if
   you are using a token you control.

5. Deploy and open the public URL. Render Free instances spin down after
   inactivity, so the first request may be slow.

Rate limits and provider cooldowns are per process. Restarting resets them. For a
multi-instance deployment, move the counters to a shared store.

## Security note

The original single-file version of this project exposed a Google API key in
client-side code. That key is not present in this repository, but it should be
revoked in Google AI Studio, and any old static deployment that still serves it
should be taken down.

## License

Licensed under the **MIT License**. See [LICENSE](LICENSE).
