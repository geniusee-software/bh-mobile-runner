import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Browser } from "webdriverio";
import { Alumni } from "../../src/client/Alumni.ts";
import { AppiumDriver } from "../../src/drivers/AppiumDriver.ts";
import {
  DelayedTreeRead,
  ImmediateTreeRead,
} from "../../src/drivers/tree/treeReadStrategies.ts";
import { Model } from "../../src/Model.ts";
import type { TestCase } from "../cases/TestCase.ts";
import { rateFor } from "../config/models.ts";
import type { Variant } from "../config/variants.ts";
import { ExpectationProbe } from "../diagnostics/ExpectationProbe.ts";
import { DeviceCallRecorder } from "../metrics/DeviceCallRecorder.ts";
import { LlmCallRecorder } from "../metrics/LlmCallRecorder.ts";
import { RunRecord, summariseCalls } from "../metrics/RunRecord.ts";
import type { TraceCollector } from "../trace/TraceCollector.ts";
import type { StepVerifier } from "../verify/StepVerifier.ts";
import { verifierFor } from "../verify/verifierFor.ts";

export namespace CaseRunner {
  export interface Props {
    variant: Variant.Props;
    browser: Browser;
    /**
     * Returns the app to its first screen. Runs before every case so a failure
     * in one case cannot decide the verdict of the next.
     */
    resetApp: () => Promise<void>;
    /** Built once per variant so model setup cost is not charged to case one. */
    llm: BaseChatModel;
    /** Where to save the screen at the moment a check fails; omit to skip. */
    failureShotsDir?: string | undefined;
    /** Collects the model's decisions as training data; omit to skip. */
    traces?: TraceCollector | undefined;
  }
}

/**
 * Executes one generated case against the device and reports what it cost.
 *
 * A step is two instructions to the agent: perform the action, then confirm the
 * screen it produced. Both must succeed for the step to pass, and the case
 * stops at the first step that does not — continuing past a failed navigation
 * would only measure the agent flailing on the wrong screen.
 */
export class CaseRunner {
  readonly #props: CaseRunner.Props;
  readonly #llmCalls = new LlmCallRecorder();
  readonly #deviceCalls = new DeviceCallRecorder();
  readonly #expectations = new ExpectationProbe();
  readonly #verifier: StepVerifier;
  #currentCaseId = "";

  constructor(props: CaseRunner.Props) {
    this.#props = props;
    this.#verifier = verifierFor(props.variant.verifier, props.llm);
    // One recorder instance serves every case; the model is shared per variant.
    props.llm.callbacks = [this.#llmCalls.handler()];
  }

  async run(testCase: TestCase): Promise<RunRecord.Case> {
    const { variant, browser, resetApp, llm } = this.#props;

    this.#currentCaseId = testCase.id.slice(0, 8);
    await resetApp();
    this.#llmCalls.reset();
    this.#deviceCalls.reset();

    const alumni = new Alumni(this.#deviceCalls.instrument(browser), {
      model: Model.parse(variant.model),
      llm,
      planner: variant.planner,
      changeAnalysis: variant.changeAnalysis,
    });
    applyDriverOptions(alumni, variant);

    const startedAt = new Date().toISOString();
    const startedMs = performance.now();
    const steps: RunRecord.Step[] = [];

    for (const [index, step] of testCase.steps.entries()) {
      const callsBefore = this.#llmCalls.callCount;
      const result = await this.#runStep(alumni, step, index);
      steps.push(result);

      await this.#props.traces?.record({
        caseId: testCase.id,
        caseTitle: testCase.title,
        step: result,
        calls: this.#llmCalls.calls.slice(callsBefore),
      });

      if (result.verdict !== "passed") break;
    }

    const durationMs = Math.round(performance.now() - startedMs);
    const stepsPassed = steps.filter((s) => s.verdict === "passed").length;
    const failed = steps.find((s) => s.verdict !== "passed");

    return {
      variantId: variant.id,
      model: variant.model,
      caseId: testCase.id,
      caseTitle: testCase.title,
      origin: testCase.origin,
      startedAt,
      durationMs,
      verdict: failed?.verdict ?? "passed",
      stepsPassed,
      stepsTotal: testCase.steps.length,
      steps,
      ...summariseCalls(this.#llmCalls.calls),
      costUsd: this.#costUsd(),
      device: this.#deviceTotals(),
    };
  }

  async #runStep(
    alumni: Alumni,
    step: TestCase["steps"][number],
    index: number,
  ): Promise<RunRecord.Step> {
    const callsBefore = this.#llmCalls.callCount;
    const startedMs = performance.now();

    const finish = (
      verdict: RunRecord.StepVerdict,
      failure: string,
    ): RunRecord.Step => ({
      index: index + 1,
      action: step.action,
      expected: step.expected,
      verdict,
      failure,
      durationMs: Math.round(performance.now() - startedMs),
      llmCalls: this.#llmCalls.callCount - callsBefore,
    });

    try {
      await alumni.do(step.action);
    } catch (error) {
      return finish("errored", `action: ${describe(error)}`);
    }

    if (!step.expected) return finish("passed", "");

    let outcome;
    try {
      outcome = await this.#verifier.verify(alumni, step.expected);
    } catch (error) {
      // The verifier only swallows the app disagreeing; anything reaching here
      // is the harness or the device breaking, and the two must not be pooled.
      return finish("errored", `check: ${describe(error)}`);
    }

    if (outcome.passed) {
      const passed = finish("passed", "");
      passed.verifierAttempts = outcome.attempts;
      // Audit the pass against the very tree the verdict was reached on: free,
      // and the only guard against a lenient judge scoring well by accepting
      // screens that do not satisfy the expectation.
      if (outcome.treeXml) {
        passed.evidence = this.#expectations.probe(step.expected, outcome.treeXml);
      }
      return passed;
    }

    const failed = finish("failed", `check: ${outcome.explanation.slice(0, 300)}`);
    failed.verifierAttempts = outcome.attempts;
    failed.evidence = await this.#probeExpectation(step.expected);
    failed.screenshotPath = await this.#captureFailure(index);
    return failed;
  }

  /**
   * Saves what the screen looked like when a check failed.
   *
   * A pass rate says how often the runner disagrees with the suite; only the
   * picture says which of the two was wrong.
   */
  async #captureFailure(stepIndex: number): Promise<string | undefined> {
    const { failureShotsDir } = this.#props;
    if (!failureShotsDir) return undefined;

    try {
      const base64 = await this.#props.browser.takeScreenshot();
      const filePath = `${failureShotsDir}/${this.#currentCaseId}-step${stepIndex + 1}.png`;
      await Bun.write(filePath, Buffer.from(base64, "base64"));
      return filePath;
    } catch {
      return undefined;
    }
  }

  /** Records whether the words the case asked for were on screen when it failed. */
  async #probeExpectation(
    expectation: string,
  ): Promise<RunRecord.Step["evidence"]> {
    try {
      const source = await this.#props.browser.getPageSource();
      return this.#expectations.probe(expectation, source);
    } catch {
      return undefined;
    }
  }

  #costUsd(): number {
    const { input, output } = summariseCalls(this.#llmCalls.calls).tokens;
    const rate = rateFor(this.#props.variant.model);
    return (input * rate.input + output * rate.output) / 1_000_000;
  }

  #deviceTotals(): RunRecord.DeviceTotals {
    const contextScanMs =
      this.#deviceCalls.msFor("getAppiumContexts") +
      this.#deviceCalls.msFor("getContexts");
    const contextScanCount =
      this.#deviceCalls.countFor("getAppiumContexts") +
      this.#deviceCalls.countFor("getContexts");

    return {
      totalMs: this.#deviceCalls.totals().totalMs,
      pageSourceMs: this.#deviceCalls.msFor("getPageSource"),
      pageSourceCount: this.#deviceCalls.countFor("getPageSource"),
      contextScanMs,
      contextScanCount,
      screenshotMs: this.#deviceCalls.msFor("takeScreenshot"),
    };
  }
}

/**
 * Applies the variant's driver switches.
 *
 * `Alumni` wraps the raw browser itself, so the driver only exists after
 * construction and its flags have to be set on the instance it built.
 */
function applyDriverOptions(alumni: Alumni, variant: Variant.Props): void {
  const { driver } = alumni;
  if (!(driver instanceof AppiumDriver)) return;

  driver.lazyWebviewContexts = variant.lazyWebviewContexts;
  driver.treeRead =
    variant.treeSettleMs > 0
      ? new DelayedTreeRead(variant.treeSettleMs)
      : new ImmediateTreeRead();
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}
