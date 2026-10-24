const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pass',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'setcookie',
  'secret',
  'apikey',
  'key',
  'image',
  'imagedata',
  'data',
  'message',
  'messages',
  'history',
  'prompt',
  'reply',
  'text',
  'content',
  'body',
  'email',
  'phone',
  'address',
  'patient',
]);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_-]/g, '');
}

export function redact(value, depth = 0) {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.has(normalizeKey(key)) ? '[redacted]' : redact(item, depth + 1);
    }
    return output;
  }
  return '[unserializable]';
}

export function serializeError(error) {
  if (!(error instanceof Error)) {
    return { detail: String(error) };
  }
  const serialized = {
    name: error.name,
    detail: error.message,
  };
  if (error.code) serialized.code = String(error.code);
  if (error.status) serialized.status = error.status;
  if (process.env.NODE_ENV !== 'production' && error.stack) {
    serialized.stack = error.stack;
  }
  return serialized;
}

function write(level, message, meta) {
  const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const threshold = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;
  if (LEVEL_ORDER[level] > threshold) return;

  const payload = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(meta ? { meta: redact(meta) } : {}),
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};
