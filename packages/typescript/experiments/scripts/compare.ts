/**
 * Compares two recorded runs step by step.
 *
 * Run: bun experiments/scripts/compare.ts fullset:split-roles best:best
 *
 * Each argument is a run label, optionally with the variant to read from it.
 * The variant is named per label rather than once for both, because the
 * interesting comparisons are between different configurations — a single
 * variant id would only ever compare a configuration against itself.
 */
import { compareRuns, reportComparison } from "../report/compareRuns.ts";
import { loadResults } from "../report/loadResults.ts";

const args = process.argv.slice(2);
if (args.length < 2) {
  throw new Error(
    "usage: compare.ts <before-label[:variant]> <after-label[:variant]>",
  );
}

const pick = async (spec: string) => {
  const [label, variantId] = spec.split(":");
  if (!label) throw new Error(`Unreadable run spec "${spec}"`);

  const byVariant = await loadResults(label);
  const available = [...byVariant.keys()];

  if (!variantId && available.length > 1) {
    throw new Error(
      `"${label}" holds ${available.length} variants (${available.join(", ")}); name one as ${label}:<variant>`,
    );
  }

  const records = variantId ? byVariant.get(variantId) : byVariant.get(available[0]!);
  if (!records?.length) {
    throw new Error(
      `No records for "${label}"${variantId ? ` variant "${variantId}"` : ""}. Available: ${available.join(", ") || "none"}`,
    );
  }
  return { records, name: `${label}:${variantId ?? available[0]}` };
};

const before = await pick(args[0]!);
const after = await pick(args[1]!);

console.log(
  reportComparison(compareRuns(before.records, after.records), {
    before: before.name,
    after: after.name,
  }),
);
