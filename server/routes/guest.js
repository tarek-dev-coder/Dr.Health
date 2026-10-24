import { Router } from 'express';
import { config, isGuestConfigured } from '../config.js';
import { AppError, badRequest } from '../lib/errors.js';
import { parseHistory, parseMessage } from '../lib/chatInput.js';
import { consumeGuestQuota, getGuestQuota } from '../lib/guestQuota.js';
import {
  createGuestSessionToken,
  verifyGuestSessionToken,
} from '../lib/guestSession.js';
import { logger } from '../lib/logger.js';
import { generateGuestReply } from '../services/guest.js';
import { requireSameOrigin } from '../middleware/auth.js';
import { guestLimiter } from '../middleware/rateLimits.js';

const guestCookieOptions = Object.freeze({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/',
});

function setGuestCookie(res, token) {
  res.cookie(config.guestCookieName, token, {
    ...guestCookieOptions,
    maxAge: config.guestSessionTtlSeconds * 1000,
  });
}

function readGuest(req) {
  const token = req.cookies?.[config.guestCookieName];
  const payload = verifyGuestSessionToken(token);
  if (!payload) return null;
  return { id: payload.sub, expiresAt: payload.exp };
}

function ensureGuest(req, res, next) {
  if (!isGuestConfigured) {
    return next(
      new AppError(503, 'GUEST_DISABLED', 'Guest mode is not available on this server.'),
    );
  }

  let guest = readGuest(req);
  if (!guest) {
    const token = createGuestSessionToken();
    setGuestCookie(res, token);
    guest = readGuest({ cookies: { [config.guestCookieName]: token } });
  }

  if (!guest) {
    return next(new AppError(503, 'GUEST_UNAVAILABLE', 'Guest mode could not be started.'));
  }

  req.guest = guest;
  return next();
}

export const guestRouter = Router();

guestRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

guestRouter.get('/session', (req, res) => {
  if (!isGuestConfigured) {
    return res.json({ available: false, guest: false });
  }

  const guest = readGuest(req);
  if (!guest) {
    return res.json({
      available: true,
      guest: false,
      remaining: config.guestDailyLimit,
      limit: config.guestDailyLimit,
    });
  }

  const quota = getGuestQuota(guest.id, req.ip);
  return res.json({
    available: true,
    guest: true,
    remaining: quota.remaining,
    limit: quota.limit,
  });
});

guestRouter.post('/session', requireSameOrigin, ensureGuest, (req, res) => {
  const quota = getGuestQuota(req.guest.id, req.ip);
  return res.json({
    available: true,
    guest: true,
    remaining: quota.remaining,
    limit: quota.limit,
  });
});

guestRouter.post('/chat', requireSameOrigin, guestLimiter, ensureGuest, async (req, res, next) => {
  try {
    if (req.body?.image !== undefined) {
      throw badRequest(
        'Guest mode is text-only. Sign in to ask about an image.',
        'GUEST_TEXT_ONLY',
      );
    }

    const message = parseMessage(req.body?.message, config.guestMaxMessageChars);
    if (!message) {
      throw badRequest('Provide a message.', 'MESSAGE_REQUIRED');
    }

    const history = parseHistory(req.body?.history, {
      maxTurns: config.guestMaxHistoryTurns,
      maxChars: config.guestMaxHistoryChars,
      maxTurnChars: config.guestMaxMessageChars,
    });

    const quota = consumeGuestQuota(req.guest.id, req.ip);
    if (!quota.allowed) {
      throw new AppError(
        429,
        'GUEST_LIMIT_REACHED',
        'Guest limit reached. Sign in to continue.',
        { retryAfterSeconds: quota.retryAfterSeconds },
      );
    }

    const reply = await generateGuestReply({
      history,
      message,
      requestId: req.id,
    });

    logger.info('guest_chat_completed', {
      requestId: req.id,
      guestId: req.guest.id,
      remaining: quota.remaining,
    });

    return res.json({ reply, remaining: quota.remaining });
  } catch (error) {
    return next(error);
  }
});
