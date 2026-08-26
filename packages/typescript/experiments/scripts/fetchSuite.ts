/**
 * Snapshots a BugsHunter suite to disk so experiments run against a fixed,
 * versioned set of cases instead of whatever the API returns that minute.
 *
 * Run: BH_TOKEN=... bun experiments/scripts/fetchSuite.ts <suiteId>
 */
import { SuiteSnapshot, type TestCase } from "../cases/TestCase.ts";
import { SUITE_SNAPSHOT_PATH } from "../config/suite.ts";

const API = process.env.BH_API ?? "https://api.stage.bugshunter.ai/api/v1";
const token = process.env.BH_TOKEN;
const suiteId = process.argv[2] ?? process.env.BH_SUITE;

if (!token) throw new Error("BH_TOKEN is required");
if (!suiteId) throw new Error("Pass a suite id as the first argument");

interface ApiStep {
  content?: string;
  expected?: string;
}

interface ApiCase {
  id: string;
  title: string;
  priority?: string;
  references?: string[];
  test_details?: { steps_separated?: ApiStep[] };
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

const [suite, page] = await Promise.all([
  get<{ title?: string; name?: string }>(`/suites/${suiteId}`),
  get<{ items: ApiCase[]; total: number }>(
    `/test_cases/?suite_id=${suiteId}&limit=1000`,
  ),
]);

const cases: TestCase[] = page.items
  .map((apiCase) => ({
    id: apiCase.id,
    title: apiCase.title,
    origin: apiCase.references?.[0] ?? "",
    priority: apiCase.priority ?? "Medium",
    steps: (apiCase.test_details?.steps_separated ?? [])
      .map((step) => ({
        action: (step.content ?? "").trim(),
        expected: (step.expected ?? "").trim(),
      }))
      .filter((step) => step.action.length > 0),
  }))
  // A case with no steps cannot be executed and would only pollute pass rates.
  .filter((testCase) => testCase.steps.length > 0)
  // Stable order makes the deterministic sample reproducible across snapshots.
  .sort((a, b) => a.id.localeCompare(b.id));

const snapshot: SuiteSnapshot = {
  suiteId,
  suiteName: suite.title ?? suite.name ?? suiteId,
  fetchedAt: new Date().toISOString(),
  cases,
};

await Bun.write(
  SUITE_SNAPSHOT_PATH,
  JSON.stringify(SuiteSnapshot.parse(snapshot), null, 2),
);

const skipped = page.items.length - cases.length;
console.log(`Suite:   ${snapshot.suiteName}`);
console.log(`Cases:   ${cases.length} runnable of ${page.total} total`);
if (skipped > 0) console.log(`Skipped: ${skipped} with no steps`);
console.log(`Written: ${SUITE_SNAPSHOT_PATH}`);
