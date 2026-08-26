import type { Browser } from "webdriverio";
import { XCUITestAccessibilityTree } from "../../src/accessibility/XCUITestAccessibilityTree.ts";
import { TreeFactory } from "../../src/tree/TreeFactory.ts";
import type { PageGraphBuilder } from "./PageGraphBuilder.ts";
import { readScreen } from "./ScreenSignature.ts";

export namespace Crawler {
  export interface Props {
    browser: Browser;
    builder: PageGraphBuilder;
    bundleId: string;
    /** How many screens deep to go before returning to the start. */
    maxDepth?: number;
    /** Upper bound on taps, so a loop cannot run forever. */
    maxTaps?: number;
  }

  export interface Report {
    taps: number;
    screensSeen: number;
    deadEnds: number;
  }
}

/** Controls that leave the app or change data, which a read-only crawl must not touch. */
const OFF_LIMITS =
  /log ?out|sign ?out|delete|remove|purchase|subscribe|donate now|pay|register|terms|privacy|apple|google|share/i;

/** Controls that are navigation rather than content, and worth exploring first. */
const NAVIGATIONAL =
  /^(Search|Highlights|Community|Donate|Home|View all|Follow|filters|options|notification|avatar|Today|Month)/i;

/**
 * Walks the app to learn what screens exist and what is on them.
 *
 * Built because a graph harvested from test runs alone only ever describes the
 * screens the runs reached — after a night of failing cases that was three.
 * A case cannot be repaired against a map that does not contain the screen it
 * is talking about.
 *
 * Read-only by construction: anything that signs out, pays, deletes or leaves
 * the app is never tapped, so the crawl can run against a real account without
 * changing it.
 */
export class Crawler {
  readonly #props: Required<Crawler.Props>;
  readonly #visited = new Set<string>();
  #taps = 0;
  #deadEnds = 0;

  constructor(props: Crawler.Props) {
    this.#props = {
      maxDepth: 3,
      maxTaps: 120,
      ...props,
    };
  }

  async crawl(): Promise<Crawler.Report> {
    await this.#relaunch();
    await this.#explore(0, "crawl");

    return {
      taps: this.#taps,
      screensSeen: this.#visited.size,
      deadEnds: this.#deadEnds,
    };
  }

  async #explore(depth: number, sequenceId: string): Promise<void> {
    if (depth > this.#props.maxDepth || this.#taps >= this.#props.maxTaps) return;

    const screen = await this.#record(sequenceId);
    if (this.#visited.has(screen.signature)) return;
    this.#visited.add(screen.signature);

    const targets = this.#tappableTargets(screen);
    for (const target of targets) {
      if (this.#taps >= this.#props.maxTaps) return;

      const moved = await this.#tap(target);
      this.#taps += 1;
      if (!moved) {
        this.#deadEnds += 1;
        continue;
      }

      // Each branch is its own walk, so the graph does not invent an edge
      // between two screens that merely followed one another in crawl order.
      await this.#explore(depth + 1, `${sequenceId}/${target}`);
      await this.#back(screen.signature, sequenceId);
    }
  }

  #tappableTargets(screen: ReturnType<typeof readScreen>): string[] {
    // Text counts as a target, not just buttons: this app draws its tab bar as
    // static text over an unnamed container, so a crawl that only tapped
    // buttons never changed tab and saw four screens.
    const TAPPABLE_ROLES = new Set(["Button", "Text", "StaticText"]);

    const named = screen.elements
      .filter(
        (element) => TAPPABLE_ROLES.has(element.role) && element.text.length > 1,
      )
      .map((element) => element.text)
      .filter((text) => !OFF_LIMITS.test(text));

    const unique = [...new Set(named)];
    // Navigation first: it opens new screens, while content opens more of the
    // same one and would spend the tap budget without widening the map.
    return [
      ...unique.filter((text) => NAVIGATIONAL.test(text)),
      ...unique.filter((text) => !NAVIGATIONAL.test(text)).slice(0, 5),
    ].slice(0, 10);
  }

  async #record(sequenceId: string): Promise<ReturnType<typeof readScreen>> {
    const source = await this.#props.browser.getPageSource();
    const treeXml = TreeFactory.create(
      "xcuitest",
      new XCUITestAccessibilityTree(source).toStr(),
    ).toXml(new Set(["id"]));

    this.#props.builder.add({ treeXml, instruction: "crawl", sequenceId });
    return readScreen(treeXml);
  }

  async #tap(text: string): Promise<boolean> {
    const before = await this.#signature();
    const element = this.#props.browser.$(
      `-ios predicate string:name == "${text}" OR label == "${text}" OR value == "${text}"`,
    );
    if (!(await element.isExisting().catch(() => false))) return false;

    await element.click().catch(() => undefined);
    await this.#settle();
    if ((await this.#signature()) !== before) return true;

    // A tab bar drawn as static text over an unnamed container is not hittable
    // itself: the click lands on a label that handles nothing. Tapping its
    // centre by coordinate reaches whatever is actually listening. Without
    // this, three quarters of the crawl's taps went nowhere.
    if (!(await this.#tapCentre(element))) return false;
    await this.#settle();
    return (await this.#signature()) !== before;
  }

  async #tapCentre(element: WebdriverIO.Element): Promise<boolean> {
    try {
      const { x, y } = await element.getLocation();
      const { width, height } = await element.getSize();
      if (!width || !height) return false;

      await this.#props.browser.execute("mobile: tap", {
        x: Math.round(x + width / 2),
        y: Math.round(y + height / 2),
      });
      return true;
    } catch {
      return false;
    }
  }

  async #back(expected: string, sequenceId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await this.#signature()) === expected) return;
      await this.#props.browser
        .execute("mobile: swipe", { direction: "right" })
        .catch(() => undefined);
      await this.#settle();
    }

    // Swiping did not get back; restart rather than crawl from a lost place.
    if ((await this.#signature()) !== expected) {
      await this.#relaunch();
      await this.#record(sequenceId);
    }
  }

  async #signature(): Promise<string> {
    const source = await this.#props.browser.getPageSource();
    return readScreen(
      TreeFactory.create(
        "xcuitest",
        new XCUITestAccessibilityTree(source).toStr(),
      ).toXml(new Set(["id"])),
    ).signature;
  }

  async #relaunch(): Promise<void> {
    const { browser, bundleId } = this.#props;
    await browser.execute("mobile: terminateApp", { bundleId });
    await browser.execute("mobile: launchApp", { bundleId });
    await this.#settle(2500);
  }

  #settle(ms = 1400): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
