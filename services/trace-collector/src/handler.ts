import { S3TraceRepository } from "./adapters/S3TraceRepository.ts";
import { IngestRequest, type TraceEvent } from "./domain/TraceEvent.ts";
import type { TraceRepository } from "./domain/TraceRepository.ts";
import { toTrainingExample } from "./export/toTrainingExample.ts";

interface LambdaEvent {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const repository: TraceRepository = new S3TraceRepository({
  bucket: requiredEnv("TRACE_BUCKET"),
  prefix: process.env.TRACE_PREFIX ?? "traces",
});

/**
 * Collects agent decisions from runs and hands them back as training data.
 *
 * Deliberately three endpoints and no more: runs write, humans look, and a
 * training job reads. Anything richer belongs in whatever consumes the export,
 * not in the thing whose only hard requirement is never to drop an event.
 */
export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";

  try {
    if (method === "POST" && path === "/events") return await ingest(event);
    if (method === "GET" && path === "/runs") return await listRuns(event);
    if (method === "GET" && path === "/dataset") return await exportDataset(event);
    return json(404, { error: `No route for ${method} ${path}` });
  } catch (error) {
    // The client is a test run that cannot pause to handle this, so answer
    // with something it can log and move on from.
    return json(500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ingest(event: LambdaEvent): Promise<LambdaResponse> {
  const parsed = IngestRequest.safeParse(JSON.parse(readBody(event)));
  if (!parsed.success) {
    return json(400, { error: "Invalid payload", detail: parsed.error.message });
  }

  await repository.append(parsed.data.events);
  return json(202, { accepted: parsed.data.events.length });
}

async function listRuns(event: LambdaEvent): Promise<LambdaResponse> {
  const limit = intParam(event, "limit", 50, 500);
  return json(200, { runs: await repository.listRuns(limit) });
}

async function exportDataset(event: LambdaEvent): Promise<LambdaResponse> {
  const query: TraceRepository.ExportQuery = {
    passedOnly: event.queryStringParameters?.["passedOnly"] !== "false",
    escalatedOnly: event.queryStringParameters?.["escalatedOnly"] === "true",
    limit: intParam(event, "limit", 1000, 20_000),
  };

  const lines: string[] = [];
  for await (const traceEvent of await repository.exportEvents(query)) {
    lines.push(JSON.stringify(toTrainingExample(traceEvent)));
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/x-ndjson" },
    body: lines.join("\n"),
  };
}

function readBody(event: LambdaEvent): string {
  const body = event.body ?? "{}";
  return event.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

function intParam(
  event: LambdaEvent,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = Number(event.queryStringParameters?.[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

function json(statusCode: number, body: unknown): LambdaResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export type { TraceEvent };
