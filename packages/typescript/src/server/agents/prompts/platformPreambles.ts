import type { Driver } from "../../../drivers/Driver.ts";

/**
 * Platform vocabulary prepended to every agent's system prompt.
 *
 * The shipped prompts describe a webpage: they name the surface a "webpage",
 * ask about its title and URL, and call the tree an ARIA tree. Pointed at a
 * native app those words are not merely inaccurate, they change answers — a
 * retriever asked whether "a screen titled 'Notifications' is visible" will
 * find the words in the navigation bar and then reject them because the
 * application's own title is the app's name, which is the only thing a webpage
 * could have meant. Naming the surface correctly costs a few dozen tokens and
 * removes a whole class of that reasoning.
 */
export const PLATFORM_PREAMBLES: Record<Driver.Platform, string> = {
  chromium: "",

  xcuitest: [
    "PLATFORM: you are looking at a native iOS application, not a webpage.",
    "- The tree is an XCUITest accessibility hierarchy. Element types are named `XCUIElementType*`.",
    "- There is no page title and no URL; those fields are empty and carry no meaning. Never reason about them.",
    '- A screen is "titled" by the text in its navigation bar, header or the heading nearest the top — not by the application name.',
    "- Treat `name`, `label` and `value` as the text a person sees. An element is present if it is in the tree, even when it sits below the fold.",
  ].join("\n"),

  uiautomator2: [
    "PLATFORM: you are looking at a native Android application, not a webpage.",
    "- The tree is a UiAutomator2 hierarchy. Element types are Android class names such as `android.widget.Button`.",
    "- There is no page title and no URL; those fields are empty and carry no meaning. Never reason about them.",
    '- A screen is "titled" by its toolbar or action-bar text, not by the application name.',
    "- Treat `text`, `content-desc` and `resource-id` as the text a person sees. An element is present if it is in the tree, even when it sits below the fold.",
  ].join("\n"),
};

/** Prepends the platform note to a system prompt, if that platform has one. */
export function withPlatformPreamble(
  systemPrompt: string,
  platform: Driver.Platform | undefined,
): string {
  const preamble = platform ? PLATFORM_PREAMBLES[platform] : "";
  return preamble ? `${preamble}\n\n${systemPrompt}` : systemPrompt;
}
