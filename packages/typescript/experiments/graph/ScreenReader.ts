import type { Browser } from "webdriverio";
import { readScreen, type ScreenSignature } from "./ScreenSignature.ts";

export namespace ScreenReader {
  export interface Reading {
    /** The raw XCUITest dump, which is what carries visibility. */
    source: string;
    screen: ScreenSignature.Screen;
  }
}

/**
 * Reads the screen once and serves everyone who asks until it changes.
 *
 * A full accessibility dump of this app costs about two seconds, and the crawl
 * was asking for up to six of them per tap: one to know where it stood, one
 * after the tap, one after the fallback tap, more again on the way back, and a
 * final one to record the screen it had reached. Every one of those but the
 * first after each action was asking about a screen nothing had touched since.
 *
 * The cache is invalidated explicitly rather than by a timer. A timer would be
 * a guess about how long the app takes to react; an explicit call is a
 * statement that something was just done to it, which is exactly what the
 * caller knows and the reader does not.
 */
export class ScreenReader {
  readonly #browser: Browser;
  #cached: ScreenReader.Reading | undefined;
  #reads = 0;

  constructor(browser: Browser) {
    this.#browser = browser;
  }

  /** How many times the device was actually asked, for measuring the saving. */
  get reads(): number {
    return this.#reads;
  }

  /** The screen as it stands, reading the device only when the cache is stale. */
  async current(): Promise<ScreenReader.Reading> {
    if (!this.#cached) {
      const source = await this.#browser.getPageSource();
      this.#reads += 1;
      this.#cached = { source, screen: readScreen(source) };
    }
    return this.#cached;
  }

  async signature(): Promise<string> {
    return (await this.current()).screen.signature;
  }

  /** Say this after anything that could have changed what is on screen. */
  invalidate(): void {
    this.#cached = undefined;
  }
}
