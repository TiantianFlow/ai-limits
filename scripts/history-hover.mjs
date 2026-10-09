/**
 * Dev-only hover regression. Moves a real mouse across the weekly 30-day
 * chart and a sparse Kimi-like chart at three panel widths.
 * Run: pnpm test:history-hover
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

const page = await browser.newPage({ viewport: { width: 700, height: 1400 }, deviceScaleFactor: 1 });
try {
  await page.goto(`${base}scripts/history-hover.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-ready='1']", { timeout: 20_000 });

  const failures = [];
  for (const width of [340, 400, 460]) {
    const card = page.locator(`[data-width="${width}"]`);
    await card.scrollIntoViewIfNeeded();
    const canvas = card.locator(".history-chart__canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`No canvas at ${width}px`);
    // The plot is the middle of the 124-tall viewBox. Sweep there, not along
    // the date labels under the axis.
    const plotY = box.y + box.height * (57 / 124);

    const seen = [];
    const steps = 8;
    for (let step = 0; step <= steps; step += 1) {
      const x = box.x + box.width * (0.12 + 0.76 * (step / steps));
      await page.mouse.move(x, plotY);
      await page.waitForTimeout(25);
      const text = (await canvas.locator(".history-chart__tooltip").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const guide = await canvas.locator(".history-chart__guide-active").count();
      const time = text.split("Observed")[0]?.trim() ?? "";
      if (guide < 1) throw new Error(`${width}px step ${step} has no guide (${time || "no tooltip"})`);
      if (time.length === 0) throw new Error(`${width}px step ${step} has an empty tooltip`);
      const tip = await canvas.locator(".history-chart__tooltip").boundingBox();
      if (!tip || tip.width - 0.5 > 180) {
        failures.push(`${width}px step ${step} tooltip is ${Math.round(tip?.width ?? 0)}px`);
      }
      if (tip && (tip.y < box.y - 1 || tip.y + tip.height > box.y + box.height + 1)) {
        failures.push(`${width}px step ${step} tooltip spills the plot`);
      }
      seen.push(time);
    }
    const distinct = [...new Set(seen)];
    if (distinct.length < 5) throw new Error(`${width}px showed ${distinct.length} times: ${distinct.join(" | ")}`);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const stamp = (time) => {
      const match = /([A-Z][a-z]{2}) (\d+), (\d+):(\d+) (AM|PM)/.exec(time);
      if (!match) return NaN;
      let hour = Number(match[3]) % 12;
      if (match[5] === "PM") hour += 12;
      return Date.UTC(2026, months.indexOf(match[1]), Number(match[2]), hour, Number(match[4]));
    };
    for (let index = 1; index < distinct.length; index += 1) {
      if (!(stamp(distinct[index]) > stamp(distinct[index - 1]))) {
        throw new Error(`${width}px time did not increase: ${distinct[index - 1]} -> ${distinct[index]}`);
      }
    }
    console.log(`${width}px ${distinct.length} times`);

    const kimi = page.locator(`[data-kimi="${width}"]`);
    await kimi.scrollIntoViewIfNeeded();
    const kimiCanvas = kimi.locator(".history-chart__canvas");
    const plot = await kimiCanvas.boundingBox();
    if (!plot) throw new Error(`No Kimi canvas at ${width}px`);
    const hoverBox = async (selector) => {
      const target = kimiCanvas.locator(selector).first();
      const box = await target.boundingBox();
      if (!box) throw new Error(`No ${selector} at ${width}px`);
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, plot.height - 4));
      await page.waitForTimeout(25);
      return kimiCanvas.locator(".history-chart__tooltip");
    };
    const idleTip = await hoverBox(".history-chart__idle");
    const idleText = (await idleTip.innerText()).replace(/\s+/g, " ");
    if (!/Idle — no active window/.test(idleText)) failures.push(`${width}px idle tooltip was "${idleText}"`);
    const emptyTip = await hoverBox(".history-chart__gap");
    const emptyText = (await emptyTip.innerText()).replace(/\s+/g, " ");
    if (!/No readings/.test(emptyText)) failures.push(`${width}px empty tooltip was "${emptyText}"`);
    const tipBox = await emptyTip.boundingBox();
    if (tipBox && (tipBox.y < plot.y - 1 || tipBox.y + tipBox.height > plot.y + plot.height + 1)) {
      failures.push(`${width}px tooltip spills the plot`);
    }
    const highlight = await kimiCanvas.locator(".history-chart__highlight").first().boundingBox();
    const pointer = await kimiCanvas.locator(".history-chart__gap").first().boundingBox();
    if (highlight && pointer) {
      const mid = pointer.x + pointer.width / 2;
      const over = mid >= highlight.x - 2 && mid <= highlight.x + highlight.width + 2;
      if (!over) failures.push(`${width}px highlight misses the gap under the pointer`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  console.log("history hover passed");
} finally {
  await page.context().close();
  await browser.close();
  await server.close();
}
