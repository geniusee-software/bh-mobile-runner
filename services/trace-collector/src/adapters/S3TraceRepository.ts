import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { TraceEvent } from "../domain/TraceEvent.ts";
import type { TraceRepository } from "../domain/TraceRepository.ts";

export namespace S3TraceRepository {
  export interface Props {
    bucket: string;
    prefix?: string;
    client?: S3Client;
  }
}

/**
 * Keeps traces as JSONL objects in S3, one object per ingest batch.
 *
 * Append-only object-per-batch rather than one growing object per run: S3 has
 * no append, and read-modify-write would lose events whenever two workers
 * finish a case at the same time — which is exactly what a warm pool does.
 * Ordering is recovered at export time from `runId` and `seq`, which the events
 * already carry.
 */
export class S3TraceRepository implements TraceRepository {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #prefix: string;

  constructor(props: S3TraceRepository.Props) {
    this.#client = props.client ?? new S3Client({});
    this.#bucket = props.bucket;
    this.#prefix = (props.prefix ?? "traces").replace(/\/$/, "");
  }

  async append(events: readonly TraceEvent[]): Promise<void> {
    if (!events.length) return;

    const first = events[0]!;
    const batchKey = `${this.#prefix}/run=${first.runId}/${first.recordedAt}-${first.seq}.jsonl`;

    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: batchKey,
        Body: events.map((event) => JSON.stringify(event)).join("\n"),
        ContentType: "application/x-ndjson",
      }),
    );
  }

  async listRuns(limit: number): Promise<TraceRepository.RunSummary[]> {
    const summaries = new Map<string, TraceRepository.RunSummary>();

    for await (const event of this.#scan()) {
      const summary = summaries.get(event.runId) ?? {
        runId: event.runId,
        events: 0,
        passedEvents: 0,
        escalatedEvents: 0,
        firstSeenAt: event.recordedAt,
        lastSeenAt: event.recordedAt,
      };

      summary.events += 1;
      if (event.stepPassed) summary.passedEvents += 1;
      if (event.escalated) summary.escalatedEvents += 1;
      if (event.recordedAt < summary.firstSeenAt) summary.firstSeenAt = event.recordedAt;
      if (event.recordedAt > summary.lastSeenAt) summary.lastSeenAt = event.recordedAt;

      summaries.set(event.runId, summary);
    }

    return [...summaries.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limit);
  }

  async exportEvents(
    query: TraceRepository.ExportQuery,
  ): Promise<AsyncIterable<TraceEvent>> {
    const scan = this.#scan();

    return (async function* filtered() {
      let yielded = 0;
      for await (const event of scan) {
        if (query.passedOnly && !event.stepPassed) continue;
        if (query.escalatedOnly && !event.escalated) continue;
        yield event;
        if (++yielded >= query.limit) return;
      }
    })();
  }

  async *#scan(): AsyncGenerator<TraceEvent> {
    let continuationToken: string | undefined;

    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: `${this.#prefix}/`,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of page.Contents ?? []) {
        if (!object.Key?.endsWith(".jsonl")) continue;
        const body = await this.#client.send(
          new GetObjectCommand({ Bucket: this.#bucket, Key: object.Key }),
        );
        const text = await body.Body?.transformToString();
        if (!text) continue;

        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          yield JSON.parse(line) as TraceEvent;
        }
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}
