/**
 * Asks the verifier a question about the screen as it is right now, and shows
 * what it was given to answer with.
 *
 * When a check fails on a screen that visibly satisfies it, the cause is either
 * a tree that never carried the answer or a model that had it and said no.
 * Printing both sides settles it in one run.
 *
 * Run: bun experiments/scripts/probeCheck.ts "the RECOMMENDED tab is active"
 */
import { Alumni } from "../../src/client/Alumni.ts";
import { AppiumDriver } from "../../src/drivers/AppiumDriver.ts";
import { Model } from "../../src/Model.ts";
import { Logger } from "../../src/telemetry/Logger.ts";
import { ServerXCUITestAccessibilityTree } from "../../src/server/accessibility/ServerXCUITestAccessibilityTree.ts";
import { XCUITestAccessibilityTree } from "../../src/accessibility/XCUITestAccessibilityTree.ts";
import { DEVICE } from "../config/device.ts";
import { MODELS } from "../config/models.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

Logger.level = "error";

const question =
  process.argv[2] ??
  "The RECOMMENDED tab is active and a list of shiur cards is visible on screen.";

const session = new SimulatorSession(DEVICE);
const browser = await session.start();

const source = await browser.getPageSource();
const clientTree = new XCUITestAccessibilityTree(source);
const serverTree = new ServerXCUITestAccessibilityTree(clientTree.toStr());
const xml = serverTree.toXml(new Set(["id"]));

console.log(`raw page source: ${source.length} chars`);
console.log(`tree sent to the model: ${xml.length} chars\n`);
console.log("--- first 3000 chars of what the model sees ---");
console.log(xml.slice(0, 3000));
console.log("\n--- does the tree mention the words in the question? ---");
for (const word of question.split(/\s+/).filter((w) => w.length > 4)) {
  const bare = word.replace(/[^A-Za-z0-9]/g, "");
  if (!bare) continue;
  console.log(`  ${bare.padEnd(18)} ${xml.toLowerCase().includes(bare.toLowerCase()) ? "present" : "MISSING"}`);
}

const alumni = new Alumni(browser, {
  model: Model.parse(MODELS.haiku),
  planner: false,
});
(alumni.driver as AppiumDriver).lazyWebviewContexts = true;

console.log(`\n--- asking: ${question}`);
try {
  const explanation = await alumni.check(question);
  console.log(`PASS: ${explanation.slice(0, 400)}`);
} catch (error) {
  console.log(`FAIL: ${error instanceof Error ? error.message.slice(0, 700) : error}`);
}

await session.stop();
