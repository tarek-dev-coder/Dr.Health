import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const rawEnv = { ...process.env };

// Treat "FOO=" in .env as unset so documented defaults apply.
for (const key of [
  'OVH_API_KEY',
  'LLM7_API_KEY',
  'ALLOWED_ORIGINS',
  'ALLOWED_HOSTS',
  'ENFORCE_HTTPS',
]) {
  if (typeof rawEnv[key] === 'string' && rawEnv[key].trim() === '') {
    delete rawEnv[key];
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // OVHcloud AI Endpoints. The anonymous tier is keyless; the placeholder
  // key is accepted by the endpoint.
  OVH_BASE_URL: z
    .string()
    .trim()
    .url()
    .default('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1'),
  OVH_MODEL: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._:/-]{1,120}$/, 'OVH_MODEL contains invalid characters')
    .default('Meta-Llama-3_3-70B-Instruct'),
  OVH_API_KEY: z.string().trim().min(1).default('empty-if-anonymous'),
  OVH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(40000),
  OVH_RPM: z.coerce.number().int().min(1).max(60).default(2),

  // LLM7.io. The anonymous tier uses a non-empty placeholder key.
  LLM7_BASE_URL: z.string().trim().url().default('https://api.llm7.io/v1'),
  LLM7_MODEL: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._:/-]{1,120}$/, 'LLM7_MODEL contains invalid characters')
    .default('codestral-latest'),
  LLM7_API_KEY: z.string().trim().min(1).default('unused'),
  LLM7_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  LLM7_RPM: z.coerce.number().int().min(1).max(60).default(25),
  LLM7_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(10000).default(2000),
  LLM7_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),

  CHAT_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(60000),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(50).max(4000).default(800),
  CHAT_MAX_MESSAGE_CHARS: z.coerce.number().int().min(100).max(20000).default(4000),
  CHAT_MAX_HISTORY_TURNS: z.coerce.number().int().min(0).max(20).default(12),
  CHAT_MAX_HISTORY_CHARS: z.coerce.number().int().min(0).max(60000).default(48000),
  CHAT_MAX_RESPONSE_CHARS: z.coerce.number().int().min(500).max(40000).default(12000),
  CHAT_MAX_FILE_MB: z.coerce.number().min(0.1).max(5).default(0.25),
  CHAT_MAX_FILE_CHARS: z.coerce.number().int().min(1000).max(100000).default(24000),
  CHAT_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(3),
  CHAT_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  CHAT_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(1),

  ALLOWED_ORIGINS: z.string().default(''),
  ALLOWED_HOSTS: z.string().default(''),
  TRUST_PROXY: z.string().default('0'),
  ENFORCE_HTTPS: z.enum(['true', 'false']).optional(),

  GLOBAL_RATE_LIMIT: z.coerce.number().int().min(1).max(100000).default(300),
  GLOBAL_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';

function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTrustProxy(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  if (normalized === 'true') return 1;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value;
}

const allowedOrigins = parseList(env.ALLOWED_ORIGINS).map((origin) => {
  if (origin === '*') {
    throw new Error('ALLOWED_ORIGINS must not contain "*"');
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`ALLOWED_ORIGINS contains an invalid URL: ${origin}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.replace(/\/$/, '')) {
    throw new Error(`ALLOWED_ORIGINS must contain bare origins (no path): ${origin}`);
  }
  return url.origin;
});

const allowedHosts = parseList(env.ALLOWED_HOSTS).map((host) => {
  const normalized = host.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(normalized)) {
    throw new Error(`ALLOWED_HOSTS contains an invalid hostname: ${host}`);
  }
  return normalized;
});

const enforceHttps =
  env.ENFORCE_HTTPS !== undefined ? env.ENFORCE_HTTPS === 'true' : isProduction;

if (isProduction) {
  if (new URL(env.OVH_BASE_URL).protocol !== 'https:') {
    throw new Error('OVH_BASE_URL must use HTTPS in production');
  }
  if (new URL(env.LLM7_BASE_URL).protocol !== 'https:') {
    throw new Error('LLM7_BASE_URL must use HTTPS in production');
  }
}

if (isProduction && enforceHttps && allowedHosts.length === 0) {
  throw new Error(
    'ALLOWED_HOSTS is required when ENFORCE_HTTPS is enabled in production (prevents Host-header redirect abuse)',
  );
}

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  publicDir: path.join(rootDir, 'public'),

  providers: Object.freeze({
    ovh: Object.freeze({
      id: 'ovh',
      baseUrl: env.OVH_BASE_URL.replace(/\/$/, ''),
      model: env.OVH_MODEL,
      apiKey: env.OVH_API_KEY,
      timeoutMs: env.OVH_TIMEOUT_MS,
      rpm: env.OVH_RPM,
      cooldownMs: 30000,
    }),
    llm7: Object.freeze({
      id: 'llm7',
      baseUrl: env.LLM7_BASE_URL.replace(/\/$/, ''),
      model: env.LLM7_MODEL,
      apiKey: env.LLM7_API_KEY,
      timeoutMs: env.LLM7_TIMEOUT_MS,
      rpm: env.LLM7_RPM,
      cooldownMs: 5000,
      retryDelayMs: env.LLM7_RETRY_DELAY_MS,
      maxRetries: env.LLM7_MAX_RETRIES,
    }),
  }),

  chatTimeoutMs: env.CHAT_TIMEOUT_MS,
  chatMaxOutputTokens: env.CHAT_MAX_OUTPUT_TOKENS,
  chatMaxMessageChars: env.CHAT_MAX_MESSAGE_CHARS,
  chatMaxHistoryTurns: env.CHAT_MAX_HISTORY_TURNS,
  chatMaxHistoryChars: env.CHAT_MAX_HISTORY_CHARS,
  chatMaxResponseChars: env.CHAT_MAX_RESPONSE_CHARS,
  chatMaxFileBytes: Math.floor(env.CHAT_MAX_FILE_MB * 1024 * 1024),
  chatMaxFileChars: env.CHAT_MAX_FILE_CHARS,
  chatMaxConcurrent: env.CHAT_MAX_CONCURRENT,
  chatRateLimit: env.CHAT_RATE_LIMIT,
  chatRateWindowMs: env.CHAT_RATE_WINDOW_MINUTES * 60 * 1000,

  allowedOrigins,
  allowedHosts,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  enforceHttps,

  globalRateLimit: env.GLOBAL_RATE_LIMIT,
  globalRateWindowMs: env.GLOBAL_RATE_WINDOW_MINUTES * 60 * 1000,
});
