import type { TestCase } from "./TestCase.ts";

/**
 * Picks a fixed subset of the suite, spread evenly across it.
 *
 * Every variant must see the same cases or the comparison is meaningless, and
 * the whole suite is far too slow to run per variant on one simulator. Cases
 * are drawn at a constant stride over the id-sorted list rather than at random,
 * so the sample is reproducible and still spans the alphabet of screens the
 * generator covered instead of clustering on the first few.
 */
export function sampleCases(
  cases: readonly TestCase[],
  size: number,
): TestCase[] {
  if (size >= cases.length) return [...cases];

  const stride = cases.length / size;
  const picked: TestCase[] = [];
  for (let index = 0; index < size; index++) {
    const testCase = cases[Math.floor(index * stride)];
    if (testCase) picked.push(testCase);
  }
  return picked;
}
