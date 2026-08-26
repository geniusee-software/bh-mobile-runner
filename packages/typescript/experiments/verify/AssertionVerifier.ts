import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Alumni } from "../../src/client/Alumni.ts";
import { TreeFactory } from "../../src/tree/TreeFactory.ts";
import { withPlatformPreamble } from "../../src/server/agents/prompts/platformPreambles.ts";
import { failure, success, type StepVerifier } from "./StepVerifier.ts";

/** Element ids mean nothing to a judgement and only add tokens. */
const EXCLUDED_ATTRIBUTES = new Set(["id"]);

export const SYSTEM = [
  "You judge whether a test step's expected result is satisfied by a mobile app screen.",
  "",
  "You are given the screen's accessibility tree. Decide as an experienced QA engineer would:",
  "- Judge the substance of the expectation, not its wording. It was written by a person",
  "  describing a screen, so treat reasonable paraphrases as matches: a 'list of cards' is",
  "  satisfied by repeated rows of content, a screen 'titled X' by X appearing as a heading",
  "  or navigation-bar label.",
  "- An element counts as present when it is in the tree, including below the fold.",
  "- A quoted phrase is satisfied when the screen carries it, even inside a longer string:",
  "  \"No new notifications\" is satisfied by \"No new notifications yet\", and \"Popular Topics\"",
  "  by a heading reading \"Popular Topics\" followed by a count. The case quotes what a person",
  "  read off the screen, not a pattern to match character for character. It is NOT satisfied",
  "  when the screen says something else, or says the opposite.",
  "- Answer that it is not satisfied when the screen is plainly a different one, when the named",
  "  element is absent, or when the tree shows the opposite state.",
  "- Do not demand evidence the tree could never carry, such as colour, animation or exact layout.",
  "- When the expectation is about what is on display rather than what exists — which tab is open,",
  "  whether a popup is up or gone, which screen replaced which — judge it by what the tree marks",
  "  as not visible, and say so in OBSERVED.",
  "",
  "Answer in exactly two lines:",
  "OBSERVED: what the screen actually shows about the thing the expectation names.",
  "VERDICT: PASS or FAIL, then a dash, then one sentence of evidence.",
  "",
  "Describe before you judge, and judge only against what you described.",
].join("\n");

/**
 * Judges an expected result with a prompt written for judging.
 *
 * The shipped `check()` runs through the retriever, whose instructions tell it
 * to answer only from information "directly present" and to refuse otherwise.
 * That is right for extracting a value and wrong for deciding an assertion:
 * expectations are written in a person's words, so a strict reader rejects
 * screens that plainly satisfy them and the run loses steps it actually passed.
 *
 * The verdict comes back as one line of text rather than through structured
 * output, because structured output is a forced tool call and the open-weight
 * models answer it in prose often enough to lose whole cases to
 * "No tool calls found in the response".
 */
export class AssertionVerifier implements StepVerifier {
  readonly name = "assert";
  readonly #llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.#llm = llm;
  }

  async verify(alumni: Alumni, expectation: string) {
    alumni.driver.resetAccessibilityTree();
    const raw = await alumni.driver.getAccessibilityTree();

    // The same compaction the agents' own prompts get. The raw XCUITest dump is
    // an order of magnitude larger and mostly layout containers: sending it
    // would cost tokens the retriever path does not pay and bury the labels the
    // judgement turns on.
    const tree = TreeFactory.create(alumni.driver.platform, raw.toStr());
    const treeXml = tree.toXml(EXCLUDED_ATTRIBUTES);

    const response = await this.#llm.invoke([
      // The judge reads the same tree the agents do, so it needs the same
      // vocabulary for it — including what an unmarked element means.
      ["system", withPlatformPreamble(SYSTEM, alumni.driver.platform)],
      [
        "human",
        [
          `Expected result: ${expectation}`,
          "",
          "Screen accessibility tree:",
          "```xml",
          treeXml,
          "```",
        ].join("\n"),
      ],
    ]);

    const verdict = readVerdict(textOf(response.content));
    return verdict.passed
      ? success(verdict.reason, [this.name], treeXml)
      : failure(verdict.reason, [this.name], treeXml);
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

/**
 * Reads the one-line verdict.
 *
 * An unreadable answer counts as a failure rather than a pass: a verifier that
 * defaults to yes turns every parsing slip into a green step, which is the one
 * failure mode a test runner must not have.
 */
export function readVerdict(text: string): { passed: boolean; reason: string } {
  const trimmed = text.trim();

  // The judge describes before it decides, so read the verdict line when there
  // is one — the description above it may well contain the words PASS or FAIL.
  const verdictLine =
    /^\s*VERDICT\s*:\s*(.+)$/im.exec(trimmed)?.[1]?.trim() ?? trimmed;

  const match = /\b(PASS|FAIL)\b/i.exec(verdictLine);
  const reason = verdictLine
    .replace(/^\s*(PASS|FAIL)\b\s*[-–—:]?\s*/i, "")
    .trim();

  if (!match) {
    return {
      passed: false,
      reason: `Verifier gave no verdict: ${trimmed.slice(0, 200)}`,
    };
  }

  return {
    passed: match[1]!.toUpperCase() === "PASS",
    reason: reason || verdictLine.slice(0, 200),
  };
}
