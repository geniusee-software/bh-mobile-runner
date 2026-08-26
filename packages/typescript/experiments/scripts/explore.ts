/**
 * Walks the app and dumps the accessibility tree at each stop.
 *
 * Cases are only as good as the words they assert on: the suite's first run
 * failed four of seven times because expected results named things the tree
 * never exposes. This prints what the tree actually says so cases can be
 * written against it.
 *
 * Run: bun experiments/scripts/explore.ts
 */
import { XCUITestAccessibilityTree } from "../../src/accessibility/XCUITestAccessibilityTree.ts";
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const session = new SimulatorSession(DEVICE);
const browser = await session.start();

const INTERESTING_TYPE =
  /Button|StaticText|TextField|SearchField|Cell|Link|SecureText|Switch|Tab/;

/** Condense the tree to the labels a test could assert on. */
function interactables(xml: string): string[] {
  const found: string[] = [];

  for (const tag of xml.matchAll(/<(XCUIElementType\w+)([^>]*)>/g)) {
    const [, type, attrs] = tag;
    if (!type || !attrs || !INTERESTING_TYPE.test(type)) continue;

    const attr = (key: string) =>
      new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1] ?? "";
    const visible = attr("visible") !== "false";
    if (!visible) continue;

    const text = [attr("name"), attr("label"), attr("value")]
      .filter(Boolean)
      .filter((part, index, all) => all.indexOf(part) === index)
      .join(" | ");
    if (!text) continue;

    const entry = `${type.replace("XCUIElementType", "")}: ${text}`;
    if (!found.includes(entry)) found.push(entry);
  }
  return found;
}

async function dump(stop: string): Promise<void> {
  await Bun.sleep(2500);
  const source = await browser.getPageSource();
  const tree = new XCUITestAccessibilityTree(source);
  console.log(`\n${"=".repeat(70)}\n## ${stop}`);
  console.log(`   (${source.length} chars, webview: ${tree.containsWebview()})`);
  for (const line of interactables(source)) console.log(`   ${line}`);
}

async function tap(label: string): Promise<boolean> {
  const element = browser.$(
    `-ios predicate string:name == "${label}" OR label == "${label}"`,
  );
  if (!(await element.isExisting())) {
    console.log(`\n   [tap "${label}" -> not found]`);
    return false;
  }
  await element.click();
  return true;
}

await dump("01 launch (intro carousel)");

if (await tap("Skip and explore the app")) {
  await dump("02 after Skip and explore");
}

// The tab bar is the spine of the guest flow; visit each tab in turn.
for (const tab of ["Search", "Highlights", "Donate", "Home"]) {
  if (await tap(tab)) await dump(`03 tab: ${tab}`);
}

await session.stop();
console.log("\nExploration done");
