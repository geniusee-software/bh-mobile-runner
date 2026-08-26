import { DEVICE } from "../config/device.ts";
import { SimulatorSession } from "../runner/SimulatorSession.ts";

const session = new SimulatorSession(DEVICE);
const b = await session.start();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await b.execute("mobile: terminateApp", { bundleId: DEVICE.bundleId });
await b.execute("mobile: launchApp", { bundleId: DEVICE.bundleId });
await sleep(2500);

for (const label of ["Search", "Highlights", "Donate"]) {
  const els = await b.$$(`-ios predicate string:name == "${label}"`).getElements();
  console.log(`\n"${label}": ${els.length} matches`);
  for (const [i, el] of els.entries()) {
    const loc = await el.getLocation().catch(() => null);
    const size = await el.getSize().catch(() => null);
    const disp = await el.isDisplayed().catch(() => false);
    console.log(`  [${i}] displayed=${disp} at ${JSON.stringify(loc)} size ${JSON.stringify(size)}`);
  }
  if (els.length) {
    const el = els[els.length - 1]!;
    const loc = await el.getLocation(); const size = await el.getSize();
    await b.execute("mobile: tap", { x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) });
    await sleep(2000);
    const src = await b.getPageSource();
    const head = /name="([^"]{3,30})"/.exec(src)?.[1];
    console.log(`  after coordinate tap -> first named: ${head}, has "Popular Topics": ${src.includes("Popular Topics")}`);
  }
}
await session.stop();
