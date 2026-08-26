import { always } from "alwaysly";
import { Element } from "domhandler";
import { Xml } from "../xml/Xml.ts";
import { XmlRenderer } from "../xml/XmlRenderer.ts";
import type { AccessibilityElement } from "./AccessibilityElement.ts";
import { BaseAccessibilityTree } from "./BaseAccessibilityTree.ts";

export class XCUITestAccessibilityTree extends BaseAccessibilityTree<string> {
  /**
   * Element types XCUITest reports for embedded web content. `WebView` is the
   * container; `ScrollView` descendants of it hold the rendered page, so the
   * container alone is enough to know a webview context may exist.
   */
  private static readonly WEBVIEW_TYPE = /XCUIElementTypeWebView/;

  /**
   * `visible="false"` is the one false-valued attribute worth relaying.
   *
   * The renderer drops false attributes as noise, which is right for the rest
   * of them — the interesting half of `enabled` and `accessible` is `true`. For
   * `visible` it is the other way round, and dropping it here silently emptied
   * the whole chain: the server tree could carry visibility all it liked while
   * this side had already thrown it away.
   */
  private static readonly PRESERVE_FALSE = new Set(["visible"]);

  #xmlString: string;
  #nextRawId: number = 0;

  protected override get kind(): string {
    return "xcuitest";
  }

  constructor(xmlString: string) {
    super(xmlString);
    this.#xmlString = xmlString;
  }

  /** Parse XML and add raw_id attributes to all elements. */
  toStr(): string {
    if (this.xml !== null) {
      return this.xml;
    }

    // Parse the XML
    const root = this.#parseRoot(this.#xmlString);

    // Add raw_id attributes recursively
    this.#addRawIds(root);

    // Serialize back to string
    return (this.xml = XmlRenderer.render([root], {
      preserveFalseAttrs: XCUITestAccessibilityTree.PRESERVE_FALSE,
    }));
  }

  /** Recursively add raw_id attribute to element and its children. */
  #addRawIds(elem: Element): void {
    this.#nextRawId += 1;
    elem.attribs["raw_id"] = String(this.#nextRawId);
    for (const child of elem.children) {
      const childEl = Xml.nodeAsTag(child);
      if (!childEl) {
        continue;
      }
      this.#addRawIds(childEl);
    }
  }

  /**
   * Find element by raw_id and return its properties for XPath construction.
   *
   * @param rawId The raw_id to search for
   * @returns AccessibilityElement with type, name, value, label attributes
   */
  elementById(rawId: number): AccessibilityElement {
    // Get raw XML with raw_id attributes
    const rawXml = this.toStr();
    const root = this.#parseRoot(rawXml);

    // Find element with matching raw_id
    const findElement = (elem: Element, targetId: string): Element | null => {
      if (elem.attribs["raw_id"] === targetId) {
        return elem;
      }
      for (const child of elem.children) {
        const childEl = Xml.nodeAsTag(child);
        if (!childEl) {
          continue;
        }
        const result = findElement(childEl, targetId);
        if (result !== null) {
          return result;
        }
      }
      return null;
    };

    const element = findElement(root, String(rawId));
    if (element === null) {
      throw new Error(`No element with raw_id=${rawId} found`);
    }

    // Extract properties for XCUITest
    return {
      id: rawId,
      type: element.tagName,
      name: element.attribs["name"],
      value: element.attribs["value"],
      label: element.attribs["label"],
      visible: element.attribs["visible"] !== "false",
      matchIndex: this.#matchIndexOf(root, element),
    };
  }

  /**
   * Counts how many elements before this one share its identifying attributes
   * *and* its visibility.
   *
   * Those attributes are all a predicate can carry, and screens repeat them: a
   * feed of thirty shiur rows has thirty buttons named "play". Document order
   * is the order WebDriverAgent returns matches in, so a count is enough to
   * pick this element back out of that set.
   *
   * Visibility has to be part of the count because the driver asks for
   * on-screen matches only. Counting across both sets and then indexing into
   * one of them lands on a different element — and on this app that different
   * element is usually the same label on a tab nobody is looking at, which
   * accepts the tap, reports success, and changes nothing.
   */
  #matchIndexOf(root: Element, target: Element): number {
    const signature = (elem: Element) =>
      JSON.stringify([
        elem.tagName,
        elem.attribs["name"],
        elem.attribs["value"],
        elem.attribs["label"],
      ]);

    const wanted = signature(target);
    const wantedVisible = target.attribs["visible"] !== "false";
    let seen = 0;
    let found = 0;

    const walk = (elem: Element): boolean => {
      if (elem === target) {
        found = seen;
        return true;
      }
      if (
        signature(elem) === wanted &&
        (elem.attribs["visible"] !== "false") === wantedVisible
      ) {
        seen += 1;
      }

      for (const child of elem.children) {
        const childEl = Xml.nodeAsTag(child);
        if (childEl && walk(childEl)) return true;
      }
      return false;
    };

    walk(root);
    return found;
  }

  /** Scope the tree to a smaller subtree identified by raw_id. */
  scopeToArea(rawId: number): XCUITestAccessibilityTree {
    const rawXml = this.toStr();

    // Parse the XML
    const root = this.#parseRoot(rawXml);

    // Find the element with the matching raw_id
    const findElement = (elem: Element, targetId: string): Element | null => {
      if (elem.attribs["raw_id"] === targetId) {
        return elem;
      }
      for (const child of elem.children) {
        const childEl = Xml.nodeAsTag(child);
        if (!childEl) {
          continue;
        }
        const result = findElement(childEl, targetId);
        if (result !== null) {
          return result;
        }
      }
      return null;
    };

    const targetElem = findElement(root, String(rawId));

    if (targetElem === null) {
      // If not found, return original tree
      return this;
    }

    // Convert the scoped element back to XML string
    const scopedXml = XmlRenderer.render([targetElem], {
      preserveFalseAttrs: XCUITestAccessibilityTree.PRESERVE_FALSE,
    });

    return new XCUITestAccessibilityTree(scopedXml);
  }

  override containsWebview(): boolean {
    return XCUITestAccessibilityTree.WEBVIEW_TYPE.test(this.#xmlString);
  }

  #parseRoot(xml: string): Element {
    const roots = Xml.parseRootChildren(xml);
    let root: Element | null = null;
    for (const node of roots) {
      const el = Xml.nodeAsTag(node);
      if (el) {
        root = el;
        break;
      }
    }
    always(root);
    return root;
  }
}
