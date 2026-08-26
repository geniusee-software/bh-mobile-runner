/**
 * Measures what one accessibility snapshot costs under different settings.
 *
 * Snapshot time dominates a mobile step on content-heavy screens, so it is
 * worth knowing which knob actually moves it before tuning blind.
 *
 * Run: bun experiments/scripts/probeSnapshot.ts
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const session = new SimulatorSession({ ...DEVICE, tuneSnapshots: false });
const browser = await session.start();

async function measure(label: string, settings: Record<string, unknown>) {
  await browser.updateSettings(settings);
  const samples: number[] = [];
  let size = 0;

  for (let i = 0; i < 3; i++) {
    const startedAt = performance.now();
    const source = await browser.getPageSource();
    samples.push(performance.now() - startedAt);
    size = source.length;
  }

  const best = Math.min(...samples);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(
    `${label.padEnd(34)} mean ${(mean / 1000).toFixed(1)}s  best ${(best / 1000).toFixed(1)}s  ${size} chars`,
  );
}

console.log("Screen under test: whatever the app currently shows\n");

await measure("stock", {
  waitForIdleTimeout: 10,
  animationCoolOffTimeout: 2,
  snapshotMaxDepth: 50,
});
await measure("no idle wait", {
  waitForIdleTimeout: 0,
  animationCoolOffTimeout: 0,
  snapshotMaxDepth: 50,
});
await measure("no idle wait + depth 30", {
  waitForIdleTimeout: 0,
  animationCoolOffTimeout: 0,
  snapshotMaxDepth: 30,
});
await measure("no idle wait + depth 20", {
  waitForIdleTimeout: 0,
  animationCoolOffTimeout: 0,
  snapshotMaxDepth: 20,
});
await measure("no idle wait + depth 12", {
  waitForIdleTimeout: 0,
  animationCoolOffTimeout: 0,
  snapshotMaxDepth: 12,
});

await session.stop();
