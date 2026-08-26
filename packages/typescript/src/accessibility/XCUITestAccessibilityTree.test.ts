import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { XCUITestAccessibilityTree } from "./XCUITestAccessibilityTree.ts";

const SIMPLE_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/simple_xcuitest_accessibility_tree.xml",
);

describe("XCUITestAccessibilityTree", () => {
  describe("elementById", () => {
    it("returns correct element for given ID", async () => {
      const xml = await fs.readFile(SIMPLE_FIXTURE_PATH, "utf-8");
      const tree = new XCUITestAccessibilityTree(xml);
      expect(tree.elementById(74)).toMatchObject({
        id: 74,
        name: "Continue",
        type: "XCUIElementTypeButton",
      });
    });
  });

  describe("scopeToArea", () => {
    it("returns the original tree when the element is not found", async () => {
      const xml = await fs.readFile(SIMPLE_FIXTURE_PATH, "utf-8");
      const tree = new XCUITestAccessibilityTree(xml);

      expect(tree.scopeToArea(99999).toStr()).toBe(tree.toStr());
    });
  });
});

describe("containsWebview", () => {
  it("is false for a native-only screen", async () => {
    const xml = await fs.readFile(SIMPLE_FIXTURE_PATH, "utf-8");

    expect(new XCUITestAccessibilityTree(xml).containsWebview()).toBe(false);
  });

  it("is true when a web view is present", () => {
    const xml = `<AppiumAUT><XCUIElementTypeApplication name="App">
      <XCUIElementTypeWebView name="content" />
    </XCUIElementTypeApplication></AppiumAUT>`;

    expect(new XCUITestAccessibilityTree(xml).containsWebview()).toBe(true);
  });
});

describe("matchIndex", () => {
  const feed = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="play" />
    <XCUIElementTypeOther type="XCUIElementTypeOther">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="play" />
    </XCUIElementTypeOther>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="play" />
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="options" />
  </XCUIElementTypeApplication></AppiumAUT>`;

  it("counts identical elements in document order", () => {
    // A locator built from any of these matches all three; only the position
    // says which one the agent actually chose.
    const tree = new XCUITestAccessibilityTree(feed);

    expect(tree.elementById(3).matchIndex).toBe(0);
    expect(tree.elementById(5).matchIndex).toBe(1);
    expect(tree.elementById(6).matchIndex).toBe(2);
  });

  it("is zero for an element nothing else matches", () => {
    const tree = new XCUITestAccessibilityTree(feed);

    expect(tree.elementById(7).matchIndex).toBe(0);
  });
});
