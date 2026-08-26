import type { RunRecord } from "../metrics/RunRecord.ts";

export namespace FailureTaxonomy {
  export type Kind =
    | "driver"
    | "wrong-screen"
    | "partly-present"
    | "prose-expectation"
    | "model-judgement"
    | "unclassified";

  export interface Bucket {
    kind: Kind;
    count: number;
    examples: string[];
  }
}

const LABELS: Record<FailureTaxonomy.Kind, string> = {
  driver: "driver or device refused the action",
  "wrong-screen": "nothing the case named was on screen — the app is elsewhere",
  "partly-present": "some of what the case named was on screen, not all",
  "prose-expectation": "expectation names no concrete element; it is a judgement call",
  "model-judgement": "everything the case named was on screen, model still said no",
  unclassified: "failed before evidence could be captured",
};

/**
 * Sorts a failed step by who is at fault.
 *
 * A pass rate cannot tell a model that misread a correct screen from a case
 * that asks about a screen the app never showed, and the two lead to opposite
 * decisions: one is worth training budget, the other an afternoon of editing
 * the suite. The evidence captured at failure time — which of the literals the
 * expectation quoted were actually in the tree — is what separates them.
 *
 * The largest bucket in practice is neither: expectations written as prose
 * ("a horizontal date strip with multiple day buttons") name nothing a string
 * match can find, so they turn on how generously the verifier reads them. That
 * is a property of the suite's phrasing and of the verification prompt, and
 * attributing it to the model would point the next fix at the wrong place.
 */
export function classify(step: RunRecord.Step): FailureTaxonomy.Kind {
  if (step.verdict === "errored") return "driver";

  const evidence = step.evidence;
  if (!evidence) return "unclassified";
  if (evidence.quoted.length === 0) return "prose-expectation";
  if (evidence.present.length === 0) return "wrong-screen";
  if (evidence.missing.length > 0) return "partly-present";
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
