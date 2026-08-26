import type { Alumni } from "../../src/client/Alumni.ts";
import { sleep } from "../../src/drivers/tree/TreeReadStrategy.ts";
import {
  describeError,
  failure,
  isAssertion,
  success,
  type StepVerifier,
} from "./StepVerifier.ts";

/** Asks the retriever to judge the expectation from the accessibility tree. */
export class TreeVerifier implements StepVerifier {
  readonly name = "tree";

  async verify(alumni: Alumni, expectation: string) {
    try {
      const explanation = await alumni.check(expectation);
      return success(explanation, [this.name]);
    } catch (error) {
      if (!isAssertion(error)) throw error;
      return failure(describeError(error), [this.name]);
    }
  }
}

/** Judges the expectation from a screenshot instead of the tree. */
export class VisionVerifier implements StepVerifier {
  readonly name = "vision";

  async verify(alumni: Alumni, expectation: string) {
    try {
      const explanation = await alumni.check(expectation, { vision: true });
      return success(explanation, [this.name]);
    } catch (error) {
      if (!isAssertion(error)) throw error;
      return failure(describeError(error), [this.name]);
    }
  }
}

/**
 * Re-runs a verifier after a pause when it first says no.
 *
 * The screen a step produces is often still animating when the first read
 * lands, and a tree captured mid-transition genuinely does not contain what
 * the case is asking for. One retry separates "not there" from "not there yet".
 */
export class SettleAndRetry implements StepVerifier {
  readonly name: string;
  readonly #inner: StepVerifier;
  readonly #waitMs: number;

  constructor(inner: StepVerifier, waitMs = 1200) {
    this.#inner = inner;
    this.#waitMs = waitMs;
    this.name = `retry(${inner.name})`;
  }

  async verify(alumni: Alumni, expectation: string) {
    const first = await this.#inner.verify(alumni, expectation);
    if (first.passed) return first;

    await sleep(this.#waitMs);
    const second = await this.#inner.verify(alumni, expectation);
    return {
      ...second,
      attempts: [...first.attempts, ...second.attempts],
    };
  }
}

/**
 * Falls back to a second opinion when the first verifier says no.
 *
 * The tree is cheap and usually right, but it cannot see anything the app
 * renders without exposing — an image, a state drawn rather than labelled. A
 * screenshot answers those, so it is worth one extra call on the failures
 * rather than on every step.
 */
export class SecondOpinion implements StepVerifier {
  readonly name: string;
  readonly #primary: StepVerifier;
  readonly #fallback: StepVerifier;

  constructor(primary: StepVerifier, fallback: StepVerifier) {
    this.#primary = primary;
    this.#fallback = fallback;
    this.name = `${primary.name}->${fallback.name}`;
  }

  async verify(alumni: Alumni, expectation: string) {
    const first = await this.#primary.verify(alumni, expectation);
    if (first.passed) return first;

    const second = await this.#fallback.verify(alumni, expectation);
    return {
      ...second,
      attempts: [...first.attempts, ...second.attempts],
    };
  }
}
