/**
 * Finds the shallowest snapshot depth that still exposes the controls a test
 * needs to touch.
 *
 * Depth trades latency and prompt size against coverage, and the trade is
 * app-specific: the cliff sits wherever that app stops nesting layout and
 * starts nesting content. Guessing it wrong is silent — the tree simply
 * arrives without the button the case asks for.
 *
 * Run: bun experiments/scripts/probeDepth.ts
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

/** Controls a case is likely to reference on the app's main screens. */
const LANDMARKS = [
  "RECOMMENDED",
  "DAILY SHIURIM",
  "Home",
  "Search",
  "Highlights",
  "Donate",
  "notification",
  "avatar",
];

const session = new SimulatorSession({ ...DEVICE, tuneSnapshots: false });
const browser = await session.start();

console.log("depth   time    chars    landmarks found");

for (const depth of [16, 18, 20, 22, 24, 26, 28, 50]) {
  await browser.updateSettings({
    waitForIdleTimeout: 0,
    animationCoolOffTimeout: 0,
    snapshotMaxDepth: depth,
  });

  const startedAt = performance.now();
  const source = await browser.getPageSource();
  const seconds = (performance.now() - startedAt) / 1000;

  const found = LANDMARKS.filter((landmark) => source.includes(landmark));
  console.log(
    `${String(depth).padStart(5)}  ${seconds.toFixed(1).padStart(5)}s  ${String(source.length).padStart(7)}  ` +
      `${found.length}/${LANDMARKS.length}  ${found.join(", ")}`,
  );
}

await session.stop();
