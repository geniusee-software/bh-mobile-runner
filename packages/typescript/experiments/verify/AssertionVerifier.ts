import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import z from "zod";
import type { Alumni } from "../../src/client/Alumni.ts";
import { failure, success, type StepVerifier } from "./StepVerifier.ts";

const Verdict = z.object({
  satisfied: z
    .boolean()
    .describe("Whether the expected result is satisfied by the screen"),
  reason: z.string().describe("One sentence of evidence from the tree"),
});

const SYSTEM = [
  "You judge whether a test step's expected result is satisfied by a mobile app screen.",
  "",
  "You are given the screen's accessibility tree. Decide as an experienced QA engineer would:",
  "- Judge the substance of the expectation, not its wording. The expectation was written by",
  "  a person describing a screen, so treat reasonable paraphrases as matches: a 'list of cards'",
  "  is satisfied by repeated rows of content, a screen 'titled X' by X appearing as a heading",
  "  or navigation-bar label.",
  "- An element counts as present when it is in the tree, including below the fold.",
  "- Say it is not satisfied when the screen is plainly a different one, when the named element",
  "  is absent, or when the tree shows the opposite state.",
  "- Do not require evidence the tree could never carry, such as colour, animation or exact layout.",
].join("\n");

/**
 * Judges an expected result with a prompt written for judging.
 *
 * The shipped `check()` runs through the retriever, whose instructions tell it
 * to answer only from information "directly present" and to refuse otherwise.
 * That is right for extracting a value and wrong for deciding an assertion:
 * expectations are written in a person's words, so a strict reader rejects
 * screens that plainly satisfy them and the run loses steps it actually passed.
 */
export class AssertionVerifier implements StepVerifier {
  readonly name = "assert";
  readonly #llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.#llm = llm;
  }

  async verify(alumni: Alumni, expectation: string) {
    alumni.driver.resetAccessibilityTree();
    const tree = await alumni.driver.getAccessibilityTree();

    const response = await this.#llm
      .withStructuredOutput(Verdict)
      .invoke([
        ["system", SYSTEM],
        [
          "human",
          [
            `Expected result: ${expectation}`,
            "",
            "Screen accessibility tree:",
            "```xml",
            tree.toStr(),
            "```",
          ].join("\n"),
        ],
      ]);

    return response.satisfied
      ? success(response.reason, [this.name])
      : failure(response.reason, [this.name]);
  }
}
