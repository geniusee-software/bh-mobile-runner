# Trace collector

Collects the decisions a mobile agent makes during runs, labelled with whether
the step they belonged to passed, and exports them in the chat format a
supervised fine-tune consumes.

A trace is only useful if it carries its outcome. This service exists so that
every run quietly adds to a dataset — screen, instruction, tool call, verdict —
rather than that dataset having to be reconstructed later from logs that never
recorded whether the decision was right.

## Shape

```
POST /events    ingest a batch of decisions          → 202 {accepted}
GET  /runs      what has been collected, per run     → 200 {runs:[…]}
GET  /dataset   export as JSONL training examples    → 200 application/x-ndjson
```

`GET /dataset` defaults to decisions from steps that passed — the ones worth
imitating. `?passedOnly=false` includes the rest, `?escalatedOnly=true` narrows
to the steps a stronger model had to rescue, which are the highest-value
examples in the set.

Storage is S3, one JSONL object per ingest batch. Append-only rather than one
object per run: S3 cannot append, and read-modify-write loses events whenever
two workers finish a case at the same moment, which is exactly what a warm pool
does. Order is recovered at export time from `runId` and `seq`.

Inside, the handlers speak to a `TraceRepository` port; `S3TraceRepository` is
the adapter. Swapping in DynamoDB for the index, or memory for a test, does not
touch the routes.

## Deploy

```bash
AWS_REGION=eu-central-1 ./deploy.sh
```

Creates (idempotently) a private bucket, an execution role scoped to that
bucket, the function, and an IAM-authenticated Function URL. Traces contain
application screen contents, so the endpoint is signed rather than open and the
bucket blocks public access.

## Sending traces from a run

```bash
export BH_TRACE_URL=$(aws lambda get-function-url-config \
  --function-name bh-trace-collector --query FunctionUrl --output text)
bun experiments/scripts/run.ts --cases 12 --variants judge --label nightly
```

The runner always writes a local `traces.jsonl` beside its results as well, so a
run stays inspectable when the collector is unreachable — and so an outage never
costs a night of data.

## Cost

S3 storage and a Lambda that runs for the length of an ingest. At the volume one
laptop can generate this rounds to nothing; the reason to watch it is the export
path, which reads every object and will want an index once the bucket holds more
than a few hundred thousand events.
