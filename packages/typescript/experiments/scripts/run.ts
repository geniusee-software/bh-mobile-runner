/**
 * Runs the experiment matrix against the local simulator.
 *
 * Run: bun experiments/scripts/run.ts --cases 12 --variants baseline,lazy-webview
 */
import { SuiteSnapshot } from "../cases/TestCase.ts";
import { sampleCases } from "../cases/sampleCases.ts";
import { runnableCases } from "../cases/eligibility.ts";
import { PageGraph, PageGraphData } from "../graph/PageGraph.ts";
import { GRAPH_PATH } from "../graph/graphPath.ts";
import { ExpectationHealer } from "../heal/ExpectationHealer.ts";
import { loadResults } from "../report/loadResults.ts";
import { DEVICE } from "../config/device.ts";
import { SUITE_SNAPSHOT_PATH } from "../config/suite.ts";
import { VARIANTS, variantById, type Variant } from "../config/variants.ts";
import { Logger } from "../../src/telemetry/Logger.ts";
import { ExperimentRunner } from "../runner/ExperimentRunner.ts";
import { preflight } from "../runner/preflight.ts";
import { SignIn } from "../runner/SignIn.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";
import { buildTraceSink } from "../trace/buildTraceSink.ts";
import { reportRuns } from "../report/reportRuns.ts";

Logger.level = process.env.BH_LOG_LEVEL ?? "error";

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const caseCount = Number(flag("cases", "12"));
const runLabel = flag("label", new Date().toISOString().slice(0, 16).replace(":", "-"));
const variantIds = flag("variants", "").trim();
const variants: readonly Variant.Props[] = variantIds
  ? variantIds.split(",").map((id) => variantById(id.trim()))
  : VARIANTS;

const snapshot = SuiteSnapshot.parse(
  await Bun.file(SUITE_SNAPSHOT_PATH).json(),
);

// Cases the environment cannot satisfy — pinned to rotated feed content, or
// walking into screens that need a signed-in account — are excluded by default.
// Mixed in, they cap the pass rate at a number that says nothing about the
// runner.
const credentials = SignIn.credentialsFromEnv();
const environment = {
  signedIn: process.argv.includes("--signed-in"),
  hasUsageHistory: process.argv.includes("--used-app"),
};
if (environment.signedIn && !credentials) {
  throw new Error(
    "--signed-in needs BH_APP_EMAIL and BH_APP_PASSWORD; without them the run " +
      "would draw cases the app cannot reach and report their failures as quality.",
  );
}
const eligible = process.argv.includes("--all-cases")
  ? snapshot.cases
  : runnableCases(snapshot.cases, environment);

// Reusing an earlier run's exact case set is what keeps a comparison honest.
// The eligibility rules get sharper as the suite is understood better, and a
// sharper filter changes which cases the sample draws — so two runs a day apart
// can differ by their case set rather than by the thing under test.
const reuseLabel = flag("cases-from", "");
const chosen = reuseLabel
  ? await casesFromRun(reuseLabel)
  : sampleCases(eligible, caseCount);

// A shorter run over the head of an earlier run's case set, for when there is
// time to compare two configurations case by case but not to finish either
// over the whole set. Kept separate from `--cases`, which samples afresh: this
// one may only ever narrow a set that is already pinned.
const limit = Number(flag("limit", "0"));
const cases = limit > 0 ? chosen.slice(0, limit) : chosen;

async function casesFromRun(label: string) {
  const byId = new Map(snapshot.cases.map((testCase) => [testCase.id, testCase]));
  const seen = new Set<string>();
  const reused = [];

  for (const records of (await loadResults(label)).values()) {
    for (const record of records) {
      if (seen.has(record.caseId)) continue;
      seen.add(record.caseId);
      const testCase = byId.get(record.caseId);
      if (testCase) reused.push(testCase);
    }
  }

  if (!reused.length) throw new Error(`No cases recorded under label "${label}"`);
  return reused;
}

console.log(`Suite:    ${snapshot.suiteName}`);
console.log(
  `Cases:    ${cases.length} of ${eligible.length} eligible (${snapshot.cases.length} in suite)${limit > 0 ? ` — first ${limit} of "${reuseLabel}"` : ""}`,
);
console.log(`Variants: ${variants.map((v) => v.id).join(", ")}`);
console.log(`Label:    ${runLabel}`);

// Before the simulator, because an unreachable model turns a run into twenty
// errored cases that read as a pass rate of zero.
await preflight(variants);

const session = new SimulatorSession(DEVICE);
await session.start();

// Signing in is a precondition, not a thing under test: it runs once, before
// any case, and never counts towards a pass rate. Refusing to continue when it
// fails is deliberate — a run that quietly proceeds as a guest reports fifty
// cases as failures of the app.
if (environment.signedIn) {
  await session.relaunchApp();
  const outcome = await new SignIn(session.browser, credentials!).ensureSignedIn();
  console.log(`Sign-in:  ${outcome.detail}`);
  if (!outcome.signedIn) {
    await session.stop();
    throw new Error(`Cannot sign in: ${outcome.detail}`);
  }
}

const traceSink = buildTraceSink(runLabel);
console.log(`Traces:   ${traceSink.name}`);

// Loaded once and shared: the graph is prior knowledge about the app, not
// something a run should be able to change while it is being measured.
const graph = (await Bun.file(GRAPH_PATH).exists())
  ? new PageGraph(PageGraphData.parse(await Bun.file(GRAPH_PATH).json()))
  : undefined;
if (variants.some((v) => v.healExpectations) && !graph) {
  throw new Error(`A healed variant needs a page graph; run crawl.ts first (${GRAPH_PATH})`);
}

const runner = new ExperimentRunner({
  session,
  cases,
  runLabel,
  traceSink,
  platform: "xcuitest",
  app: DEVICE.bundleId,
  healer: graph ? new ExpectationHealer(graph) : undefined,
});
const byVariant = new Map<string, Awaited<ReturnType<typeof runner.runVariant>>>();

try {
  for (const variant of variants) {
    byVariant.set(variant.id, await runner.runVariant(variant));
  }
} finally {
  await session.stop();
}

console.log(`\n${reportRuns(byVariant)}`);
