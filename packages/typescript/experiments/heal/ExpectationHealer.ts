import type { TestCase, TestStep } from "../cases/TestCase.ts";
import type { PageGraph } from "../graph/PageGraph.ts";

export namespace ExpectationHealer {
  export interface HealedStep extends TestStep {
    /** The wording the case shipped with, kept so a run is auditable. */
    originalExpected: string;
    /** Why it was rewritten, or why it was left alone. */
    note: string;
    healed: boolean;
  }

  export interface HealedCase extends Omit<TestCase, "steps"> {
    steps: HealedStep[];
    healedSteps: number;
  }
}

/** Words that carry a screen's identity: quoted labels and CamelCase names. */
const QUOTED = /['"]([^'"]{2,60})['"]/g;
const CAMEL_OR_TITLE = /\b([A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{3,})\b/g;

/** Expectations about state the accessibility tree cannot express at all. */
const UNANSWERABLE_BY_TREE =
  /\bactive\b|\bselected\b|\bhighlighted\b|\bcolou?r\b|\banimat/i;

/**
 * Rewrites vague expectations into ones a tree can actually answer.
 *
 * Most of this suite's failures were expectations phrased the way a person
 * describes a screen — "the AhavasYisroel4Life screen is shown" — which name
 * nothing to look for and so turn entirely on how generously the verifier
 * reads them. The graph knows what that screen is actually made of, so the
 * expectation can be restated in terms of elements that are either there or
 * not.
 *
 * It rewrites from two sources only: the case's own words, and the graph built
 * before this run. It never sees the screen the step produced — a healer that
 * did would simply describe whatever happened and pass every time.
 */
export class ExpectationHealer {
  /**
   * Screens the graph must hold before it may claim anything is distinctive.
   *
   * Distinctiveness is a comparison, and with a handful of screens there is
   * nothing to compare against: on a three-screen graph the home feed's own tab
   * bar came out "distinctive" and every rewrite in the suite anchored to the
   * same three labels. A graph this thin is not knowledge about the app, and
   * the healer says so by leaving every case alone.
   */
  static readonly MIN_SCREENS = 6;

  readonly #graph: PageGraph;

  constructor(graph: PageGraph) {
    this.#graph = graph;
  }

  heal(testCase: TestCase): ExpectationHealer.HealedCase {
    const steps = testCase.steps.map((step) => this.#healStep(step));
    return {
      ...testCase,
      steps,
      healedSteps: steps.filter((step) => step.healed).length,
    };
  }

  #healStep(step: TestStep): ExpectationHealer.HealedStep {
    const keep = (note: string): ExpectationHealer.HealedStep => ({
      ...step,
      originalExpected: step.expected,
      note,
      healed: false,
    });

    if (!step.expected.trim()) return keep("no expectation to heal");

    // An expectation that already names something concrete is checkable as it
    // stands; rewriting it would only risk changing what it asserts.
    if (QUOTED.test(step.expected)) {
      QUOTED.lastIndex = 0;
      return keep("already names a concrete label");
    }
    QUOTED.lastIndex = 0;

    if (UNANSWERABLE_BY_TREE.test(step.expected)) {
      return keep("asks about state the tree cannot express — needs a screenshot");
    }

    if (this.#graph.screens.length < ExpectationHealer.MIN_SCREENS) {
      return keep(
        `graph has only ${this.#graph.screens.length} screens; too few to know what is distinctive`,
      );
    }

    const screen = this.#targetScreen(step);
    if (!screen) return keep("no screen in the graph matches this step");

    const anchors = this.#graph
      .distinctiveElements(screen.signature)
      .filter((element) => element.role !== "Text")
      .slice(0, 3)
      .map((element) => element.text);

    if (anchors.length < 2) {
      return keep(`screen "${screen.titles[0] ?? screen.signature}" has too few stable controls to name`);
    }

    const quoted = anchors.map((anchor) => `'${anchor}'`).join(" and ");
    return {
      ...step,
      originalExpected: step.expected,
      expected: `${step.expected.replace(/\.$/, "")} — the screen shows ${quoted}.`,
      note: `anchored to "${screen.titles[0] ?? screen.signature}" from the page graph`,
      healed: true,
    };
  }

  /**
   * The screen this step is talking about, judged from its own wording.
   *
   * The action is the stronger clue and is read first: "Tap the 'Month'
   * button" says where the step is going, while the expectation often only
   * says that something happened. Quoted labels beat CamelCase names because a
   * case quotes what it saw, and CamelCase can be a series title that appears
   * on several screens.
   */
  #targetScreen(step: TestStep) {
    for (const term of this.#candidateTerms(step)) {
      // Titles only. A screen that merely mentions the term is the wrong
      // screen, and anchoring to it turns "we arrived at X" into a statement
      // about the screen we were trying to leave.
      const [best] = this.#graph.screensTitled(term);
      if (best) return best;
    }
    return undefined;
  }

  /** Terms that might name a screen, strongest clue first. */
  #candidateTerms(step: TestStep): string[] {
    const terms: string[] = [];
    const push = (value: string | undefined) => {
      const trimmed = value?.trim();
      if (trimmed && trimmed.length > 1 && !terms.includes(trimmed)) {
        terms.push(trimmed);
      }
    };

    for (const source of [step.action, step.expected]) {
      for (const match of source.matchAll(QUOTED)) push(match[1]);
      QUOTED.lastIndex = 0;
    }
    for (const source of [step.action, step.expected]) {
      for (const match of source.matchAll(CAMEL_OR_TITLE)) push(match[1]);
      CAMEL_OR_TITLE.lastIndex = 0;
    }

    return terms;
  }
}
