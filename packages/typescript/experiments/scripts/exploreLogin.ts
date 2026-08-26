/**
 * Prints the controls on the way from a cold launch to a signed-in session.
 *
 * Signing in is a precondition, not a thing under test, so it is driven by
 * fixed selectors rather than by the agent — which means the selectors have to
 * be read off the real screens first.
 *
 * Run: bun experiments/scripts/exploreLogin.ts
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const session = new SimulatorSession(DEVICE);
const browser = await session.start();

const INTERESTING =
  /Button|StaticText|TextField|SecureTextField|SearchField|Switch/;

async function dump(stop: string): Promise<void> {
  await Bun.sleep(2000);
  const source = await browser.getPageSource();
  console.log(`\n${"=".repeat(66)}\n## ${stop}  (${source.length} chars)`);

  const seen = new Set<string>();
  for (const tag of source.matchAll(/<(XCUIElementType\w+)([^>]*)>/g)) {
    const [, type, attrs] = tag;
    if (!type || !attrs || !INTERESTING.test(type)) continue;
    const attr = (key: string) =>
      new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1] ?? "";
    if (attr("visible") === "false") continue;

    const text = [attr("name"), attr("label"), attr("value")]
      .filter(Boolean)
      .filter((v, i, all) => all.indexOf(v) === i)
      .join(" | ");
    if (!text) continue;

    const line = `${type.replace("XCUIElementType", "").padEnd(16)} ${text}`;
    if (!seen.has(line)) {
      seen.add(line);
      console.log(`   ${line}`);
    }
  }
}

async function tap(label: string): Promise<boolean> {
  const element = browser.$(
    `-ios predicate string:name == "${label}" OR label == "${label}"`,
  );
  if (!(await element.isExisting())) {
    console.log(`   [no control named "${label}"]`);
    return false;
  }
  await element.click();
  return true;
}

// Start from a cold app so the first screen is the one a run actually meets.
await browser.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
await browser.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });

await dump("01 cold launch");
if (await tap("avatar")) await dump("02 after avatar");
for (const label of ["Log In", "LOG IN", "Login"]) {
  if (await tap(label)) {
    await dump(`03 after ${label}`);
    break;
  }
}

await session.stop();
