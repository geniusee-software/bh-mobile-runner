export namespace ExpectationProbe {
  export interface Evidence {
    /** UI text the expectation quotes, e.g. 'Follow' from "a 'Follow' button". */
    quoted: string[];
    present: string[];
    missing: string[];
    /**
     * Whether a tree-reading agent could possibly have confirmed this.
     *
     * False means the words the case asks for are not on the screen at all, so
     * the failure belongs to the step before it or to the case's wording — not
     * to the model's judgement.
     */
    verifiable: boolean;
  }
}

/** Matches text inside single or double quotes, the way the generator writes UI labels. */
const QUOTED = /['"]([^'"]{2,60})['"]/g;

/**
 * Asks whether a failed expectation was answerable from the screen.
 *
 * A check that fails can mean two very different things: the agent misjudged a
 * screen that did contain the answer, or it was asked about a screen that never
 * showed up. Only the first is a model problem, and only the first is worth
 * spending training budget on — so the two are separated here rather than
 * pooled into one pass rate.
 */
export class ExpectationProbe {
  probe(expectation: string, treeXml: string): ExpectationProbe.Evidence {
    const haystack = treeXml.toLowerCase();
    const quoted = [
      ...new Set(
        [...expectation.matchAll(QUOTED)]
          .map((match) => match[1]?.trim() ?? "")
          .filter(Boolean),
      ),
    ];

    const present = quoted.filter((literal) =>
      haystack.includes(literal.toLowerCase()),
    );
    const missing = quoted.filter((literal) => !present.includes(literal));

    return {
      quoted,
      present,
      missing,
      // With nothing quoted there is no evidence either way, so give the
      // expectation the benefit of the doubt rather than blaming the case.
      verifiable: quoted.length === 0 || missing.length === 0,
    };
  }
}
