import { Router } from 'express';
import { z } from 'zod';
import { config, isAdminConfigured, isUserAuthConfigured } from '../config.js';
import { AppError, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { verifyPassword } from '../lib/passwords.js';
import { createSessionToken, revokeToken } from '../lib/session.js';
import { snapshotMetrics } from '../lib/metrics.js';
import {
  requireAdmin,
  requireJson,
  requireSameOrigin,
  setSessionCookie,
  clearSessionCookie,
} from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimits.js';

const loginSchema = z
  .object({
    password: z.string().min(1).max(1024),
  })
  .strict();

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

adminRouter.post('/login', requireSameOrigin, requireJson, loginLimiter, async (req, res, next) => {
  try {
    if (!isAdminConfigured) {
      throw new AppError(503, 'ADMIN_DISABLED', 'Admin access is not configured.');
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw unauthorized('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(parsed.data.password, config.adminPasswordHash);
    if (!valid) {
      logger.warn('admin_login_failed', { requestId: req.id, ip: req.ip });
      throw unauthorized('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    const token = createSessionToken();
    setSessionCookie(res, token);

    logger.info('admin_login_succeeded', { requestId: req.id, ip: req.ip });
    res.json({
      authenticated: true,
      expiresAt: new Date((Math.floor(Date.now() / 1000) + config.adminSessionTtlSeconds) * 1000).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/logout', requireSameOrigin, (req, res) => {
  const token = req.cookies?.[config.sessionCookieName];
  if (token) revokeToken(token);
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

adminRouter.get('/session', requireAdmin, (req, res) => {
  res.json({
    authenticated: true,
    expiresAt: new Date(req.admin.expiresAt * 1000).toISOString(),
  });
});

adminRouter.get('/stats', requireAdmin, (req, res) => {
  res.json({
    ...snapshotMetrics(),
    ai: {
      configured: isUserAuthConfigured,
      model: config.openrouterModel,
    },
  });
});
