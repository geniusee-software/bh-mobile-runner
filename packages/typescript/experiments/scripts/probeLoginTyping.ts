/**
 * Reads back what the login fields actually contain after typing.
 *
 * "Incorrect email or password" has two very different causes — the wrong
 * credentials, or the right ones mangled on the way in by autocapitalisation or
 * a stale keyboard — and only the field's own value tells them apart.
 *
 * Run: BH_APP_EMAIL=... BH_APP_PASSWORD=... bun experiments/scripts/probeLoginTyping.ts
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";
import { SignIn } from "../runner/SignIn.ts";

const credentials = SignIn.credentialsFromEnv();
if (!credentials) throw new Error("Set BH_APP_EMAIL and BH_APP_PASSWORD");

const byText = (text: string) =>
  `-ios predicate string:name == "${text}" OR label == "${text}" OR value == "${text}"`;

const session = new SimulatorSession(DEVICE);
const browser = await session.start();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await browser.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
await browser.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });
await sleep(2500);

await browser.$(byText("avatar")).click();
await sleep(1800);
await browser.$(byText("Log In")).click();
await sleep(1800);

const email = browser.$(byText("Enter your email address"));
await email.click();
await email.setValue(credentials.email);
await sleep(800);

// Read the field back by type rather than by placeholder — the placeholder is
// gone once it holds a value, so the original locator no longer matches.
const emailField = browser.$(
  '-ios predicate string:type == "XCUIElementTypeTextField"',
);
const typed = await emailField.getValue();

console.log(`intended: ${JSON.stringify(credentials.email)}`);
console.log(`in field: ${JSON.stringify(typed)}`);
console.log(`match:    ${typed === credentials.email ? "yes" : "NO"}`);

const password = browser.$(byText("Enter password"));
await password.click();
await password.setValue(credentials.password);
await sleep(800);

const secure = browser.$(
  '-ios predicate string:type == "XCUIElementTypeSecureTextField"',
);
const masked = await secure.getValue();
console.log(`password field reports: ${JSON.stringify(masked)} (${credentials.password.length} chars intended)`);

await session.stop();
