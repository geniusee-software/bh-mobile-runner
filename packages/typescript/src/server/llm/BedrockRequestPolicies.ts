import type { DocumentType } from "@smithy/types";
import type { Model } from "../../Model.ts";
import type { BedrockRequestPolicy } from "./BedrockRequestPolicy.ts";
import { AnthropicBedrockPolicy } from "./policies/AnthropicBedrockPolicy.ts";
import { DefaultBedrockPolicy } from "./policies/DefaultBedrockPolicy.ts";
import { GptOssBedrockPolicy } from "./policies/GptOssBedrockPolicy.ts";

/**
 * Resolves the request policy for a Bedrock model.
 *
 * Policies are consulted in order and the first match wins, with the
 * catch-all last, so a new family is added by registering a policy rather than
 * by editing the factory that builds the client.
 */
export class BedrockRequestPolicies {
  static readonly default = new BedrockRequestPolicies([
    new AnthropicBedrockPolicy(),
    new GptOssBedrockPolicy(),
    new DefaultBedrockPolicy(),
  ]);

  readonly #policies: readonly BedrockRequestPolicy[];

  constructor(policies: readonly BedrockRequestPolicy[]) {
    if (!policies.length) {
      throw new Error("At least one Bedrock request policy is required");
    }
    this.#policies = policies;
  }

  policyFor(model: Model): BedrockRequestPolicy {
    const policy = this.#policies.find((candidate) => candidate.supports(model));
    if (!policy) {
      throw new Error(
        `No Bedrock request policy matched ${model.provider}/${model.name}; ` +
          "the registry must end with a catch-all policy.",
      );
    }
    return policy;
  }

  additionalRequestFields(model: Model): DocumentType {
    return this.policyFor(model).additionalRequestFields(model);
  }
}
