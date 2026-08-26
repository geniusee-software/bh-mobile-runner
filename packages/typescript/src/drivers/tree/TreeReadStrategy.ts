/**
 * How a driver decides that the UI has settled enough to be read.
 *
 * Reading the page source is not free and reading it too early is worse than
 * not reading it: an accessibility tree captured mid-animation describes a
 * screen that no longer exists, and every element id in it is stale. Drivers
 * differ in how badly they need to wait, so the waiting rule is a collaborator
 * rather than a flag.
 */
export interface TreeReadStrategy {
  /** Identifies the strategy in logs and experiment results. */
  readonly name: string;

  /**
   * Produces the source of a settled tree.
   *
   * @param fetchSource reads the current page source; may be called more than once.
   */
  read(fetchSource: () => Promise<string>): Promise<string>;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
