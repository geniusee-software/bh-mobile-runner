import type { Browser } from "webdriverio";

export namespace DeviceCallRecorder {
  export interface Call {
    command: string;
    durationMs: number;
  }

  export interface Totals {
    /** Wall-clock spent inside the driver, per WebdriverIO command. */
    byCommand: Record<string, { count: number; totalMs: number }>;
    totalMs: number;
    callCount: number;
  }
}

/**
 * Times every WebdriverIO command a run issues.
 *
 * Measuring at the wire rather than inside the driver keeps the numbers honest
 * about what the device actually cost — `getPageSource` and `getContexts` are
 * the two commands that dominate a mobile step, and both are invisible from the
 * agent layer.
 */
export class DeviceCallRecorder {
  /** Commands worth timing; everything else is noise at millisecond scale. */
  static readonly TRACKED = new Set([
    "getPageSource",
    "getAppiumContexts",
    "getContexts",
    "switchContext",
    "getAppiumContext",
    "takeScreenshot",
    "getUrl",
    "getTitle",
    "findElement",
    "findElements",
    "elementClick",
    "elementSendKeys",
    "execute",
    "performActions",
    "isKeyboardShown",
  ]);

  readonly #calls: DeviceCallRecorder.Call[] = [];

  get calls(): readonly DeviceCallRecorder.Call[] {
    return this.#calls;
  }

  reset(): void {
    this.#calls.length = 0;
  }

  totals(): DeviceCallRecorder.Totals {
    const byCommand: DeviceCallRecorder.Totals["byCommand"] = {};
    let totalMs = 0;

    for (const call of this.#calls) {
      const entry = (byCommand[call.command] ??= { count: 0, totalMs: 0 });
      entry.count += 1;
      entry.totalMs += call.durationMs;
      totalMs += call.durationMs;
    }

    return {
      byCommand,
      totalMs: Math.round(totalMs),
      callCount: this.#calls.length,
    };
  }

  msFor(command: string): number {
    return Math.round(
      this.#calls
        .filter((call) => call.command === command)
        .reduce((sum, call) => sum + call.durationMs, 0),
    );
  }

  countFor(command: string): number {
    return this.#calls.filter((call) => call.command === command).length;
  }

  /**
   * Returns a browser that records the tracked commands and otherwise behaves
   * exactly like the one passed in.
   */
  instrument(browser: Browser): Browser {
    return new Proxy(browser, {
      get: (target, property) => {
        // Read against the target, not the proxy: WebdriverIO exposes getters
        // that reach for sibling properties, and routing those back through the
        // proxy re-enters this trap for every one of them.
        const value = Reflect.get(target, property, target);
        const command = String(property);

        if (
          typeof value !== "function" ||
          !DeviceCallRecorder.TRACKED.has(command)
        ) {
          return value;
        }

        return (...args: unknown[]) => {
          const startedAt = performance.now();
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );

          if (!(result instanceof Promise)) {
            this.#record(command, startedAt);
            return result;
          }

          return result.finally(() => this.#record(command, startedAt));
        };
      },
    }) as Browser;
  }

  #record(command: string, startedAt: number): void {
    this.#calls.push({
      command,
      durationMs: performance.now() - startedAt,
    });
  }
}
