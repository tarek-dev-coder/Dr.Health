import path from 'node:path';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { config } from './config.js';
import { notFound } from './lib/errors.js';
import { enforceAllowedOrigin } from './lib/origin.js';
import {
  securityHeaders,
  permissionsPolicy,
  httpsRedirect,
  hostCheck,
} from './middleware/security.js';
import { requestContext } from './middleware/requestContext.js';
import { globalLimiter } from './middleware/rateLimits.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { chatRouter } from './routes/chat.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');
  app.set('json escape', true);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(permissionsPolicy);
  app.use(hostCheck);
  app.use(httpsRedirect);
  app.use(compression({ threshold: 1024 }));

  // --- API ---------------------------------------------------------------
  app.use('/api', enforceAllowedOrigin);
  app.use(
    '/api',
    cors({
      origin: true,
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
      optionsSuccessStatus: 204,
    }),
  );
  app.use('/api', globalLimiter);
  app.use('/api/chat', express.json({ limit: '256kb', strict: true, type: 'application/json' }));

  app.use('/api/chat', chatRouter);
  app.use('/api/health', healthRouter);

  app.use('/api', (req, res, next) => next(notFound('API endpoint not found.')));

  // --- Static frontend ---------------------------------------------------
  app.use(
    express.static(config.publicDir, {
      dotfiles: 'deny',
      etag: true,
      fallthrough: true,
      index: 'index.html',
      maxAge: 0,
      setHeaders(res, filePath) {
        const extension = path.extname(filePath).toLowerCase();
        const shouldRevalidate = ['.html', '.js', '.css'].includes(extension);
        const isImage = ['.gif', '.webp', '.jpg', '.jpeg', '.png', '.svg', '.ico'].includes(
          extension,
        );
        res.setHeader(
          'Cache-Control',
          shouldRevalidate
            ? 'no-store'
            : isImage
              ? 'public, max-age=86400'
              : 'public, max-age=3600',
        );
      },
    }),
  );

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.use(errorHandler);
  return app;
}
