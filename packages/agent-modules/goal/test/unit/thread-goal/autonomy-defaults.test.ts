/**
 * Long-running autonomy policy tests.
 *
 * A Goal is uncapped by budget on purpose, which makes the two breakers the only
 * thing standing between an unattended run and an infinite loop. These tests pin
 * that policy as a *decision*: the thresholds are high enough not to kill a
 * legitimate multi-hour run, and bounded enough that no configuration can remove
 * the stop.
 *
 * `@mavis/config` is imported directly rather than through a re-export: the
 * numbers under test are config-surface policy, and re-exporting them from
 * `@mavis/goal` would make a runtime package depend on the config contract.
 */

import { describe, expect, it } from "vitest";

import {
  GOAL_CONFIG_DEFAULTS,
  GOAL_CONFIG_LIMITS,
  parseGoalConfig,
} from "@mavis/config";
import { GOAL_BLOCKED_AUDIT_THRESHOLD } from "../../../src/continuation.js";

describe("goal autonomy defaults", () => {
  it("imposes no turn, time, or token cap by default", () => {
    // Finding: `defaultTokens` / `defaultMainTurns` / `defaultActiveSeconds`
    // are absent on purpose. Pinning the absence stops a future "safety" cap
    // from landing without anyone noticing it contradicts the feature.
    expect(GOAL_CONFIG_DEFAULTS.budget).not.toHaveProperty("defaultTokens");
    expect(GOAL_CONFIG_DEFAULTS.budget).not.toHaveProperty("defaultMainTurns");
    expect(GOAL_CONFIG_DEFAULTS.budget).not.toHaveProperty("defaultActiveSeconds");
  });

  it("does not write a default budget during parsing either", () => {
    const { config, warnings } = parseGoalConfig({});
    expect(warnings).toEqual([]);
    expect(config.budget).toEqual({ graceSteps: 1 });
  });

  it("keeps a user-set cap opt-in and reports no cap as unlimited", () => {
    // `parseGoalConfig` takes the `goal` object itself, not the whole file.
    const { config, warnings } = parseGoalConfig({ budget: { defaultMainTurns: 500 } });
    expect(warnings).toEqual([]);
    expect(config.budget.defaultMainTurns).toBe(500);
    expect(config.budget).not.toHaveProperty("defaultTokens");
    expect(config.budget).not.toHaveProperty("defaultActiveSeconds");
  });

  it("tolerates repeated reasoning long enough for a multi-hour run", () => {
    // A long run legitimately re-derives the same summary after a long tool
    // call, a context compaction, or a re-check of a wall it already hit. The
    // old default of 3 paused the Goal on the third of those.
    expect(GOAL_CONFIG_DEFAULTS.breaker.repeatedReplyLimit).toBeGreaterThanOrEqual(8);
    // Still bounded: eight byte-identical final replies means no progress.
    expect(isUsableBreakerLimit(GOAL_CONFIG_DEFAULTS.breaker.repeatedReplyLimit)).toBe(true);
  });

  it("tolerates verifier rejection long enough for a long tail to be chased", () => {
    // A strict requirement-by-requirement auditor rejects a large objective many
    // times while the tail converges; the old default of 5 stopped that.
    expect(GOAL_CONFIG_DEFAULTS.verifier.repeatedNotMetLimit).toBeGreaterThanOrEqual(10);
  });

  it("agrees with the prompt's blocked-audit threshold", () => {
    // Two independent convergence signals that disagree would let a run be
    // stopped by whichever fired first, which is the arbitrary outcome this
    // policy exists to remove.
    expect(GOAL_BLOCKED_AUDIT_THRESHOLD).toBe(GOAL_CONFIG_DEFAULTS.verifier.repeatedNotMetLimit);
  });

  it("respects the graceSteps hard maximum of 3", () => {
    expect(GOAL_CONFIG_LIMITS.budget.graceSteps).toBe(3);
    const { config } = parseGoalConfig({ budget: { graceSteps: 99 } });
    expect(config.budget.graceSteps).toBe(3);
  });
});

describe("goal breaker ceilings", () => {
  it("clamps a configured breaker limit to its hard maximum", () => {
    // A Goal is uncapped by budget, so the breakers are its only stop. An
    // unbounded limit would be a legal, silent disable of the whole mechanism.
    const { config, warnings } = parseGoalConfig({
      breaker: { repeatedReplyLimit: 1_000_000_000 },
    });
    expect(config.breaker.repeatedReplyLimit).toBe(GOAL_CONFIG_LIMITS.breaker.repeatedReplyLimit);
    expect(warnings).toContain(
      "Invalid goal config at goal.breaker.repeatedReplyLimit: exceeds maximum 64; clamped",
    );
  });

  it("clamps a configured verifier limit to its hard maximum", () => {
    const { config, warnings } = parseGoalConfig({
      verifier: { repeatedNotMetLimit: Number.MAX_SAFE_INTEGER },
    });
    expect(config.verifier.repeatedNotMetLimit).toBe(
      GOAL_CONFIG_LIMITS.verifier.repeatedNotMetLimit,
    );
    expect(warnings).toContain(
      `Invalid goal config at goal.verifier.repeatedNotMetLimit: exceeds maximum ${GOAL_CONFIG_LIMITS.verifier.repeatedNotMetLimit}; clamped`,
    );
  });

  it("still accepts a lowered threshold without complaint", () => {
    const { config, warnings } = parseGoalConfig({ breaker: { repeatedReplyLimit: 2 } });
    expect(warnings).toEqual([]);
    expect(config.breaker.repeatedReplyLimit).toBe(2);
  });

  it("falls back to the default for a non-integer threshold", () => {
    const { config, warnings } = parseGoalConfig({ breaker: { repeatedReplyLimit: 2.5 } });
    expect(config.breaker.repeatedReplyLimit).toBe(
      GOAL_CONFIG_DEFAULTS.breaker.repeatedReplyLimit,
    );
    expect(warnings).toHaveLength(1);
  });

  it("keeps every threshold below its ceiling", () => {
    expect(GOAL_CONFIG_DEFAULTS.breaker.repeatedReplyLimit).toBeLessThanOrEqual(
      GOAL_CONFIG_LIMITS.breaker.repeatedReplyLimit,
    );
    expect(GOAL_CONFIG_DEFAULTS.verifier.repeatedNotMetLimit).toBeLessThanOrEqual(
      GOAL_CONFIG_LIMITS.verifier.repeatedNotMetLimit,
    );
  });
});

/** A breaker threshold must always be a finite integer the ladder can act on. */
function isUsableBreakerLimit(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
