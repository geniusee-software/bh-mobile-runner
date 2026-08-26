import { describe, expect, it, vi } from "vitest";
import {
  DelayedTreeRead,
  ImmediateTreeRead,
  SettledTreeRead,
} from "./treeReadStrategies.ts";

/** Returns each source in turn, then repeats the last one forever. */
function sourceSequence(sources: string[]) {
  let index = 0;
  return vi.fn(async () => sources[Math.min(index++, sources.length - 1)]!);
}

describe("ImmediateTreeRead", () => {
  it("reads exactly once", async () => {
    const fetchSource = sourceSequence(["<a/>"]);

    expect(await new ImmediateTreeRead().read(fetchSource)).toBe("<a/>");
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });
});

describe("DelayedTreeRead", () => {
  it("waits before reading", async () => {
    const fetchSource = sourceSequence(["<a/>"]);
    const startedAt = performance.now();

    expect(await new DelayedTreeRead(60).read(fetchSource)).toBe("<a/>");
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50);
  });
});

describe("SettledTreeRead", () => {
  it("returns once two consecutive reads agree", async () => {
    const fetchSource = sourceSequence(["<a/>", "<b/>", "<c/>", "<c/>"]);

    const settled = new SettledTreeRead({ intervalMs: 1, maxWaitMs: 500 });

    expect(await settled.read(fetchSource)).toBe("<c/>");
    expect(fetchSource).toHaveBeenCalledTimes(4);
  });

  it("gives up on a screen that never stops moving", async () => {
    // A spinner or a ticking clock changes the tree forever; waiting for it to
    // settle would hang the step rather than fail it.
    let counter = 0;
    const fetchSource = vi.fn(async () => `<a v="${counter++}"/>`);

    const settled = new SettledTreeRead({ intervalMs: 1, maxWaitMs: 40 });
    const result = await settled.read(fetchSource);

    expect(result).toMatch(/^<a v="\d+"\/>$/);
    expect(fetchSource.mock.calls.length).toBeGreaterThan(1);
  });
});
