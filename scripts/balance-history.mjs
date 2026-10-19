/**
 * Dev-only balance History regression. Renders the balance chart from a
 * synthetic 30-day fixture at three panel widths and checks the status line,
 * the top-up readout and the no-readings readout under a real mouse.
 * Run: pnpm test:balance-history [--screenshot path.png]
 *
 * Uses the Chromium revision that ships with the installed playwright-core.
 * A missing browser fails with an install hint rather than passing as skipped.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "node_modules/vite/package.json"));
const { chromium } = require("playwright-core");
const { createServer } = require("vite");

const executable = process.env.AI_LIMITS_CHROME_PATH;
let browser;
try {
  browser = await chromium.launch(executable ? { executablePath: executable, headless: true } : { headless: true });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`history hover failed: Chromium is not installed (${reason})`);
  console.error("Install it with: pnpm exec playwright-core install chromium");
  process.exit(1);
}

const server = await createServer({
  root,
  configFile: false,
  plugins: [],
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: "#i18n", replacement: path.join(root, "scripts/history-hover-i18n.ts") },
      { find: "@", replacement: root },
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await server.listen();
const base = server.resolvedUrls?.local?.[0];
if (!base) throw new Error("Vite did not report a local URL");

const screenshotIndex = process.argv.indexOf("--screenshot");
const screenshotPath = screenshotIndex > 0 ? process.argv[screenshotIndex + 1] : undefined;

const page = await browser.newPage({ viewport: { width: 520, height: 1400 }, deviceScaleFactor: 2 });
try {
  await page.goto(`${base}scripts/balance-history.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ready='1']", { timeout: 20_000 });
  const fixture = await page.locator("main").evaluate((main) => ({
    start: Number(main.dataset.rangeStart),
    end: Number(main.dataset.rangeEnd),
    topUpAt: Number(main.dataset.topupAt),
    gapAt: Number(main.dataset.gapAt),
    net: Number(main.dataset.net),
  }));
  const expectedStatus = `${fixture.net < 0 ? "−" : "+"}$${Math.abs(fixture.net).toFixed(2)} in 30 days`;

  const failures = [];
  for (const width of [340, 400, 460]) {
    const card = page.locator(`[data-width="${width}"]`);
    await card.scrollIntoViewIfNeeded();
    const status = (await card.locator(".history-chart__status").innerText()).trim();
    if (status !== expectedStatus) failures.push(`${width}px status was "${status}", expected "${expectedStatus}"`);
    if ((await card.locator(".history-chart__line").count()) < 2) failures.push(`${width}px line is not broken at the gap`);
    if ((await card.locator(".history-chart__gap").count()) !== 1) failures.push(`${width}px has no gap mark`);

    const canvas = card.locator(".history-chart__canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`No canvas at ${width}px`);
    // The plot spans x 8..312 of the 320-wide viewBox.
    const xAt = (at) => box.x + box.width * ((8 + ((at - fixture.start) / (fixture.end - fixture.start)) * 304) / 320);
    const plotY = box.y + box.height * (64 / 136);
    const readout = async (at) => {
      await page.mouse.move(xAt(at), plotY);
      await page.waitForTimeout(25);
      const tip = canvas.locator(".history-chart__tooltip");
      const text = (await tip.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const tipBox = await tip.boundingBox();
      if (tipBox && (tipBox.y < box.y - 1 || tipBox.y + tipBox.height > box.y + box.height + 1)) {
        failures.push(`${width}px tooltip spills the plot`);
      }
      return text;
    };
    const topUp = await readout(fixture.topUpAt);
    if (!topUp.includes("Top-up +$20.00")) failures.push(`${width}px top-up readout was "${topUp}"`);
    const gap = await readout(fixture.gapAt);
    if (!gap.includes("No readings")) failures.push(`${width}px gap readout was "${gap}"`);
    console.log(`${width}px ok`);
  }
  if (screenshotPath) {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`screenshot written to ${screenshotPath}`);
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  console.log("balance history passed");
} finally {
  await page.context().close();
  await browser.close();
  await server.close();
}
