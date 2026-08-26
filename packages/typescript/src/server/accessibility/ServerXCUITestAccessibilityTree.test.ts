import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ServerXCUITestAccessibilityTree } from "./ServerXCUITestAccessibilityTree.ts";

describe(ServerXCUITestAccessibilityTree, () => {
  it("converts an XCUITest tree", async () => {
    const xml = (
      await fixtureTree("simple_xcuitest_accessibility_tree")
    ).toXml();

    expect(xml).toMatchInlineSnapshot(`
      "<Application id=1>
        <Window id=2>
          <div id=3 visible="false">
            <div id=4 visible="false">
              <div id=5 visible="false">
                <NavigationBar name="BLTNBoard.BulletinView" id=6 visible="false">
                  <Button name="ToDoList" id=7 visible="false" />
                  <Button name="settingsIcon" id=8 visible="false" />
                </NavigationBar>
                <div id=9 visible="false">
                  <div id=10 visible="false">
                    <div id=11 visible="false">
                      <Table id=12 visible="false">
                        <Cell id=13 visible="false">
                          <div id=14 visible="false">0</div>
                          <div id=17 visible="false">All Tasks</div>
                        </Cell>
                        <Cell id=21 visible="false">
                          <div id=22 visible="false">0</div>
                          <div id=25 visible="false">Today</div>
                        </Cell>
                        <Cell id=28 visible="false">
                          <div id=29 visible="false">0</div>
                          <div id=32 visible="false">Tomorrow</div>
                        </Cell>
                        <Cell id=35 visible="false">
                          <div id=36 visible="false">0</div>
                          <div id=39 visible="false">Next 7 Days</div>
                        </Cell>
                        <Cell id=42 visible="false">
                          <div id=45 visible="false">Custom Interval</div>
                        </Cell>
                        <Cell id=48 visible="false">
                          <div id=49 visible="false">0</div>
                          <div id=52 visible="false">Completed</div>
                        </Cell>
                        <div name="Vertical scroll bar, 1 page" id=55 value="0%" visible="false" />
                        <div name="Horizontal scroll bar, 1 page" id=57 value="0%" visible="false" />
                      </Table>
                      <Button id=59 visible="false">
                        <div id=60 visible="false">Add Task</div>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id=66>
            <div id=68>Welcome to ToDoList</div>
            <Image name="roundedIcon" id=69 />
            <div id=70>Start with a quick onboarding</div>
            <Button id=73>
              <div id=74>Continue</div>
              <Image name="checkmark.circle" id=75 label="Selected" />
              <TextField name="maskedElement" id=76 value="Entered value" label="Enter Code" />
            </Button>
          </div>
        </Window>
      </Application>"
    `);
  });

  it("trims empty and duplicated generic wrappers", async () => {
    const tree = await fixtureTree("duplicated_xcuitest_accessibility_tree");

    expect(tree.toXml()).toMatchInlineSnapshot(`
      "<Application name="FooBar" id=1>
        <Window id=2>
          <div id=40>
            <div name="IconFooBar" id=47 />
            <div id=50>Welcome to the new FooBar app!</div>
            <div id=51>We're happy to have you!</div>
          </div>
          <div id=52>Reveal exclusive perks, save lots on stuff, and find gifts for everyone. Start acting today!</div>
          <div name="onboarding-footer-button" id=54>
            <Button name="Start Now" id=56 />
          </div>
        </Window>
      </Application>"
    `);
  });

  it("does not mutate the tree while serializing", async () => {
    const tree = await fixtureTree("duplicated_xcuitest_accessibility_tree");
    const xml = tree.toXml();

    tree.toXml(new Set(["name", "label", "value"]));

    expect(tree.toXml()).toBe(xml);
  });

  it("promotes StaticText labels while keeping value fallbacks as attributes", () => {
    const tree = new ServerXCUITestAccessibilityTree(`
      <XCUIElementTypeApplication raw_id="1">
        <XCUIElementTypeOther raw_id="2">
          <XCUIElementTypeStaticText raw_id="3" name=" " label="  Label  " value="Value"/>
          <XCUIElementTypeStaticText raw_id="4" name=" " label=" " value="  Value  "/>
          <XCUIElementTypeStaticText raw_id="5" name=" " label=" " value="      "/>
        </XCUIElementTypeOther>
      </XCUIElementTypeApplication>
    `);

    expect(tree.toXml()).toMatchInlineSnapshot(`
      "<Application id=1>
        <div id=3 value="Value">Label</div>
        <div name="Value" id=4 />
      </Application>"
    `);
  });

  it("keeps StaticText names as metadata and promotes only labels", () => {
    const tree = new ServerXCUITestAccessibilityTree(`
      <XCUIElementTypeApplication raw_id="1">
        <XCUIElementTypeStaticText raw_id="2"
          name="TrackersPreventedCount?TrackingPreventionDataExists=false"
          label="In the last seven days, Safari has prevented 0 trackers from profiling you."
          value="In the last seven days, Safari has prevented 0 trackers from profiling you."/>
        <XCUIElementTypeStaticText raw_id="3" name="InternalName" value="Visible value"/>
      </XCUIElementTypeApplication>
    `);

    expect(tree.toXml()).toMatchInlineSnapshot(`
      "<Application id=1>
        <div name="TrackersPreventedCount?TrackingPreventionDataExists=false" id=2>In the last seven days, Safari has prevented 0 trackers from profiling you.</div>
        <div name="InternalName" id=3 value="Visible value" />
      </Application>"
    `);
  });

  it("collapses matching StaticText labels into semantic parents", () => {
    const tree = new ServerXCUITestAccessibilityTree(`
      <XCUIElementTypeApplication raw_id="1">
        <XCUIElementTypeLink raw_id="2" name="Calculator" label="Calculator">
          <XCUIElementTypeStaticText raw_id="3" name="Calculator" label="Calculator" value="Calculator"/>
        </XCUIElementTypeLink>
        <XCUIElementTypeLink raw_id="4" name="Parent">
          <XCUIElementTypeStaticText raw_id="5" name="Child"/>
        </XCUIElementTypeLink>
      </XCUIElementTypeApplication>
    `);

    expect(tree.toXml()).toMatchInlineSnapshot(`
      "<Application id=1>
        <Link id=2>Calculator</Link>
        <Link name="Parent" id=4>
          <div name="Child" id=5 />
        </Link>
      </Application>"
    `);
  });

  it("keeps non-StaticText names as attributes", () => {
    const tree = new ServerXCUITestAccessibilityTree(`
      <XCUIElementTypeApplication raw_id="1">
        <XCUIElementTypeOther raw_id="2" name="CapsuleNavigationBar?isSelected=true&amp;isDistractionControlOverlayUp=false"/>
      </XCUIElementTypeApplication>
    `);

    expect(tree.toXml()).toMatchInlineSnapshot(`
      "<Application id=1>
        <div name="CapsuleNavigationBar?isSelected=true&amp;isDistractionControlOverlayUp=false" id=2 />
      </Application>"
    `);
  });

  describe("what is on screen", () => {
    const overlaidScreen = `
      <XCUIElementTypeApplication raw_id="1" visible="true">
        <XCUIElementTypeOther raw_id="2" visible="false">
          <XCUIElementTypeOther raw_id="3" visible="false"/>
          <XCUIElementTypeButton raw_id="4" name="DAILY SHIURIM" visible="false"/>
        </XCUIElementTypeOther>
        <XCUIElementTypeButton raw_id="5" name="Dismiss" visible="true"/>
      </XCUIElementTypeApplication>
    `;

    it("marks the covered screen and leaves what is on top of it unmarked", () => {
      const tree = new ServerXCUITestAccessibilityTree(overlaidScreen);

      expect(tree.toXml()).toMatchInlineSnapshot(`
        "<Application id=1>
          <div id=2 visible="false">
            <Button name="DAILY SHIURIM" id=4 visible="false" />
          </div>
          <Button name="Dismiss" id=5 />
        </Application>"
      `);
    });

    it("keeps the mark on every named element, so namesakes stay distinguishable", () => {
      // The tab bar's caption and the heading of a tab nobody is looking at
      // carry the same word. Marking only the outermost hidden container left
      // both serialising to the identical line, and a tap aimed at the visible
      // one landed on the hidden one.
      const tree = new ServerXCUITestAccessibilityTree(`
        <XCUIElementTypeApplication raw_id="1" visible="true">
          <XCUIElementTypeOther raw_id="2" visible="false">
            <XCUIElementTypeStaticText raw_id="3" name="Highlights" visible="false"/>
          </XCUIElementTypeOther>
          <XCUIElementTypeStaticText raw_id="4" name="Highlights" visible="true"/>
        </XCUIElementTypeApplication>
      `);

      const lines = tree
        .toXml(new Set(["id"]))
        .split("\n")
        .filter((line) => line.includes("Highlights"));

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('visible="false"');
      expect(lines[1]).not.toContain("visible");
    });

    it("does not treat invisibility as inherited", () => {
      // Measured over sixteen real screens, 361 of 2086 nodes are visible
      // inside a hidden ancestor — a sheet over a hidden page, a webview under
      // a hidden wrapper. Inheriting the flag marks elements hidden that a
      // person can see.
      const tree = new ServerXCUITestAccessibilityTree(`
        <XCUIElementTypeApplication raw_id="1" visible="true">
          <XCUIElementTypeOther raw_id="2" visible="false">
            <XCUIElementTypeStaticText raw_id="3" name="On screen" visible="true"/>
          </XCUIElementTypeOther>
        </XCUIElementTypeApplication>
      `);

      const shown = tree
        .toXml(new Set(["id"]))
        .split("\n")
        .find((line) => line.includes("On screen"));

      expect(shown).toBeDefined();
      expect(shown).not.toContain("visible");
    });
  });

  describe("snapshots", () => {
    const fixturesPath = new URL(
      "../../../tests/unit/fixtures/tree/ios/",
      import.meta.url,
    );
    const fixtureNames = readdirSync(fixturesPath)
      .filter((name) => name.startsWith("xcuitest-") && name.endsWith(".xml"))
      .sort();

    it.for(fixtureNames)("%s", async (fixtureName) => {
      const fixtureXml = await fs.readFile(
        new URL(fixtureName, fixturesPath),
        "utf-8",
      );
      const tree = new ServerXCUITestAccessibilityTree(fixtureXml);

      await expect(tree.toXml()).toMatchFileSnapshot(
        `./__snapshots__/xcuitest/${fixtureName.replace(".xml", ".snap.xml")}`,
      );
    });
  });
});

async function fixtureTree(
  filename: string,
): Promise<ServerXCUITestAccessibilityTree> {
  const fixturePath = new URL(
    `./__fixtures__/${filename}.xml`,
    import.meta.url,
  );
  const xml = await fs.readFile(fixturePath, "utf-8");
  return new ServerXCUITestAccessibilityTree(xml);
}

describe("selected state", () => {
  const tabs = (activeSelected: string) => `<AppiumAUT>
    <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" enabled="true">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="DAILY SHIURIM" label="DAILY SHIURIM" enabled="true" selected="${activeSelected}" />
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="RECOMMENDED" label="RECOMMENDED" enabled="true" selected="false" />
    </XCUIElementTypeApplication>
  </AppiumAUT>`;

  it("marks the active tab so it is distinguishable from its siblings", () => {
    // Without it the tree shows two identical buttons and "the DAILY SHIURIM
    // tab is now active" can never be satisfied.
    const xml = new ServerXCUITestAccessibilityTree(tabs("true")).toXml();

    expect(xml).toContain('name="DAILY SHIURIM" id=2 selected');
    expect(xml).toContain('name="RECOMMENDED" id=3 />');
  });

  it("omits it when nothing is selected", () => {
    const xml = new ServerXCUITestAccessibilityTree(tabs("false")).toXml();

    expect(xml).not.toContain("selected");
  });
});
