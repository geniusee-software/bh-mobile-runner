import z from "zod";

/**
 * A generated case as BugsHunter stores it: an ordered list of steps, each an
 * action to perform and the state the app should be left in.
 */
export const TestStep = z.object({
  /** Natural-language action, handed to the agent verbatim. */
  action: z.string(),
  /** Natural-language assertion; empty when the step only navigates. */
  expected: z.string(),
  /**
   * The generator's judgement that no accessibility tree can settle this step.
   *
   * Some states an iOS app draws and never reports — which segment of a
   * control is chosen, what colour a badge is. The runner cannot infer that
   * from the words, and buying a screenshot for every step to be safe costs
   * image tokens on the many steps that never needed one. So the generator,
   * which knows what it was asking about, says.
   */
  needsScreenshot: z.boolean().optional(),
});

export type TestStep = z.infer<typeof TestStep>;

const RawTestCase = z.object({
  id: z.string(),
  title: z.string(),
  /** Screen the generator derived this case from, e.g. "device map: August". */
  origin: z.string(),
  priority: z.string(),
  steps: z.array(TestStep),
  /**
   * A URL to open before the case runs, instead of navigating to it.
   *
   * Half this suite reaches the player by tapping whatever the feed happens to
   * be showing, which makes the case depend on content that rotates daily. A
   * deep link puts the app where the case is actually about, and is a
   * precondition rather than a step: it is not the thing under test and must
   * not appear in the pass rate.
   */
  deepLink: z.string().optional(),
  /**
   * Step numbers, one-based, that only a screenshot can settle.
   *
   * Accepted alongside the per-step flag because the generator emits the list
   * form; both are folded into the steps below so the runner has one thing to
   * read.
   */
  needs_screenshot_steps: z.array(z.number()).optional(),
  needsScreenshotSteps: z.array(z.number()).optional(),
  deep_link: z.string().optional(),
});

export const TestCase = RawTestCase.transform((testCase) => {
  const flagged = new Set([
    ...(testCase.needs_screenshot_steps ?? []),
    ...(testCase.needsScreenshotSteps ?? []),
  ]);

  return {
    ...testCase,
    deepLink: testCase.deepLink ?? testCase.deep_link,
    steps: testCase.steps.map((step, index) => ({
      ...step,
      needsScreenshot: step.needsScreenshot || flagged.has(index + 1),
    })),
  };
});

export type TestCase = z.infer<typeof TestCase>;

export const SuiteSnapshot = z.object({
  suiteId: z.string(),
  suiteName: z.string(),
  fetchedAt: z.string(),
  cases: z.array(TestCase),
});

export type SuiteSnapshot = z.infer<typeof SuiteSnapshot>;
