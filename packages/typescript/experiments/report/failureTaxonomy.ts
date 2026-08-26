import type { RunRecord } from "../metrics/RunRecord.ts";

export namespace FailureTaxonomy {
  export type Kind =
    | "driver"
    | "unverifiable-expectation"
    | "wrong-screen"
    | "model-judgement";

  export interface Bucket {
    kind: Kind;
    count: number;
    examples: string[];
  }
}

const LABELS: Record<FailureTaxonomy.Kind, string> = {
  driver: "driver/device error",
  "unverifiable-expectation": "expectation not on screen (case or prior step)",
  "wrong-screen": "action left the app somewhere else",
  "model-judgement": "answer was on screen, model said no",
};

/**
 * Sorts failures by who is at fault.
 *
 * Pass rate alone cannot tell a model that misreads a correct screen from a
 * case that asks about a screen the app never shows, and the two lead to
 * opposite decisions: one is worth training budget, the other is worth an
 * afternoon of editing the suite. The evidence probe captured at failure time
 * is what separates them.
 */
export function classify(step: RunRecord.Step): FailureTaxonomy.Kind {
  if (step.verdict === "errored") return "driver";

  const evidence = step.evidence;
  if (!evidence) return "model-judgement";

  if (evidence.quoted.length === 0) {
    // Nothing quotable to look for; the model was asked for a judgement call.
    return "model-judgement";
  }
  if (evidence.present.length === 0) {
    // None of the expected words are anywhere on screen: the app is elsewhere.
    return "wrong-screen";
  }
  if (evidence.missing.length > 0) {
    return "unverifiable-expectation";
  }
  return "model-judgement";
}

export function taxonomyFor(
  records: readonly RunRecord.Case[],
): FailureTaxonomy.Bucket[] {
  const buckets = new Map<FailureTaxonomy.Kind, FailureTaxonomy.Bucket>();

  for (const record of records) {
    for (const step of record.steps) {
      if (step.verdict === "passed") continue;
      const kind = classify(step);
      const bucket = buckets.get(kind) ?? { kind, count: 0, examples: [] };
      bucket.count += 1;
      if (bucket.examples.length < 3) {
        bucket.examples.push(
          `${record.caseTitle.slice(0, 44)} — step ${step.index}: ${step.expected.slice(0, 80)}`,
        );
      }
      buckets.set(kind, bucket);
    }
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

export function label(kind: FailureTaxonomy.Kind): string {
  return LABELS[kind];
}
