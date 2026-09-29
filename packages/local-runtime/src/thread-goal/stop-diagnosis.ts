/**
 * Loop-stop diagnosis.
 *
 * An autonomous Goal runs until something stops it, so "why did it stop" is the
 * only question an operator has about a run that ended. Before this module
 * there was no single answer: `goal.state_transitioned` carries the durable
 * `statusReason`, but the breaker cause (`repeated_reply` vs `no_tool`), the
 * threshold that fired, and the counters behind it only ever appeared in the
 * adjacent `goal.breaker_decided` event, and nothing at all said how the Goal
 * could be started again.
 *
 * `goal.stopped` is that single record. It is emitted from the one choke point
 * every lifecycle transition passes through, so it cannot miss a stop, and it
 * is a *new* event type rather than new fields on `goal.breaker_decided` — the
 * reason catalog (`THREAD_GOAL_STATUS_REASONS`) is mirrored by
 * `@mavis/shared` and the TUI normalizer, so widening it would be a
 * cross-package contract change. Everything diagnosable that does not need a
 * new persisted reason lives here instead.
 */

import type {
  ThreadGoalBreakerCause,
  ThreadGoalState,
  ThreadGoalStatus,
  ThreadGoalStatusReason,
  ThreadGoalToolActivity,
} from '@mavis/goal';

/**
 * Coarse class of a stop, derived from the durable reason.
 *
 * Deliberately fewer buckets than statuses: an operator needs to know whether
 * the run *achieved* the objective, *ran out of a budget the user chose*,
 * *hit a wall the loop detected*, or *was interrupted*, not to distinguish
 * seven verifier failure modes.
 */
export type GoalStopCause =
  | 'complete'
  | 'budget_limited'
  | 'breaker'
  | 'blocked'
  | 'usage_limited'
  | 'paused';

/**
 * How the loop can be started again. `blocked` and `usage_limited` are
 * terminal-but-resumable; `complete` and a spent `budget_limited` are not.
 */
export type GoalStopRecovery =
  | 'terminal'
  | 'user_resume'
  | 'user_turn_resets_breaker'
  | 'token_budget_edit'
  | 'operator_unpause';

export interface GoalStopBreakerDetail {
  /** Which independent breaker condition fired. */
  readonly cause: ThreadGoalBreakerCause;
  /** Configured occurrence limit that was reached. */
  readonly limit: number;
  /** Consecutive identical replies for `repeated_reply`. */
  readonly repeatedReplyStreak: number;
  /** Consecutive tool-less turns for `no_tool`. */
  readonly noToolStreak: number;
  /** Tool activity observed on the settling Turn. */
  readonly toolActivity: ThreadGoalToolActivity;
  /** True when the breaker overrode a completion claim this Turn. */
  readonly overrodeCompletionClaim: boolean;
}

export interface GoalStopClassification {
  readonly cause: GoalStopCause;
  readonly recovery: GoalStopRecovery;
}

const COMPLETION_REASONS: ReadonlySet<ThreadGoalStatusReason> = new Set([
  'complete(worker_proposal)',
  'complete(verifier_met)',
  'complete(user_requested)',
]);

/**
 * Reasons written by the two breakers.
 *
 * `paused(no_progress)` is deliberately absent: the same reason is written by
 * the verifier's repeated-`not_met` convergence stop
 * (`store-verification.ts`), which is a different diagnosis with a different
 * counter. `breaker` is claimed only for a stop the breaker itself just
 * recorded, so the classification never guesses.
 */
const BREAKER_REASONS: ReadonlySet<ThreadGoalStatusReason> = new Set([
  'paused(no_progress_after_completion_claim)',
]);

export function classifyGoalStop(reason: ThreadGoalStatusReason): GoalStopClassification {
  if (COMPLETION_REASONS.has(reason)) return { cause: 'complete', recovery: 'terminal' };
  if (reason === 'budget_limited(token)') {
    // The only stop the guarded budget mutation can undo.
    return { cause: 'budget_limited', recovery: 'token_budget_edit' };
  }
  if (reason === 'budget_limited(main_turn)' || reason === 'budget_limited(active_time)') {
    // No budget edit reaches these: they are spent wall-clock and turn counts.
    return { cause: 'budget_limited', recovery: 'terminal' };
  }
  if (reason === 'blocked(worker_reported)' || reason === 'blocked(verifier_impossible)') {
    return { cause: 'blocked', recovery: 'user_resume' };
  }
  if (reason === 'blocked(safety_policy)') {
    return { cause: 'blocked', recovery: 'user_resume' };
  }
  if (reason === 'usage_limited(provider_quota)' || reason === 'usage_limited(rate_limit)') {
    return { cause: 'usage_limited', recovery: 'user_resume' };
  }
  if (reason === 'paused(user_requested)') return { cause: 'paused', recovery: 'operator_unpause' };
  if (BREAKER_REASONS.has(reason)) {
    // A user Turn resets the breaker unconditionally, so this is recoverable
    // without a deliberate resume call.
    return { cause: 'breaker', recovery: 'user_turn_resets_breaker' };
  }
  return { cause: 'paused', recovery: 'operator_unpause' };
}

/**
 * The breaker detail for the Turn that just produced `goal`, or `undefined`
 * when the stop was not a breaker pause.
 *
 * The no-progress reason is shared with the verifier's convergence stop, so
 * `statusReason` alone cannot tell the two apart — only the breaker itself
 * knows it wrote the row, and it reports that here.
 */
export function breakerDetailForStop(
  reason: ThreadGoalStatusReason,
  breaker: GoalStopBreakerDetail | undefined,
): GoalStopBreakerDetail | undefined {
  if (!breaker) return undefined;
  if (reason === 'paused(no_progress_after_completion_claim)') return breaker;
  if (reason !== 'paused(no_progress)') return undefined;
  return breaker;
}

/**
 * Short per-Goal memory of the last breaker pause, so the single emission point
 * can attach the cause to the stop it is announcing.
 *
 * Entries are written only on a pause and read exactly once, immediately, by the
 * transition that pause produced. A leftover entry is harmless: it is
 * overwritten by the next pause and never read for a non-breaker reason.
 */
export class GoalStopDiagnoses {
  private readonly byGoalId = new Map<string, GoalStopBreakerDetail>();

  record(goalId: string, detail: GoalStopBreakerDetail): void {
    this.byGoalId.set(goalId, detail);
  }

  take(goalId: string): GoalStopBreakerDetail | undefined {
    const detail = this.byGoalId.get(goalId);
    if (detail) this.byGoalId.delete(goalId);
    return detail;
  }

  clear(goalId: string): void {
    this.byGoalId.delete(goalId);
  }
}

/** Effective autonomy ladder, captured at the moment the loop stopped. */
export interface GoalStopLimits {
  readonly repeatedReplyLimit: number;
  readonly repeatedNotMetLimit: number;
  readonly graceSteps: number;
  /** `null` on every dimension means "this Goal is not budget-capped". */
  readonly tokenBudget: number | null;
  readonly mainTurns: number | null;
  readonly activeSeconds: number | null;
}

export function buildGoalStopPayload(input: {
  readonly goal: ThreadGoalState;
  readonly from: ThreadGoalStatus;
  readonly reason: ThreadGoalStatusReason;
  readonly breaker: GoalStopBreakerDetail | undefined;
  readonly limits: GoalStopLimits;
}): {
  goalId: string;
  sessionId: string;
  from: ThreadGoalStatus;
  to: ThreadGoalStatus;
  reason: ThreadGoalStatusReason;
  classification: GoalStopCause;
  recovery: GoalStopRecovery;
  budgetsCapped: {
    readonly token: boolean;
    readonly mainTurn: boolean;
    readonly activeTime: boolean;
  };
  limits: GoalStopLimits;
  usage: {
    readonly tokensUsed: number;
    readonly turnsUsed: number;
    readonly activeSeconds: number;
  };
  readonly breaker?: GoalStopBreakerDetail;
} {
  const { goal, from, reason, breaker, limits } = input;
  const classification = classifyGoalStop(reason);
  return {
    goalId: goal.goalId,
    sessionId: goal.sessionId,
    from,
    to: goal.status,
    reason,
    classification: classification.cause,
    recovery: classification.recovery,
    // An operator asking "why did it stop there?" needs to know first whether
    // any cap existed at all: an uncapped Goal stopping is a stall, never a cap.
    budgetsCapped: {
      token: limits.tokenBudget !== null,
      mainTurn: limits.mainTurns !== null,
      activeTime: limits.activeSeconds !== null,
    },
    limits,
    usage: {
      tokensUsed: goal.tokensUsed,
      turnsUsed: goal.turnsUsed,
      activeSeconds: goal.timeUsedSeconds,
    },
    ...(breakerDetailForStop(reason, breaker) ? { breaker } : {}),
  };
}
