/**
 * Issue business logic.
 *
 * This module owns:
 *  - object-level authorization (the IDOR guard)
 *  - the status state machine's side effects
 *  - transactional composition (assignment = 5 writes, atomically)
 *  - privacy projection (who may see reporter contact details)
 */
import { withTransaction, pool, isPgError, PG_ERROR, type Executor } from '../../db/pool';
import { config } from '../../config/env';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import * as issueRepo from './issue.repository';
import * as userRepo from '../users/user.repository';
import * as notifications from '../notifications/notification.service';
import * as audit from '../audit/audit.service';
import { assertTransition, allowedTransitionsFor, OPEN_STATUSES } from './issue.state';
import { computeInitialPriority } from './priority.service';
import { processAndStore, type ProcessedImage } from '../storage/image.service';
import { storageService } from '../storage/storage.service';
import type {
  AuthUser,
  Issue,
  IssueComment,
  IssueImage,
  IssueStatus,
  ImageType,
  Paginated,
  Severity,
  StatusHistoryEntry,
} from '../../types';

/** Same reporter + same title + same category inside this window = duplicate click. */
const IDENTICAL_SUBMISSION_WINDOW_MINUTES = 10;

/* ------------------------------------------------------------------ *
 * Privacy projection
 * ------------------------------------------------------------------ */

/**
 * Strip fields the viewer must not see. Applied at the service boundary so no
 * controller can accidentally leak reporter contact details.
 */
export function projectIssue(issue: Issue, viewer: AuthUser | null): Issue {
  const isAdmin = viewer?.role === 'ADMIN';
  const isReporter = viewer?.id === issue.reporterId;

  const projected: Issue = { ...issue };

  // Only admins ever see the reporter's email address.
  if (!isAdmin) delete projected.reporterEmail;

  // Anonymous/other citizens do not see who reported an issue.
  if (!isAdmin && !isReporter && viewer?.role !== 'WORKER') {
    projected.reporterName = null;
  }

  // Spam flag is internal signalling.
  if (!isAdmin) delete projected.isSpam;

  return projected;
}

/** Public/community view: coarse location and no personal data at all. */
export function projectPublicIssue(issue: Issue): Record<string, unknown> {
  return {
    id: issue.id,
    publicId: issue.publicId,
    title: issue.title,
    description: issue.description,
    categoryId: issue.categoryId,
    categoryName: issue.categoryName,
    categorySlug: issue.categorySlug,
    officialPriority: issue.officialPriority,
    status: issue.status,
    // Rounded to ~3 decimals (~110 m): enough to map a hotspot, not enough to
    // pinpoint a private address.
    latitude: Math.round(issue.latitude * 1000) / 1000,
    longitude: Math.round(issue.longitude * 1000) / 1000,
    address: issue.address,
    landmark: issue.landmark,
    imageCount: issue.imageCount,
    duplicateCount: issue.duplicateCount,
    createdAt: issue.createdAt,
    resolvedAt: issue.resolvedAt,
  };
}

/* ------------------------------------------------------------------ *
 * Access control
 * ------------------------------------------------------------------ */

export type IssueAccess = 'OWNER' | 'ADMIN' | 'ASSIGNED_WORKER' | 'PUBLIC_VIEWER';

/**
 * Resolve whether this actor may read this specific issue.
 * Throws NotFound (not Forbidden) when there is no right to know it exists —
 * that prevents existence probing via status codes.
 */
export async function resolveAccess(
  issue: Issue,
  viewer: AuthUser | null,
  db: Executor = pool,
): Promise<IssueAccess> {
  if (viewer?.role === 'ADMIN') return 'ADMIN';
  if (viewer && issue.reporterId === viewer.id) return 'OWNER';

  if (viewer?.role === 'WORKER') {
    const ever = await issueRepo.hasWorkerEverBeenAssigned(issue.id, viewer.id, db);
    if (ever) return 'ASSIGNED_WORKER';
  }

  if (issue.isPublic && !issue.isSpam) return 'PUBLIC_VIEWER';

  throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');
}

async function loadIssueOrThrow(id: string, db: Executor = pool): Promise<Issue> {
  const issue = await issueRepo.findById(id, db);
  if (!issue) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');
  return issue;
}

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

export interface CreateIssueInput {
  title: string;
  description: string;
  categoryId: number;
  citizenSeverity: Severity;
  latitude: number;
  longitude: number;
  address?: string | null;
  landmark?: string | null;
  isPublic?: boolean;
}

export interface CreateIssueResult {
  issue: Issue;
  images: IssueImage[];
  potentialDuplicates: issueRepo.DuplicateCandidate[];
}

export async function createIssue(
  input: CreateIssueInput,
  files: { buffer: Buffer; mimetype: string; originalname: string }[],
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<CreateIssueResult> {
  const category = await issueRepo.findCategoryForIssue(input.categoryId);
  if (!category || !category.isActive) {
    throw new ValidationError('Select a valid issue category', [
      { field: 'categoryId', message: 'This category is not available' },
    ]);
  }

  // Accidental double-submit guard (a re-clicked button, a retried request).
  const identical = await issueRepo.findRecentIdenticalSubmission({
    reporterId: actor.id,
    title: input.title,
    categoryId: input.categoryId,
    withinMinutes: IDENTICAL_SUBMISSION_WINDOW_MINUTES,
  });
  if (identical) {
    throw new ConflictError(
      `You already reported this a few minutes ago (${identical.publicId}). Check "My issues" before submitting again.`,
      'DUPLICATE_SUBMISSION',
    );
  }

  const potentialDuplicates = await issueRepo.findDuplicateCandidates({
    categoryId: input.categoryId,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: config.DUPLICATE_RADIUS_METERS,
    windowDays: config.DUPLICATE_WINDOW_DAYS,
  });

  const decision = computeInitialPriority({
    citizenSeverity: input.citizenSeverity,
    categoryDefaultSeverity: category.defaultSeverity,
    slaHours: category.slaHours,
    duplicateCount: potentialDuplicates.length,
  });

  // Images are processed BEFORE the transaction: re-encoding is CPU-bound and
  // must not hold a database connection or a row lock. If a file is rejected,
  // nothing has been written yet.
  const processedImages: (ProcessedImage & { originalName: string })[] = [];
  for (const file of files) {
    processedImages.push({
      ...(await processAndStore(file.buffer, file.mimetype)),
      originalName: file.originalname.slice(0, 200),
    });
  }

  try {
    return await withTransaction(async (client) => {
      const issue = await issueRepo.createIssue(
        {
          reporterId: actor.id,
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          citizenSeverity: input.citizenSeverity,
          officialPriority: decision.priority,
          latitude: input.latitude,
          longitude: input.longitude,
          address: input.address ?? null,
          landmark: input.landmark ?? null,
          isPublic: input.isPublic ?? true,
        },
        client,
      );

      const images: IssueImage[] = [];
      for (const processed of processedImages) {
        images.push(
          await issueRepo.addImage(
            {
              issueId: issue.id,
              uploadedBy: actor.id,
              storageKey: processed.storageKey,
              originalName: processed.originalName,
              mimeType: processed.mimeType,
              sizeBytes: processed.sizeBytes,
              width: processed.width,
              height: processed.height,
              type: 'REPORT',
            },
            client,
          ),
        );
      }

      await issueRepo.addStatusHistory(
        {
          issueId: issue.id,
          previousStatus: null,
          newStatus: 'REPORTED',
          changedBy: actor.id,
          reason: 'Issue reported by citizen',
        },
        client,
      );

      await notifications.create(
        {
          userId: actor.id,
          type: 'ISSUE_SUBMITTED',
          title: `Report received: ${issue.publicId}`,
          body: `Thank you. "${issue.title}" has been logged and will be reviewed shortly.`,
          issueId: issue.id,
        },
        client,
      );

      // Fan out to admins in one statement.
      const adminIds = await userRepo.findAdminIds(client);
      const isCritical = decision.priority === 'CRITICAL';
      await notifications.createMany(
        adminIds.map((adminId) => ({
          userId: adminId,
          type: isCritical ? ('CRITICAL_ISSUE_REPORTED' as const) : ('NEW_ISSUE_REPORTED' as const),
          title: isCritical ? `Critical issue reported: ${issue.publicId}` : `New issue: ${issue.publicId}`,
          body: `${category.name} — ${issue.title}`,
          issueId: issue.id,
        })),
        client,
      );

      await audit.record(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          action: audit.AUDIT_ACTIONS.ISSUE_CREATED,
          entityType: 'issue',
          entityId: issue.id,
          metadata: {
            publicId: issue.publicId,
            category: category.name,
            citizenSeverity: input.citizenSeverity,
            computedPriority: decision.priority,
            priorityRationale: decision.rationale,
            imageCount: images.length,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        client,
      );

      return { issue: projectIssue(issue, actor), images, potentialDuplicates };
    });
  } catch (error) {
    // The transaction rolled back, so the image rows are gone; remove the
    // orphaned bytes too rather than leaking disk.
    await Promise.allSettled(processedImages.map((img) => storageService.delete(img.storageKey)));
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listForViewer(
  filters: issueRepo.IssueFilters,
  viewer: AuthUser,
): Promise<Paginated<Issue>> {
  const scoped: issueRepo.IssueFilters = { ...filters };

  // Server-side scoping. A citizen cannot widen this by sending extra params:
  // reporterId is overwritten, not merged.
  if (viewer.role === 'CITIZEN') {
    scoped.reporterId = viewer.id;
    scoped.includeSpam = false;
  } else if (viewer.role === 'WORKER') {
    scoped.workerId = viewer.id;
    scoped.includeSpam = false;
  }

  const result = await issueRepo.listIssues(scoped);
  return { ...result, rows: result.rows.map((issue) => projectIssue(issue, viewer)) };
}

export async function listPublic(
  filters: issueRepo.IssueFilters,
): Promise<Paginated<Record<string, unknown>>> {
  const result = await issueRepo.listIssues({ ...filters, isPublic: true, includeSpam: false });
  return { ...result, rows: result.rows.map(projectPublicIssue) };
}

export interface IssueDetail {
  issue: Issue;
  images: IssueImage[];
  comments: IssueComment[];
  history: StatusHistoryEntry[];
  assignments: unknown[];
  allowedTransitions: IssueStatus[];
  access: IssueAccess;
}

export async function getDetail(id: string, viewer: AuthUser | null): Promise<IssueDetail> {
  const issue = await loadIssueOrThrow(id);
  const access = await resolveAccess(issue, viewer);

  const isStaff = access === 'ADMIN' || access === 'ASSIGNED_WORKER';
  const activeAssignment = await issueRepo.findActiveAssignment(issue.id);

  const [images, comments, history] = await Promise.all([
    issueRepo.listImages(issue.id),
    // Internal notes are visible to staff only.
    issueRepo.listComments(issue.id, isStaff),
    issueRepo.listStatusHistory(issue.id),
  ]);

  // Assignment history is administrative information; citizens see only the
  // fact that someone is assigned (via the projected issue), not the roster.
  const assignments = access === 'ADMIN' ? await issueRepo.listAssignments(issue.id) : [];

  const allowedTransitions = viewer
    ? allowedTransitionsFor(issue.status, {
        role: viewer.role,
        userId: viewer.id,
        reporterId: issue.reporterId,
        assignedWorkerId: activeAssignment?.workerId ?? null,
      })
    : [];

  return {
    issue: projectIssue(issue, viewer),
    images,
    comments,
    history,
    assignments,
    allowedTransitions,
    access,
  };
}

export async function getDuplicatesFor(input: {
  categoryId: number;
  latitude: number;
  longitude: number;
  excludeIssueId?: string;
}): Promise<issueRepo.DuplicateCandidate[]> {
  return issueRepo.findDuplicateCandidates({
    categoryId: input.categoryId,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: config.DUPLICATE_RADIUS_METERS,
    windowDays: config.DUPLICATE_WINDOW_DAYS,
    excludeIssueId: input.excludeIssueId,
  });
}

/* ------------------------------------------------------------------ *
 * Status transitions
 * ------------------------------------------------------------------ */

export async function changeStatus(
  issueId: string,
  newStatus: IssueStatus,
  reason: string | null,
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<Issue> {
  return withTransaction(async (client) => {
    // FOR UPDATE serialises concurrent transitions on the same issue.
    const locked = await issueRepo.lockIssue(issueId, client);
    if (!locked) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');

    const issue = await loadIssueOrThrow(issueId, client);
    await resolveAccess(issue, actor, client);

    const activeAssignment = await issueRepo.findActiveAssignment(issueId, client);
    const resolutionImages = await issueRepo.countImages(issueId, 'RESOLUTION', client);

    // The state machine is the sole authority — role, ownership, reason and
    // evidence requirements are all enforced here.
    assertTransition(locked.status, newStatus, {
      role: actor.role,
      userId: actor.id,
      reporterId: issue.reporterId,
      assignedWorkerId: activeAssignment?.workerId ?? null,
      reason,
      resolutionImageCount: resolutionImages,
    });

    await issueRepo.updateStatus(issueId, newStatus, client);
    await issueRepo.addStatusHistory(
      {
        issueId,
        previousStatus: locked.status,
        newStatus,
        changedBy: actor.id,
        reason,
      },
      client,
    );

    if (newStatus === 'IN_PROGRESS' && activeAssignment) {
      await issueRepo.markAssignmentAccepted(issueId, activeAssignment.workerId, client);
    }
    if (newStatus === 'RESOLVED') {
      // Stamp completion but keep the assignment active: the worker still owns
      // the issue until the citizen confirms or an admin closes it.
      await issueRepo.markAssignmentCompleted(issueId, client);
    }
    // Terminal or re-triage states release the worker. Without this a reopened
    // issue keeps its old active assignment, the partial unique index blocks a
    // fresh one, and the issue can never be re-assigned.
    if (['REOPENED', 'CLOSED', 'REJECTED'].includes(newStatus)) {
      await issueRepo.deactivateAssignments(issueId, client);
    }

    await emitStatusNotifications(
      { issue, previousStatus: locked.status, newStatus, actor, assignedWorkerId: activeAssignment?.workerId ?? null },
      client,
    );

    await audit.record(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: audit.AUDIT_ACTIONS.ISSUE_STATUS_CHANGED,
        entityType: 'issue',
        entityId: issueId,
        metadata: { from: locked.status, to: newStatus, reason: reason ?? undefined, publicId: issue.publicId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      client,
    );

    const updated = await loadIssueOrThrow(issueId, client);
    return projectIssue(updated, actor);
  });
}

async function emitStatusNotifications(
  input: {
    issue: Issue;
    previousStatus: IssueStatus;
    newStatus: IssueStatus;
    actor: AuthUser;
    assignedWorkerId: string | null;
  },
  client: Executor,
): Promise<void> {
  const { issue, newStatus, actor, assignedWorkerId } = input;
  const recipients = new Map<string, notifications.CreateNotificationInput>();

  const statusLabel = newStatus.replace(/_/g, ' ').toLowerCase();

  // The reporter always hears about their own issue (unless they made the change).
  if (issue.reporterId !== actor.id) {
    const type =
      newStatus === 'RESOLVED' ? 'ISSUE_RESOLVED'
      : newStatus === 'REOPENED' ? 'ISSUE_REOPENED'
      : newStatus === 'CLOSED' ? 'ISSUE_CLOSED'
      : 'STATUS_CHANGED';
    recipients.set(issue.reporterId, {
      userId: issue.reporterId,
      type,
      title: `${issue.publicId} is now ${statusLabel}`,
      body:
        newStatus === 'RESOLVED'
          ? `Work on "${issue.title}" is complete. Please confirm the fix or tell us it is still a problem.`
          : `"${issue.title}" has been updated to ${statusLabel}.`,
      issueId: issue.id,
    });
  }

  // The assigned worker hears about changes they did not make.
  if (assignedWorkerId && assignedWorkerId !== actor.id) {
    recipients.set(assignedWorkerId, {
      userId: assignedWorkerId,
      type: 'STATUS_CHANGED',
      title: `${issue.publicId} is now ${statusLabel}`,
      body: `"${issue.title}" has been updated.`,
      issueId: issue.id,
    });
  }

  // Admins are told when a citizen reopens an issue — it needs re-triage.
  if (newStatus === 'REOPENED') {
    const adminIds = await userRepo.findAdminIds(client);
    for (const adminId of adminIds) {
      if (adminId === actor.id || recipients.has(adminId)) continue;
      recipients.set(adminId, {
        userId: adminId,
        type: 'ISSUE_REOPENED',
        title: `Reopened: ${issue.publicId}`,
        body: `"${issue.title}" was reported as still unresolved and needs re-assignment.`,
        issueId: issue.id,
      });
    }
  }

  await notifications.createMany([...recipients.values()], client);
}

/* ------------------------------------------------------------------ *
 * Assignment
 * ------------------------------------------------------------------ */

export async function assignIssue(
  issueId: string,
  workerId: string,
  note: string | null,
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<Issue> {
  return withTransaction(async (client) => {
    const locked = await issueRepo.lockIssue(issueId, client);
    if (!locked) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');

    const worker = await userRepo.findById(workerId, client);
    if (!worker || worker.role !== 'WORKER') {
      throw new ValidationError('Select a valid worker', [
        { field: 'workerId', message: 'That user is not a worker' },
      ]);
    }
    if (!worker.isActive) {
      throw new ValidationError('That worker account is deactivated', [
        { field: 'workerId', message: 'Choose an active worker' },
      ]);
    }

    const existing = await issueRepo.findActiveAssignment(issueId, client);
    if (existing?.workerId === workerId) {
      throw new ConflictError('That worker is already assigned to this issue', 'ALREADY_ASSIGNED');
    }

    const issue = await loadIssueOrThrow(issueId, client);
    const isReassignment = Boolean(existing);

    // Reassignment closes the previous assignment first; the partial unique
    // index guarantees only one row can be active at a time.
    if (existing) await issueRepo.deactivateAssignments(issueId, client);

    let assignmentId: string;
    try {
      assignmentId = await issueRepo.createAssignment(
        { issueId, workerId, assignedBy: actor.id, note },
        client,
      );
    } catch (error) {
      // A concurrent admin won the race. Surface a clean 409 instead of a 500.
      if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError(
          'Another administrator just assigned this issue. Reload to see the current assignment.',
          'ASSIGNMENT_CONFLICT',
        );
      }
      throw error;
    }

    // Moving to ASSIGNED is itself a lifecycle transition, so it goes through
    // the same validation and history recording.
    if (locked.status !== 'ASSIGNED') {
      assertTransition(locked.status, 'ASSIGNED', {
        role: actor.role,
        userId: actor.id,
        reporterId: issue.reporterId,
        assignedWorkerId: workerId,
        reason: note,
        resolutionImageCount: 0,
      });
      await issueRepo.updateStatus(issueId, 'ASSIGNED', client);
      await issueRepo.addStatusHistory(
        {
          issueId,
          previousStatus: locked.status,
          newStatus: 'ASSIGNED',
          changedBy: actor.id,
          reason: note ?? `Assigned to ${worker.name}`,
        },
        client,
      );
    }

    const recipients: notifications.CreateNotificationInput[] = [
      {
        userId: workerId,
        type: 'ISSUE_ASSIGNED',
        title: `New assignment: ${issue.publicId}`,
        body: `${issue.categoryName ?? 'Issue'} — "${issue.title}"${note ? `\nNote: ${note}` : ''}`,
        issueId,
      },
    ];
    if (issue.reporterId !== actor.id) {
      recipients.push({
        userId: issue.reporterId,
        type: 'ISSUE_ASSIGNED',
        title: `${issue.publicId} has been assigned`,
        body: `A field worker has been assigned to "${issue.title}".`,
        issueId,
      });
    }
    if (existing && existing.workerId !== workerId) {
      recipients.push({
        userId: existing.workerId,
        type: 'ASSIGNMENT_REMOVED',
        title: `Reassigned: ${issue.publicId}`,
        body: `"${issue.title}" has been reassigned to another worker.`,
        issueId,
      });
    }
    await notifications.createMany(recipients, client);

    await audit.record(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: isReassignment ? audit.AUDIT_ACTIONS.ISSUE_REASSIGNED : audit.AUDIT_ACTIONS.ISSUE_ASSIGNED,
        entityType: 'issue',
        entityId: issueId,
        metadata: {
          assignmentId,
          workerId,
          workerName: worker.name,
          reassignment: isReassignment,
          previousWorkerId: existing?.workerId,
          publicId: issue.publicId,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      client,
    );

    const updated = await loadIssueOrThrow(issueId, client);
    return projectIssue(updated, actor);
  });
}

export async function unassignIssue(
  issueId: string,
  assignmentId: string,
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<Issue> {
  return withTransaction(async (client) => {
    const locked = await issueRepo.lockIssue(issueId, client);
    if (!locked) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');

    const existing = await issueRepo.findActiveAssignment(issueId, client);
    if (!existing || existing.id !== assignmentId) {
      throw new NotFoundError('Assignment', 'ASSIGNMENT_NOT_FOUND');
    }

    const issue = await loadIssueOrThrow(issueId, client);
    await issueRepo.deactivateAssignments(issueId, client);

    // Return the issue to the triage queue so it cannot get lost in ASSIGNED
    // with nobody working on it.
    if (['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(locked.status)) {
      await issueRepo.updateStatus(issueId, 'UNDER_REVIEW', client);
      await issueRepo.addStatusHistory(
        {
          issueId,
          previousStatus: locked.status,
          newStatus: 'UNDER_REVIEW',
          changedBy: actor.id,
          reason: 'Worker unassigned; returned for re-triage',
        },
        client,
      );
    }

    await notifications.create(
      {
        userId: existing.workerId,
        type: 'ASSIGNMENT_REMOVED',
        title: `Assignment removed: ${issue.publicId}`,
        body: `You are no longer assigned to "${issue.title}".`,
        issueId,
      },
      client,
    );

    await audit.record(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: audit.AUDIT_ACTIONS.ISSUE_UNASSIGNED,
        entityType: 'issue',
        entityId: issueId,
        metadata: { assignmentId, workerId: existing.workerId, publicId: issue.publicId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      client,
    );

    const updated = await loadIssueOrThrow(issueId, client);
    return projectIssue(updated, actor);
  });
}

/* ------------------------------------------------------------------ *
 * Priority, spam, edit, delete
 * ------------------------------------------------------------------ */

export async function changePriority(
  issueId: string,
  priority: Severity,
  reason: string | null,
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<Issue> {
  return withTransaction(async (client) => {
    const locked = await issueRepo.lockIssue(issueId, client);
    if (!locked) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');
    if (locked.officialPriority === priority) {
      throw new ValidationError(`Priority is already ${priority}`);
    }

    const issue = await loadIssueOrThrow(issueId, client);
    await issueRepo.updatePriority(issueId, priority, client);

    const activeAssignment = await issueRepo.findActiveAssignment(issueId, client);
    const recipients: notifications.CreateNotificationInput[] = [];
    if (activeAssignment) {
      recipients.push({
        userId: activeAssignment.workerId,
        type: 'PRIORITY_CHANGED',
        title: `Priority changed to ${priority}: ${issue.publicId}`,
        body: `"${issue.title}" is now ${priority} priority.`,
        issueId,
      });
    }
    if (issue.reporterId !== actor.id) {
      recipients.push({
        userId: issue.reporterId,
        type: 'PRIORITY_CHANGED',
        title: `${issue.publicId} priority updated`,
        body: `"${issue.title}" has been set to ${priority} priority.`,
        issueId,
      });
    }
    await notifications.createMany(recipients, client);

    await audit.record(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        action: audit.AUDIT_ACTIONS.ISSUE_PRIORITY_CHANGED,
        entityType: 'issue',
        entityId: issueId,
        metadata: { from: locked.officialPriority, to: priority, reason: reason ?? undefined },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      client,
    );

    const updated = await loadIssueOrThrow(issueId, client);
    return projectIssue(updated, actor);
  });
}

export async function markSpam(
  issueId: string,
  isSpam: boolean,
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<Issue> {
  const issue = await loadIssueOrThrow(issueId);
  await issueRepo.setSpam(issueId, isSpam);
  await audit.record({
    actorId: actor.id,
    actorEmail: actor.email,
    action: audit.AUDIT_ACTIONS.ISSUE_MARKED_SPAM,
    entityType: 'issue',
    entityId: issueId,
    metadata: { isSpam, publicId: issue.publicId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  const updated = await loadIssueOrThrow(issueId);
  return projectIssue(updated, actor);
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  landmark?: string | null;
  isPublic?: boolean;
}

export async function updateIssue(
  issueId: string,
  input: UpdateIssueInput,
  actor: AuthUser,
): Promise<Issue> {
  const issue = await loadIssueOrThrow(issueId);

  const isOwner = issue.reporterId === actor.id;
  const isAdmin = actor.role === 'ADMIN';
  if (!isOwner && !isAdmin) {
    throw new AuthorizationError('You can only edit issues you reported');
  }

  // A citizen may correct their report only while it is still untouched by
  // staff — afterwards the text is part of an active work record.
  if (isOwner && !isAdmin && !['REPORTED', 'UNDER_REVIEW'].includes(issue.status)) {
    throw new ConflictError(
      'This issue is already being handled and can no longer be edited. Add a comment instead.',
      'ISSUE_LOCKED_FOR_EDITS',
    );
  }

  const updated = await issueRepo.updateEditableFields(issueId, input);
  if (!updated) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');
  return projectIssue(updated, actor);
}

export async function deleteIssue(
  issueId: string,
  actor: AuthUser,
  meta: { ipAddress: string | null; userAgent: string | null },
): Promise<void> {
  const issue = await loadIssueOrThrow(issueId);
  // Soft delete only: history, audit trail and analytics must survive.
  const deleted = await issueRepo.softDelete(issueId);
  if (!deleted) throw new NotFoundError('Issue', 'ISSUE_NOT_FOUND');

  await audit.record({
    actorId: actor.id,
    actorEmail: actor.email,
    action: audit.AUDIT_ACTIONS.ISSUE_DELETED,
    entityType: 'issue',
    entityId: issueId,
    metadata: { publicId: issue.publicId, title: issue.title, softDelete: true },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/* ------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------ */

export async function addComment(
  issueId: string,
  body: string,
  isInternal: boolean,
  actor: AuthUser,
): Promise<IssueComment> {
  const issue = await loadIssueOrThrow(issueId);
  const access = await resolveAccess(issue, actor);

  // A passer-by who can merely *see* a public issue cannot comment on it.
  if (access === 'PUBLIC_VIEWER') {
    throw new AuthorizationError('Only the reporter, assigned worker or an administrator can comment here');
  }
  // Internal notes are staff-only.
  if (isInternal && actor.role === 'CITIZEN') {
    throw new AuthorizationError('Citizens cannot post internal notes');
  }

  const comment = await issueRepo.addComment({ issueId, authorId: actor.id, body, isInternal });

  // Public comments notify the other party; internal notes never reach citizens.
  if (!isInternal) {
    const activeAssignment = await issueRepo.findActiveAssignment(issueId);
    const recipients: notifications.CreateNotificationInput[] = [];
    if (issue.reporterId !== actor.id) {
      recipients.push({
        userId: issue.reporterId,
        type: 'COMMENT_ADDED',
        title: `New update on ${issue.publicId}`,
        body: body.slice(0, 200),
        issueId,
      });
    }
    if (activeAssignment && activeAssignment.workerId !== actor.id) {
      recipients.push({
        userId: activeAssignment.workerId,
        type: 'COMMENT_ADDED',
        title: `New comment on ${issue.publicId}`,
        body: body.slice(0, 200),
        issueId,
      });
    }
    await notifications.createMany(recipients);
  }

  return comment;
}

export async function listComments(issueId: string, actor: AuthUser | null): Promise<IssueComment[]> {
  const issue = await loadIssueOrThrow(issueId);
  const access = await resolveAccess(issue, actor);
  const isStaff = access === 'ADMIN' || access === 'ASSIGNED_WORKER';
  return issueRepo.listComments(issueId, isStaff);
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

export async function addImages(
  issueId: string,
  files: { buffer: Buffer; mimetype: string; originalname: string }[],
  type: ImageType,
  actor: AuthUser,
): Promise<IssueImage[]> {
  const issue = await loadIssueOrThrow(issueId);
  const access = await resolveAccess(issue, actor);

  if (access === 'PUBLIC_VIEWER') {
    throw new AuthorizationError('You cannot add photographs to this issue');
  }
  // Resolution evidence is the worker's/admin's record of the fix.
  if (type === 'RESOLUTION' && actor.role === 'CITIZEN') {
    throw new AuthorizationError('Only the assigned worker or an administrator can upload resolution evidence');
  }
  if (type === 'RESOLUTION' && actor.role === 'WORKER') {
    const assigned = await issueRepo.isWorkerAssigned(issueId, actor.id);
    if (!assigned) throw new AuthorizationError('You are not currently assigned to this issue');
  }

  const existingCount = await issueRepo.countImages(issueId);
  if (existingCount + files.length > config.MAX_FILES_PER_ISSUE * 2) {
    throw new ValidationError(
      `This issue already has the maximum number of photographs (${config.MAX_FILES_PER_ISSUE * 2})`,
    );
  }

  const stored: IssueImage[] = [];
  const keys: string[] = [];
  try {
    for (const file of files) {
      const processed = await processAndStore(file.buffer, file.mimetype);
      keys.push(processed.storageKey);
      stored.push(
        await issueRepo.addImage({
          issueId,
          uploadedBy: actor.id,
          storageKey: processed.storageKey,
          originalName: file.originalname.slice(0, 200),
          mimeType: processed.mimeType,
          sizeBytes: processed.sizeBytes,
          width: processed.width,
          height: processed.height,
          type,
        }),
      );
    }
  } catch (error) {
    await Promise.allSettled(keys.map((key) => storageService.delete(key)));
    throw error;
  }

  return stored;
}

/**
 * Authorised image retrieval. Access is re-checked against the parent issue on
 * every request — files are never served statically.
 */
export async function getImageForDownload(
  issueId: string,
  imageId: string,
  viewer: AuthUser | null,
): Promise<{ storageKey: string; mimeType: string }> {
  const issue = await loadIssueOrThrow(issueId);
  await resolveAccess(issue, viewer);
  const image = await issueRepo.findImage(imageId, issueId);
  if (!image) throw new NotFoundError('Image', 'IMAGE_NOT_FOUND');
  return { storageKey: image.storageKey, mimeType: image.mimeType };
}

export async function listImages(issueId: string, viewer: AuthUser | null): Promise<IssueImage[]> {
  const issue = await loadIssueOrThrow(issueId);
  await resolveAccess(issue, viewer);
  return issueRepo.listImages(issueId);
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

export async function getHistory(issueId: string, viewer: AuthUser | null): Promise<StatusHistoryEntry[]> {
  const issue = await loadIssueOrThrow(issueId);
  await resolveAccess(issue, viewer);
  return issueRepo.listStatusHistory(issueId);
}

export { OPEN_STATUSES };
