import type { TraceEvent, TrainingExample } from "../domain/TraceEvent.ts";

const SYSTEM_PROMPT = [
  "You perform one step of a test on a mobile application screen.",
  "Reason about the accessibility tree, then call exactly one tool to carry out the step.",
].join(" ");

/**
 * Renders a captured decision as a chat example.
 *
 * The assistant turn is the tool call the model made, serialised the way the
 * fine-tuning APIs expect, so a dataset can be exported without a second
 * transformation step. Only decisions from steps that passed are worth training
 * on, which is why the caller filters before reaching here rather than after.
 */
export function toTrainingExample(event: TraceEvent): TrainingExample {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Platform: ${event.platform}`,
          `Step: ${event.instruction}`,
          `Expected: ${event.expected || "(none)"}`,
          "Accessibility tree:",
          "```xml",
          event.treeXml,
          "```",
        ].join("\n"),
      },
      {
        role: "assistant",
        content: JSON.stringify({ tool_calls: event.toolCalls }),
      },
    ],
    metadata: {
      runId: event.runId,
      caseId: event.caseId,
      model: event.model,
      escalated: event.escalated,
    },
  };
}
