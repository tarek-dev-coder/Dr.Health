import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

function rateLimitHandler(req, res) {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a moment and try again.',
      requestId: req.id,
    },
  });
}

const shared = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler,
};

export const globalLimiter = rateLimit({
  ...shared,
  windowMs: config.globalRateWindowMs,
  limit: config.globalRateLimit,
});

export const guestLimiter = rateLimit({
  ...shared,
  windowMs: config.guestRateWindowMs,
  limit: config.guestRateLimit,
});
