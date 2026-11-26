import { describe, expect, it } from "vitest";
import { PlannerAgent } from "./PlannerAgent.ts";

describe("PlannerAgent.readPlan", () => {
  it("keeps a well-formed plan and drops empty actions", () => {
    expect(
      PlannerAgent.readPlan({
        explanation: "Tap Login",
        actions: ["tap Login", ""],
      }),
    ).toEqual({ explanation: "Tap Login", actions: ["tap Login"] });
  });

  it("reads actions the model returned as a JSON string", () => {
    expect(
      PlannerAgent.readPlan({
        explanation: "Tap Login",
        actions: '["tap Login", "type email"]',
      }),
    ).toEqual({
      explanation: "Tap Login",
      actions: ["tap Login", "type email"],
    });
  });

  it("reads actions written as the list the prompt's examples show", () => {
    // Haiku 5.5 copied `Actions: ['click button "Foobar"']` into the field (sandbox, 2026-11-26).
    expect(
      PlannerAgent.readPlan({
        explanation: "Swipe the onboarding pages",
        actions: `['swipe element "onboarding-container" left', 'tap button "Next"']`,
      }),
    ).toEqual({
      explanation: "Swipe the onboarding pages",
      actions: [
        'swipe element "onboarding-container" left',
        'tap button "Next"',
      ],
    });
  });

  it("keeps an escaped quote inside an action of that list", () => {
    expect(
      PlannerAgent.readPlan({
        explanation: "x",
        actions: String.raw`['tap button "Don\'t allow"']`,
      }),
    ).toEqual({ explanation: "x", actions: [`tap button "Don't allow"`] });
  });

  it("accepts an empty plan: nothing to do is a valid answer", () => {
    expect(
      PlannerAgent.readPlan({ explanation: "Nothing to do", actions: [] }),
    ).toEqual({
      explanation: "Nothing to do",
      actions: [],
    });
  });

  it.each([
    null,
    "tap Login",
    { explanation: "x" },
    { explanation: "x", actions: "tap Login" },
    { explanation: "x", actions: "[tap Login]" },
    { explanation: "x", actions: "['tap Login', 42]" },
    { explanation: "x", actions: '{"a": 1}' },
    { explanation: "x", actions: [1, 2] },
    { actions: ["tap Login"] },
  ])("refuses a plan it cannot read: %j", (structured) => {
    expect(PlannerAgent.readPlan(structured)).toBeNull();
  });
});
