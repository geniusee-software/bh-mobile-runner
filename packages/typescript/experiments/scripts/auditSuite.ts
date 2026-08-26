/**
 * Reports how much of the suite is still runnable today.
 *
 * Run: bun experiments/scripts/auditSuite.ts
 */
import { SuiteSnapshot } from "../cases/TestCase.ts";
import { eligibilityOf } from "../cases/eligibility.ts";
import { SUITE_SNAPSHOT_PATH } from "../config/suite.ts";

const snapshot = SuiteSnapshot.parse(
  await Bun.file(SUITE_SNAPSHOT_PATH).json(),
);

const environment = { signedIn: process.argv.includes("--signed-in") };
const verdicts = snapshot.cases.map((testCase) => ({
  testCase,
  verdict: eligibilityOf(testCase, environment),
}));

const volatile = verdicts.filter((row) => !row.verdict.runnable);
const stable = verdicts.filter((row) => row.verdict.runnable);

const byReason = new Map<string, number>();
for (const row of volatile) {
  for (const reason of row.verdict.reasons) {
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
}

console.log(`Suite:    ${snapshot.suiteName}`);
console.log(`Snapshot: ${snapshot.fetchedAt}`);
console.log(`Cases:    ${snapshot.cases.length}\n`);

const share = (n: number) => `${Math.round((n / snapshot.cases.length) * 100)}%`;
console.log(`  runnable ${String(stable.length).padStart(3)}  ${share(stable.length)}`);
console.log(`  blocked  ${String(volatile.length).padStart(3)}  ${share(volatile.length)}  — the environment cannot satisfy them`);

console.log("\nWhy cases are blocked:");
for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${reason}`);
}

console.log("\nExamples of blocked cases:");
for (const row of volatile.slice(0, 5)) {
  console.log(`  - ${row.testCase.title.slice(0, 70)}`);
  console.log(`      ${row.verdict.reasons.join(", ")}`);
}

console.log("\nExamples of runnable cases:");
for (const row of stable.slice(0, 8)) {
  console.log(`  - ${row.testCase.title.slice(0, 70)}`);
}
