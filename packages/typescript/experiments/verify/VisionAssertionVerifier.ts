import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Alumni } from "../../src/client/Alumni.ts";
import { readVerdict } from "./AssertionVerifier.ts";
import { failure, success, type StepVerifier } from "./StepVerifier.ts";

const SYSTEM = [
  "You judge whether a test step's expected result is satisfied by a screenshot",
  "of a mobile app screen.",
  "",
  "Decide as an experienced QA engineer would:",
  "- Judge the substance of the expectation, not its wording.",
  "- You can see what an accessibility tree cannot: which tab is highlighted,",
  "  whether a control looks enabled, what an image shows. Use that.",
  "- Say it is not satisfied when the screen is plainly a different one, or when",
  "  the named element is simply not visible.",
  "",
  "Answer in exactly two lines:",
  "OBSERVED: what the screen actually shows about the thing the expectation names.",
  "VERDICT: PASS or FAIL, then a dash, then one sentence of evidence.",
  "",
  "Describe before you judge, and judge only against what you described.",
].join("\n");

/**
 * Judges an expected result from a screenshot.
 *
 * Some states exist only in pixels. Measured on Path4Life, the active and
 * inactive feed tabs serialise identically — `<Button name="DAILY SHIURIM" />`
 * beside `<Button name="RECOMMENDED" />` — because XCUITest's snapshot has no
 * attribute for selection at all, so "the DAILY SHIURIM tab is now active" is
 * unanswerable from a tree however the prompt is written.
 *
 * This runs the same judging prompt as the tree verifier, against an image, so
 * the two differ only in what they are looking at.
 */
export class VisionAssertionVerifier implements StepVerifier {
  readonly name = "vision-assert";
  readonly #llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.#llm = llm;
  }

  async verify(alumni: Alumni, expectation: string) {
    const screenshot = await alumni.driver.screenshot();

    const response = await this.#llm.invoke([
      new SystemMessage(SYSTEM),
      new HumanMessage({
        content: [
          { type: "text", text: `Expected result: ${expectation}` },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${screenshot}` },
          },
        ],
      }),
    ]);

    const verdict = readVerdict(textOf(response.content));
    // No tree is read here, so a pass from this verifier cannot be audited
    // against one; that is the price of seeing what the tree cannot.
    return verdict.passed
      ? success(verdict.reason, [this.name])
      : failure(verdict.reason, [this.name]);
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) =>
      typeof part === "object" && part && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}
