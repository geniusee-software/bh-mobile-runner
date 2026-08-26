import type { TestCase } from "./TestCase.ts";

export namespace Eligibility {
  export type Blocker =
    | "volatile-content"
    | "requires-account"
    | "requires-prior-state";

  export interface Verdict {
    runnable: boolean;
    blockers: Blocker[];
    /** Human-readable reasons, for the audit report. */
    reasons: string[];
  }

  export interface Environment {
    /** Whether the app under test is signed in to an account. */
    signedIn: boolean;
    /** Whether the install carries playback, download or subscription history. */
    hasUsageHistory: boolean;
  }
}

/**
 * Text that pins a case to content the app rotates.
 *
 * A generated case quotes whatever was on screen the day it was written. When
 * that is a navigation label it stays true; when it is a dated feed item —
 * "Daf 115", "Aug 24, 2026", "2:18 min" — the case stops being runnable as soon
 * as the feed moves on, and it fails for reasons no runner can fix.
 */
const VOLATILE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["a calendar date", /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/],
  ["a duration", /\b\d{1,2}:\d{2}\s*min\b/],
  ["a numbered item", /\b(Shiur|Daf|Perek|Chelek)\s+\d+/i],
  ["a weekday", /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*\d/],
  ["an item count", /\b\d{2,},?\s*Shiurim\b/i],
];

/**
 * Surfaces that only exist behind a sign-in.
 *
 * The suite was generated while signed in, so it walks into the profile, the
 * followed-series list and notification settings as if they were always there.
 * Run as a guest, those steps land on the registration screen instead — the
 * step is impossible rather than failed, and counting it as a failure hides how
 * the runner is doing on everything else.
 */
const ACCOUNT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["the profile screen", /\bprofile screen\b|\bavatar button\b/i],
  // The gap is generous on purpose: "Follow a second recommended series" sits
  // just past a tighter window and slipped through as runnable.
  ["followed series", /\bfollow(ed|ing)?\b.{0,40}\bseries\b|\bunfollow\b/i],
  ["notification settings", /\bnotification (preference|setting)/i],
  ["the user's own details", /\buser's (name|email|country)\b/i],
];

/**
 * State a fresh install does not have.
 *
 * The generator walked an account that had already listened, downloaded and
 * subscribed, so it wrote cases that assert on the residue of that history.
 * Launched clean, the app has none of it, and the step is impossible rather
 * than failed.
 */
const PRIOR_STATE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["playback history", /\bmarked as played\b|\bcontinue listening\b|\bresume\b/i],
  ["downloads", /\bdownloaded\b|\boffline\b/i],
  ["a prior subscription", /\bsubscribed\b|\bmy (series|list)\b/i],
];

function matches(
  text: string,
  patterns: ReadonlyArray<[string, RegExp]>,
): string[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
}

function textOf(testCase: TestCase): string {
  return [
    testCase.title,
    testCase.origin,
    ...testCase.steps.flatMap((step) => [step.action, step.expected]),
  ].join(" ");
}

/**
 * Decides whether a case can be judged at all in this environment.
 *
 * Keeping this separate from the run is what lets a pass rate mean something:
 * a case the environment cannot satisfy tells you nothing about the runner, and
 * mixing the two produces a number that only ever goes down.
 */
export function eligibilityOf(
  testCase: TestCase,
  environment: Eligibility.Environment,
): Eligibility.Verdict {
  const text = textOf(testCase);
  const blockers: Eligibility.Blocker[] = [];
  const reasons: string[] = [];

  const volatile = matches(text, VOLATILE_PATTERNS);
  if (volatile.length) {
    blockers.push("volatile-content");
    reasons.push(...volatile);
  }

  if (!environment.signedIn) {
    const account = matches(text, ACCOUNT_PATTERNS);
    if (account.length) {
      blockers.push("requires-account");
      reasons.push(...account);
    }
  }

  if (!environment.hasUsageHistory) {
    const priorState = matches(text, PRIOR_STATE_PATTERNS);
    if (priorState.length) {
      blockers.push("requires-prior-state");
      reasons.push(...priorState);
    }
  }

  return { runnable: blockers.length === 0, blockers, reasons };
}

export function runnableCases(
  cases: readonly TestCase[],
  environment: Eligibility.Environment,
): TestCase[] {
  return cases.filter((testCase) => eligibilityOf(testCase, environment).runnable);
}
