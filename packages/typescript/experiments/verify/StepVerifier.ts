import type { Alumni } from "../../src/client/Alumni.ts";

export namespace StepVerifier {
  export interface Outcome {
    passed: boolean;
    /** Why it failed, or how it was confirmed. */
    explanation: string;
    /** Verifiers that ran, in order, so a result can be attributed. */
    attempts: string[];
    /**
     * The tree the verdict was reached against, when the verifier read one.
     *
     * Carried so a pass can be audited for free: a step that passed while the
     * words its expectation quotes are nowhere on screen is a false positive,
     * and a lenient judge scores well on pass rate precisely by producing them.
     */
    treeXml?: string | undefined;
  }
}

/**
 * Decides whether a step left the app in the state its case expects.
 *
 * Verification is where a mobile run actually loses its pass rate, and there is
 * more than one way to be right about a screen — read the tree, look at it,
 * look again after it settles. Each way is a separate implementation so they
 * can be composed and measured against each other instead of being tangled
 * into one method with flags.
 */
export interface StepVerifier {
  readonly name: string;
  verify(alumni: Alumni, expectation: string): Promise<StepVerifier.Outcome>;
}

export function failure(
  explanation: string,
  attempts: string[],
  treeXml?: string,
): StepVerifier.Outcome {
  return { passed: false, explanation, attempts, treeXml };
}

export function success(
  explanation: string,
  attempts: string[],
  treeXml?: string,
): StepVerifier.Outcome {
  return { passed: true, explanation, attempts, treeXml };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Whether the failure is the app disagreeing rather than the harness breaking. */
export function isAssertion(error: unknown): boolean {
  return error instanceof Error && error.name === "AssertionError";
}
