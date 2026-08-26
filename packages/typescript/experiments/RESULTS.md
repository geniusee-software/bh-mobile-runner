# What a mobile case costs, and why it fails

Measured overnight on 26 August 2026 against a local iOS simulator
(BH-EXP-01, iOS 17.0, Appium 3.7 on a dedicated port), running the generated
suite *Path4Life — journeys from a device map (v2)*, 145 cases.

Every number below comes from `experiments/results/`; regenerate the tables with
`bun experiments/scripts/summary.ts`.

## The short version

Two things came out of the night. The cost of a step fell by more than half and
is now understood line by line. The pass rate did not reach 90%, and the reason
is not the model: **64% of the suite cannot be satisfied in this environment at
all**, and of the failures that remain, genuine model errors are 7%.

## What the step was paying for

Same six cases, same model (`claude-haiku-4-5`), one change at a time.

| configuration        | median | model calls | context scans | $/case  |
| -------------------- | ------ | ----------- | ------------- | ------- |
| as shipped           | 160s   | 7.0         | 50s           | $0.0503 |
| + lazy webview scans | 83s    | 5.5         | 0s            | $0.0390 |
| + no planner         | 71s    | 3.5         | 0s            | $0.0206 |

**Webview context scans cost 50 seconds per case.** `getAppiumContexts()` takes
about 5.5s on a simulator and returns `["NATIVE_APP"]`, and `check()` pays for
it twice — once for `title()`, once for `url()` — to learn there is no webview.
WebDriverAgent does not even implement those two endpoints for a native screen,
so both calls then failed after a timeout. The accessibility tree already knows
whether a webview exists, so it answers instead.

**The planner had nothing to plan.** Generated case steps arrive atomic ("Tap
the 'Month' button"). Splitting them is a model call that returns the step it
was given.

**Snapshot depth is a trap worth documenting.** Capping `snapshotMaxDepth` at 24
takes a snapshot from 17.3s to 4.7s and still shows every navigation landmark —
but this app nests its content one level below that cap, so the lists arrive
empty (`<ScrollView />`) and steps fail for no visible reason. Step pass rate
drops from 57% to 39%. The cap is left off. See `scripts/probeDepth.ts`.

## What was silently broken

- **Extended thinking is incompatible with structured output on Bedrock.** Four
  of six agents reach the model through `withStructuredOutput`, which pins
  `tool_choice`; Bedrock rejects the combination outright. The first run made
  zero model calls and every case errored.
- **Every simulator's WebDriverAgent defaults to port 8100.** With several
  simulators booted, a session without `wdaLocalPort` talks to another
  simulator's WDA and fails with "Session does not exist".
- **The mobile driver had no scroll tool.** Cases ask to scroll constantly and
  the agent had no move to make. Worse, `mobile: scrollToElement` refuses on
  SwiftUI lists, and that refusal aborted the whole action rather than letting
  the click that followed decide.
- **The prompts describe a webpage.** On a native app this changes answers: the
  retriever found "Notifications" in the navigation bar and rejected it because
  "the application's title is Path4Life", which is the only thing a webpage
  could have meant.
- **The driver acted on the wrong element.** One Path4Life screen carries thirty
  buttons named `play`, ten named `options` and nine named after the same
  series. The driver turned the agent's chosen element into a predicate over
  type, name, value and label and then took the *first* match, so on any
  repeated label the agent's choice was discarded and the tap landed on another
  row. It looked like the app ignoring the tap, and it accounted for three of
  the five failures in the best configuration.
- **An unstorable response failed the call.** gpt-oss attaches usage metadata in
  a shape the cache's schema does not accept, and the throw travelled out of the
  agent — the call was made, paid for, and discarded.

## Why cases fail

67 failed steps across every run, sorted by whether the words the case quoted
were on screen when it failed.

| cause                                                        | share | look at                     |
| ------------------------------------------------------------ | ----- | --------------------------- |
| expectation names no concrete element — a judgement call       | 60%   | case wording, verify prompt |
| driver or device refused the action                            | 13%   | the runner                  |
| failed before evidence could be captured                       | 10%   | —                           |
| nothing the case named was on screen — the app is elsewhere    | 9%    | the previous step           |
| everything named was on screen, the model still said no        | 7%    | the model                   |

The largest class is expectations written as prose — "a horizontal date strip
containing multiple day buttons" — which name nothing a string match can find
and turn entirely on how generously the verifier reads them.

That points at the verifier, and it was wrong for the job: `check()` runs
through the retriever, whose instructions are to answer only from information
"directly present" and to refuse otherwise. Right for extracting a value, wrong
for deciding an assertion. A prompt written for judging (`verify/AssertionVerifier.ts`)
moved step pass rate from **28% to 39%** on the same six cases.

## Pass rate alone is a misleading metric

In the first sweep one model passed *"a button labeled 'Join Path4life' is
visible on screen"* — on a registration form that has no such button, confirmed
against both the screenshot and the tree. Another model rejected the same step
and was right.

A lenient judge scores well on pass rate precisely by accepting screens that do
not satisfy the expectation, and for a test runner that is the worse mistake: a
green step that should be red hides a real defect.

The verifier now carries the tree it reached its verdict on, so every *pass*
whose expectation quotes concrete words is audited against it for free
(`report/suspectPasses.ts`). Reported as a rate over auditable passes, since an
expectation that quotes nothing cannot be checked this way. Comparing models on
pass rate without it is not sound.

## Why the suite cannot reach 90% here

`bun experiments/scripts/auditSuite.ts`, run against a guest session:

| | cases | |
| --- | ---: | --- |
| runnable | 52 | 36% |
| needs a signed-in account | 50 | profile, followed series, notification settings |
| pinned to rotating content | 43 | "Hakaras Hatov!, Aug 24, 2026, 2:18 min" |

The suite was generated on 25 August by walking a device map while signed in. It
quotes whatever was on screen that day. Two days later the feed has moved on and
those cards are gone — no model, fine-tuned or otherwise, can tap a card that
does not exist.

## On fine-tuning

Not yet, and the numbers say why. Training is worth it when the model is wrong
on data that is right. Here two thirds of the suite is unsatisfiable, and of the
failures that remain, the largest class is fixed by rewriting a prompt. Spending
a training budget now would teach a model the noise.

What was built instead is the thing that makes a later fine-tune possible:
`services/trace-collector/`, deployed to the QA account. Every run records the
screen as the model saw it, the instruction, the tool call, and whether the step
passed — and `GET /dataset` returns them as chat-format JSONL. The dataset now
accumulates on its own.

## Reproducing

```bash
xcrun simctl boot BH-EXP-01
appium server --port 4739 --base-path /

AWS_REGION_NAME=eu-central-1 bun experiments/scripts/contractSmoke.ts
AWS_REGION_NAME=eu-central-1 bun experiments/scripts/run.ts \
  --cases 6 --variants baseline,lazy-webview,no-planner,judge --label nightly
bun experiments/scripts/analyze.ts nightly
```
