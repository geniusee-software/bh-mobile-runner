import { describe, expect, it } from "vitest";
import { Model } from "../../Model.ts";
import { BedrockRequestPolicies } from "./BedrockRequestPolicies.ts";

const policies = BedrockRequestPolicies.default;

describe("BedrockRequestPolicies", () => {
  describe("anthropic", () => {
    it("sends no thinking fields", () => {
      // Four of six agents reach the model through `withStructuredOutput`,
      // which pins tool_choice, and Bedrock rejects thinking alongside it.
      const model = Model.parse(
        "aws_anthropic/eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      );

      expect(policies.policyFor(model).name).toBe("anthropic");
      expect(policies.additionalRequestFields(model)).toEqual({});
    });
  });

  describe("gpt-oss", () => {
    it("asks for the shortest reasoning", () => {
      const model = Model.parse("aws_openai/openai.gpt-oss-120b-1:0");

      expect(policies.policyFor(model).name).toBe("gpt-oss");
      expect(policies.additionalRequestFields(model)).toEqual({
        reasoning_effort: "low",
      });
    });
  });

  describe("families with no tuning", () => {
    it.each([
      ["aws_qwen/qwen.qwen3-235b-a22b-2507-v1:0"],
      ["aws_amazon/eu.amazon.nova-2-lite-v1:0"],
      ["aws_meta/us.meta.llama4-maverick-17b-instruct-v1:0"],
    ])("sends nothing extra for %s", (modelString) => {
      // Sending another family's field is a 400, not an ignored key.
      const model = Model.parse(modelString);

      expect(policies.policyFor(model).name).toBe("default");
      expect(policies.additionalRequestFields(model)).toEqual({});
    });
  });

  describe("registry", () => {
    it("refuses to be built without policies", () => {
      expect(() => new BedrockRequestPolicies([])).toThrow(
        /at least one/i,
      );
    });

    it("reports when nothing matches instead of guessing", () => {
      const noneMatch = new BedrockRequestPolicies([
        {
          name: "never",
          supports: () => false,
          additionalRequestFields: () => ({}),
        },
      ]);

      expect(() =>
        noneMatch.policyFor(Model.parse("aws_qwen/qwen.qwen3-32b-v1:0")),
      ).toThrow(/catch-all/);
    });
  });
});
