import { remote } from "webdriverio";
import type { Browser } from "webdriverio";

export namespace SimulatorSession {
  /** Everything needed to reach one iOS simulator through one Appium server. */
  export interface Props {
    /** Simulator UDID. The device must already be created; booting is left to Appium. */
    udid: string;
    /** Bundle identifier of the application under test. */
    bundleId: string;
    /** Absolute path to the `.app` bundle, installed when the app is missing. */
    appPath?: string | undefined;
    platformVersion: string;
    deviceName: string;
    appiumPort: number;
    appiumHost?: string;
    /**
     * Port WebDriverAgent listens on inside the simulator. Every booted
     * simulator on the host runs its own WDA, and they all default to 8100 —
     * leaving this unset makes the driver talk to whichever WDA claimed the
     * port first and fail with "Session does not exist".
     */
    wdaLocalPort: number;
    /** MJPEG screenshot stream port; collides across simulators like `wdaLocalPort`. */
    mjpegServerPort: number;
    /**
     * Wipe application state between sessions. Runs start from a known screen
     * when enabled, which is what experiment comparability requires.
     */
    fullReset?: boolean;
    /**
     * Cap on snapshot depth. Left unset by default — see `SNAPSHOT_TUNING` for
     * why capping it loses content on this app.
     */
    snapshotMaxDepth?: number | undefined;
    /**
     * Apply the snapshot tuning below. Off reproduces stock Appium timings,
     * which is what a "before" measurement needs.
     */
    tuneSnapshots?: boolean;
  }
}

/**
 * Settings that decide what a single accessibility snapshot costs.
 *
 * `waitForIdleTimeout` is the free part: it makes WebDriverAgent wait for the
 * app to report itself idle before looking at it, which an app with a running
 * animation or a repeating timer never does.
 *
 * Depth is not free, and the tempting setting is a trap. Measured on this app's
 * home screen (`scripts/probeDepth.ts`), capping at 24 costs 4.7s instead of
 * 17.3s and still shows every navigation landmark — but the content lists
 * arrive empty (`<ScrollView />`), because this app nests its cards one level
 * below the cap. Steps then fail for no visible reason: the screen is right and
 * the tree says it is bare. The cap is left off, and snapshot count is reduced
 * elsewhere instead.
 */
const SNAPSHOT_TUNING = {
  waitForIdleTimeout: 0,
  animationCoolOffTimeout: 0,
  /** Fail loudly rather than hanging when a snapshot genuinely cannot be taken. */
  customSnapshotTimeout: 60,
} as const;

/**
 * Owns the WebdriverIO session against a local iOS simulator.
 *
 * Capabilities are pinned here rather than spread across cases so every
 * experiment variant talks to the device through an identical channel, and the
 * only thing that varies between runs is the agent under test.
 */
export class SimulatorSession {
  readonly #props: SimulatorSession.Props;
  #browser: Browser | undefined;

  constructor(props: SimulatorSession.Props) {
    this.#props = props;
  }

  get browser(): Browser {
    if (!this.#browser) {
      throw new Error("Simulator session is not open; call start() first.");
    }
    return this.#browser;
  }

  async start(): Promise<Browser> {
    const {
      udid,
      bundleId,
      appPath,
      platformVersion,
      deviceName,
      appiumPort,
      appiumHost = "127.0.0.1",
      wdaLocalPort,
      mjpegServerPort,
      fullReset = false,
      tuneSnapshots = true,
      snapshotMaxDepth,
    } = this.#props;

    const capabilities: WebdriverIO.Capabilities = {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:udid": udid,
      "appium:deviceName": deviceName,
      "appium:platformVersion": platformVersion,
      "appium:bundleId": bundleId,
      "appium:noReset": !fullReset,
      "appium:fullReset": fullReset,
      "appium:newCommandTimeout": 600,
      // Log capture spawns a syslog tail per session that never drains on
      // simulators and eventually stalls the whole run.
      "appium:skipLogCapture": true,
      "appium:wdaLocalPort": wdaLocalPort,
      "appium:mjpegServerPort": mjpegServerPort,
      "appium:usePrebuiltWDA": false,
      "appium:wdaLaunchTimeout": 240_000,
      "appium:wdaConnectionTimeout": 240_000,
      "appium:simulatorStartupTimeout": 240_000,
    };

    if (appPath) {
      capabilities["appium:app"] = appPath;
    }


    this.#browser = await remote({
      capabilities,
      hostname: appiumHost,
      port: appiumPort,
      path: "/",
      logLevel: "error",
      connectionRetryTimeout: 300_000,
      connectionRetryCount: 2,
    });

    if (tuneSnapshots) {
      // These are session settings rather than capabilities: passing them at
      // session creation is silently ignored, which looks exactly like the
      // tuning having no effect.
      await this.#browser.updateSettings({
        ...SNAPSHOT_TUNING,
        ...(snapshotMaxDepth ? { snapshotMaxDepth } : {}),
      });
    }

    return this.#browser;
  }

  /** Return the app to its first screen without paying for a new WDA handshake. */
  async relaunchApp(): Promise<void> {
    const { bundleId } = this.#props;
    await this.browser.execute("mobile: terminateApp", { bundleId });
    await this.browser.execute("mobile: launchApp", { bundleId });
  }

  async stop(): Promise<void> {
    if (!this.#browser) return;
    await this.#browser.deleteSession();
    this.#browser = undefined;
  }
}
