import { describe, expect, it, vi } from "vitest";
import { SnapshotDepth } from "./SnapshotDepth.ts";

/** Two reads of the same screen: one capped and empty, one deep and full. */
const SHALLOW = '<Application><Button name="Home"/></Application>';
const DEEP = `${SHALLOW.slice(0, -14)}<div>Shiur 768. Attitude</div></Application>`;

function depth(sources: string[]) {
  const setDepth = vi.fn(async () => {});
  const fetch = vi.fn(async () => sources.shift() ?? SHALLOW);
  return {
    setDepth,
    fetch,
    subject: new SnapshotDepth({ shallow: 24, setDepth }),
  };
}

describe("SnapshotDepth", () => {
  it("stays shallow when nothing was named", async () => {
    const { subject, fetch, setDepth } = depth([SHALLOW]);

    await expect(subject.read(fetch)).resolves.toBe(SHALLOW);
    expect(fetch).toHaveBeenCalledOnce();
    expect(setDepth).not.toHaveBeenCalled();
  });

  it("stays shallow when the shallow read already shows what was named", async () => {
    const { subject, fetch, setDepth } = depth([SHALLOW]);
    subject.expect(["Home"]);

    await expect(subject.read(fetch)).resolves.toBe(SHALLOW);
    expect(fetch).toHaveBeenCalledOnce();
    expect(setDepth).not.toHaveBeenCalled();
    expect(subject.reads).toEqual({ shallow: 1, deep: 0 });
  });

  it("reads again uncapped when what was named is missing", async () => {
    const { subject, fetch, setDepth } = depth([SHALLOW, DEEP]);
    subject.expect(["Shiur 768. Attitude"]);

    await expect(subject.read(fetch)).resolves.toBe(DEEP);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(subject.reads).toEqual({ shallow: 1, deep: 1 });
  });

  it("puts the cap back, even when the deep read throws", async () => {
    const setDepth = vi.fn(async () => {});
    const subject = new SnapshotDepth({ shallow: 24, setDepth });
    let call = 0;
    const fetch = vi.fn(async () => {
      if (++call === 1) return SHALLOW;
      throw new Error("device went away");
    });
    subject.expect(["Nowhere"]);

    await expect(subject.read(fetch)).rejects.toThrow("device went away");
    expect(setDepth).toHaveBeenLastCalledWith(24);
  });

  it("ignores terms too short to mean anything", async () => {
    const { subject, fetch, setDepth } = depth([SHALLOW]);
    subject.expect(["a", " "]);

    await subject.read(fetch);
    expect(setDepth).not.toHaveBeenCalled();
  });
});
