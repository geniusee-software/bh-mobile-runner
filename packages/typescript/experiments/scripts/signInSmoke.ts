/**
 * Verifies that the deterministic sign-in works before a run depends on it.
 *
 * Run: BH_APP_EMAIL=... BH_APP_PASSWORD=... bun experiments/scripts/signInSmoke.ts
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";
import { SignIn } from "../runner/SignIn.ts";

const credentials = SignIn.credentialsFromEnv();
if (!credentials) {
  throw new Error("Set BH_APP_EMAIL and BH_APP_PASSWORD");
}

const session = new SimulatorSession(DEVICE);
const browser = await session.start();

// Start cold so the smoke exercises the same path a run will.
await browser.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
await browser.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });

const startedAt = performance.now();
const result = await new SignIn(browser, credentials).ensureSignedIn();
const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);

console.log(`${result.signedIn ? "SIGNED IN" : "FAILED"} in ${seconds}s — ${result.detail}`);

// Show what the app looks like afterwards, so a false positive is visible.
const source = await browser.getPageSource();
const labels = [
  ...new Set(
    [...source.matchAll(/name="([^"]{2,40})"/g)].map((match) => match[1]!),
  ),
].slice(0, 25);
console.log(`\nControls on screen now: ${labels.join(", ")}`);

await session.stop();
process.exit(result.signedIn ? 0 : 1);
