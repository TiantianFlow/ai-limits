/**
 * Dev-only hover regression. Moves a real mouse across the weekly 30-day
 * chart at three panel widths. Skips when no Chromium is installed.
 * Run: pnpm test:history-hover
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
  console.log(`history hover skipped: no Chromium installed (${error instanceof Error ? error.message : error})`);
  process.exit(0);
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
    const belowHits = await canvas.locator(".history-chart__hit").first().evaluate((node) => {
      return node.getBoundingClientRect().bottom - 2;
    });

    const seen = [];
    const steps = 8;
    for (let step = 0; step <= steps; step += 1) {
      const x = box.x + box.width * (0.12 + 0.76 * (step / steps));
      // The line sits near the axis. The broken overlay only covered the top
      // of the plot, so a sweep through the middle never reached the canvas.
      await page.mouse.move(x, belowHits);
      await page.waitForTimeout(25);
      const text = (await canvas.locator(".history-chart__tooltip").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const guide = await canvas.locator(".history-chart__guide-active").count();
      const dot = await canvas.locator(".history-chart__dot-active").count();
      const time = text.split("Observed")[0]?.trim() ?? "";
      if (guide < 1 || dot < 1) throw new Error(`${width}px step ${step} has no guide or dot (${time || "no tooltip"})`);
      if (time.length === 0) throw new Error(`${width}px step ${step} has an empty tooltip`);
      const tip = await canvas.locator(".history-chart__tooltip").boundingBox();
      const dotBox = await canvas.locator(".history-chart__dot-active").boundingBox();
      if (!tip || tip.width - 0.5 > 180) {
        failures.push(`${width}px step ${step} tooltip is ${Math.round(tip?.width ?? 0)}px`);
      }
      if (dotBox) {
        const cx = dotBox.x + dotBox.width / 2;
        const cy = dotBox.y + dotBox.height / 2;
        const covers = cx >= tip.x && cx <= tip.x + tip.width && cy >= tip.y && cy <= tip.y + tip.height;
        if (covers) failures.push(`${width}px step ${step} tooltip covers the dot`);
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
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  console.log("history hover passed");
} finally {
  await page.context().close();
  await browser.close();
  await server.close();
}
