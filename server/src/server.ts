/**
 * Process entry point: verify dependencies, start listening, shut down cleanly.
 */
import { createApp } from './app';
import { config } from './config/env';
import { logger } from './utils/logger';
import { checkDatabaseConnection, closePool } from './db/pool';
import { initStorage } from './modules/storage/storage.service';
import { deleteExpiredTokens } from './modules/auth/auth.repository';

const TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function bootstrap(): Promise<void> {
  // Fail fast if the database is unreachable: a server that accepts traffic it
  // cannot serve is worse than one that refuses to start.
  const dbUp = await checkDatabaseConnection();
  if (!dbUp) {
    logger.fatal('Cannot reach PostgreSQL. Check DATABASE_URL and that the server is running.');
    process.exit(1);
  }

  await initStorage();

  const app = createApp();
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV, corsOrigins: config.CORS_ORIGIN },
      `Civic API listening on port ${config.PORT}`,
    );
  });

  // Housekeeping: purge long-expired refresh tokens.
  const cleanupTimer = setInterval(() => {
    deleteExpiredTokens()
      .then((count) => {
        if (count > 0) logger.info({ count }, 'Purged expired refresh tokens');
      })
      .catch((err) => logger.error({ err }, 'Refresh token cleanup failed'));
  }, TOKEN_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    clearInterval(cleanupTimer);
    server.close(() => {
      void closePool().then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      });
    });
    // Do not hang forever on lingering connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

void bootstrap();
