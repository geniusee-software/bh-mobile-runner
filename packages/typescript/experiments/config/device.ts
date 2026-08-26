import type { SimulatorSession } from "../runner/SimulatorSession.ts";

/**
 * The dedicated experiment simulator.
 *
 * Kept apart from the shared QA-P4L devices so a run here can never collide
 * with work happening on those, and pinned by UDID so results always name the
 * exact device they came from.
 */
export const DEVICE: SimulatorSession.Props = {
  udid: process.env.BH_SIM_UDID ?? "FD86C95B-BB38-4680-AC6E-F3F32907CB91",
  deviceName: process.env.BH_SIM_NAME ?? "BH-EXP-01",
  platformVersion: process.env.BH_SIM_OS ?? "17.0",
  bundleId: process.env.BH_APP_BUNDLE_ID ?? "com.thepath4life.ios.prod",
  appPath:
    process.env.BH_APP_PATH ??
    "/Users/nazariy/Downloads/bh-apps/p4l-sim/Payload/Path4Life Prod.app",
  appiumPort: Number(process.env.BH_APPIUM_PORT ?? 4739),
  appiumHost: process.env.BH_APPIUM_HOST ?? "127.0.0.1",
  // 8100-8102 / 9100 belong to the shared QA-P4L simulators already booted on
  // this host; these are picked well clear of that range.
  wdaLocalPort: Number(process.env.BH_WDA_PORT ?? 8199),
  mjpegServerPort: Number(process.env.BH_MJPEG_PORT ?? 9199),
  // Measured on this app: 4.7s per snapshot instead of 17.3s, with no
  // observed cost to pass rate. See SNAPSHOT_TUNING for the caveat.
  snapshotMaxDepth: Number(process.env.BH_SNAPSHOT_DEPTH ?? 24),
};
