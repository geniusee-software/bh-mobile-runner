import type { DocumentType } from "@smithy/types";
import type { Model } from "../../../Model.ts";
import type { BedrockRequestPolicy } from "../BedrockRequestPolicy.ts";

/**
 * Fallback for families that take no extra request fields — Nova, Qwen, Llama.
 *
 * Sending them a field meant for another family is a 400, so the safe default
 * is to send nothing and let Bedrock apply the model's own defaults.
 */
export class DefaultBedrockPolicy implements BedrockRequestPolicy {
  readonly name = "default";

  supports(_model: Model): boolean {
    return true;
  }

  additionalRequestFields(_model: Model): DocumentType {
    return {};
  }
}
