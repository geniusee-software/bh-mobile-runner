import z from "zod";

export const GraphElement = z.object({
  role: z.string(),
  text: z.string(),
  /** How many visits to this screen showed it; rare elements are content, not chrome. */
  seen: z.number().int().positive(),
});

export const GraphScreen = z.object({
  signature: z.string(),
  /** Titles observed for this screen, most frequent first. */
  titles: z.array(z.string()),
  visits: z.number().int().positive(),
  elements: z.array(GraphElement),
});

export const GraphEdge = z.object({
  from: z.string(),
  to: z.string(),
  /** Instructions that were seen to cause this transition. */
  actions: z.array(z.string()),
  seen: z.number().int().positive(),
});

export const PageGraphData = z.object({
  builtAt: z.string(),
  app: z.string(),
  screens: z.array(GraphScreen),
  edges: z.array(GraphEdge),
});

export type GraphElement = z.infer<typeof GraphElement>;
export type GraphScreen = z.infer<typeof GraphScreen>;
export type GraphEdge = z.infer<typeof GraphEdge>;
export type PageGraphData = z.infer<typeof PageGraphData>;

/**
 * What the app is made of, learned from screens the runner has already seen.
 *
 * The point is to answer questions a test case cannot answer about itself:
 * does the thing this expectation names exist anywhere in this app, and if so,
 * on which screen and next to what. That turns a vague expectation into a
 * checkable one, and an impossible one into a case worth deleting rather than
 * a model worth blaming.
 *
 * Deliberately built from screen composition only — which elements appear
 * together — and never from whether a step passed. Knowing the app is fair
 * game; knowing the answer is not.
 */
export class PageGraph {
  readonly #screens: Map<string, GraphScreen>;
  readonly #edges: GraphEdge[];

  constructor(data: PageGraphData) {
    this.#screens = new Map(data.screens.map((s) => [s.signature, s]));
    this.#edges = data.edges;
  }

  get screens(): GraphScreen[] {
    return [...this.#screens.values()];
  }

  get edges(): readonly GraphEdge[] {
    return this.#edges;
  }

  screen(signature: string): GraphScreen | undefined {
    return this.#screens.get(signature);
  }

  /** Screens whose title or elements carry this text, most-visited first. */
  screensMentioning(text: string): GraphScreen[] {
    const needle = text.toLowerCase();
    return this.screens
      .filter(
        (screen) =>
          screen.titles.some((title) => title.toLowerCase().includes(needle)) ||
          screen.elements.some((element) =>
            element.text.toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => b.visits - a.visits);
  }

  /** Whether any screen in the app carries this text at all. */
  knows(text: string): boolean {
    return this.screensMentioning(text).length > 0;
  }

  /**
   * Screens this text is the name of, rather than screens it appears on.
   *
   * The difference decides whether a rewrite is safe. "AhavasYisroel4Life" is
   * the title of a series screen and also the label of a row in the home feed,
   * so a search by mention answers "home" — and an expectation about having
   * navigated somewhere, restated against home, passes precisely when the
   * navigation failed.
   */
  screensTitled(text: string): GraphScreen[] {
    const needle = text.toLowerCase();
    return this.screens
      .filter((screen) =>
        screen.titles.some((title) => title.toLowerCase() === needle),
      )
      .sort((a, b) => b.visits - a.visits);
  }

  /**
   * Elements that show up on nearly every visit to a screen.
   *
   * These are the ones an expectation can safely name: the chrome that defines
   * the screen rather than the feed that fills it.
   */
  stableElements(signature: string, minShare = 0.6): GraphElement[] {
    const screen = this.#screens.get(signature);
    if (!screen) return [];

    return screen.elements
      .filter((element) => element.seen / screen.visits >= minShare)
      .sort((a, b) => b.seen - a.seen);
  }

  /**
   * Stable elements that this screen does not share with most others.
   *
   * Naming a tab-bar label in an expectation proves nothing — every screen has
   * one. What makes an expectation worth checking is an element that would only
   * be there if the app really had arrived where the step intended.
   */
  distinctiveElements(signature: string, maxShare = 0.5): GraphElement[] {
    const total = this.#screens.size || 1;
    const elsewhere = new Map<string, number>();

    for (const screen of this.screens) {
      if (screen.signature === signature) continue;
      for (const element of new Set(screen.elements.map((e) => e.text))) {
        elsewhere.set(element, (elsewhere.get(element) ?? 0) + 1);
      }
    }

    return this.stableElements(signature).filter(
      (element) => (elsewhere.get(element.text) ?? 0) / total <= maxShare,
    );
  }
}
