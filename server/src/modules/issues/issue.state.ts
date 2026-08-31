/**
 * Issue lifecycle state machine.
 *
 * This table is the SINGLE authority on status changes. Nothing else in the
 * codebase may write `issues.status` without passing through assertTransition,
 * so an arbitrary transition is impossible regardless of what a client sends.
 */
import { InvalidTransitionError, AuthorizationError, ValidationError } from '../../utils/errors';
import type { IssueStatus, UserRole } from '../../types';

export interface TransitionRule {
  /** Roles permitted to perform this transition. */
  roles: UserRole[];
  /** A free-text reason must accompany the change. */
  requiresReason?: boolean;
  /** Only the citizen who reported the issue may do this. */
  reporterOnly?: boolean;
  /** Only the currently assigned worker may do this. */
  assignedWorkerOnly?: boolean;
  /** At least one RESOLUTION image must exist before this is allowed. */
  requiresResolutionEvidence?: boolean;
}

type TransitionMap = Partial<Record<IssueStatus, Partial<Record<IssueStatus, TransitionRule>>>>;

export const TRANSITIONS: TransitionMap = {
  REPORTED: {
    UNDER_REVIEW: { roles: ['ADMIN'] },
    ASSIGNED: { roles: ['ADMIN'] },
    REJECTED: { roles: ['ADMIN'], requiresReason: true },
  },
  UNDER_REVIEW: {
    ASSIGNED: { roles: ['ADMIN'] },
    REJECTED: { roles: ['ADMIN'], requiresReason: true },
    REPORTED: { roles: ['ADMIN'] },
  },
  ASSIGNED: {
    IN_PROGRESS: { roles: ['ADMIN', 'WORKER'], assignedWorkerOnly: true },
    UNDER_REVIEW: { roles: ['ADMIN'] },
    ON_HOLD: { roles: ['ADMIN', 'WORKER'], assignedWorkerOnly: true, requiresReason: true },
  },
  IN_PROGRESS: {
    ON_HOLD: { roles: ['ADMIN', 'WORKER'], assignedWorkerOnly: true, requiresReason: true },
    RESOLVED: {
      roles: ['ADMIN', 'WORKER'],
      assignedWorkerOnly: true,
      requiresResolutionEvidence: true,
    },
    ASSIGNED: { roles: ['ADMIN'] },
  },
  ON_HOLD: {
    IN_PROGRESS: { roles: ['ADMIN', 'WORKER'], assignedWorkerOnly: true },
    ASSIGNED: { roles: ['ADMIN'] },
    REJECTED: { roles: ['ADMIN'], requiresReason: true },
  },
  RESOLVED: {
    // Citizen confirms the fix, or an admin closes it administratively.
    CLOSED: { roles: ['ADMIN', 'CITIZEN'], reporterOnly: false },
    // Citizen reports the problem is still there.
    REOPENED: { roles: ['ADMIN', 'CITIZEN'], requiresReason: true },
  },
  REOPENED: {
    ASSIGNED: { roles: ['ADMIN'] },
    UNDER_REVIEW: { roles: ['ADMIN'] },
    REJECTED: { roles: ['ADMIN'], requiresReason: true },
  },
  REJECTED: {
    UNDER_REVIEW: { roles: ['ADMIN'] },
  },
  CLOSED: {
    // Terminal. Reopening a closed issue is deliberately an admin decision.
    REOPENED: { roles: ['ADMIN'], requiresReason: true },
  },
};

/** Statuses that count as "open work" for dashboards and analytics. */
export const OPEN_STATUSES: IssueStatus[] = [
  'REPORTED',
  'UNDER_REVIEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'REOPENED',
];

export const TERMINAL_STATUSES: IssueStatus[] = ['CLOSED', 'REJECTED'];

export interface TransitionContext {
  role: UserRole;
  userId: string;
  reporterId: string;
  assignedWorkerId: string | null;
  reason?: string | null;
  resolutionImageCount: number;
}

export function allowedTransitionsFor(
  current: IssueStatus,
  context: Omit<TransitionContext, 'reason' | 'resolutionImageCount'>,
): IssueStatus[] {
  const candidates = TRANSITIONS[current] ?? {};
  return (Object.keys(candidates) as IssueStatus[]).filter((next) => {
    const rule = candidates[next]!;
    if (!rule.roles.includes(context.role)) return false;
    if (context.role === 'CITIZEN' && context.userId !== context.reporterId) return false;
    if (rule.assignedWorkerOnly && context.role === 'WORKER' && context.assignedWorkerId !== context.userId) {
      return false;
    }
    return true;
  });
}

/**
 * Throws unless the transition is legal for this actor and issue state.
 * Every status write in the codebase calls this first.
 */
export function assertTransition(
  from: IssueStatus,
  to: IssueStatus,
  context: TransitionContext,
): TransitionRule {
  if (from === to) {
    throw new ValidationError(`The issue is already ${to.replace('_', ' ').toLowerCase()}`);
  }

  const rule = TRANSITIONS[from]?.[to];
  if (!rule) throw new InvalidTransitionError(from, to);

  if (!rule.roles.includes(context.role)) {
    throw new AuthorizationError('Your role cannot make this status change');
  }

  // A citizen may only drive the lifecycle of their OWN issue.
  if (context.role === 'CITIZEN' && context.userId !== context.reporterId) {
    throw new AuthorizationError('Only the citizen who reported this issue can make this change');
  }

  if (rule.assignedWorkerOnly && context.role === 'WORKER' && context.assignedWorkerId !== context.userId) {
    throw new AuthorizationError('You are not the worker assigned to this issue');
  }

  if (rule.requiresReason && !context.reason?.trim()) {
    throw new ValidationError('A reason is required for this status change', [
      { field: 'reason', message: 'Please explain why this change is being made' },
    ]);
  }

  if (rule.requiresResolutionEvidence && context.resolutionImageCount < 1) {
    throw new ValidationError(
      'Upload at least one resolution photograph before marking this issue resolved',
      [{ field: 'images', message: 'Resolution evidence is required' }],
    );
  }

  return rule;
}

/** Human-readable labels shared with the API documentation. */
export const STATUS_LABELS: Record<IssueStatus, string> = {
  REPORTED: 'Reported',
  UNDER_REVIEW: 'Under review',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  RESOLVED: 'Resolved',
  REOPENED: 'Reopened',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};
