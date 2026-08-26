import type { DocumentType } from "@smithy/types";
import { Env } from "../../../Env.ts";
import type { Model } from "../../../Model.ts";
import type { BedrockRequestPolicy } from "../BedrockRequestPolicy.ts";

/**
 * OpenAI's open-weight models served through Bedrock.
 *
 * gpt-oss reasons before every answer. Acting on one step of an already planned
 * goal needs the shortest of those, and deeper settings cost latency and output
 * tokens without changing the tool call that comes out.
 */
export class GptOssBedrockPolicy implements BedrockRequestPolicy {
  readonly name = "gpt-oss";

  supports(model: Model): boolean {
    return model.provider === "aws_openai";
  }

  additionalRequestFields(_model: Model): DocumentType {
    return { reasoning_effort: Env.ALUMNIUM_AWS_REASONING_EFFORT };
  }
}
