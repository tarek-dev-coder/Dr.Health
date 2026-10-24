import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const rawEnv = { ...process.env };

// Treat "FOO=" in .env as unset for optional secrets and overrides.
for (const key of [
  'APP_ORIGIN',
  'OPENROUTER_CALLBACK_URL',
  'DATABASE_URL',
  'KEY_ENCRYPTION_SECRET',
  'GUEST_API_KEY',
  'ADMIN_PASSWORD_HASH',
  'SESSION_SECRET',
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

  // Public origin of this app. Used for the OAuth callback and OpenRouter
  // attribution headers. Production must be HTTPS.
  APP_ORIGIN: z.string().trim().url().optional(),
  OPENROUTER_CALLBACK_URL: z.string().trim().url().optional(),
  OPENROUTER_AUTH_URL: z.string().trim().url().default('https://openrouter.ai/auth'),
  OPENROUTER_API_BASE: z.string().trim().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._:/-]{1,120}$/, 'OPENROUTER_MODEL contains invalid characters')
    .default('google/gemma-4-31b-it:free'),
  OPENROUTER_FALLBACK_MODELS: z
    .string()
    .default('google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3.5-super-vl:free'),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  OPENROUTER_KEY_LABEL: z.string().trim().min(1).max(64).default('Dr.Health'),

  // Guest mode is text-only and uses a separate server-side provider. The
  // default OVHcloud endpoint is keyless; LLM7 can be used instead by setting
  // GUEST_API_URL, GUEST_MODEL, and GUEST_API_KEY.
  GUEST_MODE_ENABLED: z.enum(['true', 'false']).default('true'),
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

  // Postgres is required in production so encrypted user keys survive restarts.
  DATABASE_URL: z.string().trim().min(1).optional(),
  DATABASE_SSL: z.enum(['auto', 'true', 'false']).default('auto'),
  DATABASE_POOL_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(process.env.VERCEL ? 1 : 5),

  ADMIN_PASSWORD_HASH: z.string().trim().optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters').optional(),
  KEY_ENCRYPTION_SECRET: z
    .string()
    .min(32, 'KEY_ENCRYPTION_SECRET must be at least 32 characters')
    .optional(),
  ADMIN_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  USER_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(43200).default(10080),

  ALLOWED_ORIGINS: z.string().default(''),
  ALLOWED_HOSTS: z.string().default(''),
  TRUST_PROXY: z.string().default('0'),
  ENFORCE_HTTPS: z.enum(['true', 'false']).optional(),

  MAX_UPLOAD_MB: z.coerce.number().min(0.1).max(20).default(5),
  MAX_MESSAGE_CHARS: z.coerce.number().int().min(100).max(20000).default(4000),
  MAX_HISTORY_TURNS: z.coerce.number().int().min(0).max(100).default(20),
  MAX_HISTORY_CHARS: z.coerce.number().int().min(0).max(200000).default(20000),

  GLOBAL_RATE_LIMIT: z.coerce.number().int().min(1).max(100000).default(300),
  GLOBAL_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  CHAT_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(20),
  CHAT_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  LOGIN_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  AUTH_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

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

const fallbackModels = parseList(env.OPENROUTER_FALLBACK_MODELS)
  .filter((model) => model !== env.OPENROUTER_MODEL)
  .filter((model, index, list) => list.indexOf(model) === index);

for (const model of fallbackModels) {
  if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(model)) {
    throw new Error(`OPENROUTER_FALLBACK_MODELS contains an invalid model name: ${model}`);
  }
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

const appOrigin = (env.APP_ORIGIN || `http://localhost:${env.PORT}`).replace(/\/$/, '');
let parsedAppOrigin;
try {
  parsedAppOrigin = new URL(appOrigin);
} catch {
  throw new Error(`APP_ORIGIN is not a valid URL: ${appOrigin}`);
}
if (parsedAppOrigin.origin !== appOrigin) {
  throw new Error('APP_ORIGIN must be a bare origin (for example https://drhealth.example.com)');
}
if (isProduction && parsedAppOrigin.protocol !== 'https:') {
  throw new Error('APP_ORIGIN must use HTTPS in production');
}

const openrouterCallbackUrl = (
  env.OPENROUTER_CALLBACK_URL || new URL('/auth/callback', appOrigin).toString()
).replace(/\/$/, '');
let parsedCallbackUrl;
try {
  parsedCallbackUrl = new URL(openrouterCallbackUrl);
} catch {
  throw new Error(`OPENROUTER_CALLBACK_URL is not a valid URL: ${openrouterCallbackUrl}`);
}
if (isProduction && parsedCallbackUrl.protocol !== 'https:') {
  throw new Error('OPENROUTER_CALLBACK_URL must use HTTPS in production');
}
if (parsedCallbackUrl.origin !== appOrigin) {
  throw new Error('OPENROUTER_CALLBACK_URL must use the same origin as APP_ORIGIN');
}
if (isProduction && new URL(env.OPENROUTER_AUTH_URL).protocol !== 'https:') {
  throw new Error('OPENROUTER_AUTH_URL must use HTTPS in production');
}
if (isProduction && new URL(env.OPENROUTER_API_BASE).protocol !== 'https:') {
  throw new Error('OPENROUTER_API_BASE must use HTTPS in production');
}
if (
  isProduction &&
  env.GUEST_MODE_ENABLED === 'true' &&
  new URL(env.GUEST_API_URL).protocol !== 'https:'
) {
  throw new Error('GUEST_API_URL must use HTTPS in production');
}

const databaseSsl =
  env.DATABASE_SSL === 'true'
    ? true
    : env.DATABASE_SSL === 'false'
      ? false
      : isProduction;

if (env.ADMIN_PASSWORD_HASH) {
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(env.ADMIN_PASSWORD_HASH)) {
    throw new Error('ADMIN_PASSWORD_HASH is malformed. Generate it with: npm run hash-password');
  }
  if (!env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required when ADMIN_PASSWORD_HASH is set');
  }
}

if (isProduction && !env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required when NODE_ENV=production');
}

if (isProduction && !env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required when NODE_ENV=production so encrypted per-user keys survive restarts',
  );
}

if (isProduction && !env.APP_ORIGIN) {
  throw new Error('APP_ORIGIN is required when NODE_ENV=production');
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

  appOrigin,
  openrouterAuthUrl: env.OPENROUTER_AUTH_URL,
  openrouterApiBase: env.OPENROUTER_API_BASE.replace(/\/$/, ''),
  openrouterCallbackUrl,
  openrouterModel: env.OPENROUTER_MODEL,
  openrouterFallbackModels: Object.freeze(fallbackModels),
  openrouterTimeoutMs: env.OPENROUTER_TIMEOUT_MS,
  openrouterKeyLabel: env.OPENROUTER_KEY_LABEL,

  guestModeEnabled: env.GUEST_MODE_ENABLED === 'true',
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

  databaseUrl: env.DATABASE_URL,
  databaseSsl,
  databasePoolMax: env.DATABASE_POOL_MAX,

  adminPasswordHash: env.ADMIN_PASSWORD_HASH,
  sessionSecret: env.SESSION_SECRET,
  keyEncryptionSecret: env.KEY_ENCRYPTION_SECRET || env.SESSION_SECRET,
  adminSessionTtlSeconds: env.ADMIN_SESSION_TTL_MINUTES * 60,
  userSessionTtlSeconds: env.USER_SESSION_TTL_MINUTES * 60,
  sessionCookieName: isProduction ? '__Host-dh_admin' : 'dh_admin',
  userCookieName: isProduction ? '__Host-dh_user' : 'dh_user',
  oauthCookieName: 'dh_oauth',
  oauthStateTtlSeconds: 600,

  allowedOrigins,
  allowedHosts,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  enforceHttps,

  maxUploadBytes: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
  maxMessageChars: env.MAX_MESSAGE_CHARS,
  maxHistoryTurns: env.MAX_HISTORY_TURNS,
  maxHistoryChars: env.MAX_HISTORY_CHARS,

  globalRateLimit: env.GLOBAL_RATE_LIMIT,
  globalRateWindowMs: env.GLOBAL_RATE_WINDOW_MINUTES * 60 * 1000,
  chatRateLimit: env.CHAT_RATE_LIMIT,
  chatRateWindowMs: env.CHAT_RATE_WINDOW_MINUTES * 60 * 1000,
  loginRateLimit: env.LOGIN_RATE_LIMIT,
  loginRateWindowMs: env.LOGIN_RATE_WINDOW_MINUTES * 60 * 1000,
  authRateLimit: env.AUTH_RATE_LIMIT,
  authRateWindowMs: env.AUTH_RATE_WINDOW_MINUTES * 60 * 1000,

  logLevel: env.LOG_LEVEL,
});

export const isAdminConfigured = Boolean(config.adminPasswordHash && config.sessionSecret);
export const isUserAuthConfigured = Boolean(
  config.sessionSecret && config.keyEncryptionSecret && config.openrouterCallbackUrl,
);
export const isGuestConfigured = Boolean(
  config.guestModeEnabled && config.guestApiUrl && config.guestModel && config.sessionSecret,
);
