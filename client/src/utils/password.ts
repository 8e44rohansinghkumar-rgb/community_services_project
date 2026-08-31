/**
 * Password policy, mirrored from the server.
 *
 * The authoritative rule lives in `server/src/modules/auth/auth.validators.ts`.
 * This copy exists purely so the user gets an instant answer instead of a round
 * trip — it is a usability feature, never a security control. The server
 * re-validates every password regardless of what happened here.
 *
 * Keep the two in step: 12+ characters with a lower-case letter, an upper-case
 * letter, a digit and a symbol.
 */

export const PASSWORD_MIN_LENGTH = 12;

/** Returns a human-readable problem, or null when the password is acceptable. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (password.length > 128) {
    return 'Password must be at most 128 characters long';
  }
  if (!/[a-z]/.test(password)) return 'Password must include a lower-case letter';
  if (!/[A-Z]/.test(password)) return 'Password must include an upper-case letter';
  if (!/[0-9]/.test(password)) return 'Password must include a digit';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a symbol';
  return null;
}

export interface PasswordStrength {
  /** 0–5, for the meter width. */
  score: number;
  label: string;
  tone: string;
}

/**
 * Advisory strength meter. Deliberately more generous than the policy: it
 * rewards length above all, because a long passphrase beats a short password
 * with one of every character class.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, label: '', tone: 'var(--ink-300)' };

  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, label: 'Weak', tone: 'var(--danger-700)' };
  if (score === 3) return { score, label: 'Fair', tone: 'var(--warning-700)' };
  if (score === 4) return { score, label: 'Good', tone: 'var(--info-700)' };
  return { score, label: 'Strong', tone: 'var(--success-700)' };
}
