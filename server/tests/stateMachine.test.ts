/**
 * Pure unit tests for the transition table and the priority engine.
 *
 * No database and no HTTP: these assert the rules themselves, so a regression
 * in the table is caught even if no integration test happens to exercise that
 * particular edge.
 */
import { describe, expect, it } from 'vitest';
import {
  allowedTransitionsFor,
  assertTransition,
  TRANSITIONS,
  TERMINAL_STATUSES,
  OPEN_STATUSES,
  type TransitionContext,
} from '../src/modules/issues/issue.state';
import { priorityEngine, type PrioritySignals } from '../src/modules/issues/priority.service';
import { ISSUE_STATUSES } from '../src/types';
import { AuthorizationError, InvalidTransitionError, ValidationError } from '../src/utils/errors';

/** Builds a full context; every field must be supplied to assertTransition. */
function ctx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    role: 'ADMIN',
    userId: 'admin-1',
    reporterId: 'citizen-1',
    assignedWorkerId: 'worker-1',
    reason: null,
    resolutionImageCount: 0,
    ...overrides,
  };
}

const ADMIN = { role: 'ADMIN' as const, userId: 'admin-1', reporterId: 'citizen-1', assignedWorkerId: 'worker-1' };
const OWNER = { role: 'CITIZEN' as const, userId: 'citizen-1', reporterId: 'citizen-1', assignedWorkerId: 'worker-1' };
const STRANGER = { role: 'CITIZEN' as const, userId: 'citizen-9', reporterId: 'citizen-1', assignedWorkerId: 'worker-1' };
const ASSIGNED = { role: 'WORKER' as const, userId: 'worker-1', reporterId: 'citizen-1', assignedWorkerId: 'worker-1' };
const OTHER_WORKER = { role: 'WORKER' as const, userId: 'worker-9', reporterId: 'citizen-1', assignedWorkerId: 'worker-1' };

/** assertTransition throws on failure; this turns that into a boolean. */
function allows(from: Parameters<typeof assertTransition>[0], to: Parameters<typeof assertTransition>[1], context: TransitionContext): boolean {
  try {
    assertTransition(from, to, context);
    return true;
  } catch {
    return false;
  }
}

describe('Transition table integrity', () => {
  it('defines an entry for every status', () => {
    for (const status of ISSUE_STATUSES) {
      expect(TRANSITIONS).toHaveProperty(status);
    }
  });

  it('never targets a status outside the enum', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of Object.keys(targets)) {
        expect(ISSUE_STATUSES, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never allows a self-transition', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      expect(Object.keys(targets)).not.toContain(from);
    }
  });

  it('keeps the open and terminal sets disjoint', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(OPEN_STATUSES).not.toContain(status);
    }
  });

  it('treats RESOLVED as awaiting confirmation rather than open or terminal', () => {
    // Deliberate third category: the work is done but the reporter has not
    // confirmed, so it must not inflate the open backlog nor count as finished.
    expect(OPEN_STATUSES).not.toContain('RESOLVED');
    expect(TERMINAL_STATUSES).not.toContain('RESOLVED');
    // And it still has somewhere to go.
    expect(Object.keys(TRANSITIONS.RESOLVED).length).toBeGreaterThan(0);
  });

  it('marks only CLOSED and REJECTED as terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['CLOSED', 'REJECTED']);
  });

  it('requires a reason on every destructive or exception path', () => {
    // These are the states a citizen will ask "why?" about, so the reason is
    // mandatory rather than advisory.
    expect(TRANSITIONS.REPORTED.REJECTED?.requiresReason).toBe(true);
    expect(TRANSITIONS.IN_PROGRESS.ON_HOLD?.requiresReason).toBe(true);
    expect(TRANSITIONS.RESOLVED.REOPENED?.requiresReason).toBe(true);
    expect(TRANSITIONS.UNDER_REVIEW.REJECTED?.requiresReason).toBe(true);
  });

  it('restricts on-site progress to the assigned worker', () => {
    expect(TRANSITIONS.ASSIGNED.IN_PROGRESS?.assignedWorkerOnly).toBe(true);
    expect(TRANSITIONS.IN_PROGRESS.RESOLVED?.assignedWorkerOnly).toBe(true);
  });

  it('demands resolution evidence on the RESOLVED edge', () => {
    expect(TRANSITIONS.IN_PROGRESS.RESOLVED?.requiresResolutionEvidence).toBe(true);
  });
});

describe('assertTransition', () => {
  it('permits an admin to move REPORTED to UNDER_REVIEW', () => {
    expect(allows('REPORTED', 'UNDER_REVIEW', ctx())).toBe(true);
  });

  it('refuses REPORTED straight to RESOLVED', () => {
    expect(() => assertTransition('REPORTED', 'RESOLVED', ctx())).toThrow(InvalidTransitionError);
  });

  it('refuses REPORTED straight to CLOSED', () => {
    expect(() => assertTransition('REPORTED', 'CLOSED', ctx())).toThrow(InvalidTransitionError);
  });

  it('refuses a no-op transition with a validation error', () => {
    expect(() => assertTransition('REPORTED', 'REPORTED', ctx())).toThrow(ValidationError);
  });

  it('lets the assigned worker start work', () => {
    expect(allows('ASSIGNED', 'IN_PROGRESS', ctx({ role: 'WORKER', userId: 'worker-1' }))).toBe(true);
  });

  it('stops a different worker starting work', () => {
    expect(() =>
      assertTransition('ASSIGNED', 'IN_PROGRESS', ctx({ role: 'WORKER', userId: 'worker-9' })),
    ).toThrow(AuthorizationError);
  });

  it('lets the reporter close a resolved issue', () => {
    expect(allows('RESOLVED', 'CLOSED', ctx({ role: 'CITIZEN', userId: 'citizen-1' }))).toBe(true);
  });

  it("stops an unrelated citizen closing someone else's issue", () => {
    expect(() =>
      assertTransition('RESOLVED', 'CLOSED', ctx({ role: 'CITIZEN', userId: 'citizen-9' })),
    ).toThrow(AuthorizationError);
  });

  it('lets the reporter reopen a resolved issue when they give a reason', () => {
    expect(
      allows('RESOLVED', 'REOPENED', ctx({ role: 'CITIZEN', userId: 'citizen-1', reason: 'Still broken' })),
    ).toBe(true);
  });

  it('rejects a reopen with no reason', () => {
    expect(() =>
      assertTransition('RESOLVED', 'REOPENED', ctx({ role: 'CITIZEN', userId: 'citizen-1', reason: '   ' })),
    ).toThrow(ValidationError);
  });

  it('reserves reopening a CLOSED issue for admins', () => {
    expect(allows('CLOSED', 'REOPENED', ctx({ reason: 'Recurrence reported' }))).toBe(true);
    expect(
      allows('CLOSED', 'REOPENED', ctx({ role: 'CITIZEN', userId: 'citizen-1', reason: 'Recurrence' })),
    ).toBe(false);
  });

  it('treats REJECTED as recoverable only back into review', () => {
    expect(allows('REJECTED', 'UNDER_REVIEW', ctx())).toBe(true);
    expect(() => assertTransition('REJECTED', 'ASSIGNED', ctx())).toThrow(InvalidTransitionError);
  });

  it('blocks RESOLVED without resolution evidence and allows it with', () => {
    const worker = { role: 'WORKER' as const, userId: 'worker-1' };
    expect(() =>
      assertTransition('IN_PROGRESS', 'RESOLVED', ctx({ ...worker, resolutionImageCount: 0 })),
    ).toThrow(ValidationError);
    expect(allows('IN_PROGRESS', 'RESOLVED', ctx({ ...worker, resolutionImageCount: 1 }))).toBe(true);
  });

  it('returns the matched rule on success', () => {
    const rule = assertTransition('REPORTED', 'UNDER_REVIEW', ctx());
    expect(rule.roles).toContain('ADMIN');
  });
});

describe('allowedTransitionsFor', () => {
  it('offers a citizen nothing to do on a freshly reported issue', () => {
    expect(allowedTransitionsFor('REPORTED', OWNER)).toHaveLength(0);
  });

  it('offers an admin the triage options on a reported issue', () => {
    const options = allowedTransitionsFor('REPORTED', ADMIN);
    expect(options).toContain('UNDER_REVIEW');
    expect(options).toContain('ASSIGNED');
    expect(options).toContain('REJECTED');
  });

  it('offers the reporter both confirm and reopen on a resolved issue', () => {
    const options = allowedTransitionsFor('RESOLVED', OWNER);
    expect(options).toContain('CLOSED');
    expect(options).toContain('REOPENED');
  });

  it('offers an unrelated citizen nothing at all', () => {
    expect(allowedTransitionsFor('RESOLVED', STRANGER)).toHaveLength(0);
    expect(allowedTransitionsFor('ASSIGNED', STRANGER)).toHaveLength(0);
  });

  it('offers the assigned worker progress options but not another worker', () => {
    expect(allowedTransitionsFor('ASSIGNED', ASSIGNED)).toContain('IN_PROGRESS');
    expect(allowedTransitionsFor('ASSIGNED', OTHER_WORKER)).not.toContain('IN_PROGRESS');
  });

  it('offers nothing from a terminal state to a citizen', () => {
    expect(allowedTransitionsFor('CLOSED', OWNER)).toHaveLength(0);
    expect(allowedTransitionsFor('REJECTED', OWNER)).toHaveLength(0);
  });

  it('only ever offers valid enum members', () => {
    for (const status of ISSUE_STATUSES) {
      for (const actor of [ADMIN, OWNER, ASSIGNED, STRANGER, OTHER_WORKER]) {
        for (const target of allowedTransitionsFor(status, actor)) {
          expect(ISSUE_STATUSES).toContain(target);
        }
      }
    }
  });

  it('agrees with assertTransition for every offered option', () => {
    // The UI renders buttons from this list, so anything it offers must
    // actually succeed (given a reason and evidence where required).
    for (const status of ISSUE_STATUSES) {
      for (const actor of [ADMIN, OWNER, ASSIGNED]) {
        for (const target of allowedTransitionsFor(status, actor)) {
          const context = ctx({ ...actor, reason: 'A supplied reason', resolutionImageCount: 3 });
          expect(
            allows(status, target, context),
            `${actor.role} was offered ${status} -> ${target} but assertTransition refused it`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('Priority engine', () => {
  const base: PrioritySignals = {
    categoryDefaultSeverity: 'MEDIUM',
    citizenSeverity: 'MEDIUM',
    duplicateCount: 0,
    ageHours: 0,
    slaHours: 72,
  };

  it('is deterministic for identical input', () => {
    const a = priorityEngine.evaluate(base);
    const b = priorityEngine.evaluate(base);
    expect(a.priority).toBe(b.priority);
    expect(a.score).toBe(b.score);
  });

  it('identifies itself by name for auditability', () => {
    expect(priorityEngine.name).toBe('rule-based-v1');
  });

  it('rates a critical category above a low one', () => {
    const critical = priorityEngine.evaluate({ ...base, categoryDefaultSeverity: 'CRITICAL' });
    const low = priorityEngine.evaluate({ ...base, categoryDefaultSeverity: 'LOW' });
    expect(critical.score).toBeGreaterThan(low.score);
  });

  it('lets corroborating reports raise the score', () => {
    const alone = priorityEngine.evaluate(base);
    const corroborated = priorityEngine.evaluate({ ...base, duplicateCount: 5 });
    // Several people reporting the same thing is real signal.
    expect(corroborated.score).toBeGreaterThan(alone.score);
  });

  it('caps the duplicate contribution so it cannot dominate', () => {
    const few = priorityEngine.evaluate({ ...base, duplicateCount: 3 });
    const absurd = priorityEngine.evaluate({ ...base, duplicateCount: 500 });
    // Otherwise a brigading campaign could force everything to CRITICAL.
    expect(absurd.score - few.score).toBeLessThanOrEqual(1.5);
  });

  it('escalates an issue that has blown through its SLA', () => {
    const fresh = priorityEngine.evaluate(base);
    const overdue = priorityEngine.evaluate({ ...base, ageHours: 500 });
    expect(overdue.score).toBeGreaterThan(fresh.score);
  });

  it('weights the category above the citizen rating', () => {
    // A citizen calling a cosmetic issue critical must not outrank a real hazard.
    const hazard = priorityEngine.evaluate({ ...base, categoryDefaultSeverity: 'CRITICAL', citizenSeverity: 'LOW' });
    const dramatic = priorityEngine.evaluate({ ...base, categoryDefaultSeverity: 'LOW', citizenSeverity: 'CRITICAL' });
    expect(hazard.score).toBeGreaterThan(dramatic.score);
  });

  it('always returns a valid severity band', () => {
    for (const categoryDefaultSeverity of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      for (const citizenSeverity of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
        for (const duplicateCount of [0, 2, 10]) {
          const result = priorityEngine.evaluate({
            ...base,
            categoryDefaultSeverity,
            citizenSeverity,
            duplicateCount,
          });
          expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.priority);
          expect(Number.isFinite(result.score)).toBe(true);
        }
      }
    }
  });

  it('rates the worst case CRITICAL and the mildest case LOW', () => {
    const worst = priorityEngine.evaluate({
      categoryDefaultSeverity: 'CRITICAL',
      citizenSeverity: 'CRITICAL',
      duplicateCount: 10,
      ageHours: 1000,
      slaHours: 6,
    });
    expect(worst.priority).toBe('CRITICAL');

    const mildest = priorityEngine.evaluate({
      categoryDefaultSeverity: 'LOW',
      citizenSeverity: 'LOW',
      duplicateCount: 0,
      ageHours: 0,
      slaHours: 168,
    });
    expect(mildest.priority).toBe('LOW');
  });

  it('explains its reasoning', () => {
    const result = priorityEngine.evaluate({ ...base, categoryDefaultSeverity: 'CRITICAL', duplicateCount: 4 });
    // An unexplained score is not auditable.
    expect(result.rationale.length).toBeGreaterThan(0);
    for (const line of result.rationale) expect(typeof line).toBe('string');
  });
});
