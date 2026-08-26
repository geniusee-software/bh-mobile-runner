import type { TestCase } from "../cases/TestCase.ts";
import type { PageGraph } from "../graph/PageGraph.ts";

export namespace CaseValidator {
  export type Verdict =
    | "ok"
    | "names-nothing"
    | "names-the-unknown"
    | "no-expectation";

  export interface StepFinding {
    stepIndex: number;
    verdict: Verdict;
    /** Literals the expectation quotes. */
    quoted: string[];
    /** Of those, the ones no screen in the app has ever shown. */
    unknown: string[];
  }

  export interface Report {
    caseId: string;
    caseTitle: string;
    steps: StepFinding[];
    /** True when nothing in this case looks unrunnable. */
    sound: boolean;
  }
}

const QUOTED = /['"]([^'"]{2,60})['"]/g;

/**
 * Checks a case against what the app is actually made of.
 *
 * Two failures are worth catching before a device is ever touched. An
 * expectation that quotes a label no screen has ever shown is asking about
 * something that does not exist — the case is wrong, not the runner. And an
 * expectation that quotes nothing at all cannot be checked against a tree by
 * anyone, model or human; it will turn on interpretation every time, which is
 * where most of this suite's failures came from.
 */
export class CaseValidator {
  readonly #graph: PageGraph;

  constructor(graph: PageGraph) {
    this.#graph = graph;
  }

  validate(testCase: TestCase): CaseValidator.Report {
    const steps = testCase.steps.map((step, index) =>
      this.#validateStep(step.expected, index + 1),
    );

    return {
      caseId: testCase.id,
      caseTitle: testCase.title,
      steps,
      sound: steps.every((step) => step.verdict === "ok" || step.verdict === "no-expectation"),
    };
  }

  #validateStep(expected: string, stepIndex: number): CaseValidator.StepFinding {
    if (!expected.trim()) {
      return { stepIndex, verdict: "no-expectation", quoted: [], unknown: [] };
    }

    const quoted = [
      ...new Set(
        [...expected.matchAll(QUOTED)].map((m) => m[1]?.trim() ?? "").filter(Boolean),
      ),
    ];

    if (!quoted.length) {
      return { stepIndex, verdict: "names-nothing", quoted, unknown: [] };
    }

    const unknown = quoted.filter((literal) => !this.#graph.knows(literal));
    return {
      stepIndex,
      verdict: unknown.length ? "names-the-unknown" : "ok",
      quoted,
      unknown,
    };
  }
}
