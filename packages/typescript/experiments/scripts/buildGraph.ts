/**
 * Builds the page graph from every tree the runner has already captured.
 *
 * Traces are written by every run anyway, so the graph costs no device time —
 * it is a by-product of testing that happens to describe the app.
 *
 * Run: bun experiments/scripts/buildGraph.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { RESULTS_DIR } from "../config/suite.ts";
import { DEVICE } from "../config/device.ts";
import { PageGraphBuilder } from "../graph/PageGraphBuilder.ts";
import { GRAPH_PATH } from "../graph/graphPath.ts";

const builder = new PageGraphBuilder();
let observations = 0;

for (const label of await fs.readdir(RESULTS_DIR).catch(() => [])) {
  const tracePath = path.join(RESULTS_DIR, label, "traces.jsonl");
  const file = Bun.file(tracePath);
  if (!(await file.exists())) continue;

  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    const trace = JSON.parse(line) as {
      treeXml?: string;
      instruction?: string;
      runId?: string;
      caseId?: string;
    };
    if (!trace.treeXml) continue;

    builder.add({
      treeXml: trace.treeXml,
      instruction: trace.instruction ?? "",
      // One case is one walk through the app, so edges only join screens that
      // actually followed each other.
      sequenceId: `${trace.runId ?? label}/${trace.caseId ?? ""}`,
    });
    observations += 1;
  }
}

const data = builder.toData(DEVICE.bundleId);
await fs.mkdir(path.dirname(GRAPH_PATH), { recursive: true });
await Bun.write(GRAPH_PATH, JSON.stringify(data, null, 2));

console.log(`observations: ${observations}`);
console.log(`screens:      ${data.screens.length}`);
console.log(`edges:        ${data.edges.length}`);
console.log(`written:      ${GRAPH_PATH}\n`);

for (const screen of [...data.screens].sort((a, b) => b.visits - a.visits).slice(0, 12)) {
  const stable = screen.elements
    .filter((element) => element.seen / screen.visits >= 0.6)
    .slice(0, 8)
    .map((element) => element.text);
  console.log(
    `${String(screen.visits).padStart(3)} visits  ${(screen.titles[0] || "(untitled)").slice(0, 34).padEnd(34)} ${stable.join(", ").slice(0, 90)}`,
  );
}
