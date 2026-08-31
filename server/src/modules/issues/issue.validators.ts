/**
 * Zod schemas for issue endpoints.
 *
 * Query schemas coerce strings (everything arrives as text in a query string)
 * and CLAMP pagination server-side, so a client cannot request limit=100000.
 */
import { z } from 'zod';
import { ISSUE_STATUSES, SEVERITIES, IMAGE_TYPES } from '../../types';

export const MAX_PAGE_SIZE = 100;

export const uuidParam = z.string().uuid('Invalid identifier');

export const idParamsSchema = z.object({ id: uuidParam });

export const imageParamsSchema = z.object({ id: uuidParam, imageId: uuidParam });

export const assignmentParamsSchema = z.object({ id: uuidParam, assignmentId: uuidParam });

/** Accepts "a,b,c" or repeated params, and validates each member. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      return list.map((v) => v.trim()).filter(Boolean);
    })
    .pipe(z.array(z.enum(values)).optional());

const csvIntArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const list = Array.isArray(value) ? value : value.split(',');
    return list
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
  })
  .transform((arr) => (arr && arr.length > 0 ? arr : undefined));

export const latitudeSchema = z.coerce
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

export const longitudeSchema = z.coerce
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

export const createIssueSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(5, 'Title must be at least 5 characters')
      .max(150, 'Title must be at most 150 characters'),
    description: z
      .string()
      .trim()
      .min(10, 'Please describe the issue in at least 10 characters')
      .max(5000, 'Description must be at most 5000 characters'),
    categoryId: z.coerce.number().int().positive('Select a category'),
    citizenSeverity: z.enum(SEVERITIES).default('MEDIUM'),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    address: z.string().trim().max(300).optional().nullable(),
    landmark: z.string().trim().max(150).optional().nullable(),
    // Multipart bodies deliver booleans as strings.
    isPublic: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .default(true)
      .transform((v) => (typeof v === 'boolean' ? v : v === 'true')),
  })
  .strict();

export const updateIssueSchema = z
  .object({
    title: z.string().trim().min(5).max(150).optional(),
    description: z.string().trim().min(10).max(5000).optional(),
    landmark: z.string().trim().max(150).optional().nullable(),
    isPublic: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' });

export const listIssuesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    // Hard server-side ceiling regardless of what the client asks for.
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
    status: csvEnum(ISSUE_STATUSES),
    priority: csvEnum(SEVERITIES),
    categoryId: csvIntArray,
    search: z.string().trim().min(1).max(120).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    workerId: z.string().uuid().optional(),
    reporterId: z.string().uuid().optional(),
    onlyOpen: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'status', 'title', 'resolvedAt']).default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
    minLat: latitudeSchema.optional(),
    maxLat: latitudeSchema.optional(),
    minLng: longitudeSchema.optional(),
    maxLng: longitudeSchema.optional(),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to),
    { message: 'The start date must be before the end date', path: ['from'] },
  );

export const changeStatusSchema = z
  .object({
    status: z.enum(ISSUE_STATUSES),
    reason: z.string().trim().min(1).max(1000).optional().nullable(),
  })
  .strict();

export const assignSchema = z
  .object({
    workerId: z.string().uuid('Select a worker'),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

export const changePrioritySchema = z
  .object({
    priority: z.enum(SEVERITIES),
    reason: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

export const markSpamSchema = z.object({ isSpam: z.boolean() }).strict();

export const createCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Comment cannot be empty')
      .max(2000, 'Comment must be at most 2000 characters'),
    isInternal: z.boolean().default(false),
  })
  .strict();

export const uploadImagesSchema = z
  .object({
    type: z.enum(IMAGE_TYPES).default('ADDITIONAL'),
  })
  .strict();

export const duplicateCheckSchema = z
  .object({
    categoryId: z.coerce.number().int().positive(),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    excludeIssueId: z.string().uuid().optional(),
  })
  .strict();

export const publicIssuesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
    status: csvEnum(ISSUE_STATUSES),
    categoryId: csvIntArray,
    search: z.string().trim().min(1).max(120).optional(),
    minLat: latitudeSchema.optional(),
    maxLat: latitudeSchema.optional(),
    minLng: longitudeSchema.optional(),
    maxLng: longitudeSchema.optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'status']).default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
