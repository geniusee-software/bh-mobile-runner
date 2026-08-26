# Mobile runner experiments

Measures what a mobile case actually costs — wall-clock, model calls, dollars —
and how often the runner and the suite agree, across configurations of the
runner. Everything here runs against a local iOS simulator so a configuration
can be judged in minutes rather than through a stage deploy.

## Layout

| Path            | Role                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `config/`       | The device, the candidate models and their rates, the variant matrix  |
| `cases/`        | Case model and the deterministic sample drawn from a suite snapshot   |
| `runner/`       | Simulator session, one-case execution, the matrix loop                |
| `verify/`       | Interchangeable ways to confirm a step's expected result              |
| `metrics/`      | Per-call recorders for the model and the device, and the run record   |
| `diagnostics/`  | Evidence captured at failure time                                     |
| `report/`       | Comparison table and the failure taxonomy                             |
| `scripts/`      | Entry points                                                          |
| `data/`         | Suite snapshot (committed, so runs are reproducible)                  |
| `results/`      | One folder per run label; JSONL per variant plus failure screenshots  |

## Prerequisites

A simulator with the app installed, and an Appium server on a port of its own.
Every booted simulator runs its own WebDriverAgent and they all default to
port 8100, so a run that does not pin `wdaLocalPort` will talk to whichever
simulator claimed it first and fail with "Session does not exist".

```bash
xcrun simctl create BH-EXP-01 "iPhone 15 Pro" com.apple.CoreSimulator.SimRuntime.iOS-17-0
xcrun simctl boot BH-EXP-01
xcrun simctl install BH-EXP-01 "/path/to/Path4Life Prod.app"
appium server --port 4739 --base-path /
```

## Running

```bash
# Refresh the suite snapshot (only when the suite changed)
BH_TOKEN=... bun experiments/scripts/fetchSuite.ts <suiteId>

# Check a model can return tool calls before benchmarking it
AWS_REGION_NAME=eu-central-1 bun experiments/scripts/contractSmoke.ts

# Run the matrix
AWS_REGION_NAME=eu-central-1 bun experiments/scripts/run.ts \
  --cases 12 --variants baseline,lazy-webview,no-planner --label nightly

# Read the results back, with the failure breakdown
bun experiments/scripts/analyze.ts nightly
```

## Reading a result

`llm/case` and `$/case` say what the configuration costs. `scan s` is time spent
enumerating webview contexts — on a native screen that is pure waste, and it is
the first thing the optimisations remove.

The failure breakdown matters more than the pass rate. A step can fail because
the device refused an action, because the app ended up on another screen, or
because the model misread a screen that did contain the answer. Only the last
is a model problem; the taxonomy separates them using the words the case quotes
and whether they were on screen when the check failed.

## Adding a variant

Add an entry to `config/variants.ts` with a one-line hypothesis and change one
field from the variant you want to compare against. Nothing else needs editing:
the runner reads the matrix, and the report derives its columns from the
records.
