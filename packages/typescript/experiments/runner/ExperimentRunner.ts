import fs from "node:fs/promises";
import path from "node:path";
import type { Browser } from "webdriverio";
import { NullCache } from "../../src/server/cache/NullCache.ts";
import { LlmFactory } from "../../src/server/LlmFactory.ts";
import { SessionContext } from "../../src/server/session/SessionContext.ts";
import type { AppId } from "../../src/AppId.ts";
import { Model } from "../../src/Model.ts";
import type { TestCase } from "../cases/TestCase.ts";
import type { ExpectationHealer } from "../heal/ExpectationHealer.ts";
import { RESULTS_DIR } from "../config/suite.ts";
import type { Variant } from "../config/variants.ts";
import type { RunRecord } from "../metrics/RunRecord.ts";
import { TraceCollector } from "../trace/TraceCollector.ts";
import type { TraceSink } from "../trace/TraceEvent.ts";
import { CaseRunner } from "./CaseRunner.ts";
import type { SimulatorSession } from "./SimulatorSession.ts";

export namespace ExperimentRunner {
  export interface Props {
    session: SimulatorSession;
    cases: readonly TestCase[];
    /** Tag that groups every variant of one invocation under a single folder. */
    runLabel: string;
    /** Where the model's decisions are collected for later training. */
    traceSink: TraceSink;
    /** Platform tag recorded alongside every trace. */
    platform: string;
    /** Application under test, recorded alongside every trace. */
    app: string;
    /** Rewrites vague expectations for variants that ask for it. */
    healer?: ExpectationHealer | undefined;
  }
}

/**
 * Runs the case set once per variant and writes results as they arrive.
 *
 * Results are appended per case rather than at the end so a run that dies
 * halfway still leaves usable data — on a device this slow, a lost batch is an
 * hour lost.
 */
export class ExperimentRunner {
  readonly #props: ExperimentRunner.Props;

  constructor(props: ExperimentRunner.Props) {
    this.#props = props;
  }

  async runVariant(variant: Variant.Props): Promise<RunRecord.Case[]> {
    const { session, cases, runLabel } = this.#props;

    const model = Model.parse(variant.model);
    const buildLlm = (id: Model, suffix: string) =>
      LlmFactory.createLlm(
        id,
        new NullCache(
          new SessionContext({
            app: "experiment" as AppId,
            sessionId: `${runLabel}-${variant.id}${suffix}`,
          }),
        ),
      );

    const llm = buildLlm(model, "");
    const verifierLlm = variant.verifierModel
      ? buildLlm(Model.parse(variant.verifierModel), "-verify")
      : undefined;

    // Built through a factory so the run can rebuild it around a fresh
    // session without re-deriving everything else.
    const buildRunner = (browser: Browser) =>
      new CaseRunner({
          variant,
          browser,
          resetApp: () => session.relaunchApp(),
          systemDialogs: session.systemDialogs,
          bundleId: this.#props.app,
          llm,
          verifierLlm,
          failureShotsDir: path.join(RESULTS_DIR, runLabel, "shots", variant.id),
          traces: new TraceCollector({
            sink: this.#props.traceSink,
            runId: `${runLabel}-${variant.id}`,
            model: model.name,
            platform: this.#props.platform,
            app: this.#props.app,
          }),
      });

    const runner = buildRunner(session.browser);

    const outputPath = path.join(
      RESULTS_DIR,
      runLabel,
      `${variant.id}.jsonl`,
    );
    const records: RunRecord.Case[] = [];

    const models = verifierLlm
      ? `${model.name}, verify: ${Model.parse(variant.verifierModel!).name}`
      : model.name;
    console.log(`\n=== ${variant.id} (${models}) ===`);
    console.log(`    ${variant.hypothesis}`);

    const toRun = variant.healExpectations
      ? this.#healed(cases)
      : [...cases];

    let active = runner;

    for (const [index, testCase] of toRun.entries()) {
      let record = await this.#runOne(active, testCase, variant);

      // One lost connection used to end the run: the case runner holds the
      // browser it was built with, so once the session died every remaining
      // case errored in under a second — forty-eight of them in nine seconds,
      // which reads as a catastrophic pass rate and is one dropped socket.
      if (record.verdict === "errored" && looksLikeLostSession(record)) {
        console.log(`    session lost on "${testCase.title}"; reconnecting`);
        const revived = await this.#reconnect(buildRunner);
        if (revived) {
          active = revived;
          record = await this.#runOne(active, testCase, variant);
        }
      }

      records.push(record);
      await appendJsonl(outputPath, record);
      console.log(formatProgress(index, toRun.length, record));
    }

    return records;
  }

  /**
   * Brings the device back and rebuilds the runner around the new session.
   *
   * Deliberately allowed to fail: if the device cannot be brought back, the
   * remaining cases will error and be recorded as errors, which is the honest
   * outcome. What must not happen is doing this silently — a run that quietly
   * reconnects hides a device that is falling over every few cases.
   */
  async #reconnect(
    buildRunner: (browser: Browser) => CaseRunner,
  ): Promise<CaseRunner | undefined> {
    const { session } = this.#props;
    try {
      await session.stop();
    } catch {
      // Already gone, which is what we are recovering from.
    }

    try {
      const browser = await session.start();
      await session.relaunchApp();
      return buildRunner(browser);
    } catch (error) {
      console.log(
        `    could not reconnect: ${error instanceof Error ? error.message.slice(0, 120) : error}`,
      );
      return undefined;
    }
  }

  /** Applies the healer and says how much of the suite it touched. */
  #healed(cases: readonly TestCase[]): TestCase[] {
    const { healer } = this.#props;
    if (!healer) throw new Error("This variant heals expectations but no healer was provided");

    let rewritten = 0;
    const healed = cases.map((testCase) => {
      const result = healer.heal(testCase);
      rewritten += result.healedSteps;
      return { ...testCase, steps: result.steps };
    });

    const steps = cases.reduce((total, testCase) => total + testCase.steps.length, 0);
    console.log(`    healer rewrote ${rewritten} of ${steps} expectations`);
    return healed;
  }

  async #runOne(
    runner: CaseRunner,
    testCase: TestCase,
    variant: Variant.Props,
  ): Promise<RunRecord.Case> {
    try {
      return await runner.run(testCase);
    } catch (error) {
      // A crash between cases (lost session, device wedge) is data too; record
      // it as an errored case so the variant's totals stay honest.
      return {
        variantId: variant.id,
        model: variant.model,
        caseId: testCase.id,
        caseTitle: testCase.title,
        origin: testCase.origin,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        verdict: "errored",
        stepsPassed: 0,
        stepsTotal: testCase.steps.length,
        steps: [],
        llmCalls: 0,
        llmMs: 0,
        llmCallsByAgent: {},
        tokens: { input: 0, output: 0, cacheRead: 0 },
        costUsd: 0,
        device: {
          totalMs: 0,
          pageSourceMs: 0,
          pageSourceCount: 0,
          contextScanMs: 0,
          contextScanCount: 0,
          screenshotMs: 0,
        },
      };
    }
  }
}

function formatProgress(
  index: number,
  total: number,
  record: RunRecord.Case,
): string {
  const mark =
    record.verdict === "passed" ? "PASS" : record.verdict === "failed" ? "FAIL" : "ERR ";
  const position = `${String(index + 1).padStart(3)}/${total}`;
  const seconds = (record.durationMs / 1000).toFixed(1).padStart(6);
  const cost = record.costUsd.toFixed(4);
  return (
    `  ${mark} ${position}  ${seconds}s  ${String(record.llmCalls).padStart(2)} calls  ` +
    `$${cost}  ${record.stepsPassed}/${record.stepsTotal}  ${record.caseTitle.slice(0, 52)}`
  );
}

async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}


/**
 * Whether this error is the connection to the device, rather than the app.
 *
 * Matched on the message because that is all WebDriver gives: the codes are
 * not distinct enough to separate "the session is gone" from "the element is
 * gone", and treating the second as the first would restart the device over an
 * ordinary missing button.
 */
function looksLikeLostSession(record: RunRecord.Case): boolean {
  const text = record.steps.map((step) => step.failure ?? "").join(" ");
  return /invalid session id|session (is either terminated|does not exist|was deleted)|not started|ECONNREFUSED|socket hang up/i.test(
    text,
  );
}
