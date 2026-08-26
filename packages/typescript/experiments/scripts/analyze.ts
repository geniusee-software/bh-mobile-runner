/**
 * Turns a run label's records into the comparison and the failure breakdown.
 *
 * Run: bun experiments/scripts/analyze.ts <label>
 */
import { label as labelFor, taxonomyFor } from "../report/failureTaxonomy.ts";
import { loadResults } from "../report/loadResults.ts";
import { reportRuns } from "../report/reportRuns.ts";
import {
  auditablePasses,
  overturnedSteps,
  suspectPasses,
} from "../report/suspectPasses.ts";

const runLabel = process.argv[2];
if (!runLabel) {
  throw new Error("Pass a run label, e.g. `bun experiments/scripts/analyze.ts judge`");
}

const byVariant = await loadResults(runLabel);
if (!byVariant.size) throw new Error(`No results under label "${runLabel}"`);

console.log(reportRuns(byVariant));

for (const [variantId, records] of byVariant) {
  const suspects = suspectPasses(records);
  if (suspects.length) {
    const auditable = auditablePasses(records);
    console.log(
      `\n--- ${variantId}: ${suspects.length} of ${auditable} auditable passes look wrong ---`,
    );
    for (const suspect of suspects) {
      console.log(`  step ${suspect.stepIndex} of "${suspect.caseTitle.slice(0, 44)}"`);
      console.log(`    expected: ${suspect.expected.slice(0, 90)}`);
      console.log(`    not on screen: ${suspect.missing.join(", ")}`);
    }
  }

  const overturned = overturnedSteps(records);
  if (overturned.length) {
    console.log(
      `\n--- ${variantId}: ${overturned.length} passes came from a second opinion ---`,
    );
    for (const step of overturned) {
      console.log(`  granted by ${step.by}: ${step.expected.slice(0, 88)}`);
    }
  }

  const failures = taxonomyFor(records);
  if (!failures.length) continue;

  const total = failures.reduce((sum, bucket) => sum + bucket.count, 0);
  console.log(`\n--- ${variantId}: ${total} failed steps ---`);
  for (const bucket of failures) {
    const share = Math.round((bucket.count / total) * 100);
    console.log(
      `  ${String(bucket.count).padStart(3)} (${String(share).padStart(3)}%)  ${labelFor(bucket.kind)}`,
    );
    for (const example of bucket.examples) console.log(`        ${example}`);
  }
}
