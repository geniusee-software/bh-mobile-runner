import type { RunRecord } from "../metrics/RunRecord.ts";

export namespace CompareRuns {
  export interface StepMove {
    caseTitle: string;
    index: number;
    expected: string;
    from: string;
    to: string;
    reason: string;
  }

  export interface Comparison {
    /** Cases present in both runs, which is all a comparison may speak about. */
    pairedCases: number;
    before: { steps: number; passed: number; cases: number };
    after: { steps: number; passed: number; cases: number };
    gained: StepMove[];
    lost: StepMove[];
  }
}

/**
 * Compares two runs step by step over the cases they share.
 *
 * A pass rate on its own cannot say whether a change helped: two runs of the
 * same configuration differ, and two runs over different case sets differ for
 * reasons that have nothing to do with the change. Pairing removes both — every
 * step is compared against the same step of the same case, and steps that
 * appear in only one run are left out rather than counted as movement.
 *
 * Both directions are reported. A change that wins ten steps and loses eight is
 * a different result from one that wins two and loses none, and a summary that
 * shows only the net is unable to tell them apart.
 */
export function compareRuns(
  before: readonly RunRecord.Case[],
  after: readonly RunRecord.Case[],
): CompareRuns.Comparison {
  const beforeById = new Map(before.map((record) => [record.caseId, record]));
  const gained: CompareRuns.StepMove[] = [];
  const lost: CompareRuns.StepMove[] = [];
  const totals = {
    before: { steps: 0, passed: 0, cases: 0 },
    after: { steps: 0, passed: 0, cases: 0 },
  };
  let pairedCases = 0;

  for (const now of after) {
    const then = beforeById.get(now.caseId);
    if (!then) continue;
    pairedCases += 1;

    if (then.verdict === "passed") totals.before.cases += 1;
    if (now.verdict === "passed") totals.after.cases += 1;

    const thenSteps = new Map(then.steps.map((step) => [step.index, step]));
    for (const step of now.steps) {
      const was = thenSteps.get(step.index);
      if (!was) continue;

      totals.before.steps += 1;
      totals.after.steps += 1;
      if (was.verdict === "passed") totals.before.passed += 1;
      if (step.verdict === "passed") totals.after.passed += 1;
      if (was.verdict === step.verdict) continue;

      const move: CompareRuns.StepMove = {
        caseTitle: now.caseTitle,
        index: step.index,
        expected: step.expected,
        from: was.verdict,
        to: step.verdict,
        reason: String(
          (step.verdict === "passed" ? was.failure : step.failure) ?? "",
        ),
      };
      (step.verdict === "passed" ? gained : lost).push(move);
    }
  }

  return { pairedCases, ...totals, gained, lost };
}

const share = (passed: number, total: number) =>
  total ? `${passed}/${total} (${Math.round((passed / total) * 100)}%)` : "—";

/** Renders a comparison as the paragraph a reader actually wants. */
export function reportComparison(
  comparison: CompareRuns.Comparison,
  labels: { before: string; after: string },
): string {
  const lines: string[] = [
    `Paired over ${comparison.pairedCases} cases: "${labels.before}" -> "${labels.after}"`,
    "",
    `  steps  ${share(comparison.before.passed, comparison.before.steps)}  ->  ${share(comparison.after.passed, comparison.after.steps)}`,
    `  cases  ${share(comparison.before.cases, comparison.pairedCases)}  ->  ${share(comparison.after.cases, comparison.pairedCases)}`,
    "",
    `  ${comparison.gained.length} steps gained, ${comparison.lost.length} lost`,
  ];

  for (const [heading, moves] of [
    ["GAINED", comparison.gained],
    ["LOST", comparison.lost],
  ] as const) {
    if (!moves.length) continue;
    lines.push("", `${heading}:`);
    for (const move of moves) {
      lines.push(
        `  • ${move.caseTitle.slice(0, 46)} — step ${move.index}: ${move.expected.slice(0, 78)}`,
        `      was ${move.from}: ${move.reason.slice(0, 110)}`,
      );
    }
  }

  return lines.join("\n");
}
