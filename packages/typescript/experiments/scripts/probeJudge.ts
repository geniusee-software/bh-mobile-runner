/**
 * Asks the judge the exact question it got wrong, against the tree it saw.
 *
 * A prompt change is cheap to make and easy to fool yourself about: the run it
 * was meant to fix takes half an hour, and by then a dozen other things have
 * moved. This replays one recorded screen and asks both the question that
 * should pass and one that must not, so the rule can be checked in seconds.
 */
import { ChatBedrockConverse } from "@langchain/aws";
import { readVerdict, SYSTEM } from "../verify/AssertionVerifier.ts";
import { withPlatformPreamble } from "../../src/server/agents/prompts/platformPreambles.ts";
import { RESULTS_DIR } from "../config/suite.ts";

const traces = (await Bun.file(`${RESULTS_DIR}/bestfull/traces.jsonl`).text())
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .filter((trace) => /No new notifications/.test(trace.treeXml ?? ""));

const treeXml = traces[0]?.treeXml;
if (!treeXml) throw new Error("no recorded tree carries that screen");

const llm = new ChatBedrockConverse({
  model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  region: process.env["AWS_REGION_NAME"] ?? "eu-central-1",
});

// The screen reads "No new notifications yet".
const questions = [
  { expected: "The text 'No new notifications' is displayed on the screen.", want: true },
  { expected: "The text 'You have 5 unread notifications' is displayed on the screen.", want: false },
  { expected: "A 'Back' button is visible in the navigation bar.", want: true },
];

for (const question of questions) {
  const response = await llm.invoke([
    ["system", withPlatformPreamble(SYSTEM, "xcuitest")],
    ["human", `Expected result: ${question.expected}\n\nScreen accessibility tree:\n\`\`\`xml\n${treeXml}\n\`\`\``],
  ]);
  const content = response.content;
  const verdict = readVerdict(typeof content === "string" ? content : JSON.stringify(content));
  const ok = verdict.passed === question.want;
  console.log(
    `${ok ? "OK   " : "WRONG"} expected ${question.want ? "PASS" : "FAIL"}, got ${verdict.passed ? "PASS" : "FAIL"} — ${question.expected.slice(0, 54)}`,
  );
  console.log(`      ${verdict.reason.slice(0, 108)}`);
}
