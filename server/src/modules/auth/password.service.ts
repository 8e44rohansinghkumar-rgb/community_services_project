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
 * factor, so we require 10+ characters and block the most common passwords
 * rather than demanding unmemorable symbol soup.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'letmein123', 'welcome123', 'admin123', 'iloveyou',
  'password!', 'passw0rd', 'p@ssw0rd', 'changeme', 'civic1234', 'abcd1234',
]);

export function passwordPolicyIssues(password: string, email?: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('Password must be at least 10 characters long');
  if (password.length > 128) issues.push('Password must be at most 128 characters long');
  if (!/[a-zA-Z]/.test(password)) issues.push('Password must contain at least one letter');
  if (!/[0-9]/.test(password)) issues.push('Password must contain at least one number');
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
