import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const rawEnv = { ...process.env };

// Treat "FOO=" in .env as unset for optional secrets and overrides.
for (const key of [
  'GUEST_SESSION_SECRET',
  'GUEST_API_KEY',
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

  // Signs the HttpOnly guest cookie. There are no accounts or user sessions.
  GUEST_SESSION_SECRET: z
    .string()
    .min(32, 'GUEST_SESSION_SECRET must be at least 32 characters'),

  // The server calls one OpenAI-compatible endpoint. The default is keyless;
  // an optional server-side token can be used for providers such as LLM7.
  GUEST_API_URL: z
    .string()
    .trim()
    .url()
    .default('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions'),
  GUEST_MODEL: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._:/-]{1,120}$/, 'GUEST_MODEL contains invalid characters')
    .default('Meta-Llama-3_3-70B-Instruct'),
  GUEST_API_KEY: z.string().trim().min(1).optional(),
  GUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  GUEST_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(50).max(2000).default(500),
  GUEST_MAX_MESSAGE_CHARS: z.coerce.number().int().min(100).max(10000).default(2000),
  GUEST_MAX_HISTORY_TURNS: z.coerce.number().int().min(0).max(20).default(4),
  GUEST_MAX_HISTORY_CHARS: z.coerce.number().int().min(0).max(20000).default(4000),
  GUEST_MAX_RESPONSE_CHARS: z.coerce.number().int().min(500).max(20000).default(6000),
  GUEST_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  GUEST_IP_DAILY_LIMIT: z.coerce.number().int().min(1).max(10000).default(10),
  GUEST_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(1).max(100000).default(200),
  GUEST_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  GUEST_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  GUEST_MAX_CONCURRENT: z.coerce.number().int().min(1).max(20).default(2),
  GUEST_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(10080).default(1440),

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
  // Trusting exactly one proxy hop is the safe default when "true" is used.
  if (normalized === 'true') return 1;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value;
}

const allowedOrigins = parseList(env.ALLOWED_ORIGINS).map((origin) => {
  if (origin === '*') {
    throw new Error('ALLOWED_ORIGINS must not contain "*" when credentials are supported');
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

if (isProduction && new URL(env.GUEST_API_URL).protocol !== 'https:') {
  throw new Error('GUEST_API_URL must use HTTPS in production');
}

if (isProduction && enforceHttps && allowedHosts.length === 0) {
  throw new Error(
    'ALLOWED_HOSTS is required when ENFORCE_HTTPS is enabled in production (prevents Host-header redirect abuse)',
  );
}

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  rootDir,
  publicDir: path.join(rootDir, 'public'),

  guestSessionSecret: env.GUEST_SESSION_SECRET,
  guestApiUrl: env.GUEST_API_URL,
  guestModel: env.GUEST_MODEL,
  guestApiKey: env.GUEST_API_KEY,
  guestTimeoutMs: env.GUEST_TIMEOUT_MS,
  guestMaxOutputTokens: env.GUEST_MAX_OUTPUT_TOKENS,
  guestMaxMessageChars: env.GUEST_MAX_MESSAGE_CHARS,
  guestMaxHistoryTurns: env.GUEST_MAX_HISTORY_TURNS,
  guestMaxHistoryChars: env.GUEST_MAX_HISTORY_CHARS,
  guestMaxResponseChars: env.GUEST_MAX_RESPONSE_CHARS,
  guestDailyLimit: env.GUEST_DAILY_LIMIT,
  guestIpDailyLimit: env.GUEST_IP_DAILY_LIMIT,
  guestGlobalDailyLimit: env.GUEST_GLOBAL_DAILY_LIMIT,
  guestRateLimit: env.GUEST_RATE_LIMIT,
  guestRateWindowMs: env.GUEST_RATE_WINDOW_MINUTES * 60 * 1000,
  guestMaxConcurrent: env.GUEST_MAX_CONCURRENT,
  guestSessionTtlSeconds: env.GUEST_SESSION_TTL_MINUTES * 60,
  guestCookieName: isProduction ? '__Host-dh_guest' : 'dh_guest',

  allowedOrigins,
  allowedHosts,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  enforceHttps,

  globalRateLimit: env.GLOBAL_RATE_LIMIT,
  globalRateWindowMs: env.GLOBAL_RATE_WINDOW_MINUTES * 60 * 1000,

  logLevel: env.LOG_LEVEL,
});
