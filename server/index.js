import { createApp } from './app.js';
import { config } from './config.js';
import { logger, serializeError } from './lib/logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    environment: config.nodeEnv,
    httpsEnforced: config.enforceHttps,
    allowedOrigins: config.allowedOrigins.length,
    allowedHosts: config.allowedHosts.length,
    providers: 2,
    chatTimeoutMs: config.chatTimeoutMs,
  });
});

// Basic slowloris / resource-exhaustion limits.
server.headersTimeout = 20000;
server.requestTimeout = Math.max(60000, config.chatTimeoutMs + 15000);
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

  server.close((error) => {
    clearTimeout(forceExit);
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
