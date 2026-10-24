import { Router } from 'express';
import { config, isUserAuthConfigured } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger, serializeError } from '../lib/logger.js';
import { encryptSecret, hashSecret } from '../lib/keyVault.js';
import { createOAuthState, verifyOAuthState } from '../lib/oauthState.js';
import { createUser, deleteUser } from '../lib/store.js';
import { createUserSessionToken } from '../lib/userSession.js';
import { requireSameOrigin } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimits.js';
import {
  clearUserCookie,
  resolveUser,
  setUserCookie,
} from '../middleware/userAuth.js';

const OAUTH_COOKIE_PATH = '/auth';
const OAUTH_EXCHANGE_TIMEOUT_MS = 15000;

const oauthCookieOptions = Object.freeze({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: OAUTH_COOKIE_PATH,
});

function setOAuthCookie(res, value) {
  res.cookie(config.oauthCookieName, value, {
    ...oauthCookieOptions,
    maxAge: config.oauthStateTtlSeconds * 1000,
  });
}

function clearOAuthCookie(res) {
  res.clearCookie(config.oauthCookieName, oauthCookieOptions);
}

function redirectAuthError(res) {
  return res.redirect(302, '/?auth_error=1');
}

function validAuthorizationCode(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 2048 &&
    /^[\x21-\x7E]+$/.test(value)
  );
}

function validApiKey(value) {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 512 &&
    /^[\x21-\x7E]+$/.test(value)
  );
}

async function exchangeCodeForKey(code, verifier) {
  const response = await fetch(`${config.openrouterApiBase}/auth/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: 'S256',
    }),
    signal: AbortSignal.timeout(OAUTH_EXCHANGE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AppError(502, 'AUTH_EXCHANGE_FAILED', 'Sign-in could not be completed.', {
      expose: false,
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError(502, 'AUTH_EXCHANGE_FAILED', 'Sign-in could not be completed.', {
      expose: false,
    });
  }

  if (!validApiKey(data?.key)) {
    throw new AppError(502, 'AUTH_EXCHANGE_FAILED', 'Sign-in could not be completed.', {
      expose: false,
    });
  }

  return data.key;
}

export const authRouter = Router();

authRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

authRouter.get('/openrouter', authLimiter, (req, res, next) => {
  try {
    if (!isUserAuthConfigured) {
      throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Sign-in is not configured on this server.');
    }

    const { state, challenge, cookieValue } = createOAuthState();
    setOAuthCookie(res, cookieValue);

    const authUrl = new URL(config.openrouterAuthUrl);
    authUrl.searchParams.set('callback_url', config.openrouterCallbackUrl);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('key_label', config.openrouterKeyLabel);

    logger.info('openrouter_auth_started', { requestId: req.id });
    return res.redirect(302, authUrl.toString());
  } catch (error) {
    return next(error);
  }
});

authRouter.get('/callback', authLimiter, async (req, res) => {
  const cookieValue = req.cookies?.[config.oauthCookieName];
  clearOAuthCookie(res);

  if (!isUserAuthConfigured) {
    return redirectAuthError(res);
  }

  const queryError = req.query?.error;
  const code = req.query?.code;
  const state = req.query?.state;

  if (queryError || !validAuthorizationCode(code)) {
    logger.warn('openrouter_auth_cancelled', { requestId: req.id });
    return redirectAuthError(res);
  }

  const verifiedState = verifyOAuthState(cookieValue, state);
  if (!verifiedState) {
    logger.warn('openrouter_auth_state_invalid', { requestId: req.id });
    return redirectAuthError(res);
  }

  try {
    const apiKey = await exchangeCodeForKey(code, verifiedState.verifier);
    const encrypted = encryptSecret(apiKey);
    const user = await createUser({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      keyHash: hashSecret(apiKey),
    });

    const token = createUserSessionToken(user.id);
    setUserCookie(res, token);

    logger.info('openrouter_auth_succeeded', {
      requestId: req.id,
      userId: user.id,
    });
    return res.redirect(302, '/?signed_in=1');
  } catch (error) {
    logger.warn('openrouter_auth_failed', {
      requestId: req.id,
      error: serializeError(error),
    });
    return redirectAuthError(res);
  }
});

export const accountRouter = Router();

accountRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

accountRouter.get('/session', async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      expiresAt: new Date(user.sessionExpiresAt * 1000).toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

accountRouter.post('/logout', requireSameOrigin, async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    clearUserCookie(res);

    if (user) {
      await deleteUser(user.id);
      logger.info('user_signed_out', { requestId: req.id, userId: user.id });
    }

    return res.json({ authenticated: false });
  } catch (error) {
    return next(error);
  }
});
