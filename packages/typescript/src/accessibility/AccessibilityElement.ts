export interface AccessibilityElement {
  id?: number | undefined;
  backendNodeId?: number | undefined;
  name?: string | undefined;
  label?: string | undefined;
  type?: string | undefined;
  value?: string | undefined;
  androidResourceId?: string | undefined;
  androidClass?: string | undefined;
  androidText?: string | undefined;
  androidContentDesc?: string | undefined;
  androidBounds?: string | undefined;
  frame?: object | undefined;
  frameChain?: number[] | undefined; // For Selenium: chain of iframe backendNodeIds from root to element's frame
  /**
   * Position among the elements a locator built from this one would match,
   * in document order, starting at 0.
   *
   * Mobile screens repeat labels freely — one Path4Life screen carries thirty
   * buttons named "play" — so a locator alone identifies a set, not an element.
   * Without this the driver silently acts on the first of that set and the
   * agent's actual choice is discarded.
   */
  matchIndex?: number | undefined;
}
