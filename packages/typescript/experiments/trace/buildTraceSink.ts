import path from "node:path";
import { RESULTS_DIR } from "../config/suite.ts";
import type { TraceSink } from "./TraceEvent.ts";
import {
  FileTraceSink,
  HttpTraceSink,
  NullTraceSink,
  ResilientTraceSink,
} from "./traceSinks.ts";

/**
 * Chooses where a run's traces go.
 *
 * The local file is always written: it costs nothing, survives an outage at the
 * collector, and makes a run inspectable without AWS. The collector is added
 * when `BH_TRACE_URL` is set, so enabling central collection is one environment
 * variable rather than a code change.
 */
export function buildTraceSink(runLabel: string): TraceSink {
  if (process.env.BH_TRACE === "off") return new NullTraceSink();

  const sinks: TraceSink[] = [
    new FileTraceSink(path.join(RESULTS_DIR, runLabel, "traces.jsonl")),
  ];

  const url = process.env.BH_TRACE_URL;
  if (url) {
    sinks.push(
      new HttpTraceSink(url, process.env.AWS_REGION_NAME ?? "eu-central-1"),
    );
  }

  return new ResilientTraceSink(sinks, (sink, error) => {
    console.warn(
      `  ! trace sink ${sink.name} failed: ${error instanceof Error ? error.message.slice(0, 160) : error}`,
    );
  });
}
