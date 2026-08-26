import type { LlmCallRecorder } from "../metrics/LlmCallRecorder.ts";
import type { RunRecord } from "../metrics/RunRecord.ts";
import type { TraceEvent, TraceSink } from "./TraceEvent.ts";

export namespace TraceCollector {
  export interface Props {
    sink: TraceSink;
    runId: string;
    model: string;
    platform: string;
    app: string;
  }

  export interface StepContext {
    caseId: string;
    caseTitle: string;
    step: RunRecord.Step;
    /** Model calls made while this step ran. */
    calls: readonly LlmCallRecorder.Call[];
  }
}

/**
 * Turns finished steps into labelled training examples.
 *
 * The label is the step's verdict, which is why collection happens after a step
 * resolves rather than as calls are made: a decision is only worth imitating
 * once you know it led somewhere. Only decisions that produced a tool call
 * against a real tree are kept — a call with neither is a judgement about a
 * screen, not an action to learn.
 */
export class TraceCollector {
  readonly #props: TraceCollector.Props;
  #seq = 0;

  constructor(props: TraceCollector.Props) {
    this.#props = props;
  }

  async record(context: TraceCollector.StepContext): Promise<void> {
    const events = context.calls
      .filter((call) => call.agent === "actor" && call.calls.length > 0 && call.treeXml)
      .map((call) => this.#toEvent(context, call));

    if (events.length) await this.#props.sink.write(events);
  }

  #toEvent(
    context: TraceCollector.StepContext,
    call: LlmCallRecorder.Call,
  ): TraceEvent {
    const { runId, model, platform, app } = this.#props;

    return {
      runId,
      seq: this.#seq++,
      recordedAt: new Date().toISOString(),
      agent: call.agent,
      model,
      platform,
      app,
      caseId: context.caseId,
      caseTitle: context.caseTitle,
      stepIndex: context.step.index,
      instruction: context.step.action,
      expected: context.step.expected,
      treeXml: call.treeXml,
      toolCalls: call.calls,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      stepPassed: context.step.verdict === "passed",
      // Reserved for the escalation path, where a stronger model retries a step
      // the cheap one lost. Those are the examples worth the most.
      escalated: false,
    };
  }
}
