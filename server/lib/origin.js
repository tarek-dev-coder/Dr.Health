import { config } from '../config.js';
import { forbidden } from './errors.js';

/**
 * An Origin is allowed when it matches an explicitly configured origin or
 * the host this request was sent to (same-origin).
 */
export function isAllowedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return parsed.host === req.get('host');
  } catch {
    return false;
  }
}

/**
 * Reject browser requests whose Origin is not same-origin or allow-listed.
 * CORS headers alone do not stop the request from being processed.
 */
export function enforceAllowedOrigin(req, res, next) {
  if (isAllowedOrigin(req)) return next();
  return next(forbidden('This origin is not allowed to access the API.', 'ORIGIN_NOT_ALLOWED'));
}
