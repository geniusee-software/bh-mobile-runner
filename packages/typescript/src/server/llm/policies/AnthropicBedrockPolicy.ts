import type { DocumentType } from "@smithy/types";
import type { Model } from "../../../Model.ts";
import type {
  BedrockRequestPolicy,
  ToolChoiceValue,
} from "../BedrockRequestPolicy.ts";

/**
 * Claude models served through Bedrock Converse.
 *
 * Extended thinking is deliberately left off. The planner, retriever, locator
 * and area agents all reach the model through `withStructuredOutput`, which
 * pins `tool_choice` to a single tool, and Bedrock rejects that combination
 * outright: "Thinking may not be enabled when tool_choice forces tool use."
 * Since one chat model instance is shared by every agent in a session, the
 * setting has to satisfy the strictest caller, so thinking stays disabled.
 *
 * Tool choice is stated, not guessed: `@langchain/aws` forces the structured
 * output tool only for ids it knows (`claude-3`, `claude-4`, `claude-*-4`), so a
 * Claude 5 model ran without `tool_choice`, sometimes answered in prose, and the
 * planner read a null plan ("null is not an object (evaluating
 * 'structured.explanation')"). Every Claude on Bedrock takes all three values.
 */
export class AnthropicBedrockPolicy implements BedrockRequestPolicy {
  readonly name = "anthropic";

  supports(model: Model): boolean {
    return model.provider === "aws_anthropic";
  }

  additionalRequestFields(_model: Model): DocumentType {
    return {};
  }

  toolChoiceValues(_model: Model): ToolChoiceValue[] {
    return ["auto", "any", "tool"];
  }
}
