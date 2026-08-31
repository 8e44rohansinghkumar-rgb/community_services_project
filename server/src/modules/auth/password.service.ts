/**
 * Password hashing (Argon2id) and policy.
 *
 * Argon2id is the OWASP-recommended default: memory-hard, resistant to GPU and
 * side-channel attacks. Parameters follow the OWASP minimum (19 MiB, t=2, p=1),
 * which is comfortably fast on modest hardware while being expensive to attack.
 */
import argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * A pre-computed hash of a random value. Verified against when a login is
 * attempted for an unknown e-mail so that "user missing" and "wrong password"
 * take comparable time — this is what stops timing-based user enumeration.
 */
let dummyHashPromise: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash('a-fixed-string-that-is-never-a-real-password', ARGON2_OPTIONS);
  return dummyHashPromise;
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash in the database — treat as a failed login, never a 500.
    return false;
  }
}

/** Burn comparable CPU time for a non-existent account. */
export async function verifyDummyPassword(plain: string): Promise<void> {
  const hash = await getDummyHash();
  await verifyPassword(hash, plain);
}

/**
 * Password policy: reasonable, not absurd (spec §11). Length is the dominant
 * factor, so length is weighted most heavily. A small amount of character
 * variety is still required — a 12-character all-lowercase phrase turns up in
 * wordlists — but the emphasis is on length plus a common-password blocklist
 * rather than demanding unmemorable symbol soup.
 *
 * This function is the SINGLE SOURCE OF TRUTH for the policy. The Zod schema in
 * auth.validators.ts delegates to it, and client/src/utils/password.ts mirrors
 * the structural rules for instant feedback only.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/**
 * A short blocklist of passwords that pass the structural rules but are on
 * every cracking wordlist. This is not a substitute for a full breached-password
 * check (Have I Been Pwned's k-anonymity API would be the real answer, and is
 * listed as a hardening step) — it just catches the handful of patterns people
 * reach for first when told "must contain a symbol and a digit".
 *
 * Compared case-insensitively, so `Password123!` and `password123!` both match.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'password123!', 'password1234',
  'password@123', 'p@ssword123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'qwerty123!', 'letmein123', 'letmein123!',
  'welcome123', 'welcome123!', 'admin123', 'admin123!', 'administrator',
  'iloveyou', 'password!', 'passw0rd', 'passw0rd!', 'p@ssw0rd', 'p@ssw0rd!',
  'changeme', 'changeme123', 'civic1234', 'abcd1234', 'abcd1234!',
  'aaaaaaaaaaaa', 'qazwsxedc123', 'zaq12wsx!', 'trustno1!', 'monkey123!',
  'football123', 'baseball123', 'sunshine123', 'princess123', 'dragon123!',
]);

export function passwordPolicyIssues(password: string, email?: string): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }
  // Not cosmetic: Argon2id cost grows with input length, so an unbounded field
  // is a cheap denial-of-service vector.
  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters long`);
  }
  if (!/[a-z]/.test(password)) issues.push('Password must include a lower-case letter');
  if (!/[A-Z]/.test(password)) issues.push('Password must include an upper-case letter');
  if (!/[0-9]/.test(password)) issues.push('Password must include a digit');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('Password must include a symbol');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    issues.push('This password is too common — please choose something less predictable');
  }
  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
      issues.push('Password must not contain your email address');
    }
  }
  return issues;
}
