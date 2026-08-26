/**
 * Reads back what actually landed in the login fields.
 *
 * The app rejects credentials that Cognito accepts directly, so something
 * between the keyboard and the form is changing them. The email field is not
 * secure, so its value can simply be read; the password field cannot, and is
 * probed by length instead.
 */
import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const email = process.env["BH_APP_EMAIL"] ?? "";
const password = process.env["BH_APP_PASSWORD"] ?? "";

const byText = (text: string) =>
  `-ios predicate string:name == "${text}" OR label == "${text}" OR value == "${text}"`;

const session = new SimulatorSession(DEVICE);
await session.start();
const browser = session.browser;

const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

try {
  await browser.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
  await browser.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });
  await settle(3000);

  await browser.$(byText("avatar")).click();
  await settle();
  const logIn = browser.$(byText("Log In"));
  if (await logIn.isExisting()) {
    await logIn.click();
    await settle();
  }

  const emailField = browser.$(byText("Enter your email address"));
  await emailField.click();
  await emailField.setValue(email);
  await settle();

  // Read every text field on the form back, whatever it is called now.
  const fields = await browser.$$(
    '-ios predicate string:type == "XCUIElementTypeTextField" OR type == "XCUIElementTypeSecureTextField"',
  );
  console.log(`intended email : ${JSON.stringify(email)}`);
  for (const field of fields) {
    const [type, value, placeholder] = await Promise.all([
      field.getAttribute("type"),
      field.getAttribute("value"),
      field.getAttribute("placeholderValue").catch(() => ""),
    ]);
    console.log(
      `  ${String(type).replace("XCUIElementType", "").padEnd(16)} value=${JSON.stringify(value)} placeholder=${JSON.stringify(placeholder)}`,
    );
  }

  const secure = browser.$(byText("Enter password"));
  if (await secure.isExisting()) {
    await secure.click();
    await secure.setValue(password);
    await settle();
  }

  const submit = browser.$(
    '-ios predicate string:type == "XCUIElementTypeButton" AND label == "LOG IN"',
  );
  await submit.click();
  await settle(4000);
  const rejected = await browser
    .$(byText("Incorrect email or password"))
    .isExisting();
  console.log(`\nsetValue  -> ${rejected ? "REJECTED by the app" : "accepted"}`);

  // Second attempt: the same characters, but through the keyboard, so a
  // SwiftUI binding sees each edit rather than one silent assignment.
  await browser.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
  await browser.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });
  await settle(3000);
  await browser.$(byText("avatar")).click();
  await settle();
  const link = browser.$(byText("Log In"));
  if (await link.isExisting()) { await link.click(); await settle(); }

  const typeByKeyboard = async (locator: string, text: string) => {
    const field = browser.$(locator);
    await field.click();
    await settle(500);
    for (const character of text) {
      await browser.keys(character);
      await new Promise((r) => setTimeout(r, 45));
    }
    await settle(400);
  };

  await typeByKeyboard(byText("Enter your email address"), email);
  await typeByKeyboard(byText("Enter password"), password);
  await browser
    .$('-ios predicate string:type == "XCUIElementTypeButton" AND label == "LOG IN"')
    .click();
  await settle(5000);
  const rejected2 = await browser
    .$(byText("Incorrect email or password"))
    .isExisting();
  const loggedOut = await browser.$(byText("Log Out")).isExisting();
  console.log(`keyboard  -> ${rejected2 ? "REJECTED by the app" : loggedOut ? "SIGNED IN" : "no rejection banner; signed-in marker not found yet"}`);
} finally {
  await session.stop();
}
