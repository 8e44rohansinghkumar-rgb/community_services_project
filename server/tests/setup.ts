/**
 * Global test setup.
 *
 * Runs before any test file. Forces NODE_ENV=test, which the application uses
 * to disable rate limiting (otherwise a fast test run trips the login limiter
 * and every subsequent assertion fails for the wrong reason).
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

// Fail loudly rather than leaving a hanging handle if a promise rejects
// outside a test's own try/catch.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection during tests:', reason);
});
