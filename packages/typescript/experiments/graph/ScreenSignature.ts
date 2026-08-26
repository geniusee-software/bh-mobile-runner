import { Xml } from "../../src/xml/Xml.ts";

export namespace ScreenSignature {
  export interface Element {
    role: string;
    /** The text a person sees: name, label or value, whichever the tree carried. */
    text: string;
  }

  export interface Screen {
    /** Stable identity across visits. */
    signature: string;
    /** Best guess at what a case would call this screen. */
    title: string;
    elements: Element[];
  }
}

/**
 * Text that belongs to content rather than to the screen itself.
 *
 * A screen has to be recognisable across visits, and this app's screens are
 * mostly filled with a feed that changes daily. Dates, durations, counts and
 * numbered items are what change; navigation labels and section headings are
 * what stay. Only the second kind may enter a signature.
 */
const CONTENT_LIKE = [
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{2,}\s*Shiurim\b/i,
  /\b(Shiur|Daf|Perek|Chelek)\s+\d+/i,
  /^\d+$/,
  /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*\d/i,
];

/** Roles whose presence and naming define a screen rather than fill it. */
const STRUCTURAL_ROLES = new Set(["Button", "TextField", "SearchField", "Switch"]);

function isContentLike(text: string): boolean {
  return CONTENT_LIKE.some((pattern) => pattern.test(text));
}

/**
 * Names that identify nothing.
 *
 * SwiftUI leaves controls whose accessibility label was never set carrying
 * punctuation or an internal class name; both are noise in a signature and in
 * anything an expectation could reference.
 */
function isJunk(text: string): boolean {
  return (
    text.length < 2 ||
    /^[\s,.|·:;-]+$/.test(text) ||
    text.startsWith("_Tt") ||
    /^(Vertical|Horizontal) scroll bar$/.test(text) ||
    /^\d+ page$/.test(text)
  );
}

/**
 * Derives a screen's identity and contents from a serialised accessibility tree.
 *
 * Identity is the screen's heading, because that is what a test case calls it —
 * "the Notifications screen", "the AhavasYisroel4Life screen" — and because it
 * survives the feed underneath rotating. The set of structural controls was
 * tried first and split one home screen into five: every visit differed by
 * whichever cards happened to be loaded. It is kept only as a fallback for
 * screens that show no heading at all.
 */
export function readScreen(treeXml: string): ScreenSignature.Screen {
  const elements: ScreenSignature.Element[] = [];
  const structural = new Set<string>();

  const collect = (node: Xml.Node): void => {
    const text = Xml.nodeAsText(node);
    if (text) {
      const body = text.data.trim().replace(/\s+/g, " ");
      if (body && !isJunk(body)) elements.push({ role: "Text", text: body });
      return;
    }

    const tag = Xml.nodeAsTag(node);
    if (!tag) return;

    // Everything under a hidden element is hidden too, and this app keeps every
    // tab mounted at once — so without this the reading is of all four tabs
    // stacked together, and no two screens can be told apart.
    if (tag.attribs["visible"] === "false") return;

    const role = tag.tagName.replace(/^XCUIElementType/, "");
    const label = (
      tag.attribs["name"] ??
      tag.attribs["label"] ??
      tag.attribs["value"] ??
      ""
    ).trim();

    if (label && !isJunk(label)) {
      const isText = role === "StaticText";
      elements.push({ role: isText ? "Text" : role, text: label });
      if (!isText && STRUCTURAL_ROLES.has(role) && !isContentLike(label)) {
        structural.add(label);
      }
    }

    for (const child of tag.children) collect(child);
  };

  for (const root of Xml.parseRootChildren(treeXml)) collect(root);

  const title = guessTitle(elements);
  return {
    signature: title || [...structural].sort().join("|") || "unknown",
    title,
    elements,
  };
}

/**
 * The heading a person would name this screen by.
 *
 * Prefers the first non-content text that is not a tab-bar label, which on iOS
 * is where the navigation title lands once the tree is flattened.
 */
function guessTitle(elements: ScreenSignature.Element[]): string {
  const TAB_LABELS = new Set([
    "Home",
    "Search",
    "Highlights",
    "Community",
    "Donate",
  ]);

  for (const element of elements) {
    if (element.role !== "Text") continue;
    if (TAB_LABELS.has(element.text)) continue;
    if (isContentLike(element.text) || isJunk(element.text)) continue;
    if (element.text.length > 48) continue;
    return element.text;
  }
  return "";
}
