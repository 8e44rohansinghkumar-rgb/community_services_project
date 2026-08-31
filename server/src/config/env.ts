/**
 * Environment configuration.
 *
 * Every value the application depends on is validated here at startup with Zod.
 * A misconfigured server fails loudly and immediately rather than throwing a
 * confusing runtime error on the first request. Secrets live only in env vars.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env') });

/** Reject the placeholder secrets shipped in .env.example when running for real. */
const INSECURE_PLACEHOLDERS = new Set([
  'change-me',
  'changeme',
  'secret',
  'replace-me-with-a-long-random-string',
]);

const csvToArray = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.string().url().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform(csvToArray)
      .refine((origins) => origins.length > 0, 'CORS_ORIGIN must list at least one origin'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    UPLOAD_DIR: z.string().default('./var/uploads'),
    MAX_FILE_SIZE: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
    MAX_FILES_PER_ISSUE: z.coerce.number().int().min(1).max(20).default(5),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    // Duplicate detection tuning (rule-based, no external service required).
    DUPLICATE_RADIUS_METERS: z.coerce.number().int().min(10).max(5000).default(150),
    DUPLICATE_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),

    // Optional e-mail transport. Absent in development: the console notifier is used.
    EMAIL_HOST: z.string().optional(),
    EMAIL_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    EMAIL_USER: z.string().optional(),
    EMAIL_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    // Optional AI classifier endpoint. Absent => NullClassifier, app works fully.
    AI_CLASSIFIER_URL: z.string().url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    for (const key of ['JWT_SECRET', 'COOKIE_SECRET'] as const) {
      if (INSECURE_PLACEHOLDERS.has(env[key].toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still uses a placeholder value; set a real secret in production`,
        });
      }
    }

    if (env.JWT_SECRET === env.COOKIE_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECRET'],
        message: 'COOKIE_SECRET must differ from JWT_SECRET',
      });
    }

    if (env.CORS_ORIGIN.some((origin) => origin === '*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'Wildcard CORS origin is not permitted for an authenticated production API',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Deliberately console: the logger itself depends on this configuration.
  console.error(`\nInvalid environment configuration:\n${details}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  uploadDir: path.resolve(process.cwd(), raw.UPLOAD_DIR),
  emailConfigured: Boolean(raw.EMAIL_HOST && raw.EMAIL_PORT && raw.EMAIL_FROM),
  aiConfigured: Boolean(raw.AI_CLASSIFIER_URL),
} as const;

export type AppConfig = typeof config;
