import type { DocumentType } from "@smithy/types";
import type { Model } from "../../Model.ts";

/**
 * Per-model-family tuning of the Bedrock Converse request.
 *
 * Every family Bedrock hosts accepts a different set of `additionalModelRequestFields`,
 * and sending the wrong one is a hard 400 rather than a silently ignored key.
 * Each family gets its own policy so adding a model never means editing a
 * branch that other models also travel through.
 */
export interface BedrockRequestPolicy {
  /** Identifies the policy in logs. */
  readonly name: string;

  /** Whether this policy governs the given model. */
  supports(model: Model): boolean;

  /** Fields to merge into `additionalModelRequestFields` for this model. */
  additionalRequestFields(model: Model): DocumentType;
}
