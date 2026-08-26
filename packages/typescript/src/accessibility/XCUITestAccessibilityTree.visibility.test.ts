import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Xml } from "../xml/Xml.ts";
import { XCUITestAccessibilityTree } from "./XCUITestAccessibilityTree.ts";

/**
 * The driver asks WebDriverAgent for on-screen matches and then takes the
 * agent's index into that list. So the index the tree reports has to be
 * counted in the same set — otherwise the tap lands on a different element,
 * and on this app that different element is usually the same label sitting on
 * a tab nobody is looking at, which accepts the tap and changes nothing.
 */
describe("XCUITestAccessibilityTree visibility", () => {
  const screen = `
    <XCUIElementTypeApplication raw_id="1" visible="true">
      <XCUIElementTypeOther raw_id="2" visible="false">
        <XCUIElementTypeStaticText raw_id="3" name="Highlights" visible="false"/>
      </XCUIElementTypeOther>
      <XCUIElementTypeStaticText raw_id="4" name="Highlights" visible="true"/>
      <XCUIElementTypeStaticText raw_id="5" name="Highlights" visible="true"/>
    </XCUIElementTypeApplication>
  `;

  it("counts a visible element among the visible ones only", () => {
    const tree = new XCUITestAccessibilityTree(screen);

    // Second of the two on screen, even though it is third in the document.
    expect(tree.elementById(5)).toMatchObject({
      name: "Highlights",
      visible: true,
      matchIndex: 1,
    });
  });

  it("counts a hidden element among the hidden ones only", () => {
    const tree = new XCUITestAccessibilityTree(screen);

    expect(tree.elementById(3)).toMatchObject({
      visible: false,
      matchIndex: 0,
    });
  });

  it("reports visibility from real dumps, where it is not inherited", async () => {
    const raw = await fs.readFile(
      new URL(
        "../../tests/unit/fixtures/tree/ios/xcuitest-1c175ec770b9e96d.xml",
        import.meta.url,
      ),
      "utf-8",
    );
    const withIds = new XCUITestAccessibilityTree(raw).toStr();

    // A node marked visible while an ancestor is hidden. 361 of the 2086 nodes
    // across the recorded screens look like this — a sheet over a hidden page,
    // a webview under a hidden wrapper — so the flag has to be read from the
    // element rather than derived from its parents.
    const found: number[] = [];
    const walk = (node: Xml.Node, hidden: boolean): void => {
      const tag = Xml.nodeAsTag(node);
      if (!tag) return;
      const visible = tag.attribs["visible"];
      if (hidden && visible === "true" && tag.attribs["raw_id"]) {
        found.push(Number(tag.attribs["raw_id"]));
      }
      for (const child of tag.children) {
        walk(child, hidden || visible === "false");
      }
    };
    for (const root of Xml.parseRootChildren(withIds)) walk(root, false);

    expect(found.length).toBeGreaterThan(0);
    expect(new XCUITestAccessibilityTree(raw).elementById(found[0]!).visible).toBe(
      true,
    );
  });
});
