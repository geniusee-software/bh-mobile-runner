/**
 * Emits a run label's results as HTML table rows.
 *
 * Report tables are the one place a number can quietly become wrong through
 * retyping, so they are generated from the records instead.
 *
 * Run: bun experiments/scripts/tableRows.ts <label>
 */
import { loadResults } from "../report/loadResults.ts";
import { summarise } from "../report/reportRuns.ts";

const runLabel = process.argv[2];
if (!runLabel) throw new Error("Pass a run label");

const byVariant = await loadResults(runLabel);

for (const [variantId, records] of byVariant) {
  const s = summarise(variantId, records);
  const stepShare = Math.round((s.stepsPassed / Math.max(s.stepsTotal, 1)) * 100);

  console.log(
    `    <tr><td class="k">${variantId}</td>` +
      `<td class="n">${s.stepsPassed}/${s.stepsTotal} (${stepShare}%)</td>` +
      `<td class="n">${s.medianCaseSec.toFixed(0)} с</td>` +
      `<td class="n">$${s.costPerCase.toFixed(4)}</td>` +
      `<td class="n">${s.llmCallsPerCase.toFixed(1)}</td></tr>`,
  );
}
