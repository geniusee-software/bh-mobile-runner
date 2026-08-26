import { NullCache } from "../../src/server/cache/NullCache.ts";
import { LlmFactory } from "../../src/server/LlmFactory.ts";
import { Model } from "../../src/Model.ts";
import { SessionContext } from "../../src/server/session/SessionContext.ts";
import type { AppId } from "../../src/AppId.ts";
import type { Variant } from "../config/variants.ts";

/**
 * Calls every model a run will need, before the run can cost anything.
 *
 * A model that cannot be reached does not stop the runner: each step turns into
 * an errored step and the run completes, reporting a pass rate of zero that
 * looks exactly like a quality result. That is the expensive way to discover a
 * missing region — twenty cases and eight minutes of device time to learn that
 * `AWS_REGION_NAME` was unset and every `eu.` inference profile was therefore
 * being addressed in us-east-1, where it does not exist.
 *
 * Two seconds and two tokens per model buys the same answer up front.
 */
export async function preflight(
  variants: readonly Variant.Props[],
): Promise<void> {
  const names = new Set<string>();
  for (const variant of variants) {
    names.add(variant.model);
    if (variant.verifierModel) names.add(variant.verifierModel);
  }

  const failures: string[] = [];
  for (const name of names) {
    try {
      const llm = LlmFactory.createLlm(
        Model.parse(name),
        new NullCache(
          new SessionContext({ app: "preflight" as AppId, sessionId: "preflight" }),
        ),
      );
      await llm.invoke([["human", "ok"]]);
      console.log(`  reachable  ${name}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`  UNREACHABLE ${name} — ${reason}`);
      failures.push(name);
    }
  }

  if (failures.length) {
    throw new Error(
      `${failures.length} of ${names.size} models are unreachable. ` +
        `Check AWS_REGION_NAME (regional inference profiles named eu.* only ` +
        `exist in eu-*) and AWS_PROFILE before spending device time.`,
    );
  }
}
