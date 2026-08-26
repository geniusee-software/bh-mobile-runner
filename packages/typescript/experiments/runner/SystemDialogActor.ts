import type { Browser } from "webdriverio";

export namespace SystemDialogActor {
  export interface Dismissal {
    /** The dialog's own text, so a run can be read back and audited. */
    text: string;
    /** Where in the case it appeared, for the run log. */
    at: string;
  }
}

/**
 * Answers the dialogs iOS puts over the app, so no case has to.
 *
 * A system alert — notification permission, tracking, location — belongs to
 * SpringBoard rather than to the application, so it never appears in the app's
 * accessibility tree and nothing an agent does can reach it. What it does do is
 * cover the screen: measured on this suite, twenty signed-in cases passed six
 * steps out of sixty-seven while a permission prompt stood over them, and the
 * judge's reason on most of them was that a dialog was blocking the view. That
 * reads exactly like the application being broken.
 *
 * Dialogs are declined rather than accepted. A test should not grant a
 * permission nobody asked it to grant, and iOS remembers a refusal: the prompt
 * is shown once and never again, whereas an app that is granted notification
 * permission is then free to draw banners over a later step.
 *
 * Nothing here is a step. Dismissals are recorded separately so a run stays
 * auditable, but they never enter a pass rate: the dialog is a property of the
 * device, and counting it would score the runner on iOS's behaviour rather than
 * on the application's.
 */
export class SystemDialogActor {
  /** Buttons that decline, in the order iOS tends to label them. */
  static readonly DECLINE_LABELS = [
    "Don't Allow",
    "Don’t Allow",
    "Not Now",
    "Ask App Not to Track",
    "Cancel",
  ];

  readonly #browser: Browser;
  readonly #dismissed: SystemDialogActor.Dismissal[] = [];

  constructor(browser: Browser) {
    this.#browser = browser;
  }

  /** Everything this actor answered, in the order it appeared. */
  get dismissed(): readonly SystemDialogActor.Dismissal[] {
    return this.#dismissed;
  }

  forget(): void {
    this.#dismissed.length = 0;
  }

  /**
   * Clears any system dialog standing over the app.
   *
   * Silent and cheap when there is none, which is the common case: one probe
   * for alert text, and an immediate return when the device says there is no
   * alert. Loops because dismissing one can reveal another.
   *
   * @returns how many dialogs were answered.
   */
  async clear(at: string, maxDialogs = 3): Promise<number> {
    let answered = 0;

    for (let attempt = 0; attempt < maxDialogs; attempt += 1) {
      const text = await this.#alertText();
      if (text === undefined) break;

      if (await this.#decline()) {
        this.#dismissed.push({ text: text.slice(0, 200), at });
        answered += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else {
        break;
      }
    }

    return answered;
  }

  async #alertText(): Promise<string | undefined> {
    try {
      return await this.#browser.getAlertText();
    } catch {
      return undefined; // No alert standing.
    }
  }

  /**
   * Presses the button that says no.
   *
   * The named buttons are tried first because `dismissAlert` presses whichever
   * button the alert calls its cancel button, and a permission prompt does not
   * always nominate one — on those, dismissing silently does nothing and the
   * dialog is still there on the next read.
   */
  async #decline(): Promise<boolean> {
    for (const label of SystemDialogActor.DECLINE_LABELS) {
      const button = this.#browser.$(
        `-ios predicate string:type == "XCUIElementTypeButton" AND (label == "${label}" OR name == "${label}")`,
      );
      try {
        if (await button.isExisting()) {
          await button.click();
          return true;
        }
      } catch {
        // The dialog went away on its own between the check and the tap.
        return true;
      }
    }

    try {
      await this.#browser.dismissAlert();
      return true;
    } catch {
      return false;
    }
  }
}
