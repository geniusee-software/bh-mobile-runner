import { Logger } from "../../telemetry/Logger.ts";
import { sleep, type TreeReadStrategy } from "./TreeReadStrategy.ts";

const logger = Logger.get(import.meta.url);

/** Reads once, immediately. Cheapest, and correct when nothing is animating. */
export class ImmediateTreeRead implements TreeReadStrategy {
  readonly name = "immediate";

  read(fetchSource: () => Promise<string>): Promise<string> {
    return fetchSource();
  }
}

/** Waits a fixed time, then reads once. */
export class DelayedTreeRead implements TreeReadStrategy {
  readonly name: string;
  readonly #delayMs: number;

  constructor(delayMs: number) {
    this.#delayMs = delayMs;
    this.name = `delayed:${delayMs}ms`;
  }

  async read(fetchSource: () => Promise<string>): Promise<string> {
    await sleep(this.#delayMs);
    return fetchSource();
  }
}

export namespace SettledTreeRead {
  export interface Props {
    /** Pause between reads while the screen is still changing. */
    intervalMs?: number;
    /** Give up waiting after this long and return the newest read. */
    maxWaitMs?: number;
  }
}

/**
 * Reads until two consecutive reads agree, or the budget runs out.
 *
 * Costs one extra read on a still screen and pays for itself on a moving one,
 * where a fixed delay is a guess that is either too short to be safe or too
 * long to be cheap.
 */
export class SettledTreeRead implements TreeReadStrategy {
  readonly name = "settled";

  readonly #intervalMs: number;
  readonly #maxWaitMs: number;

  constructor(props: SettledTreeRead.Props = {}) {
    this.#intervalMs = props.intervalMs ?? 250;
    this.#maxWaitMs = props.maxWaitMs ?? 3000;
  }

  async read(fetchSource: () => Promise<string>): Promise<string> {
    const deadline = performance.now() + this.#maxWaitMs;
    let previous = await fetchSource();

    while (performance.now() < deadline) {
      await sleep(this.#intervalMs);
      const current = await fetchSource();
      if (current === previous) return current;
      previous = current;
    }

    logger.debug(
      `Tree still changing after ${this.#maxWaitMs}ms, using the latest read`,
    );
    return previous;
  }
}
