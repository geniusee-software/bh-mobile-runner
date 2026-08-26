/**
 * Collects every recorded run into one table.
 *
 * Each experiment writes its own folder; this reads them all so the headline
 * numbers come from the records rather than from whoever is transcribing them.
 *
 * Run: bun experiments/scripts/summary.ts [label...]
 */
import type { RunRecord } from "../metrics/RunRecord.ts";
import { label as labelFor, taxonomyFor } from "../report/failureTaxonomy.ts";
import { listLabels, loadResults } from "../report/loadResults.ts";

interface Row {
  run: string;
  cases: number;
  casesPassed: number;
  steps: number;
  stepsPassed: number;
  meanSec: number;
  callsPerCase: number;
  costPerCase: number;
  totalCost: number;
}

function toRow(run: string, records: RunRecord.Case[]): Row {
  const n = Math.max(records.length, 1);
  const sum = (pick: (r: RunRecord.Case) => number) =>
    records.reduce((total, r) => total + pick(r), 0);

  return {
    run,
    cases: records.length,
    casesPassed: records.filter((r) => r.verdict === "passed").length,
    steps: sum((r) => r.stepsTotal),
    stepsPassed: sum((r) => r.stepsPassed),
    meanSec: sum((r) => r.durationMs) / n / 1000,
    callsPerCase: sum((r) => r.llmCalls) / n,
    costPerCase: sum((r) => r.costUsd) / n,
    totalCost: sum((r) => r.costUsd),
  };
}

const labels = process.argv.slice(2).length
  ? process.argv.slice(2)
  : await listLabels();

const rows: Row[] = [];
const allRecords: RunRecord.Case[] = [];

for (const label of labels) {
  for (const [variant, records] of await loadResults(label)) {
    if (!records.length) continue;
    rows.push(toRow(`${label}/${variant}`, records));
    allRecords.push(...records);
  }
}

const columns: ReadonlyArray<[string, (row: Row) => string]> = [
  ["run", (r) => r.run],
  ["cases", (r) => `${r.casesPassed}/${r.cases}`],
  ["steps", (r) => `${r.stepsPassed}/${r.steps}`],
  ["step %", (r) => `${Math.round((r.stepsPassed / Math.max(r.steps, 1)) * 100)}%`],
  ["mean s", (r) => r.meanSec.toFixed(0)],
  ["calls", (r) => r.callsPerCase.toFixed(1)],
  ["$/case", (r) => r.costPerCase.toFixed(4)],
];

const table = [
  columns.map(([header]) => header),
  ...rows.map((row) => columns.map(([, render]) => render(row))),
];
const widths = table[0]!.map((_, i) => Math.max(...table.map((r) => r[i]!.length)));
const line = (cells: string[]) =>
  cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ");

console.log(line(table[0]!));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of table.slice(1)) console.log(line(row));

console.log(
  `\nTotal spend across every recorded run: $${rows.reduce((sum, r) => sum + r.totalCost, 0).toFixed(2)}`,
);

const failures = taxonomyFor(allRecords);
const failureTotal = failures.reduce((sum, bucket) => sum + bucket.count, 0);
console.log(`\nFailed steps across all runs: ${failureTotal}`);
for (const bucket of failures) {
  const share = Math.round((bucket.count / Math.max(failureTotal, 1)) * 100);
  console.log(`  ${String(bucket.count).padStart(3)} (${String(share).padStart(3)}%)  ${labelFor(bucket.kind)}`);
}
