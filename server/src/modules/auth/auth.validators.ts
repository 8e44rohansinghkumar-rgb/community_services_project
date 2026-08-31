/**
 * Zod schemas for authentication endpoints.
 * `.strict()` rejects unknown keys, which blocks mass-assignment attempts such
 * as posting `role: "ADMIN"` to the registration endpoint.
 */
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, passwordPolicyIssues } from './password.service';

export const emailSchema = z
  .string()
  .trim()
  .min(5, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

/**
 * Password policy.
 *
 * Delegates to `passwordPolicyIssues` in password.service.ts so there is one
 * definition rather than two that can drift. That function additionally blocks
 * common passwords; the email-similarity check needs the email and so runs in
 * the service layer where both fields are available.
 */
export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`)
  .superRefine((value, ctx) => {
    for (const issue of passwordPolicyIssues(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }
  });

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters long')
  .max(100, 'Name must be at most 100 characters long')
  // Letters, spaces, apostrophes, hyphens and dots — covers real-world names
  // without allowing markup or control characters.
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u, 'Name contains invalid characters');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+][0-9 ()-]{6,19}$/, 'Enter a valid phone number')
  .optional()
  .nullable();

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    phone: phoneSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'Invalid reset token').max(200),
    newPassword: passwordSchema,
  })
  .strict();

export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema,
  })
  .strict()
  .refine((data) => data.name !== undefined || data.phone !== undefined, {
    message: 'Provide at least one field to update',
  });
