import { createApp } from './app.js';
import { config, isUserAuthConfigured } from './config.js';
import { logger, serializeError } from './lib/logger.js';
import { closeStore, initStore, storeMode } from './lib/store.js';

try {
  await initStore();
} catch (error) {
  logger.error('store_init_failed', { error: serializeError(error) });
  process.exit(1);
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    environment: config.nodeEnv,
    authConfigured: isUserAuthConfigured,
    store: storeMode(),
    adminConfigured: Boolean(config.adminPasswordHash && config.sessionSecret),
    httpsEnforced: config.enforceHttps,
    allowedOrigins: config.allowedOrigins.length,
    allowedHosts: config.allowedHosts.length,
  });

  if (!isUserAuthConfigured) {
    logger.warn('user_auth_not_configured', {
      detail: 'SESSION_SECRET is not set; /api/chat will return 503 until sign-in is configured.',
    });
  }

  if (storeMode() === 'memory') {
    logger.warn('memory_store_in_use', {
      detail:
        'DATABASE_URL is not set. Encrypted user keys are kept in memory and will be lost on restart. Use Postgres in production.',
    });
  }
});

// Basic slowloris / resource-exhaustion limits.
server.headersTimeout = 20000;
server.requestTimeout = Math.max(45000, config.openrouterTimeoutMs + 15000);
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;

server.on('error', (error) => {
  logger.error('server_error', { error: serializeError(error) });
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server_shutdown', { signal });

  const forceExit = setTimeout(() => {
    logger.error('server_shutdown_timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async (error) => {
    clearTimeout(forceExit);
    await closeStore().catch((storeError) => {
      logger.error('store_close_failed', { error: serializeError(storeError) });
    });
    if (error) {
      logger.error('server_close_failed', { error: serializeError(error) });
      process.exit(1);
    }
    logger.info('server_stopped');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { error: serializeError(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error: serializeError(error) });
  shutdown('uncaughtException');
});
