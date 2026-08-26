import type { TraceEvent } from "./TraceEvent.ts";

export namespace TraceRepository {
  export interface RunSummary {
    runId: string;
    events: number;
    passedEvents: number;
    escalatedEvents: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }

  export interface ExportQuery {
    /** Only decisions from steps that passed — the ones worth imitating. */
    passedOnly: boolean;
    /** Only decisions a stronger model had to rescue. */
    escalatedOnly: boolean;
    limit: number;
  }
}

/**
 * Where traces are kept.
 *
 * Stated as a port so the collector can be exercised against memory in tests
 * and against S3 and DynamoDB in the account, without the request handlers
 * knowing which is behind them.
 */
export interface TraceRepository {
  append(events: readonly TraceEvent[]): Promise<void>;
  listRuns(limit: number): Promise<TraceRepository.RunSummary[]>;
  exportEvents(
    query: TraceRepository.ExportQuery,
  ): Promise<AsyncIterable<TraceEvent>>;
}
