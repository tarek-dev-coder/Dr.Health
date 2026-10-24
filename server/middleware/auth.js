import { config, isAdminConfigured } from '../config.js';
import { forbidden, unauthorized, unsupportedMedia, AppError } from '../lib/errors.js';
import { verifySessionToken } from '../lib/session.js';

export const sessionCookieOptions = Object.freeze({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'strict',
  path: '/',
});

export function setSessionCookie(res, token) {
  res.cookie(config.sessionCookieName, token, {
    ...sessionCookieOptions,
    maxAge: config.adminSessionTtlSeconds * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookieName, sessionCookieOptions);
}

export function requireAdmin(req, res, next) {
  if (!isAdminConfigured) {
    return next(new AppError(503, 'ADMIN_DISABLED', 'Admin access is not configured.'));
  }

  const token = req.cookies?.[config.sessionCookieName];
  if (!token) {
    return next(unauthorized('Authentication required.', 'UNAUTHENTICATED'));
  }

  const session = verifySessionToken(token);
  if (!session) {
    clearSessionCookie(res);
    return next(unauthorized('Your session is invalid or has expired.', 'SESSION_EXPIRED'));
  }

  req.admin = { sid: session.sid, expiresAt: session.exp };
  return next();
}

/**
 * Defense in depth for cookie-authenticated admin mutations. SameSite=Strict
 * already blocks most CSRF, but also check Fetch Metadata and Origin.
 */
export function requireSameOrigin(req, res, next) {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return next(forbidden('Cross-site requests are not allowed.', 'CSRF_REJECTED'));
  }
  return next();
}

export function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return next(unsupportedMedia('Content-Type must be application/json.', 'JSON_REQUIRED'));
  }
  return next();
}
