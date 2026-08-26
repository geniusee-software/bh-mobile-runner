/**
 * Asks whether `visible` tells this app's tabs apart.
 *
 * The suite's largest single group of failures is "the RECOMMENDED tab is
 * active" — a claim the agents cannot check, because the tree they read shows
 * every tab's content at once and carries no active-state attribute. If the raw
 * dump marks the inactive tabs' content invisible, then the claim is answerable
 * after all and the tree simply throws the answer away.
 *
 * Prints, for each tab, how much of the dump is visible and what visible text
 * it holds, so the two tabs can be compared side by side.
 */
import { remote } from "webdriverio";
import { DEVICE } from "../config/device.ts";

const VISIBLE_FALSE = /visible="false"/g;
const ELEMENT = /<XCUIElementType\w+/g;
const STATIC_TEXT =
  /<XCUIElementTypeStaticText[^>]*\bname="([^"]{2,60})"[^>]*\bvisible="(true|false)"/g;

const browser = await remote({
  hostname: "127.0.0.1",
  port: DEVICE.appiumPort,
  logLevel: "error",
  capabilities: DEVICE.capabilities,
});

const survey = async (label: string) => {
  const xml = await browser.getPageSource();
  const total = xml.match(ELEMENT)?.length ?? 0;
  const hidden = xml.match(VISIBLE_FALSE)?.length ?? 0;
  const texts = new Set<string>();
  for (const match of xml.matchAll(STATIC_TEXT)) {
    if (match[2] === "true" && match[1]) texts.add(match[1]);
  }
  console.log(
    `\n=== ${label} === ${total} elements, ${hidden} invisible (${Math.round((hidden / total) * 100)}%)`,
  );
  console.log("visible text:", [...texts].slice(0, 18).join(" | "));
  return texts;
};

try {
  const daily = await survey("as launched");

  for (const tab of ["RECOMMENDED", "DAILY SHIURIM"]) {
    const element = await browser.$(`~${tab}`);
    if (await element.isExisting()) {
      await element.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const now = await survey(`after tapping ${tab}`);
      const gained = [...now].filter((text) => !daily.has(text));
      const lost = [...daily].filter((text) => !now.has(text));
      console.log(`  gained ${gained.length}, lost ${lost.length}`);
      console.log("  gained:", gained.slice(0, 8).join(" | "));
    } else {
      console.log(`\n${tab}: no such element`);
    }
  }
} finally {
  await browser.deleteSession();
}
