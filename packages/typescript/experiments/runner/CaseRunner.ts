import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Browser } from "webdriverio";
import { Alumni } from "../../src/client/Alumni.ts";
import { AppiumDriver } from "../../src/drivers/AppiumDriver.ts";
import {
  DelayedTreeRead,
  ImmediateTreeRead,
} from "../../src/drivers/tree/treeReadStrategies.ts";
import { SnapshotDepth } from "../../src/drivers/tree/SnapshotDepth.ts";
import { Model } from "../../src/Model.ts";
import type { TestCase } from "../cases/TestCase.ts";
import { rateFor } from "../config/models.ts";
import type { Variant } from "../config/variants.ts";
import { ExpectationProbe } from "../diagnostics/ExpectationProbe.ts";
import { DeviceCallRecorder } from "../metrics/DeviceCallRecorder.ts";
import { LlmCallRecorder } from "../metrics/LlmCallRecorder.ts";
import { RunRecord, summariseCalls } from "../metrics/RunRecord.ts";
import { readScreen } from "../graph/ScreenSignature.ts";
import { namedTargets } from "../cases/namedTargets.ts";
import type { SystemDialogActor } from "./SystemDialogActor.ts";
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
    /** Model for the verifier; defaults to the actor's. */
    verifierLlm?: BaseChatModel | undefined;
    /** Where to save the screen at the moment a check fails; omit to skip. */
    failureShotsDir?: string | undefined;
    /** Collects the model's decisions as training data; omit to skip. */
    traces?: TraceCollector | undefined;
    /** Needed to open a case's deep link; omit to skip deep links. */
    bundleId?: string | undefined;
    /**
     * Answers the dialogs iOS puts over the app.
     *
     * Passed in rather than built here: a dialog is a property of the device,
     * not of a case, and the same actor serves the launch and every step.
     */
    systemDialogs?: SystemDialogActor | undefined;
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
  /**
   * Used only for steps the generator marked as unanswerable from the tree.
   *
   * Built once and lazily, because most runs never need it: buying a
   * screenshot on every step costs image tokens on the many steps that a tree
   * settles perfectly well.
   */
  #eyes: StepVerifier | undefined;
  #currentCaseId = "";

  constructor(props: CaseRunner.Props) {
    this.#props = props;
    this.#verifier = verifierFor(
      props.variant.verifier,
      props.verifierLlm ?? props.llm,
    );
    // One recorder serves every case and both models; each handler tags its
    // calls so cost can be priced per model rather than at a single rate.
    props.llm.callbacks = [this.#llmCalls.handler(Model.parse(props.variant.model).name)];
    if (props.verifierLlm && props.variant.verifierModel) {
      props.verifierLlm.callbacks = [
        this.#llmCalls.handler(Model.parse(props.variant.verifierModel).name),
      ];
    }
  }

  async run(testCase: TestCase): Promise<RunRecord.Case> {
    const { variant, browser, resetApp, llm } = this.#props;

    this.#currentCaseId = testCase.id.slice(0, 8);
    await resetApp();
    await this.#openDeepLink(testCase);
    this.#llmCalls.reset();
    this.#deviceCalls.reset();
    this.#props.systemDialogs?.forget();

    const alumni = new Alumni(this.#deviceCalls.instrument(browser), {
      model: Model.parse(variant.model),
      llm,
      planner: variant.planner,
      changeAnalysis: variant.changeAnalysis,
    });
    applyDriverOptions(alumni, variant, browser);

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
      systemDialogs: this.#props.systemDialogs?.dismissed.length,
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

    // Before the action, because a dialog standing over the app swallows the
    // tap; and again after it, because an action can be what summons one. The
    // count never enters the verdict — iOS asking for a permission is not the
    // case failing.
    await this.#props.systemDialogs?.clear(`step ${index + 1} before`);

    // What the instruction names, so a shallow read that missed it can be told
    // apart from a screen that genuinely has nothing on it.
    alumni.driver.lookingFor?.(namedTargets(step.action));

    const before = await this.#fingerprint(alumni);

    try {
      await alumni.do(step.action);
    } catch (error) {
      return finish("errored", `action: ${describe(error)}`);
    }

    await this.#props.systemDialogs?.clear(`step ${index + 1} after`);
    let after = await this.#fingerprint(alumni, { fresh: true });

    // One retry, for either of the two ways an action can quietly not happen.
    // A tap that lands on nothing reports success, so the agent walks on and
    // fails two steps later with a message about the wrong screen; and a step
    // that ends on a scroll has not been performed at all, because scrolling
    // brings the target into view and the instruction asked for something to
    // be done to it.
    const retryReason = this.#retryReason(callsBefore, before, after);
    if (retryReason) {
      try {
        await alumni.do(`${step.action}\n\n${RETRY_NOTES[retryReason]}`);
      } catch (error) {
        return finish("errored", `action (${retryReason} retry): ${describe(error)}`);
      }
      await this.#props.systemDialogs?.clear(`step ${index + 1} after retry`);
      after = await this.#fingerprint(alumni, { fresh: true });
    }

    const screenChanged = after !== before;

    if (!step.expected) return finish("passed", "");

    let outcome;
    try {
      outcome = await this.#verifierFor(step).verify(alumni, step.expected);
    } catch (error) {
      // The verifier only swallows the app disagreeing; anything reaching here
      // is the harness or the device breaking, and the two must not be pooled.
      return finish("errored", `check: ${describe(error)}`);
    }

    if (outcome.passed) {
      const passed = finish("passed", "");
      passed.retriedBecause = retryReason;
      passed.screenChanged = screenChanged;
      passed.verifierAttempts = outcome.attempts;
      passed.passReason = outcome.explanation;
      // A pass the tree could not have reached was decided by a picture, and
      // the picture is the only thing that can show whether it was decided
      // rightly. Keeping it only for failures left exactly the verdicts worth
      // checking with nothing behind them.
      if (outcome.attempts.some((attempt) => attempt.includes("vision"))) {
        passed.screenshotPath = await this.#captureScreen(index);
      }
      // Audit the pass against the very tree the verdict was reached on: free,
      // and the only guard against a lenient judge scoring well by accepting
      // screens that do not satisfy the expectation.
      if (outcome.treeXml) {
        passed.evidence = this.#expectations.probe(step.expected, outcome.treeXml);
      }
      return passed;
    }

    const failed = finish("failed", `check: ${outcome.explanation.slice(0, 300)}`);
    failed.retriedBecause = retryReason;
    failed.screenChanged = screenChanged;
    failed.verifierAttempts = outcome.attempts;
    failed.evidence = await this.#probeExpectation(step.expected);
    failed.screenshotPath = await this.#captureScreen(index);
    return failed;
  }

  /**
   * Why this action deserves a second attempt, or nothing if it does not.
   *
   * Two failures look identical from outside and are both silent: an action
   * that left the screen exactly as it was, and one that spent its whole turn
   * scrolling. Neither raises an error — WebDriverAgent reports a tap on an
   * unresponsive element as a success — so without this the agent walks on and
   * the case fails two steps later, blaming a screen it never left.
   */
  #retryReason(
    callsBefore: number,
    before: string,
    after: string,
  ): RunRecord.RetryReason | undefined {
    if (this.#onlyScrolled(callsBefore)) return "only-scrolled";
    if (before && after && before === after) return "screen-unchanged";
    return undefined;
  }

  /**
   * Whether the actor's whole contribution to this step was scrolling.
   *
   * Read from the calls the recorder already collects, so nothing new has to
   * be threaded through the agent classes. A step with no actor call at all is
   * not counted: that is a different failure, and re-issuing it would only
   * spend another call to reach the same place.
   */
  #onlyScrolled(callsBefore: number): boolean {
    const tools = this.#llmCalls.calls
      .slice(callsBefore)
      .filter((call) => call.agent === "actor")
      .flatMap((call) => call.calls);

    return (
      tools.length > 0 && tools.every((tool) => /scroll/i.test(tool.name))
    );
  }

  /**
   * The verifier for this step: the variant's, unless the generator said this
   * one needs a picture.
   *
   * The generator knows what it was asking about, and the runner cannot infer
   * "only a screenshot can settle this" from the wording — an assertion about
   * which segment is chosen reads exactly like one about which is present.
   */
  #verifierFor(step: TestCase["steps"][number]): StepVerifier {
    if (!step.needsScreenshot) return this.#verifier;

    this.#eyes ??= verifierFor(
      "assert-vision",
      this.#props.verifierLlm ?? this.#props.llm,
    );
    return this.#eyes;
  }

  /**
   * Puts the app where the case is about, before the case starts.
   *
   * A precondition, not a step: it is not the thing under test, it consumes no
   * model call, and it never counts towards the pass rate. Half this suite
   * reaches the player by tapping whatever the feed happens to be showing,
   * which ties the case to content that rotates daily; a link does not.
   */
  async #openDeepLink(testCase: TestCase): Promise<void> {
    if (!testCase.deepLink) return;
    try {
      await this.#props.browser.execute("mobile: deepLink", {
        url: testCase.deepLink,
        bundleId: this.#props.bundleId,
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await this.#props.systemDialogs?.clear("deep link");
    } catch (error) {
      // Recorded rather than thrown: the case will fail on its first step with
      // a screen that says why, which is more use than an errored case.
      console.log(
        `    deep link failed for "${testCase.title}": ${describe(error).slice(0, 100)}`,
      );
    }
  }

  #lastFingerprint = "";

  /**
   * A cheap statement of what is on the screen, for telling "it moved" from
   * "it did not".
   *
   * Carried between steps so the common case costs one read rather than two:
   * the screen a step starts on is the screen the previous step ended on.
   */
  async #fingerprint(
    alumni: Alumni,
    options: { fresh?: boolean } = {},
  ): Promise<string> {
    if (!options.fresh && this.#lastFingerprint) return this.#lastFingerprint;

    try {
      const source = await this.#props.browser.getPageSource();
      const names = readScreen(source).elements.map((element) => element.text);
      this.#lastFingerprint = [...new Set(names)].sort().join("\u0001");
    } catch {
      // Unreadable screens are not evidence of anything; leave the last
      // reading alone rather than inventing a change.
    }
    return this.#lastFingerprint;
  }

  /**
   * Saves what the screen looked like when a verdict was reached.
   *
   * A pass rate says how often the runner disagrees with the suite; only the
   * picture says which of the two was wrong.
   */
  async #captureScreen(stepIndex: number): Promise<string | undefined> {
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
    return this.#llmCalls.calls.reduce((total, call) => {
      const rate = rateFor(call.model);
      return (
        total + (call.inputTokens * rate.input + call.outputTokens * rate.output) / 1_000_000
      );
    }, 0);
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
function applyDriverOptions(
  alumni: Alumni,
  variant: Variant.Props,
  browser: Browser,
): void {
  const { driver } = alumni;
  if (!(driver instanceof AppiumDriver)) return;

  driver.lazyWebviewContexts = variant.lazyWebviewContexts;
  driver.treeRead =
    variant.treeSettleMs > 0
      ? new DelayedTreeRead(variant.treeSettleMs)
      : new ImmediateTreeRead();

  // Shallow by default, deep when the shallow read missed what the step named.
  // Measured on this app: depth 24 takes 5.7s and reports no feed rows at all,
  // while uncapped takes 20s and reports forty-three — so a capped-only runner
  // cannot open a shiur under any wording, and an uncapped-only one pays four
  // times over on every step that never needed it.
  if (variant.adaptiveSnapshotDepth && variant.snapshotMaxDepth) {
    const shallow = variant.snapshotMaxDepth;
    driver.snapshotDepth = new SnapshotDepth({
      shallow,
      setDepth: async (depth) => {
        await browser.updateSettings({ snapshotMaxDepth: depth ?? 0 });
      },
    });
  }
}

/** What the agent is told when its action left the screen where it found it. */
const RETRY_NOTES: Record<RunRecord.RetryReason, string> = {
  "screen-unchanged":
    "Nothing on the screen changed. The element you chose did not respond to it — several elements can carry the same label, and only one of them handles the tap. Choose a different element and try again.",
  "only-scrolled":
    "You only scrolled. Scrolling brings a target into view; it is not the action that was asked for. The target should be on screen now — do what the instruction asked.",
};

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}
