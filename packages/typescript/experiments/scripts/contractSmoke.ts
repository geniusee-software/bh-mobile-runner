/**
 * Contract check for a candidate actor model.
 *
 * The actor is only usable if the provider returns tool calls as structured
 * blocks. Bedrock-hosted open-weight models have been known to describe the
 * call in prose instead, which every downstream layer would read as "the model
 * chose to do nothing" — so this runs before any model is benchmarked.
 *
 * Run: bun experiments/scripts/contractSmoke.ts [model...]
 */
import type { AppId } from "../../src/AppId.ts";
import { NullCache } from "../../src/server/cache/NullCache.ts";
import { LlmFactory } from "../../src/server/LlmFactory.ts";
import { SessionContext } from "../../src/server/session/SessionContext.ts";
import { Model } from "../../src/Model.ts";
import { ClickTool } from "../../src/tools/ClickTool.ts";
import { TypeTool } from "../../src/tools/TypeTool.ts";
import { convertToolsToSchemas } from "../../src/tools/toolToSchemaConverter.ts";
import { Logger } from "../../src/telemetry/Logger.ts";
import { CANDIDATE_MODELS } from "../config/models.ts";

Logger.level = "warning";

const TREE = `<XCUIElementTypeApplication raw_id="1" name="Path4Life">
  <XCUIElementTypeOther raw_id="2">
    <XCUIElementTypeStaticText raw_id="3" name="Enjoy daily Path4Life lectures" />
    <XCUIElementTypeButton raw_id="4" name="LOG IN" label="LOG IN" />
    <XCUIElementTypeButton raw_id="5" name="REGISTER" label="REGISTER" />
    <XCUIElementTypeButton raw_id="6" name="Skip and explore the app" />
  </XCUIElementTypeOther>
</XCUIElementTypeApplication>`;

const GOAL = "sign in to the application";
const STEP = 'tap the "LOG IN" button';

const toolSchemas = convertToolsToSchemas({ ClickTool, TypeTool });

interface Verdict {
  model: string;
  ok: boolean;
  latencyMs: number;
  toolCalls: string;
  detail: string;
}

async function checkModel(modelStr: string): Promise<Verdict> {
  const startedAt = performance.now();
  try {
    const model = Model.parse(modelStr);
    const sessionContext = new SessionContext({
      app: "contract-smoke" as AppId,
      sessionId: `contract-${Date.now()}`,
    });
    const llm = LlmFactory.createLlm(model, new NullCache(sessionContext));
    if (!llm.bindTools) throw new Error("Provider cannot bind tools");

    const response = await llm.bindTools(toolSchemas).invoke([
      [
        "system",
        "You perform one step of a test on a mobile screen. " +
          "Reason about the accessibility tree, then call exactly one tool.",
      ],
      ["human", `Goal: ${GOAL}\nStep: ${STEP}\nAccessibility tree:\n\n${TREE}`],
    ]);

    const toolCalls = response.tool_calls ?? [];
    const latencyMs = Math.round(performance.now() - startedAt);
    const clickedRightButton =
      toolCalls.length === 1 &&
      toolCalls[0]?.name === "ClickTool" &&
      Number(toolCalls[0]?.args?.["id"]) === 4;

    return {
      model: modelStr,
      ok: clickedRightButton,
      latencyMs,
      toolCalls: JSON.stringify(
        toolCalls.map((call) => ({ name: call.name, args: call.args })),
      ),
      detail: clickedRightButton
        ? `${response.usage_metadata?.input_tokens ?? "?"} in / ${response.usage_metadata?.output_tokens ?? "?"} out tokens`
        : `unexpected calls; text: ${String(response.content).slice(0, 160)}`,
    };
  } catch (error) {
    return {
      model: modelStr,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      toolCalls: "[]",
      detail: error instanceof Error ? error.message.slice(0, 220) : String(error),
    };
  }
}

const requested = process.argv.slice(2);
const models = requested.length ? requested : CANDIDATE_MODELS;

for (const modelStr of models) {
  const verdict = await checkModel(modelStr);
  console.log(`${verdict.ok ? "PASS" : "FAIL"}  ${verdict.model}`);
  console.log(`      latency: ${verdict.latencyMs}ms`);
  console.log(`      calls:   ${verdict.toolCalls}`);
  console.log(`      detail:  ${verdict.detail}\n`);
}
