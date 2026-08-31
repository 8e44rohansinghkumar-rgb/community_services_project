#!/usr/bin/env tsx
/**
 * Development seed data.
 *
 * Creates a realistic demo dataset: departments, staff, citizens, issues at
 * every lifecycle stage, comments, history and notifications.
 *
 * DEVELOPMENT ONLY — the passwords below are published in the README and must
 * never be used in a real deployment. The script refuses to run with
 * NODE_ENV=production.
 */
import { pool, withTransaction, closePool } from './pool';
import { config } from '../config/env';
import { hashPassword } from '../modules/auth/password.service';
import type { PoolClient } from 'pg';
import type { IssueStatus, Severity } from '../types';

const DEV_PASSWORD = 'CivicDemo#2026';

interface SeedUser {
  name: string;
  email: string;
  role: 'ADMIN' | 'WORKER' | 'CITIZEN';
  phone?: string;
  department?: string;
}

const USERS: SeedUser[] = [
  { name: 'Anita Sharma', email: 'admin@civicconnect.dev', role: 'ADMIN', phone: '+91 98100 11001' },
  { name: 'Rakesh Verma', email: 'supervisor@civicconnect.dev', role: 'ADMIN', phone: '+91 98100 11002' },

  { name: 'Suresh Kumar', email: 'worker.roads@civicconnect.dev', role: 'WORKER', phone: '+91 98100 22001', department: 'Roads and Transport' },
  { name: 'Meena Patel', email: 'worker.sanitation@civicconnect.dev', role: 'WORKER', phone: '+91 98100 22002', department: 'Sanitation' },
  { name: 'Imran Qureshi', email: 'worker.water@civicconnect.dev', role: 'WORKER', phone: '+91 98100 22003', department: 'Water and Drainage' },
  { name: 'Joseph Mathew', email: 'worker.electrical@civicconnect.dev', role: 'WORKER', phone: '+91 98100 22004', department: 'Street Lighting' },

  { name: 'Priya Nair', email: 'citizen@civicconnect.dev', role: 'CITIZEN', phone: '+91 98100 33001' },
  { name: 'Arjun Desai', email: 'arjun@civicconnect.dev', role: 'CITIZEN', phone: '+91 98100 33002' },
  { name: 'Fatima Sheikh', email: 'fatima@civicconnect.dev', role: 'CITIZEN' },
  { name: 'Vikram Rao', email: 'vikram@civicconnect.dev', role: 'CITIZEN' },
];

const DEPARTMENTS = [
  { name: 'Roads and Transport', description: 'Carriageways, footpaths, potholes and road furniture.' },
  { name: 'Sanitation', description: 'Waste collection, street cleaning and illegal dumping.' },
  { name: 'Water and Drainage', description: 'Water supply, leakage, drains and waterlogging.' },
  { name: 'Street Lighting', description: 'Public lighting installation and maintenance.' },
  { name: 'Public Works', description: 'Parks, benches, signage and civic infrastructure.' },
];

/** Sohna / South Haryana area coordinates — realistic for the demo. */
interface SeedIssue {
  title: string;
  description: string;
  categorySlug: string;
  citizenSeverity: Severity;
  officialPriority: Severity;
  status: IssueStatus;
  latitude: number;
  longitude: number;
  address: string;
  landmark?: string;
  reporterEmail: string;
  workerEmail?: string;
  ageDays: number;
  comments?: { authorEmail: string; body: string; isInternal: boolean }[];
}

const ISSUES: SeedIssue[] = [
  {
    title: 'Deep pothole near Sohna bus stand causing two-wheeler falls',
    description:
      'A large pothole roughly two feet wide has formed just before the bus stand entrance. Two scooter riders have already fallen this week. It fills with water and becomes invisible after rain.',
    categorySlug: 'pothole',
    citizenSeverity: 'HIGH',
    officialPriority: 'HIGH',
    status: 'IN_PROGRESS',
    latitude: 28.247_5,
    longitude: 77.065_2,
    address: 'Sohna Bus Stand Road, Sohna, Haryana',
    landmark: 'Opposite State Bank branch',
    reporterEmail: 'citizen@civicconnect.dev',
    workerEmail: 'worker.roads@civicconnect.dev',
    ageDays: 6,
    comments: [
      { authorEmail: 'citizen@civicconnect.dev', body: 'It rained last night and the hole is now completely hidden under water.', isInternal: false },
      { authorEmail: 'worker.roads@civicconnect.dev', body: 'Site inspected. Cold mix applied as a temporary measure; full patching scheduled once the tar plant delivers.', isInternal: false },
      { authorEmail: 'admin@civicconnect.dev', body: 'Materials requisition CR-4471 raised with the depot.', isInternal: true },
    ],
  },
  {
    title: 'Garbage piling up behind the vegetable market for over a week',
    description:
      'The collection vehicle has not visited the rear lane of the vegetable market for at least eight days. Waste has spread across the lane and the smell is severe. Stray dogs are scattering it further.',
    categorySlug: 'garbage',
    citizenSeverity: 'HIGH',
    officialPriority: 'HIGH',
    status: 'RESOLVED',
    latitude: 28.249_1,
    longitude: 77.068_9,
    address: 'Rear lane, Subzi Mandi, Sohna',
    landmark: 'Behind the wholesale vegetable market',
    reporterEmail: 'arjun@civicconnect.dev',
    workerEmail: 'worker.sanitation@civicconnect.dev',
    ageDays: 11,
    comments: [
      { authorEmail: 'worker.sanitation@civicconnect.dev', body: 'Lane cleared with two tractor trips. Requested the route supervisor to restore the daily pickup.', isInternal: false },
    ],
  },
  {
    title: 'Street light out on the entire stretch near the girls college',
    description:
      'All six poles between the college gate and the water tank have been dark for about two weeks. Students walking home after evening classes have raised safety concerns.',
    categorySlug: 'streetlight',
    citizenSeverity: 'HIGH',
    officialPriority: 'HIGH',
    status: 'ASSIGNED',
    latitude: 28.244_8,
    longitude: 77.062_3,
    address: 'College Road, Sohna',
    landmark: 'Government Girls College gate',
    reporterEmail: 'fatima@civicconnect.dev',
    workerEmail: 'worker.electrical@civicconnect.dev',
    ageDays: 3,
    comments: [
      { authorEmail: 'admin@civicconnect.dev', body: 'Likely a feeder fault rather than individual lamps — check the junction box first.', isInternal: true },
    ],
  },
  {
    title: 'Water main leaking continuously at Ambedkar Chowk',
    description:
      'A pipe joint has been leaking since Sunday. A steady stream runs down the road all day and the surrounding area stays wet. Significant water is being wasted.',
    categorySlug: 'water-leakage',
    citizenSeverity: 'CRITICAL',
    officialPriority: 'CRITICAL',
    status: 'UNDER_REVIEW',
    latitude: 28.251_2,
    longitude: 77.071_4,
    address: 'Ambedkar Chowk, Sohna',
    reporterEmail: 'citizen@civicconnect.dev',
    ageDays: 1,
  },
  {
    title: 'Open manhole without cover on the school approach road',
    description:
      'The manhole cover outside house number 44 is missing entirely. The opening is roughly two feet across and sits directly on the route children take to the primary school. Someone has placed a branch as a warning.',
    categorySlug: 'open-manhole',
    citizenSeverity: 'CRITICAL',
    officialPriority: 'CRITICAL',
    status: 'REPORTED',
    latitude: 28.246_2,
    longitude: 77.069_8,
    address: 'Gali No. 4, Rajiv Nagar, Sohna',
    landmark: 'Near the primary school gate',
    reporterEmail: 'vikram@civicconnect.dev',
    ageDays: 0,
  },
  {
    title: 'Drain overflowing onto the road after every rainfall',
    description:
      'The drain at the corner of the market road blocks and overflows whenever it rains. Dirty water spreads over the road and into shopfronts. It has happened three times this month.',
    categorySlug: 'drainage',
    citizenSeverity: 'HIGH',
    officialPriority: 'HIGH',
    status: 'ON_HOLD',
    latitude: 28.248_7,
    longitude: 77.066_1,
    address: 'Market Road corner, Sohna',
    reporterEmail: 'arjun@civicconnect.dev',
    workerEmail: 'worker.water@civicconnect.dev',
    ageDays: 8,
    comments: [
      { authorEmail: 'worker.water@civicconnect.dev', body: 'Desilting needs the jetting machine, which is deployed in Ward 7 until Friday.', isInternal: false },
    ],
  },
  {
    title: 'Broken footpath slabs outside the community health centre',
    description:
      'Several concrete slabs have cracked and sunk, leaving uneven gaps. Elderly visitors to the health centre are stepping onto the road to avoid them.',
    categorySlug: 'road-damage',
    citizenSeverity: 'MEDIUM',
    officialPriority: 'MEDIUM',
    status: 'CLOSED',
    latitude: 28.243_9,
    longitude: 77.064_7,
    address: 'Hospital Road, Sohna',
    landmark: 'Community Health Centre',
    reporterEmail: 'fatima@civicconnect.dev',
    workerEmail: 'worker.roads@civicconnect.dev',
    ageDays: 24,
    comments: [
      { authorEmail: 'worker.roads@civicconnect.dev', body: 'Slabs relaid and levelled. Surface checked with a spirit level.', isInternal: false },
      { authorEmail: 'fatima@civicconnect.dev', body: 'Walked past this morning — the footpath is level again. Thank you.', isInternal: false },
    ],
  },
  {
    title: 'Construction debris dumped on the vacant plot near the park',
    description:
      'A truck unloaded brick rubble and cement bags on the empty plot beside the children park two nights ago. The pile is blocking the footpath along the boundary wall.',
    categorySlug: 'illegal-dumping',
    citizenSeverity: 'MEDIUM',
    officialPriority: 'HIGH',
    status: 'REPORTED',
    latitude: 28.250_3,
    longitude: 77.063_5,
    address: 'Plot adjoining Nehru Park, Sohna',
    reporterEmail: 'vikram@civicconnect.dev',
    ageDays: 2,
  },
  {
    title: 'Park benches broken and railing bent near the walking track',
    description:
      'Three benches along the morning walking track have broken planks and the safety railing near the pond is bent outwards. Regular walkers have been avoiding that section.',
    categorySlug: 'public-infrastructure',
    citizenSeverity: 'LOW',
    officialPriority: 'LOW',
    status: 'REPORTED',
    latitude: 28.252_1,
    longitude: 77.067_2,
    address: 'Nehru Park walking track, Sohna',
    reporterEmail: 'citizen@civicconnect.dev',
    ageDays: 4,
  },
  {
    title: 'Second pothole opening beside the bus stand repair site',
    description:
      'A new pothole has started forming about twenty metres from the one already reported. Still small but widening quickly with the heavy bus traffic.',
    categorySlug: 'pothole',
    citizenSeverity: 'MEDIUM',
    officialPriority: 'MEDIUM',
    status: 'REPORTED',
    latitude: 28.247_6,
    longitude: 77.065_4,
    address: 'Sohna Bus Stand Road, Sohna',
    reporterEmail: 'arjun@civicconnect.dev',
    ageDays: 1,
  },
  {
    title: 'Streetlight flickering all night on Hospital Road',
    description:
      'The lamp outside the chemist shop flickers continuously through the night. It is distracting for drivers and likely to fail completely soon.',
    categorySlug: 'streetlight',
    citizenSeverity: 'LOW',
    officialPriority: 'LOW',
    status: 'REOPENED',
    latitude: 28.244_1,
    longitude: 77.064_9,
    address: 'Hospital Road, Sohna',
    reporterEmail: 'citizen@civicconnect.dev',
    ageDays: 15,
    comments: [
      { authorEmail: 'citizen@civicconnect.dev', body: 'It was fixed last week but started flickering again after two days.', isInternal: false },
    ],
  },
  {
    title: 'Advertising hoarding leaning dangerously over the footpath',
    description:
      'The metal frame of a large hoarding has come loose at the base and the whole structure tilts towards the footpath. It moves visibly in strong wind.',
    categorySlug: 'public-infrastructure',
    citizenSeverity: 'HIGH',
    officialPriority: 'HIGH',
    status: 'REJECTED',
    latitude: 28.249_9,
    longitude: 77.070_1,
    address: 'Main Bazaar Road, Sohna',
    reporterEmail: 'vikram@civicconnect.dev',
    ageDays: 9,
  },
];

/** Realistic lifecycle path so timelines look genuine in the demo. */
const HISTORY_PATHS: Record<IssueStatus, IssueStatus[]> = {
  REPORTED: [],
  UNDER_REVIEW: ['UNDER_REVIEW'],
  ASSIGNED: ['UNDER_REVIEW', 'ASSIGNED'],
  IN_PROGRESS: ['UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS'],
  ON_HOLD: ['UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'],
  RESOLVED: ['UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'],
  REOPENED: ['UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED'],
  CLOSED: ['UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  REJECTED: ['UNDER_REVIEW', 'REJECTED'],
};

const REASONS: Partial<Record<IssueStatus, string>> = {
  UNDER_REVIEW: 'Report verified by the civic desk',
  ASSIGNED: 'Assigned to the responsible field team',
  IN_PROGRESS: 'Field team has started work on site',
  ON_HOLD: 'Waiting for specialised equipment to become available',
  RESOLVED: 'Work completed and verified on site',
  CLOSED: 'Resolution confirmed by the citizen who reported it',
  REOPENED: 'Citizen reported that the problem has recurred',
  REJECTED: 'Structure is on private land; referred to the owner and the enforcement wing',
};

async function clearExistingData(client: PoolClient): Promise<void> {
  // Ordered DELETEs rather than TRUNCATE CASCADE: cascading from `departments`
  // would also wipe `issue_categories`, which is reference data owned by
  // migration 003, not by this seed script.
  await client.query('UPDATE issue_categories SET department_id = NULL');

  const tablesInDependencyOrder = [
    'notifications',
    'audit_logs',
    'issue_status_history',
    'issue_assignments',
    'issue_comments',
    'issue_images',
    'issues',
    'refresh_tokens',
    'password_reset_tokens',
    'email_verification_tokens',
    'login_attempts',
    'users',
    'departments',
  ];
  for (const table of tablesInDependencyOrder) {
    await client.query(`DELETE FROM ${table}`);
  }

  await client.query('ALTER SEQUENCE issue_public_id_seq RESTART WITH 1');
}

async function main(): Promise<void> {
  if (config.isProduction) {
    console.error('Refusing to seed a production database.');
    process.exit(1);
  }

  console.log('\nSeeding development data...\n');

  const passwordHash = await hashPassword(DEV_PASSWORD);

  await withTransaction(async (client) => {
    await clearExistingData(client);

    /* Departments */
    const departmentIds = new Map<string, string>();
    for (const dept of DEPARTMENTS) {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING id',
        [dept.name, dept.description],
      );
      departmentIds.set(dept.name, rows[0].id);
    }
    console.log(`  ${DEPARTMENTS.length} departments`);

    /* Link categories to departments */
    const categoryDepartments: Record<string, string> = {
      pothole: 'Roads and Transport',
      'road-damage': 'Roads and Transport',
      garbage: 'Sanitation',
      'illegal-dumping': 'Sanitation',
      'water-leakage': 'Water and Drainage',
      drainage: 'Water and Drainage',
      'open-manhole': 'Water and Drainage',
      streetlight: 'Street Lighting',
      'public-infrastructure': 'Public Works',
    };
    for (const [slug, deptName] of Object.entries(categoryDepartments)) {
      await client.query('UPDATE issue_categories SET department_id = $1 WHERE slug = $2', [
        departmentIds.get(deptName),
        slug,
      ]);
    }

    /* Users */
    const userIds = new Map<string, string>();
    for (const user of USERS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, phone, role, department_id, email_verified, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true, true)
         RETURNING id`,
        [
          user.name,
          user.email,
          passwordHash,
          user.phone ?? null,
          user.role,
          user.department ? departmentIds.get(user.department) : null,
        ],
      );
      userIds.set(user.email, rows[0].id);
    }
    console.log(`  ${USERS.length} users (2 admins, 4 workers, 4 citizens)`);

    /* Categories lookup */
    const { rows: catRows } = await client.query<{ id: number; slug: string }>(
      'SELECT id, slug FROM issue_categories',
    );
    const categoryIds = new Map(catRows.map((r) => [r.slug, r.id]));

    /* Issues with history, assignments, comments and notifications */
    let commentCount = 0;
    let historyCount = 0;
    let notificationCount = 0;

    for (const seed of ISSUES) {
      const reporterId = userIds.get(seed.reporterEmail)!;
      const categoryId = categoryIds.get(seed.categorySlug)!;
      const createdAt = new Date(Date.now() - seed.ageDays * 24 * 60 * 60 * 1000);

      const isResolved = ['RESOLVED', 'CLOSED'].includes(seed.status);
      const isClosed = seed.status === 'CLOSED';
      const resolvedAt = isResolved
        ? new Date(createdAt.getTime() + Math.max(4, seed.ageDays * 0.6) * 60 * 60 * 1000)
        : null;
      const closedAt = isClosed ? new Date(resolvedAt!.getTime() + 12 * 60 * 60 * 1000) : null;

      const { rows: issueRows } = await client.query<{ id: string; public_id: string }>(
        `INSERT INTO issues
           (reporter_id, title, description, category_id, citizen_severity, official_priority,
            status, latitude, longitude, address, landmark, is_public, created_at, updated_at,
            resolved_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$12,$13,$14)
         RETURNING id, public_id`,
        [
          reporterId,
          seed.title,
          seed.description,
          categoryId,
          seed.citizenSeverity,
          seed.officialPriority,
          seed.status,
          seed.latitude,
          seed.longitude,
          seed.address,
          seed.landmark ?? null,
          createdAt,
          resolvedAt,
          closedAt,
        ],
      );
      const issueId = issueRows[0].id;
      const publicId = issueRows[0].public_id;

      /* Status history: initial REPORTED plus the path to the current status */
      await client.query(
        `INSERT INTO issue_status_history (issue_id, previous_status, new_status, changed_by, reason, created_at)
         VALUES ($1, NULL, 'REPORTED', $2, 'Issue reported by citizen', $3)`,
        [issueId, reporterId, createdAt],
      );
      historyCount += 1;

      const path = HISTORY_PATHS[seed.status];
      let previous: IssueStatus = 'REPORTED';
      let stepTime = createdAt.getTime();
      const adminId = userIds.get('admin@civicconnect.dev')!;
      const workerId = seed.workerEmail ? userIds.get(seed.workerEmail)! : null;

      for (const step of path) {
        stepTime += Math.max(2, seed.ageDays * 0.15) * 60 * 60 * 1000;
        // Worker-driven steps are attributed to the worker, admin steps to admin,
        // citizen confirmation to the reporter — matching the real workflow.
        const actor =
          step === 'IN_PROGRESS' || step === 'ON_HOLD' || step === 'RESOLVED'
            ? (workerId ?? adminId)
            : step === 'CLOSED' || step === 'REOPENED'
              ? reporterId
              : adminId;
        await client.query(
          `INSERT INTO issue_status_history (issue_id, previous_status, new_status, changed_by, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [issueId, previous, step, actor, REASONS[step] ?? null, new Date(stepTime)],
        );
        historyCount += 1;
        previous = step;
      }

      /* Assignment */
      if (workerId) {
        const assignedAt = new Date(createdAt.getTime() + 3 * 60 * 60 * 1000);
        const stillActive = !['CLOSED', 'REJECTED'].includes(seed.status);
        await client.query(
          `INSERT INTO issue_assignments
             (issue_id, worker_id, assigned_by, note, assigned_at, accepted_at, completed_at, active, unassigned_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            issueId,
            workerId,
            adminId,
            'Please inspect and action as per the category SLA.',
            assignedAt,
            ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED'].includes(seed.status)
              ? new Date(assignedAt.getTime() + 60 * 60 * 1000)
              : null,
            resolvedAt,
            stillActive,
            stillActive ? null : (closedAt ?? new Date()),
          ],
        );
      }

      /* Comments */
      for (const [index, comment] of (seed.comments ?? []).entries()) {
        await client.query(
          `INSERT INTO issue_comments (issue_id, author_id, body, is_internal, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            issueId,
            userIds.get(comment.authorEmail)!,
            comment.body,
            comment.isInternal,
            new Date(createdAt.getTime() + (index + 1) * 5 * 60 * 60 * 1000),
          ],
        );
        commentCount += 1;
      }

      /* Notifications for the reporter */
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, issue_id, is_read, read_at, created_at)
         VALUES ($1, 'ISSUE_SUBMITTED', $2, $3, $4, true, $5, $5)`,
        [
          reporterId,
          `Report received: ${publicId}`,
          `Thank you. "${seed.title}" has been logged and will be reviewed shortly.`,
          issueId,
          createdAt,
        ],
      );
      notificationCount += 1;

      if (seed.status === 'RESOLVED') {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, issue_id, is_read, created_at)
           VALUES ($1, 'ISSUE_RESOLVED', $2, $3, $4, false, $5)`,
          [
            reporterId,
            `${publicId} has been resolved`,
            'Work is complete. Please confirm the fix or tell us it is still a problem.',
            issueId,
            resolvedAt,
          ],
        );
        notificationCount += 1;
      }

      if (workerId && !['CLOSED', 'REJECTED'].includes(seed.status)) {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, issue_id, is_read, created_at)
           VALUES ($1, 'ISSUE_ASSIGNED', $2, $3, $4, false, $5)`,
          [
            workerId,
            `New assignment: ${publicId}`,
            seed.title,
            issueId,
            new Date(createdAt.getTime() + 3 * 60 * 60 * 1000),
          ],
        );
        notificationCount += 1;
      }

      /* Admin notification for critical reports */
      if (seed.officialPriority === 'CRITICAL') {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, issue_id, is_read, created_at)
           VALUES ($1, 'CRITICAL_ISSUE_REPORTED', $2, $3, $4, false, $5)`,
          [adminId, `Critical issue reported: ${publicId}`, seed.title, issueId, createdAt],
        );
        notificationCount += 1;
      }

      /* Audit trail */
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata, created_at)
         VALUES ($1, $2, 'ISSUE_CREATED', 'issue', $3, $4::jsonb, $5)`,
        [
          reporterId,
          seed.reporterEmail,
          issueId,
          JSON.stringify({ publicId, category: seed.categorySlug, seeded: true }),
          createdAt,
        ],
      );
      if (workerId) {
        await client.query(
          `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata, created_at)
           VALUES ($1, 'admin@civicconnect.dev', 'ISSUE_ASSIGNED', 'issue', $2, $3::jsonb, $4)`,
          [
            adminId,
            issueId,
            JSON.stringify({ publicId, workerId, seeded: true }),
            new Date(createdAt.getTime() + 3 * 60 * 60 * 1000),
          ],
        );
      }
    }

    /* Duplicate linkage: the second bus-stand pothole references the first */
    await client.query(
      `UPDATE issues SET duplicate_count = 1
        WHERE title LIKE 'Deep pothole near Sohna bus stand%'`,
    );

    console.log(`  ${ISSUES.length} issues across every lifecycle state`);
    console.log(`  ${historyCount} status history entries`);
    console.log(`  ${commentCount} comments`);
    console.log(`  ${notificationCount} notifications`);
  });

  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM issues');
  console.log(`\nSeed complete. ${rows[0].count} issues in the database.\n`);
  console.log('  DEVELOPMENT credentials (all accounts share one password):');
  console.log(`    Password: ${DEV_PASSWORD}\n`);
  console.log('    Admin    admin@civicconnect.dev');
  console.log('    Admin    supervisor@civicconnect.dev');
  console.log('    Worker   worker.roads@civicconnect.dev');
  console.log('    Worker   worker.sanitation@civicconnect.dev');
  console.log('    Worker   worker.water@civicconnect.dev');
  console.log('    Worker   worker.electrical@civicconnect.dev');
  console.log('    Citizen  citizen@civicconnect.dev');
  console.log('    Citizen  arjun@civicconnect.dev');
  console.log('    Citizen  fatima@civicconnect.dev');
  console.log('    Citizen  vikram@civicconnect.dev\n');
  console.log('  These are DEVELOPMENT ONLY. Never deploy them.\n');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
