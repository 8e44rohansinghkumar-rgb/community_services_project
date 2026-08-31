/**
 * Rule-based priority engine.
 *
 * Deliberately simple and explainable — no pretence of AI (spec §25). It scores
 * an issue from four signals and maps the score onto a priority band. The
 * `PriorityEngine` interface is the extension point: an ML model can be dropped
 * in later without touching the issue service.
 */
import type { Severity } from '../../types';

export interface PrioritySignals {
  citizenSeverity: Severity;
  categoryDefaultSeverity: Severity;
  /** Similar nearby reports in the recent window — corroboration raises urgency. */
  duplicateCount: number;
  ageHours: number;
  /** Category SLA target; a tight SLA implies an inherently urgent category. */
  slaHours: number;
}

export interface PriorityDecision {
  priority: Severity;
  score: number;
  /** Human-readable factors, surfaced to admins so the decision is auditable. */
  rationale: string[];
}

export interface PriorityEngine {
  readonly name: string;
  evaluate(signals: PrioritySignals): PriorityDecision;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function bandFromScore(score: number): Severity {
  if (score >= 7.5) return 'CRITICAL';
  if (score >= 5.5) return 'HIGH';
  if (score >= 3.25) return 'MEDIUM';
  return 'LOW';
}

class RuleBasedPriorityEngine implements PriorityEngine {
  readonly name = 'rule-based-v1';

  evaluate(signals: PrioritySignals): PriorityDecision {
    const rationale: string[] = [];

    // The category baseline is weighted above the citizen's own rating: an open
    // manhole is critical whatever the reporter selected, and a citizen cannot
    // escalate their own report by ticking CRITICAL.
    const categoryWeight = SEVERITY_WEIGHT[signals.categoryDefaultSeverity];
    const citizenWeight = SEVERITY_WEIGHT[signals.citizenSeverity];

    let score = categoryWeight * 1.25 + citizenWeight * 0.75;
    rationale.push(`Category baseline: ${signals.categoryDefaultSeverity}`);
    rationale.push(`Reporter assessment: ${signals.citizenSeverity}`);

    // Corroboration: several people reporting the same thing nearby.
    if (signals.duplicateCount > 0) {
      const bump = Math.min(1.5, signals.duplicateCount * 0.5);
      score += bump;
      rationale.push(`${signals.duplicateCount} similar nearby report(s) (+${bump.toFixed(1)})`);
    }

    // Ageing: an unresolved issue past its SLA becomes more urgent over time.
    if (signals.ageHours > signals.slaHours) {
      const overdueRatio = signals.ageHours / Math.max(1, signals.slaHours);
      const bump = Math.min(1.5, (overdueRatio - 1) * 0.75);
      if (bump > 0.05) {
        score += bump;
        rationale.push(`Past its ${signals.slaHours}h target (+${bump.toFixed(1)})`);
      }
    }

    const priority = bandFromScore(score);
    rationale.push(`Score ${score.toFixed(2)} → ${priority}`);
    return { priority, score: Number(score.toFixed(2)), rationale };
  }
}

export const priorityEngine: PriorityEngine = new RuleBasedPriorityEngine();

/** Convenience wrapper used at issue-creation time. */
export function computeInitialPriority(input: {
  citizenSeverity: Severity;
  categoryDefaultSeverity: Severity;
  slaHours: number;
  duplicateCount?: number;
}): PriorityDecision {
  return priorityEngine.evaluate({
    citizenSeverity: input.citizenSeverity,
    categoryDefaultSeverity: input.categoryDefaultSeverity,
    duplicateCount: input.duplicateCount ?? 0,
    ageHours: 0,
    slaHours: input.slaHours,
  });
}
