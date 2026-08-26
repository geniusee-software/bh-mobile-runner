import type { DocumentType } from "@smithy/types";
import type { Model } from "../../../Model.ts";
import type { BedrockRequestPolicy } from "../BedrockRequestPolicy.ts";

/**
 * Claude models served through Bedrock Converse.
 *
 * Extended thinking is deliberately left off. The planner, retriever, locator
 * and area agents all reach the model through `withStructuredOutput`, which
 * pins `tool_choice` to a single tool, and Bedrock rejects that combination
 * outright: "Thinking may not be enabled when tool_choice forces tool use."
 * Since one chat model instance is shared by every agent in a session, the
 * setting has to satisfy the strictest caller, so thinking stays disabled.
 */
export class AnthropicBedrockPolicy implements BedrockRequestPolicy {
  readonly name = "anthropic";

  supports(model: Model): boolean {
    return model.provider === "aws_anthropic";
  }

  additionalRequestFields(_model: Model): DocumentType {
    return {};
  }
}
