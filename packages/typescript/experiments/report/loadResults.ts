import fs from "node:fs/promises";
import path from "node:path";
import { RESULTS_DIR } from "../config/suite.ts";
import type { RunRecord } from "../metrics/RunRecord.ts";

/**
 * Files in a results folder that are not run records.
 *
 * Traces live alongside results and are also JSONL, so anything reading the
 * folder by extension will happily parse them as cases and fail on the first
 * missing field.
 */
const NOT_RESULTS = new Set(["traces.jsonl"]);

/** Loads one run label's records, keyed by variant. */
export async function loadResults(
  label: string,
): Promise<Map<string, RunRecord.Case[]>> {
  const dir = path.join(RESULTS_DIR, label);
  const entries = await fs.readdir(dir).catch(() => []);

  const byVariant = new Map<string, RunRecord.Case[]>();
  for (const name of entries) {
    if (!name.endsWith(".jsonl") || NOT_RESULTS.has(name)) continue;

    const text = await Bun.file(path.join(dir, name)).text();
    const records = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunRecord.Case);

    if (records.length) byVariant.set(path.basename(name, ".jsonl"), records);
  }
  return byVariant;
}

/** Every label that has results, oldest name first. */
export async function listLabels(): Promise<string[]> {
  return (await fs.readdir(RESULTS_DIR).catch(() => [])).sort();
}
