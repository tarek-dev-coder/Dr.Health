import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { metrics } from '../lib/metrics.js';

function rateLimitHandler(req, res) {
  metrics.rateLimited += 1;
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

export const chatLimiter = rateLimit({
  ...shared,
  windowMs: config.chatRateWindowMs,
  limit: config.chatRateLimit,
});

export const loginLimiter = rateLimit({
  ...shared,
  windowMs: config.loginRateWindowMs,
  limit: config.loginRateLimit,
  skipSuccessfulRequests: true,
});

export const authLimiter = rateLimit({
  ...shared,
  windowMs: config.authRateWindowMs,
  limit: config.authRateLimit,
});
