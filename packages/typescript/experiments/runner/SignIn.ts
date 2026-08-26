import type { Browser } from "webdriverio";

export namespace SignIn {
  export interface Credentials {
    email: string;
    password: string;
  }

  export interface Result {
    signedIn: boolean;
    /** What happened, for the run log. */
    detail: string;
  }
}

/** iOS predicate for a control carrying this name, label or placeholder. */
const byText = (text: string) =>
  `-ios predicate string:name == "${text}" OR label == "${text}" OR value == "${text}"`;

const EMAIL_FIELD = byText("Enter your email address");
const PASSWORD_FIELD = byText("Enter password");
const AVATAR = byText("avatar");
const LOG_IN_LINK = byText("Log In");
const SUBMIT = `-ios predicate string:type == "XCUIElementTypeButton" AND label == "LOG IN"`;
/** Present only once a session exists: the profile screen's sign-out control. */
const SIGNED_IN_MARKER = byText("Log Out");

/**
 * Puts the app into a signed-in state before a run.
 *
 * Signing in is a precondition, not a thing under test, so it is driven by
 * fixed selectors rather than by the agent: it must not consume model calls,
 * must not appear in the pass rate, and must fail loudly rather than leaving a
 * run to discover halfway through that it is still a guest.
 *
 * Typing is verified rather than assumed. A field that reports empty after
 * `setValue` means the keyboard was still animating or the tree was stale, and
 * submitting then produces a login form that silently posts nothing.
 */
export class SignIn {
  readonly #browser: Browser;
  readonly #credentials: SignIn.Credentials;

  constructor(browser: Browser, credentials: SignIn.Credentials) {
    this.#browser = browser;
    this.#credentials = credentials;
  }

  /** Reads credentials from the environment; returns undefined when unset. */
  static credentialsFromEnv(): SignIn.Credentials | undefined {
    const email = process.env["BH_APP_EMAIL"];
    const password = process.env["BH_APP_PASSWORD"];
    return email && password ? { email, password } : undefined;
  }

  async ensureSignedIn(): Promise<SignIn.Result> {
    if (await this.#exists(SIGNED_IN_MARKER)) {
      return { signedIn: true, detail: "already signed in" };
    }

    if (!(await this.#tap(AVATAR))) {
      return { signedIn: false, detail: "no avatar control on the home screen" };
    }
    await this.#settle();

    // The avatar opens the profile when a session exists and registration when
    // it does not, so the marker is the cheapest way to tell them apart.
    if (await this.#exists(SIGNED_IN_MARKER)) {
      await this.#goBack();
      return { signedIn: true, detail: "already signed in" };
    }

    if (!(await this.#tap(LOG_IN_LINK))) {
      return { signedIn: false, detail: "registration screen has no Log In link" };
    }
    await this.#settle();

    const typed = await this.#fillCredentials();
    if (typed) return { signedIn: false, detail: typed };

    if (!(await this.#tap(SUBMIT))) {
      return { signedIn: false, detail: "login form has no LOG IN button" };
    }

    // The form posts and the app navigates; give it room before deciding.
    await this.#settle(4000);
    const landed = !(await this.#exists(SUBMIT));
    return landed
      ? { signedIn: true, detail: `signed in as ${this.#credentials.email}` }
      : { signedIn: false, detail: "still on the login form after submitting" };
  }

  /** @returns an error description, or undefined when both fields hold their value. */
  async #fillCredentials(): Promise<string | undefined> {
    const { email, password } = this.#credentials;

    const emailError = await this.#type(EMAIL_FIELD, email, "email");
    if (emailError) return emailError;

    // Secure fields never echo their contents, so the check is that the
    // placeholder is gone rather than that the value matches.
    const passwordError = await this.#type(PASSWORD_FIELD, password, "password");
    if (passwordError) return passwordError;

    return undefined;
  }

  async #type(
    locator: string,
    text: string,
    field: string,
  ): Promise<string | undefined> {
    const element = this.#browser.$(locator);
    if (!(await element.isExisting())) return `no ${field} field on the form`;

    await element.click();
    await element.setValue(text);
    await this.#settle(600);

    // The locator matches on the placeholder, so the field having accepted the
    // text is exactly the locator no longer matching anything.
    if (await this.#exists(locator)) {
      return `${field} field still shows its placeholder after typing`;
    }
    return undefined;
  }

  async #tap(locator: string): Promise<boolean> {
    const element = this.#browser.$(locator);
    if (!(await element.isExisting())) return false;
    await element.click();
    return true;
  }

  async #exists(locator: string): Promise<boolean> {
    return this.#browser.$(locator).isExisting();
  }

  async #goBack(): Promise<void> {
    await this.#browser.execute("mobile: swipe", { direction: "right" });
    await this.#settle();
  }

  #settle(ms = 1500): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
