/**
 * Structured logging.
 *
 * Development: human-readable via pino-pretty.
 * Production:  newline-delimited JSON for log shippers.
 *
 * A redaction list guarantees that credentials, tokens and cookies never reach
 * the log stream even if an object containing them is passed by mistake.
 */
import pino from 'pino';
import { config } from '../config/env';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'token_hash',
  '*.password',
  '*.passwordHash',
  '*.token',
];

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'civic-api', env: config.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
        },
      }),
});

export type Logger = typeof logger;
