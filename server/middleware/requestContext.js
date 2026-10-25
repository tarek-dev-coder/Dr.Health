import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function requestContext(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('http_request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: req.ip,
    });
  });

  next();
}
