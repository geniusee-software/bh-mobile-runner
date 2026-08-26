/**
 * Compares two recorded runs step by step.
 *
 * Run: bun experiments/scripts/compare.ts fullset visible [variant]
 */
import { compareRuns, reportComparison } from "../report/compareRuns.ts";
import { loadResults } from "../report/loadResults.ts";

const [beforeLabel, afterLabel, variantId] = process.argv.slice(2);
if (!beforeLabel || !afterLabel) {
  throw new Error("usage: compare.ts <before-label> <after-label> [variant]");
}

const pick = async (label: string) => {
  const byVariant = await loadResults(label);
  const chosen = variantId
    ? byVariant.get(variantId)
    : [...byVariant.values()][0];
  if (!chosen?.length) {
    throw new Error(
      `No records for "${label}"${variantId ? ` variant "${variantId}"` : ""}`,
    );
  }
  return chosen;
};

console.log(
  reportComparison(
    compareRuns(await pick(beforeLabel), await pick(afterLabel)),
    { before: beforeLabel, after: afterLabel },
  ),
);
