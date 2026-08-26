/**
 * Reads the accessibility tree shallow, and deep only when shallow missed.
 *
 * A capped snapshot is what makes a mobile step affordable — on Path4Life,
 * depth 24 takes 5.7s against 20s uncapped. It is also what makes half the app
 * invisible: at that depth the home screen reports thirty captions and *no*
 * feed rows at all, so an agent asked to open a shiur is looking at an empty
 * list and cannot succeed under any wording.
 *
 * Paying 20s on every step to fix that is the wrong trade — most steps never
 * need the depth. So the rule is: read shallow, and if what the instruction
 * named is not in what came back, read once more with the cap off. The cost
 * lands on the steps that need it instead of on all of them.
 *
 * Deepening is only ever justified by a miss. With nothing named to look for
 * the shallow read stands, because "I found nothing" and "there was nothing to
 * find" are the same tree.
 */
export class SnapshotDepth {
  readonly #shallow: number;
  readonly #setDepth: (depth: number | undefined) => Promise<void>;
  #wanted: readonly string[] = [];
  #deepReads = 0;
  #shallowReads = 0;

  constructor(props: {
    /** Depth the ordinary read is capped at. */
    shallow: number;
    /** Applies a cap to the session; `undefined` removes it. */
    setDepth: (depth: number | undefined) => Promise<void>;
  }) {
    this.#shallow = props.shallow;
    this.#setDepth = props.setDepth;
  }

  get reads(): { shallow: number; deep: number } {
    return { shallow: this.#shallowReads, deep: this.#deepReads };
  }

  /**
   * Names what the next reads should contain.
   *
   * Set per step from the instruction's own words. Cleared by passing nothing,
   * which returns the driver to reading shallow unconditionally.
   */
  expect(terms: readonly string[]): void {
    this.#wanted = terms.filter((term) => term.trim().length > 1);
  }

  async read(fetchSource: () => Promise<string>): Promise<string> {
    const shallow = await fetchSource();
    this.#shallowReads += 1;
    if (this.#satisfies(shallow)) return shallow;

    try {
      await this.#setDepth(undefined);
      const deep = await fetchSource();
      this.#deepReads += 1;
      return deep;
    } finally {
      await this.#setDepth(this.#shallow);
    }
  }

  /** Whether this tree already shows something the instruction named. */
  #satisfies(source: string): boolean {
    if (!this.#wanted.length) return true;
    const haystack = source.toLowerCase();
    return this.#wanted.some((term) => haystack.includes(term.toLowerCase()));
  }
}
