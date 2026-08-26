/**
 * Walks the app and writes what it finds into the page graph.
 *
 * Run: bun experiments/scripts/crawl.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DEVICE } from "../config/device.ts";
import { Crawler } from "../graph/Crawler.ts";
import { GRAPH_PATH } from "../graph/graphPath.ts";
import { PageGraphBuilder } from "../graph/PageGraphBuilder.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const session = new SimulatorSession(DEVICE);
const browser = await session.start();

// A fresh install opens on the onboarding carousel, and a crawl that starts
// there maps the carousel instead of the app.
await session.relaunchApp();

const builder = new PageGraphBuilder();
const report = await new Crawler({
  browser,
  builder,
  bundleId: DEVICE.bundleId,
  maxTaps: Number(process.env["BH_CRAWL_TAPS"] ?? 90),
}).crawl();

const data = builder.toData(DEVICE.bundleId);
await fs.mkdir(path.dirname(GRAPH_PATH), { recursive: true });
await Bun.write(GRAPH_PATH, JSON.stringify(data, null, 2));

console.log(
  `taps ${report.taps}, dead ends ${report.deadEnds}, tree reads ${report.treeReads}` +
    (report.taps ? ` (${(report.treeReads / report.taps).toFixed(1)} per tap)` : ""),
);
console.log(`screens ${data.screens.length}, edges ${data.edges.length}\n`);
for (const screen of [...data.screens].sort((a, b) => b.visits - a.visits)) {
  const stable = screen.elements
    .filter((e) => e.seen / screen.visits >= 0.6 && e.role !== "Text")
    .slice(0, 7)
    .map((e) => e.text);
  console.log(`${String(screen.visits).padStart(3)}  ${(screen.titles[0] || "(untitled)").slice(0, 30).padEnd(30)} ${stable.join(", ").slice(0, 80)}`);
}

await session.stop();
