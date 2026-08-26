import { describe, expect, it } from "vitest";
import { readVerdict } from "./AssertionVerifier.ts";

describe("readVerdict", () => {
  it("reads a pass and its reason", () => {
    expect(readVerdict("PASS - the RECOMMENDED tab is selected")).toEqual({
      passed: true,
      reason: "the RECOMMENDED tab is selected",
    });
  });

  it("reads a fail", () => {
    expect(readVerdict("FAIL — the navigation bar reads 'Search'")).toEqual({
      passed: false,
      reason: "the navigation bar reads 'Search'",
    });
  });

  it("finds the verdict when the model adds a preamble", () => {
    const { passed } = readVerdict("Looking at the tree: PASS, the list is there.");
    expect(passed).toBe(true);
  });

  it("treats an unreadable answer as a failure", () => {
    // A verifier that defaults to yes turns a parsing slip into a green step.
    const { passed, reason } = readVerdict("I am not sure about this screen.");
    expect(passed).toBe(false);
    expect(reason).toMatch(/no verdict/i);
  });
});
