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
});

export type TestStep = z.infer<typeof TestStep>;

export const TestCase = z.object({
  id: z.string(),
  title: z.string(),
  /** Screen the generator derived this case from, e.g. "device map: August". */
  origin: z.string(),
  priority: z.string(),
  steps: z.array(TestStep),
});

export type TestCase = z.infer<typeof TestCase>;

export const SuiteSnapshot = z.object({
  suiteId: z.string(),
  suiteName: z.string(),
  fetchedAt: z.string(),
  cases: z.array(TestCase),
});

export type SuiteSnapshot = z.infer<typeof SuiteSnapshot>;
