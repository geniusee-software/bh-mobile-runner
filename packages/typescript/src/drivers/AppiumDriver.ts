import { Key as SeleniumKey } from "selenium-webdriver";
import type { Browser } from "webdriverio";
import z from "zod";
import type { AccessibilityElement } from "../accessibility/AccessibilityElement.ts";
import { BaseAccessibilityTree } from "../accessibility/BaseAccessibilityTree.ts";
import { UIAutomator2AccessibilityTree } from "../accessibility/UIAutomator2AccessibilityTree.ts";
import { XCUITestAccessibilityTree } from "../accessibility/XCUITestAccessibilityTree.ts";
import { AppId } from "../AppId.ts";
import { Telemetry } from "../telemetry/Telemetry.ts";
import type { Tracer } from "../telemetry/Tracer.ts";
import { TreeDevDrillError } from "../tree/dev/TreeDevDrillError.ts";
import type { TreeReadStrategy } from "./tree/TreeReadStrategy.ts";
import { ImmediateTreeRead } from "./tree/treeReadStrategies.ts";
import type { ToolClass } from "../tools/BaseTool.ts";
import { ClickTool } from "../tools/ClickTool.ts";
import { DragAndDropTool } from "../tools/DragAndDropTool.ts";
import { PressKeyTool } from "../tools/PressKeyTool.ts";
import { ScrollTool } from "../tools/ScrollTool.ts";
import { TypeTool } from "../tools/TypeTool.ts";
import { BaseDriver } from "./BaseDriver.ts";
import type { Keys } from "./keys.ts";

const { tracer, logger } = Telemetry.get(import.meta.url);
const { span } = tracer.dec();
const stateful = BaseDriver.stateful;

export namespace AppiumDriver {
  export type Platform = z.infer<typeof AppiumDriver.Platform>;
}

export class AppiumDriver extends BaseDriver {
  static platforms = ["uiautomator2", "xcuitest"] as const;

  /** How far to swipe after WDA refuses to scroll, before giving up. */
  static readonly MAX_SCROLL_SWIPES = 6;

  static Platform = z.enum(AppiumDriver.platforms);

  public platform: AppiumDriver.Platform;

  private driver: Browser;

  public supportedTools: Set<ToolClass> = new Set([
    ClickTool,
    DragAndDropTool,
    PressKeyTool,
    ScrollTool,
    TypeTool,
  ]);
  public autoswitchContexts: boolean = true;
  public delay: number = 0;
  public doubleFetchPageSource: boolean = false;
  public hideKeyboardAfterTyping: boolean = false;
  /**
   * Consult the accessibility tree before enumerating webview contexts.
   *
   * `getAppiumContexts()` costs seconds on a simulator because it probes every
   * WebKit inspector target, and `title()` and `url()` both need it — so a
   * single `check()` on a native screen pays it twice to learn there is no
   * webview. The tree already carries that answer, so the scan only runs when
   * a webview node is actually present.
   */
  public lazyWebviewContexts: boolean = true;
  /**
   * When to consider the screen settled enough to read.
   *
   * Native transitions animate for a few hundred milliseconds, and a tree read
   * during one carries element ids that are already gone by the time the agent
   * acts on them.
   */
  public treeRead: TreeReadStrategy = new ImmediateTreeRead();

  constructor(driver: Browser) {
    super();
    this.driver = driver;
    if (this.driver.capabilities.platformName?.toLowerCase() === "android") {
      this.platform = "uiautomator2";
    } else {
      this.platform = "xcuitest";
    }
  }

  @span("driver.get_accessibility_tree", spanAttrs)
  protected async fetchAccessibilityTree(): Promise<BaseAccessibilityTree> {
    await this.ensureNativeAppContext();
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay * 1000));
    }
    // Hacky workaround for cloud providers reporting stale page source.
    // Intentionally fetch and discard the page source to refresh internal state.
    if (this.doubleFetchPageSource) {
      await this.driver.getPageSource();
    }

    const xmlString = await this.treeRead.read(() =>
      this.driver.getPageSource(),
    );
    if (this.platform === "uiautomator2") {
      return new UIAutomator2AccessibilityTree(xmlString);
    } else {
      return new XCUITestAccessibilityTree(xmlString);
    }
  }

  @span("driver.click", spanAttrs)
  @stateful
  async click(id: number): Promise<void> {
    await this.ensureNativeAppContext();
    const element = await this.findElement(id);
    await this.scrollIntoView(element);
    await element.click();
  }

  @span("driver.drag_slider", spanAttrs)
  dragSlider(): void {
    throw new Error("Dragging slider is not supported for this driver");
  }

  @span("driver.drag_and_drop", spanAttrs)
  @stateful
  async dragAndDrop(fromId: number, toId: number): Promise<void> {
    await this.ensureNativeAppContext();
    const fromElement = await this.findElement(fromId);
    const toElement = await this.findElement(toId);
    await this.scrollIntoView(fromElement);
    await fromElement.dragAndDrop(toElement);
  }

  @span("driver.press_key", spanAttrs)
  @stateful
  async pressKey(key: Keys.Key): Promise<void> {
    await this.ensureNativeAppContext();
    const keyMap: Record<Keys.Key, string> = {
      Backspace: SeleniumKey.BACK_SPACE,
      Enter: SeleniumKey.ENTER,
      Escape: SeleniumKey.ESCAPE,
      Tab: SeleniumKey.TAB,
    };

    // Simulate ActionChains behavior
    await this.driver.performActions([
      {
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: keyMap[key] },
          { type: "keyUp", value: keyMap[key] },
        ],
      },
    ]);
  }

  @span("driver.back", spanAttrs)
  @stateful
  async back(): Promise<void> {
    await this.driver.back();
  }

  @span("driver.visit", spanAttrs)
  @stateful
  async visit(url: string): Promise<void> {
    await this.driver.url(url);
  }

  @span("driver.scroll_to", spanAttrs)
  @stateful
  async scrollTo(id: number): Promise<void> {
    const element = await this.findElement(id);
    await this.scrollIntoView(element);
  }

  @span("driver.quit", spanAttrs)
  async quit(): Promise<void> {
    // WebdriverIO handles session termination automatically.
    return;
  }

  @span("driver.screenshot", spanAttrs)
  async screenshot(): Promise<string> {
    return this.driver.takeScreenshot();
  }

  @span("driver.title", spanAttrs)
  async title(): Promise<string> {
    if (!(await this.enterWebContentOrSkip())) return "";
    try {
      return await this.driver.getTitle();
    } catch {
      return "";
    }
  }

  @span("driver.type", spanAttrs)
  @stateful
  async type(id: number, text: string): Promise<void> {
    await this.ensureNativeAppContext();
    const element = await this.findElement(id);
    await this.scrollIntoView(element);
    await element.click();
    await element.setValue(text);
    if (this.hideKeyboardAfterTyping && (await this.driver.isKeyboardShown())) {
      await this.hideKeyboard();
    }
  }

  @span("driver.url", spanAttrs)
  async url(): Promise<string> {
    if (!(await this.enterWebContentOrSkip())) return "";
    try {
      return await this.driver.getUrl();
    } catch {
      return "";
    }
  }

  @span("driver.app", spanAttrs)
  async app(): Promise<AppId> {
    const caps = this.driver.capabilities as Record<string, unknown>;
    return AppId.parse(
      caps["appPackage"] ||
        caps["bundleId"] ||
        caps["appium:appPackage"] ||
        caps["appium:bundleId"],
    );
  }

  @span("driver.find_element", spanAttrs)
  async findElement(id: number): Promise<WebdriverIO.Element> {
    const tree = await this.getAccessibilityTree();
    const element = tree.elementById(id);
    const locator = this.#elementLocator(element);
    logger.debug(`Finding element by locator: ${locator}`);

    const matchIndex = element.matchIndex ?? 0;
    if (matchIndex === 0) {
      return this.driver.$(locator).getElement();
    }

    // The label repeats on this screen, so the locator names a set and the
    // agent picked one member of it. Taking the first would silently act on a
    // different element — usually one belonging to another row entirely.
    const matches = await this.driver.$$(locator).getElements();
    const match = matches[matchIndex];
    if (match) return match;

    logger.debug(
      `Expected at least ${matchIndex + 1} matches for ${locator}, found ${matches.length}; using the first`,
    );
    return this.driver.$(locator).getElement();
  }

  @span("driver.execute_script", spanAttrs)
  @stateful
  async executeScript(script: string): Promise<void> {
    await this.ensureWebviewContext();
    await this.driver.execute(script);
  }

  @span("driver.switch_to_next_tab", spanAttrs)
  async switchToNextTab(): Promise<void> {
    throw new Error("Tab switching not supported for this driver");
  }

  @span("driver.switch_to_previous_tab", spanAttrs)
  async switchToPreviousTab(): Promise<void> {
    throw new Error("Tab switching not supported for this driver");
  }

  @span("driver.wait", spanAttrs)
  @stateful
  async wait(seconds: number): Promise<void> {
    const clampedSeconds = Math.max(1, Math.min(30, seconds));
    await new Promise((resolve) => setTimeout(resolve, clampedSeconds * 1000));
  }

  @span("driver.wait_for_selector", spanAttrs)
  async waitForSelector(): Promise<void> {
    throw new Error("waitForSelector not supported for this driver");
  }

  @span("driver.print_to_pdf", spanAttrs)
  async printToPdf(): Promise<void> {
    throw new Error("Printing to PDF not supported for this driver");
  }

  private async ensureNativeAppContext(): Promise<void> {
    if (!this.autoswitchContexts) {
      return;
    }

    const currentContext = (await this.driver.getAppiumContext()) as string;
    if (currentContext !== "NATIVE_APP") {
      await this.driver.switchContext("NATIVE_APP");
    }
  }

  /**
   * Prepares the session for a web-content call, or reports that there is none.
   *
   * `title()` and `url()` only mean something inside a webview. On a native
   * screen WebDriverAgent either has no such endpoint or answers after a long
   * timeout, so once the tree is trusted about webviews there is nothing to
   * gain by asking. Without that trust the old behaviour stands: attempt the
   * call and let it fail.
   */
  private async enterWebContentOrSkip(): Promise<boolean> {
    const inWebview = await this.ensureWebviewContext();
    return inWebview || !this.lazyWebviewContexts;
  }

  /**
   * Switches to a webview context if the screen has one.
   *
   * @returns whether the session ended up in a webview context.
   */
  private async ensureWebviewContext(): Promise<boolean> {
    if (!this.autoswitchContexts) {
      return true;
    }

    if (this.lazyWebviewContexts && !(await this.hasWebviewInTree())) {
      logger.debug(
        "No webview in the accessibility tree, skipping context scan",
      );
      return false;
    }

    const contexts = (await this.driver.getAppiumContexts()) as string[];
    for (const context of contexts.reverse()) {
      if (context.includes("WEBVIEW")) {
        await this.driver.switchContext(context);
        return true;
      }
    }

    return false;
  }

  /**
   * Whether the current screen embeds a webview.
   *
   * Reads the cached tree when the caller already fetched one — the common
   * case, since `check()` and `get()` build the tree before asking for the
   * title and URL — so the answer is usually free.
   */
  private async hasWebviewInTree(): Promise<boolean> {
    try {
      const tree = await this.getAccessibilityTree();
      return tree.containsWebview();
    } catch (error) {
      // A tree we cannot read tells us nothing; fall back to scanning.
      logger.debug(`Failed to inspect tree for webviews: ${error}`);
      return true;
    }
  }

  private async hideKeyboard(): Promise<void> {
    if (this.platform === "uiautomator2") {
      await this.driver.hideKeyboard();
    } else {
      // Tap to the top left corner of the keyboard to dismiss it
      const keyboard = this.driver.$(
        "-ios predicate string:type == 'XCUIElementTypeKeyboard'",
      );
      const { width, height } = await keyboard.getSize();
      await keyboard.click({
        x: -Math.ceil(width / 2),
        y: -Math.ceil(height / 2),
      });
    }
  }

  /**
   * Brings an element into view before acting on it.
   *
   * Best effort by design. An element that is already visible needs no
   * scrolling, and a scroll that cannot be performed does not mean the action
   * is impossible — so a refusal must never abort it; let the click or type
   * that follows be the one to decide.
   */
  private async scrollIntoView(element: WebdriverIO.Element): Promise<void> {
    try {
      if (this.platform === "uiautomator2") {
        await element.scrollIntoView();
      } else {
        await this.#scrollIntoViewIos(element);
      }
    } catch (error) {
      logger.debug(`Could not scroll element into view, continuing: ${error}`);
    }
  }

  /**
   * iOS scrolling, with a fallback for the containers WDA cannot drive.
   *
   * `mobile: scrollToElement` is the cheap path but refuses outright on
   * SwiftUI lists and on any element that is its own scroll container, which
   * covers most of a modern app's content. Swiping the window is slower but
   * works anywhere, so it takes over when the cheap path is refused — bounded,
   * because a target that is genuinely absent must not turn into an endless
   * scroll.
   */
  async #scrollIntoViewIos(element: WebdriverIO.Element): Promise<void> {
    if (await element.isDisplayed().catch(() => false)) return;

    try {
      await this.driver.execute("mobile: scrollToElement", {
        elementId: element.elementId,
      });
      return;
    } catch (error) {
      logger.debug(`scrollToElement refused, falling back to swipes: ${error}`);
    }

    for (let attempt = 0; attempt < AppiumDriver.MAX_SCROLL_SWIPES; attempt++) {
      await this.driver.execute("mobile: swipe", { direction: "up" });
      if (await element.isDisplayed().catch(() => false)) return;
    }
  }

  #elementLocator(element: AccessibilityElement): string {
    if (this.platform === "xcuitest") {
      // Use iOS Predicate locators for XCUITest

      let predicate = `type == "${element.type}"`;

      const props: Record<string, string> = {};
      if (element.name) props.name = element.name;
      if (element.value) props.value = element.value;
      if (element.label) props.label = element.label;

      if (Object.keys(props).length) {
        predicate += ` AND ${Object.entries(props)
          .map(([key, value]) => `${key} == "${value}"`)
          .join(" AND ")}`;
      }

      return `-ios predicate string:${predicate}`;
    }

    // Use XPath for UIAutomator2

    let xpath = `//${element.type}`;
    const props: Record<string, string> = {};
    if (element.androidResourceId)
      props["resource-id"] = element.androidResourceId;
    if (element.androidBounds) props.bounds = element.androidBounds;
    if (Object.keys(props).length) {
      xpath += `[${Object.entries(props)
        .map(([key, value]) => `@${key}="${value}"`)
        .join(" and ")}]`;
    }
    return xpath;
  }

  //#region Dev

  protected override async devDrillProbeTree(
    tree: BaseAccessibilityTree,
    rawId: number,
  ): Promise<string> {
    let element: AccessibilityElement;
    try {
      element = tree.elementById(rawId);
    } catch (error) {
      throw new TreeDevDrillError("resolve", error);
    }

    const locator = this.#elementLocator(element);
    try {
      const exists = await this.driver.$(locator).isExisting();
      if (!exists) throw new Error(`No element found by locator: ${locator}`);
      return locator;
    } catch (error) {
      throw new TreeDevDrillError("probe", error, locator);
    }
  }

  //#endregion
}

function spanAttrs(this: AppiumDriver): Tracer.SpansDriverAttrs {
  return {
    "driver.kind": "appium",
    "driver.platform": this.platform,
  };
}
