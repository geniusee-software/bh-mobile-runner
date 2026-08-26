import type { RunRecord } from "../metrics/RunRecord.ts";

export interface VariantSummary {
  variantId: string;
  model: string;
  cases: number;
  casesPassed: number;
  stepsPassed: number;
  stepsTotal: number;
  medianCaseSec: number;
  meanCaseSec: number;
  llmCallsPerCase: number;
  llmSecPerCase: number;
  deviceSecPerCase: number;
  contextScanSecPerCase: number;
  costPerCase: number;
  totalCostUsd: number;
}

export function summarise(
  variantId: string,
  records: readonly RunRecord.Case[],
): VariantSummary {
  const count = Math.max(records.length, 1);
  const sum = (pick: (r: RunRecord.Case) => number) =>
    records.reduce((total, record) => total + pick(record), 0);

  return {
    variantId,
    model: records[0]?.model ?? "",
    cases: records.length,
    casesPassed: records.filter((r) => r.verdict === "passed").length,
    stepsPassed: sum((r) => r.stepsPassed),
    stepsTotal: sum((r) => r.stepsTotal),
    medianCaseSec: median(records.map((r) => r.durationMs)) / 1000,
    meanCaseSec: sum((r) => r.durationMs) / count / 1000,
    llmCallsPerCase: sum((r) => r.llmCalls) / count,
    llmSecPerCase: sum((r) => r.llmMs) / count / 1000,
    deviceSecPerCase: sum((r) => r.device.totalMs) / count / 1000,
    contextScanSecPerCase: sum((r) => r.device.contextScanMs) / count / 1000,
    costPerCase: sum((r) => r.costUsd) / count,
    totalCostUsd: sum((r) => r.costUsd),
  };
}

/** Renders the comparison table that the experiment exists to produce. */
export function reportRuns(
  byVariant: ReadonlyMap<string, readonly RunRecord.Case[]>,
): string {
  const summaries = [...byVariant].map(([id, records]) =>
    summarise(id, records),
  );

  const columns: ReadonlyArray<[string, (s: VariantSummary) => string]> = [
    ["variant", (s) => s.variantId],
    ["cases", (s) => `${s.casesPassed}/${s.cases}`],
    ["steps", (s) => `${s.stepsPassed}/${s.stepsTotal}`],
    ["med s", (s) => s.medianCaseSec.toFixed(1)],
    ["mean s", (s) => s.meanCaseSec.toFixed(1)],
    ["llm/case", (s) => s.llmCallsPerCase.toFixed(1)],
    ["llm s", (s) => s.llmSecPerCase.toFixed(1)],
    ["dev s", (s) => s.deviceSecPerCase.toFixed(1)],
    ["scan s", (s) => s.contextScanSecPerCase.toFixed(1)],
    ["$/case", (s) => s.costPerCase.toFixed(4)],
  ];

  const rows = [
    columns.map(([header]) => header),
    ...summaries.map((summary) =>
      columns.map(([, render]) => render(summary)),
    ),
  ];

  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );

  const line = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index]!)).join("  ");

  return [
    line(rows[0]!),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.slice(1).map(line),
  ].join("\n");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
