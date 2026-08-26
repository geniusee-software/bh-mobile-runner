import z from "zod";

/**
 * One model decision captured during a run, with the label that makes it
 * trainable: whether the step it belonged to went on to pass.
 *
 * The schema is duplicated rather than imported from the runner on purpose —
 * this service is deployed separately and must be able to reject malformed
 * input on its own terms, without taking a dependency on the client that
 * happens to be sending it.
 */
export const TraceEvent = z.object({
  runId: z.string().min(1).max(128),
  seq: z.number().int().nonnegative(),
  recordedAt: z.string().min(1),

  agent: z.string().max(64),
  model: z.string().max(256),
  platform: z.string().max(64),
  app: z.string().max(256),

  caseId: z.string().max(128),
  caseTitle: z.string().max(512),
  stepIndex: z.number().int(),
  instruction: z.string().max(8192),
  expected: z.string().max(8192),

  treeXml: z.string().max(2_000_000),
  toolCalls: z.array(
    z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }),
  ),

  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),

  stepPassed: z.boolean(),
  escalated: z.boolean(),
});

export type TraceEvent = z.infer<typeof TraceEvent>;

export const IngestRequest = z.object({
  events: z.array(TraceEvent).min(1).max(500),
});

export type IngestRequest = z.infer<typeof IngestRequest>;

/**
 * A training example in the shape a supervised fine-tune consumes.
 *
 * Derived from a trace rather than stored alongside it, so the export format
 * can change without a migration of everything already collected.
 */
export interface TrainingExample {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  metadata: {
    runId: string;
    caseId: string;
    model: string;
    escalated: boolean;
  };
}
