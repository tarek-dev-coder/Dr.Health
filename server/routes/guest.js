import { Router } from 'express';
import { config } from '../config.js';
import { AppError, badRequest } from '../lib/errors.js';
import { parseHistory, parseMessage } from '../lib/chatInput.js';
import { consumeGuestQuota, getGuestQuota } from '../lib/guestQuota.js';
import {
  createGuestSessionToken,
  verifyGuestSessionToken,
} from '../lib/guestSession.js';
import { logger } from '../lib/logger.js';
import { generateGuestReply } from '../services/guest.js';
import { requireSameOrigin } from '../middleware/sameOrigin.js';
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
  let guest = readGuest(req);
  if (!guest) {
    const token = createGuestSessionToken();
    setGuestCookie(res, token);
    guest = readGuest({ cookies: { [config.guestCookieName]: token } });
  }

  if (!guest) {
    return next(new AppError(503, 'GUEST_UNAVAILABLE', 'Chat is unavailable right now.'));
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
        'This assistant is text-only and cannot view images.',
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
        'Daily question limit reached. Please come back tomorrow.',
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
