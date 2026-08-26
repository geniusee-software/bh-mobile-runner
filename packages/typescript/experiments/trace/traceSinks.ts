import fs from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { TraceEvent, TraceSink } from "./TraceEvent.ts";

/** Discards everything. Used when tracing is off, so callers need no branches. */
export class NullTraceSink implements TraceSink {
  readonly name = "none";

  async write(): Promise<void> {}
}

/** Appends events to a local JSONL file — useful without AWS, and as a backup. */
export class FileTraceSink implements TraceSink {
  readonly name: string;
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
    this.name = `file:${filePath}`;
  }

  async write(events: readonly TraceEvent[]): Promise<void> {
    if (!events.length) return;
    // Appended rather than rewritten: a trace carries a whole accessibility
    // tree, so read-modify-write would re-serialise megabytes on every step.
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const lines = events.map((event) => JSON.stringify(event)).join("\n");
    await fs.appendFile(this.#filePath, `${lines}\n`, "utf8");
  }
}

/**
 * Posts events to the trace collector's Function URL.
 *
 * The endpoint is IAM-authenticated because traces carry application screen
 * contents, so requests are SigV4-signed with whatever credentials the runner
 * already uses for Bedrock.
 */
export class HttpTraceSink implements TraceSink {
  readonly name: string;
  readonly #url: string;
  readonly #region: string;
  #client: AwsClient | undefined;

  constructor(url: string, region: string) {
    this.#url = url.replace(/\/$/, "");
    this.#region = region;
    this.name = `http:${new URL(url).host}`;
  }

  async write(events: readonly TraceEvent[]): Promise<void> {
    if (!events.length) return;

    const client = (this.#client ??= await this.#signer());
    const response = await client.fetch(`${this.#url}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      aws: { service: "lambda", region: this.#region },
    });

    if (!response.ok) {
      throw new Error(
        `Trace ingest failed: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
  }

  async #signer(): Promise<AwsClient> {
    const credentials = await fromNodeProviderChain()();
    return new AwsClient({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      region: this.#region,
      service: "lambda",
    });
  }
}

/**
 * Writes to several sinks, and never lets one of them stop a run.
 *
 * Traces are a by-product: losing them is a nuisance, while an exception
 * escaping into the middle of a case costs the case itself. Failures are
 * reported and swallowed.
 */
export class ResilientTraceSink implements TraceSink {
  readonly name: string;
  readonly #sinks: readonly TraceSink[];
  readonly #onError: (sink: TraceSink, error: unknown) => void;

  constructor(
    sinks: readonly TraceSink[],
    onError: (sink: TraceSink, error: unknown) => void = () => {},
  ) {
    this.#sinks = sinks;
    this.#onError = onError;
    this.name = sinks.map((sink) => sink.name).join("+") || "none";
  }

  async write(events: readonly TraceEvent[]): Promise<void> {
    await Promise.all(
      this.#sinks.map(async (sink) => {
        try {
          await sink.write(events);
        } catch (error) {
          this.#onError(sink, error);
        }
      }),
    );
  }
}
