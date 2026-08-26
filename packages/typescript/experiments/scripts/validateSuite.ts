/**
 * Checks the suite against the page graph, before any device time is spent.
 *
 * Run: bun experiments/scripts/validateSuite.ts
 */
import { SuiteSnapshot } from "../cases/TestCase.ts";
import { runnableCases } from "../cases/eligibility.ts";
import { SUITE_SNAPSHOT_PATH } from "../config/suite.ts";
import { PageGraph, PageGraphData } from "../graph/PageGraph.ts";
import { GRAPH_PATH } from "../graph/graphPath.ts";
import { CaseValidator } from "../heal/CaseValidator.ts";
import { ExpectationHealer } from "../heal/ExpectationHealer.ts";

const snapshot = SuiteSnapshot.parse(await Bun.file(SUITE_SNAPSHOT_PATH).json());
const graph = new PageGraph(
  PageGraphData.parse(await Bun.file(GRAPH_PATH).json()),
);

const cases = runnableCases(snapshot.cases, {
  signedIn: process.argv.includes("--signed-in"),
  hasUsageHistory: process.argv.includes("--used-app"),
});

const validator = new CaseValidator(graph);
const healer = new ExpectationHealer(graph);

const tally = { ok: 0, "names-nothing": 0, "names-the-unknown": 0, "no-expectation": 0 };
let healedSteps = 0;
let healableCases = 0;
const unknownLabels = new Map<string, number>();

for (const testCase of cases) {
  for (const step of validator.validate(testCase).steps) {
    tally[step.verdict] += 1;
    for (const label of step.unknown) {
      unknownLabels.set(label, (unknownLabels.get(label) ?? 0) + 1);
    }
  }

  const healed = healer.heal(testCase);
  healedSteps += healed.healedSteps;
  if (healed.healedSteps) healableCases += 1;
}

const steps = Object.values(tally).reduce((a, b) => a + b, 0);
const share = (n: number) => `${Math.round((n / Math.max(steps, 1)) * 100)}%`;

console.log(`Graph:  ${graph.screens.length} screens, ${graph.edges.length} edges`);
console.log(`Cases:  ${cases.length} runnable, ${steps} steps\n`);
console.log(`  ${String(tally.ok).padStart(4)}  ${share(tally.ok).padStart(4)}  names a label the app really has`);
console.log(`  ${String(tally["names-nothing"]).padStart(4)}  ${share(tally["names-nothing"]).padStart(4)}  names nothing checkable`);
console.log(`  ${String(tally["names-the-unknown"]).padStart(4)}  ${share(tally["names-the-unknown"]).padStart(4)}  names a label no screen has ever shown`);
console.log(`  ${String(tally["no-expectation"]).padStart(4)}  ${share(tally["no-expectation"]).padStart(4)}  has no expectation at all`);

console.log(`\nHealer would rewrite ${healedSteps} steps across ${healableCases} cases.`);

if (unknownLabels.size) {
  console.log("\nLabels the case quotes but the app never showed:");
  for (const [label, count] of [...unknownLabels].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(count).padStart(3)}x  ${label.slice(0, 62)}`);
  }
}
