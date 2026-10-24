import { config, isUserAuthConfigured } from '../config.js';
import { AppError, unauthorized } from '../lib/errors.js';
import { getUser } from '../lib/store.js';
import { verifyUserSessionToken } from '../lib/userSession.js';

const userCookieOptions = Object.freeze({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/',
});

export function setUserCookie(res, token) {
  res.cookie(config.userCookieName, token, {
    ...userCookieOptions,
    maxAge: config.userSessionTtlSeconds * 1000,
  });
}

export function clearUserCookie(res) {
  res.clearCookie(config.userCookieName, userCookieOptions);
}

/**
 * Resolve the signed-in user without throwing. Returns null for a missing,
 * expired, tampered, or revoked session.
 */
export async function resolveUser(req) {
  if (!isUserAuthConfigured) return null;

  const token = req.cookies?.[config.userCookieName];
  const payload = verifyUserSessionToken(token);
  if (!payload) return null;

  const user = await getUser(payload.sub);
  if (!user) return null;

  return { ...user, sessionExpiresAt: payload.exp };
}

export async function requireUser(req, res, next) {
  if (!isUserAuthConfigured) {
    return next(
      new AppError(503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not configured on this server.'),
    );
  }

  try {
    const user = await resolveUser(req);
    if (!user) {
      clearUserCookie(res);
      return next(unauthorized('Sign in to continue.', 'SIGN_IN_REQUIRED'));
    }
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}
