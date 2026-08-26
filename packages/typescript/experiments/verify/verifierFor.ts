import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AssertionVerifier } from "./AssertionVerifier.ts";
import { VisionAssertionVerifier } from "./VisionAssertionVerifier.ts";
import type { StepVerifier } from "./StepVerifier.ts";
import {
  SecondOpinion,
  SettleAndRetry,
  TreeVerifier,
  VisionVerifier,
} from "./verifiers.ts";

/** Verification strategies an experiment can select by name. */
export const VERIFIER_KINDS = [
  "tree",
  "tree-retry",
  "tree-vision",
  "tree-retry-vision",
  "assert",
  "assert-retry",
  "assert-vision",
] as const;

export type VerifierKind = (typeof VERIFIER_KINDS)[number];

/**
 * Builds the verifier for a variant.
 *
 * Composition order matters: retrying wraps the tree check so a slow screen
 * gets a second read before the more expensive screenshot opinion is bought.
 */
export function verifierFor(
  kind: VerifierKind,
  llm: BaseChatModel,
): StepVerifier {
  switch (kind) {
    case "tree":
      return new TreeVerifier();
    case "tree-retry":
      return new SettleAndRetry(new TreeVerifier());
    case "tree-vision":
      return new SecondOpinion(new TreeVerifier(), new VisionVerifier());
    case "tree-retry-vision":
      return new SecondOpinion(
        new SettleAndRetry(new TreeVerifier()),
        new VisionVerifier(),
      );
    case "assert":
      return new AssertionVerifier(llm);
    case "assert-retry":
      return new SettleAndRetry(new AssertionVerifier(llm));
    case "assert-vision":
      // The screenshot is the second opinion, not the first: it costs image
      // tokens on every step it runs, and the tree answers most expectations.
      return new SecondOpinion(
        new SettleAndRetry(new AssertionVerifier(llm)),
        new VisionAssertionVerifier(llm),
      );
  }
}
