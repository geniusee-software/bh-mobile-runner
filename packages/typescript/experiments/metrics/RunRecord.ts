import type { ExpectationProbe } from "../diagnostics/ExpectationProbe.ts";
import type { LlmCallRecorder } from "./LlmCallRecorder.ts";

export namespace RunRecord {
  export type StepVerdict = "passed" | "failed" | "errored";

  export interface Step {
    index: number;
    action: string;
    expected: string;
    verdict: StepVerdict;
    /** Why the step did not pass; empty when it did. */
    failure: string;
    /**
     * Why a passing step passed, in the judge's own words.
     *
     * Failures record their reason in `failure`; passes recorded nothing, which
     * made exactly the interesting case unauditable — a step that starts
     * passing after a change cannot be told apart from a step the judge merely
     * became more generous about.
     */
    passReason?: string;
    durationMs: number;
    llmCalls: number;
    /** Present only on a failed check: was the answer on screen at all? */
    evidence?: ExpectationProbe.Evidence;
    /** Verifiers that ran before the step was called failed. */
    verifierAttempts?: string[];
    /** Screen at the moment the check failed. */
    screenshotPath?: string | undefined;
  }

  export interface DeviceTotals {
    totalMs: number;
    pageSourceMs: number;
    pageSourceCount: number;
    contextScanMs: number;
    contextScanCount: number;
    screenshotMs: number;
  }

  export interface Tokens {
    input: number;
    output: number;
    cacheRead: number;
  }

  /** One case executed under one variant. */
  export interface Case {
    variantId: string;
    model: string;
    caseId: string;
    caseTitle: string;
    origin: string;
    startedAt: string;
    durationMs: number;
    verdict: StepVerdict;
    /** Steps that passed, out of steps attempted. */
    stepsPassed: number;
    stepsTotal: number;
    steps: Step[];
    llmCalls: number;
    llmMs: number;
    llmCallsByAgent: Record<string, number>;
    tokens: Tokens;
    costUsd: number;
    /**
     * System dialogs answered while this case ran.
     *
     * Recorded so a run can be read back and audited, and kept out of
     * `stepsTotal` on purpose: iOS asking for a permission is a property of the
     * device, and counting it would score the runner on the operating system's
     * behaviour rather than on the application's.
     */
    systemDialogs?: number;
    device: DeviceTotals;
  }
}

export function summariseCalls(
  calls: readonly LlmCallRecorder.Call[],
): Pick<RunRecord.Case, "llmCalls" | "llmMs" | "llmCallsByAgent" | "tokens"> {
  const llmCallsByAgent: Record<string, number> = {};
  let llmMs = 0;
  const tokens: RunRecord.Tokens = { input: 0, output: 0, cacheRead: 0 };

  for (const call of calls) {
    llmCallsByAgent[call.agent] = (llmCallsByAgent[call.agent] ?? 0) + 1;
    llmMs += call.latencyMs;
    tokens.input += call.inputTokens;
    tokens.output += call.outputTokens;
    tokens.cacheRead += call.cacheReadTokens;
  }

  return { llmCalls: calls.length, llmMs, llmCallsByAgent, tokens };
}
