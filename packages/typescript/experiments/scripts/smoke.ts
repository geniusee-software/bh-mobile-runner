/**
 * Verifies the device channel end to end: Appium session, app launch, tree
 * fetch, and the cost of the context scan that `check()`/`get()` pay twice.
 *
 * Run: bun experiments/scripts/smoke.ts
 */
import { XCUITestAccessibilityTree } from "../../src/accessibility/XCUITestAccessibilityTree.ts";
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - startedAt);
  console.log(`  ${label}: ${ms}ms`);
  return value;
}

const session = new SimulatorSession(DEVICE);

console.log("Opening Appium session...");
const browser = await timed("session", () => session.start());
console.log(`  sessionId: ${browser.sessionId}`);

const source = await timed("getPageSource #1", () => browser.getPageSource());
console.log(`  page source: ${source.length} chars`);

await timed("getPageSource #2", () => browser.getPageSource());

const contexts = await timed(
  "getAppiumContexts (webview scan)",
  async () => (await browser.getAppiumContexts()) as string[],
);
console.log(`  contexts: ${JSON.stringify(contexts)}`);

await timed("screenshot", () => browser.takeScreenshot());

const tree = new XCUITestAccessibilityTree(source);
const xml = tree.toXml(new Set());
console.log(`  tree xml: ${xml.length} chars`);
console.log("\n--- tree head ---");
console.log(xml.slice(0, 1500));

await session.stop();
console.log("\nSmoke OK");
