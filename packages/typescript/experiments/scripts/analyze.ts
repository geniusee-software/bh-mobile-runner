/**
 * Turns a run label's JSONL into the comparison and the failure breakdown.
 *
 * Run: bun experiments/scripts/analyze.ts <label>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { RESULTS_DIR } from "../config/suite.ts";
import type { RunRecord } from "../metrics/RunRecord.ts";
import { label as labelFor, taxonomyFor } from "../report/failureTaxonomy.ts";
import { reportRuns } from "../report/reportRuns.ts";

const runLabel = process.argv[2];
if (!runLabel) throw new Error("Pass a run label, e.g. `bun ... analyze.ts diag`");

const dir = path.join(RESULTS_DIR, runLabel);
const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".jsonl"));

const byVariant = new Map<string, RunRecord.Case[]>();
for (const file of files) {
  const text = await Bun.file(path.join(dir, file)).text();
  const records = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunRecord.Case);
  byVariant.set(path.basename(file, ".jsonl"), records);
}

console.log(reportRuns(byVariant));

for (const [variantId, records] of byVariant) {
  const failures = taxonomyFor(records);
  if (!failures.length) continue;

  const total = failures.reduce((sum, bucket) => sum + bucket.count, 0);
  console.log(`\n--- ${variantId}: ${total} failed steps ---`);
  for (const bucket of failures) {
    const share = Math.round((bucket.count / total) * 100);
    console.log(`  ${String(bucket.count).padStart(3)} (${String(share).padStart(3)}%)  ${labelFor(bucket.kind)}`);
    for (const example of bucket.examples) console.log(`        ${example}`);
  }
}
