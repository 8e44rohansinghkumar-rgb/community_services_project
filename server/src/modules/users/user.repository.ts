/**
 * User data access. Every query is parameterised; no user input is ever
 * concatenated into SQL. `password_hash` is selected only where it is genuinely
 * needed (login / password change) and never leaves the service layer.
 */
import { pool, type Executor } from '../../db/pool';
import type { Paginated, User, UserRole } from '../../types';

/** Column list for public-facing user reads — deliberately excludes password_hash. */
const USER_COLUMNS = `
  u.id, u.name, u.email, u.phone, u.role, u.department_id, u.is_active,
  u.email_verified, u.last_login_at, u.created_at, u.updated_at
`;

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  department_id: string | null;
  department_name?: string | null;
  is_active: boolean;
  email_verified: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    isActive: row.is_active,
    emailVerified: row.email_verified,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UserWithSecret extends User {
  passwordHash: string;
  tokenVersion: number;
}

export async function findByEmailWithSecret(
  email: string,
  db: Executor = pool,
): Promise<UserWithSecret | null> {
  const { rows } = await db.query<UserRow & { password_hash: string; token_version: number }>(
    `SELECT ${USER_COLUMNS}, u.password_hash, u.token_version
       FROM users u
      WHERE u.email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version };
}

export async function findByIdWithSecret(
  id: string,
  db: Executor = pool,
): Promise<UserWithSecret | null> {
  const { rows } = await db.query<UserRow & { password_hash: string; token_version: number }>(
    `SELECT ${USER_COLUMNS}, u.password_hash, u.token_version
       FROM users u
      WHERE u.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version };
}

export async function findById(id: string, db: Executor = pool): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS}, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function emailExists(email: string, db: Executor = pool): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  return rows.length > 0;
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  phone?: string | null;
  role?: UserRole;
  departmentId?: string | null;
  emailVerified?: boolean;
}

export async function createUser(input: CreateUserInput, db: Executor = pool): Promise<User> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (name, email, password_hash, phone, role, department_id, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, email, phone, role, department_id, is_active,
               email_verified, last_login_at, created_at, updated_at`,
    [
      input.name,
      input.email,
      input.passwordHash,
      input.phone ?? null,
      input.role ?? 'CITIZEN',
      input.departmentId ?? null,
      input.emailVerified ?? false,
    ],
  );
  return mapUser(rows[0]!);
}

export async function touchLastLogin(id: string, db: Executor = pool): Promise<void> {
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}

export async function updateProfile(
  id: string,
  input: { name?: string; phone?: string | null },
  db: Executor = pool,
): Promise<User | null> {
  // COALESCE keeps this a single statement while leaving omitted fields untouched.
  // `phone` uses a separate boolean flag so an explicit null can clear it.
  const { rows } = await db.query<UserRow>(
    `UPDATE users
        SET name  = COALESCE($2, name),
            phone = CASE WHEN $3::boolean THEN $4 ELSE phone END
      WHERE id = $1
      RETURNING id, name, email, phone, role, department_id, is_active,
                email_verified, last_login_at, created_at, updated_at`,
    [id, input.name ?? null, input.phone !== undefined, input.phone ?? null],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updatePasswordHash(
  id: string,
  passwordHash: string,
  db: Executor = pool,
): Promise<void> {
  // Bumping token_version invalidates every outstanding access token.
  await db.query(
    'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1',
    [id, passwordHash],
  );
}

export async function setActive(id: string, isActive: boolean, db: Executor = pool): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users
        SET is_active = $2,
            token_version = CASE WHEN $2 THEN token_version ELSE token_version + 1 END
      WHERE id = $1
      RETURNING id, name, email, phone, role, department_id, is_active,
                email_verified, last_login_at, created_at, updated_at`,
    [id, isActive],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function setRole(
  id: string,
  role: UserRole,
  departmentId: string | null | undefined,
  db: Executor = pool,
): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users
        SET role = $2,
            department_id = CASE
              WHEN $2 IN ('WORKER', 'ADMIN') THEN COALESCE($3, department_id)
              ELSE NULL
            END,
            token_version = token_version + 1
      WHERE id = $1
      RETURNING id, name, email, phone, role, department_id, is_active,
                email_verified, last_login_at, created_at, updated_at`,
    [id, role, departmentId ?? null],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function bumpTokenVersion(id: string, db: Executor = pool): Promise<void> {
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
}

export interface ListUsersFilters {
  role?: UserRole;
  isActive?: boolean;
  search?: string;
  page: number;
  limit: number;
}

export async function listUsers(filters: ListUsersFilters, db: Executor = pool): Promise<Paginated<User>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.role) {
    params.push(filters.role);
    conditions.push(`u.role = $${params.length}`);
  }
  if (filters.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`u.is_active = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    // ILIKE against name/email only; both are short columns and admin-only.
    conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (filters.page - 1) * filters.limit;

  const { rows } = await db.query<UserRow & { total: string }>(
    `SELECT ${USER_COLUMNS}, d.name AS department_name, COUNT(*) OVER() AS total
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ${where}
      ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset],
  );

  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    rows: rows.map(mapUser),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    },
  };
}

/** Workers with their current open workload — powers assignment pickers. */
export interface WorkerSummary extends User {
  activeAssignments: number;
  completedAssignments: number;
}

export async function listWorkers(
  options: { onlyActive?: boolean } = {},
  db: Executor = pool,
): Promise<WorkerSummary[]> {
  const { rows } = await db.query<UserRow & { active_assignments: string; completed_assignments: string }>(
    `SELECT ${USER_COLUMNS}, d.name AS department_name,
            COUNT(*) FILTER (WHERE a.active) AS active_assignments,
            COUNT(*) FILTER (WHERE a.completed_at IS NOT NULL) AS completed_assignments
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN issue_assignments a ON a.worker_id = u.id
      WHERE u.role = 'WORKER'
        AND ($1::boolean IS FALSE OR u.is_active)
      GROUP BY u.id, d.name
      ORDER BY COUNT(*) FILTER (WHERE a.active) ASC, u.name ASC`,
    [options.onlyActive ?? false],
  );

  return rows.map((row) => ({
    ...mapUser(row),
    activeAssignments: Number(row.active_assignments),
    completedAssignments: Number(row.completed_assignments),
  }));
}

export async function findAdminIds(db: Executor = pool): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'ADMIN' AND is_active`,
  );
  return rows.map((r) => r.id);
}
