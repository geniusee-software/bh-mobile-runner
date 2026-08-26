import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";

export namespace LlmCallRecorder {
  /** One completed model round trip. */
  export interface Call {
    /** Which agent asked, inferred from the system prompt it sent. */
    agent: AgentKind;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    toolCalls: number;
    /** Accessibility tree as it was serialised into the prompt, when present. */
    treeXml: string;
    /** The calls themselves, kept for training data rather than for metrics. */
    calls: Array<{ name: string; args: Record<string, unknown> }>;
  }

  export type AgentKind =
    | "planner"
    | "actor"
    | "retriever"
    | "area"
    | "locator"
    | "changes-analyzer"
    | "unknown";
}

/**
 * Distinctive phrases from each agent's system prompt.
 *
 * All agents in a session share one chat model instance, so the request itself
 * is the only place that says who is asking. Matching on prompt text is
 * indirect, but it keeps measurement entirely outside the agent classes.
 */
const AGENT_SIGNATURES: ReadonlyArray<[LlmCallRecorder.AgentKind, RegExp]> = [
  ["planner", /breaks down|plan .*steps|list of steps/i],
  ["actor", /performs actions|tool call/i],
  ["retriever", /retrieve|answer .*question|extract/i],
  ["area", /area/i],
  ["locator", /locate|find .*element/i],
  ["changes-analyzer", /changes|diff/i],
];

/**
 * Collects per-call latency and token counts for one run.
 *
 * Attaches as a LangChain callback rather than wrapping the model, so the agent
 * and client layers stay untouched and the numbers describe exactly the calls
 * the production code path made.
 */
export class LlmCallRecorder {
  readonly #calls: LlmCallRecorder.Call[] = [];
  readonly #pending = new Map<
    string,
    {
      startedAt: number;
      agent: LlmCallRecorder.AgentKind;
      treeXml: string;
    }
  >();

  get calls(): readonly LlmCallRecorder.Call[] {
    return this.#calls;
  }

  get callCount(): number {
    return this.#calls.length;
  }

  callsByAgent(agent: LlmCallRecorder.AgentKind): LlmCallRecorder.Call[] {
    return this.#calls.filter((call) => call.agent === agent);
  }

  reset(): void {
    this.#calls.length = 0;
    this.#pending.clear();
  }

  /** Callback handler to hand to `BaseChatModel#callbacks`. */
  handler(): Partial<BaseCallbackHandler> {
    return {
      handleChatModelStart: (
        _llm: unknown,
        messages: BaseMessage[][],
        runId: string,
      ) => {
        this.#pending.set(runId, {
          startedAt: performance.now(),
          agent: classifyAgent(messages),
          treeXml: extractTree(messages),
        });
      },

      handleLLMEnd: (output: LLMResult, runId: string) => {
        const pending = this.#pending.get(runId);
        if (!pending) return;
        this.#pending.delete(runId);

        const calls = readToolCalls(output);
        this.#calls.push({
          agent: pending.agent,
          latencyMs: Math.round(performance.now() - pending.startedAt),
          ...readUsage(output),
          toolCalls: calls.length,
          treeXml: pending.treeXml,
          calls,
        });
      },

      handleLLMError: (_error: unknown, runId: string) => {
        this.#pending.delete(runId);
      },
    } as Partial<BaseCallbackHandler>;
  }
}

function classifyAgent(messages: BaseMessage[][]): LlmCallRecorder.AgentKind {
  const systemText = String(messages[0]?.[0]?.content ?? "");
  const match = AGENT_SIGNATURES.find(([, pattern]) =>
    pattern.test(systemText),
  );
  return match ? match[0] : "unknown";
}

function readUsage(output: LLMResult): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
} {
  const generation = output.generations?.[0]?.[0] as
    | { message?: { usage_metadata?: Record<string, unknown> } }
    | undefined;
  const usage = generation?.message?.usage_metadata ?? {};
  const details = (usage["input_token_details"] ?? {}) as Record<
    string,
    unknown
  >;

  return {
    inputTokens: numberOr(usage["input_tokens"], 0),
    outputTokens: numberOr(usage["output_tokens"], 0),
    cacheReadTokens: numberOr(details["cache_read"], 0),
  };
}

function readToolCalls(
  output: LLMResult,
): Array<{ name: string; args: Record<string, unknown> }> {
  const generation = output.generations?.[0]?.[0] as
    | {
        message?: {
          tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>;
        };
      }
    | undefined;

  return (generation?.message?.tool_calls ?? []).map((call) => ({
    name: call.name ?? "",
    args: call.args ?? {},
  }));
}

/** Pulls the accessibility tree back out of the prompt the agent sent. */
function extractTree(messages: BaseMessage[][]): string {
  for (const message of messages[0] ?? []) {
    const content = String(message.content ?? "");
    const fenced = /```xml\s*([\s\S]*?)```/.exec(content);
    if (fenced?.[1]) return fenced[1].trim();
  }
  return "";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
