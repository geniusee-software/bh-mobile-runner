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
    { explanation: "x", actions: '{"a": 1}' },
    { explanation: "x", actions: [1, 2] },
    { actions: ["tap Login"] },
  ])("refuses a plan it cannot read: %j", (structured) => {
    expect(PlannerAgent.readPlan(structured)).toBeNull();
  });
});
