/**
 * Walks the login screen by hand and photographs every stage.
 *
 * The account is known good — Cognito issues tokens for it directly, and it
 * works in the App Store build — so what is wrong is on this screen. The
 * password field cannot be read while it is masked, but the form has a reveal
 * toggle, which turns it into an ordinary readable field.
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const email = process.env["BH_APP_EMAIL"] ?? "";
const password = process.env["BH_APP_PASSWORD"] ?? "";
const OUT = process.env["BH_SHOTS"] ?? "/tmp/p4l-login";

const byText = (text: string) =>
  `-ios predicate string:name == "${text}" OR label == "${text}" OR value == "${text}"`;

const session = new SimulatorSession(DEVICE);
await session.start();
const browser = session.browser;
const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

const shot = async (name: string) => {
  const base64 = await browser.takeScreenshot();
  await Bun.write(`${OUT}/${name}.png`, Buffer.from(base64, "base64"));
  console.log(`  shot: ${name}`);
};

const fields = async (label: string) => {
  const all = await browser.$$(
    '-ios predicate string:type == "XCUIElementTypeTextField" OR type == "XCUIElementTypeSecureTextField"',
  );
  console.log(`  [${label}]`);
  for (const field of all) {
    const [type, value] = await Promise.all([
      field.getAttribute("type"),
      field.getAttribute("value"),
    ]);
    console.log(
      `    ${String(type).replace("XCUIElementType", "").padEnd(16)} value=${JSON.stringify(value)}`,
    );
  }
};

try {
  await browser.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
  await browser.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });
  await settle(3500);
  await shot("1-home");

  await browser.$(byText("avatar")).click();
  await settle();
  await shot("2-after-avatar");

  const logIn = browser.$(byText("Log In"));
  if (await logIn.isExisting()) {
    await logIn.click();
    await settle();
  }
  await shot("3-login-form");

  const emailField = browser.$(byText("Enter your email address"));
  await emailField.click();
  await emailField.setValue(email);
  await settle();

  const secure = browser.$(byText("Enter password"));
  await secure.click();
  await secure.setValue(password);
  await settle();
  await fields("after typing, masked");
  await shot("4-filled");

  // Reveal, so the masked field becomes readable.
  for (const name of ["eyeClosed", "eyeOpened", "eye"]) {
    const eye = browser.$(byText(name));
    if (await eye.isExisting()) {
      await eye.click();
      await settle(700);
      console.log(`  tapped reveal: ${name}`);
      break;
    }
  }
  await fields("after reveal");
  await shot("5-revealed");

  await browser
    .$('-ios predicate string:type == "XCUIElementTypeButton" AND label == "LOG IN"')
    .click();
  await settle(5000);
  await shot("6-after-submit");
  await fields("after submit");
} finally {
  await session.stop();
}
