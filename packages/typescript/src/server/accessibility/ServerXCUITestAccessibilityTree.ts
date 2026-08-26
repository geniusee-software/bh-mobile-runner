import { Xml } from "../../xml/Xml.ts";
import { BaseServerAccessibilityTree } from "./BaseServerAccessibilityTree.ts";
import type { Tree } from "../../tree/Tree.ts";
import { always } from "alwaysly";

export class ServerXCUITestAccessibilityTree extends BaseServerAccessibilityTree {
  #tree: Tree.Node[] = [];

  constructor(xml: string) {
    super();

    this.#tree = this.#parseTree(xml);

    void this.devCaptureTreeInput("xcuitest", xml);
  }

  //#region Parsing

  #parseTree(xml: string): Tree.Node[] {
    const xmlAppTag = this.#findXmlAppTag(Xml.parseRootChildren(xml));
    if (!xmlAppTag) return [];

    const root = this.xmlNodeToTreeNode(xmlAppTag);
    this.#summariseHidden(root, false);
    return [root];
  }

  /**
   * Reduces what is hidden to the least that still says it.
   *
   * XCUITest flags every element separately, so one closed tab arrives as
   * several hundred individually marked nodes. Two things follow from
   * invisibility being inherited: only the outermost hidden node needs the
   * mark, and a hidden subtree that names nothing is worth no mark at all —
   * the reader learns nothing from being told an anonymous box is off screen,
   * and leaving it in place blocks the wrapper trimming that keeps these trees
   * small.
   */
  #summariseHidden(node: Tree.Node, inherited: boolean): void {
    const hidden = inherited || node.attrs["visible"] === "false";
    if (inherited) delete node.attrs["visible"];

    node.children = node.children.filter(
      (child) =>
        !(hidden || child.attrs["visible"] === "false") || this.#names(child),
    );

    for (const child of node.children) this.#summariseHidden(child, hidden);
  }

  /** Whether this subtree names anything a person could be looking for. */
  #names(node: Tree.Node): boolean {
    return (
      Boolean(node.name?.trim()) || node.children.some((c) => this.#names(c))
    );
  }

  #findXmlAppTag(xmlRoots: Xml.Node[]): Xml.Tag | null {
    for (const xmlRoot of xmlRoots) {
      const xmlRootTag = Xml.nodeAsTag(xmlRoot);
      if (!xmlRootTag) continue;

      if (xmlRootTag.tagName === "AppiumAUT") {
        for (const xmlChild of xmlRootTag.children) {
          const xmlRootChild = Xml.nodeAsTag(xmlChild);
          if (xmlRootChild?.tagName.startsWith("XCUIElementType"))
            return xmlRootChild;
        }
        return null;
      }

      if (xmlRootTag.tagName.startsWith("XCUIElementType")) return xmlRootTag;
    }
    return null;
  }

  protected override parseRole(xmlTag: Xml.Tag): string {
    const xcuiType = xmlTag.attribs.type ?? xmlTag.tagName;
    const simple = xcuiType.replace(/^XCUIElementType/, "");
    return simple === "Other" ? "generic" : simple;
  }

  #textAttrs = new Set(["name", "label", "value"]);

  protected override parseName(
    role: string,
    xmlTag: Xml.Tag,
  ): string | undefined {
    const { name, label, value } = xmlTag.attribs;
    const trimmedName = name?.trim();
    const trimmedLabel = label?.trim();
    if (role === "StaticText" && trimmedLabel) return trimmedLabel;
    if (trimmedName) return trimmedName;
    if (trimmedLabel) return trimmedLabel;
    const trimmedValue = value?.trim();
    if (role === "StaticText" && trimmedValue) return trimmedValue;
    return undefined;
  }

  protected override normalizeXmlAttr(
    attrName: string,
    attrValue: string,
  ): string {
    return this.#textAttrs.has(attrName) ? attrValue.trim() : attrValue;
  }

  /**
   * `selected` is listed for completeness, but XCUITest does not report it:
   * its snapshot carries type, name, label, value, enabled, visible,
   * accessible, frame and index, and nothing else. Segmented controls are the
   * exception — they encode selection in `value`, which is already carried.
   *
   * `visible` stands in for the selection XCUITest will not report. An iOS app
   * keeps every tab of a tab bar mounted, so all of them appear here at once
   * and the active and inactive tab buttons serialise identically. What does
   * differ is their content: only the open tab's rows are visible. Carrying
   * that distinguishes the screen on display from the three behind it, which
   * is otherwise not expressible in this tree at all.
   *
   * It is carried rather than filtered out because off-screen is not the same
   * as absent: a row below the fold is invisible too, and the runner is
   * expected to scroll to it rather than report it missing.
   */
  #xmlAttrsToExtract = new Set([
    "label",
    "value",
    "enabled",
    "selected",
    "visible",
  ]);

  protected override skipXmlAttr(
    role: string,
    attrName: string,
    attrValue: string,
  ): boolean {
    if (role === "StaticText" && attrName === "name") return false;
    if (!this.#xmlAttrsToExtract.has(attrName)) return true;
    // Only the surprising value is worth its tokens: almost everything is
    // enabled and almost nothing is selected.
    if (attrName === "enabled" && attrValue === "true") return true;
    if (attrName === "selected" && attrValue !== "true") return true;
    if (attrName === "visible" && attrValue !== "false") return true;
    return false;
  }

  //#endregion

  //#region Rendering

  /**
   * Converts tree to XML string.
   *
   * @param excludeAttrs Optional set of attribute names to exclude from output.
   */
  override toXml(excludeAttrs: Set<string> = new Set()): string {
    const xml = this.renderXml(this.#tree, { excludeAttrs });

    void this.devCaptureTreeOutput(xml);

    return xml;
  }

  /**
   * `false` is the whole point of carrying `visible`, and both the parser and
   * the renderer drop false-valued attributes unless told otherwise.
   */
  protected override preserveFalseAttrs = new Set(["visible"]);

  protected override get renderPreserveFalseAttrs(): ReadonlySet<string> {
    return this.preserveFalseAttrs;
  }

  protected override genericRoles = new Set(["generic", "StaticText"]);

  protected override redundantTextAttrs = new Set(["name", "label", "value"]);

  protected override deduplicateAttrs = new Set(["label", "value"]);

  protected override textContentAttr(role: string): string | undefined {
    return role === "StaticText" ? "label" : undefined;
  }

  protected override pruneBackendRedundantNodes(xmlTag: Xml.Tag): void {
    for (const child of xmlTag.children) {
      const childTag = Xml.nodeAsTag(child);
      if (childTag) this.pruneBackendRedundantNodes(childTag);
    }

    if (xmlTag.children.length !== 1) return;
    const onlyChild = xmlTag.children[0];
    always(onlyChild);
    const childTag = Xml.nodeAsTag(onlyChild);
    if (!childTag || !this.isGenericRole(childTag.tagName)) return;
    if (Object.keys(childTag.attribs).some((attrName) => attrName !== "id"))
      return;
    if (childTag.children.length !== 1) return;

    const onlyGrandchild = childTag.children[0];
    always(onlyGrandchild);
    const childText = Xml.nodeAsText(onlyGrandchild);
    if (!childText) return;
    const parentName = xmlTag.attribs.name;
    if (parentName && parentName !== childText.data) return;

    delete xmlTag.attribs.name;
    xmlTag.children = [childText];
  }

  //#endregion
}
