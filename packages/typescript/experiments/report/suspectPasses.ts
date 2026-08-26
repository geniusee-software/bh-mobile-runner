import type { RunRecord } from "../metrics/RunRecord.ts";

export interface SuspectPass {
  caseTitle: string;
  stepIndex: number;
  expected: string;
  /** Words the expectation quoted that were nowhere in the judged tree. */
  missing: string[];
}

/**
 * Finds steps that passed while the words their expectation quotes were absent
 * from the very tree the verdict was reached on.
 *
 * Pass rate on its own rewards a lenient judge: accepting a screen that does
 * not satisfy the expectation scores exactly as well as being right, and for a
 * test runner it is the worse mistake — a green step that should be red hides a
 * real defect. Measured on this suite, one model passed "a button labeled 'Join
 * Path4life' is visible" on a registration form that has no such button.
 *
 * Quoted literals are a conservative signal: an expectation that quotes nothing
 * cannot be audited this way and is not reported, so this counts a floor rather
 * than the total.
 */
export function suspectPasses(
  records: readonly RunRecord.Case[],
): SuspectPass[] {
  const suspects: SuspectPass[] = [];

  for (const record of records) {
    for (const step of record.steps) {
      if (step.verdict !== "passed") continue;

      const evidence = step.evidence;
      if (!evidence || evidence.quoted.length === 0) continue;
      if (evidence.missing.length === 0) continue;

      suspects.push({
        caseTitle: record.caseTitle,
        stepIndex: step.index,
        expected: step.expected,
        missing: evidence.missing,
      });
    }
  }

  return suspects;
}

/**
 * Passes that only the fallback verifier granted.
 *
 * A second opinion wired to run on failure can only ever turn a FAIL into a
 * PASS, so it raises the pass rate by construction. How often it does is the
 * number that says whether it is seeing what the tree cannot — or just being
 * agreeable — and it belongs next to the pass rate rather than inside it.
 */
export function overturnedPasses(
  records: readonly RunRecord.Case[],
): number {
  return records
    .flatMap((record) => record.steps)
    .filter(
      (step) =>
        step.verdict === "passed" && (step.verifierAttempts?.length ?? 0) > 1,
    ).length;
}

/** Passed steps that could be audited at all — the denominator for the rate. */
export function auditablePasses(records: readonly RunRecord.Case[]): number {
  return records
    .flatMap((record) => record.steps)
    .filter(
      (step) =>
        step.verdict === "passed" && (step.evidence?.quoted.length ?? 0) > 0,
    ).length;
}
