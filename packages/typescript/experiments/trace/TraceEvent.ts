import z from "zod";

/**
 * One model decision, recorded with everything needed to learn from it later.
 *
 * This is the unit a fine-tune would train on: the screen as the model saw it,
 * the instruction it was given, the tool call it produced, and — crucially —
 * whether the step it belonged to went on to pass. Traces without that last
 * field are just logs; with it they are labelled examples.
 */
export const TraceEvent = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  recordedAt: z.string(),

  /** Which agent produced the decision. */
  agent: z.string(),
  model: z.string(),
  platform: z.string(),
  app: z.string(),

  caseId: z.string(),
  caseTitle: z.string(),
  stepIndex: z.number().int(),
  instruction: z.string(),
  expected: z.string(),

  /** Accessibility tree exactly as it was serialised into the prompt. */
  treeXml: z.string(),
  /** Tool calls the model returned. */
  toolCalls: z.array(
    z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }),
  ),

  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),

  /**
   * Whether the step this decision belonged to ended up passing.
   *
   * Filled in after the step resolves, which is why events are written at the
   * end of a case rather than as they happen.
   */
  stepPassed: z.boolean(),
  /** True when a stronger model had to rescue the step — the highest-value examples. */
  escalated: z.boolean(),
});

export type TraceEvent = z.infer<typeof TraceEvent>;

/** Where trace events go. Implementations may batch, but must not lose events. */
export interface TraceSink {
  readonly name: string;
  write(events: readonly TraceEvent[]): Promise<void>;
}
