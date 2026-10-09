/**
 * Renders every synthetic fixture meter at 360px for 48h, 7d and 30d, Used and
 * Left, light and dark. Writes one PNG per card plus a contact sheet.
 * Run: node scripts/history-v20-render.mjs [output directory]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = process.argv[2] ?? path.join(root, "artifacts/history-v20");
const require = createRequire(path.join(root, "node_modules/vite/package.json"));
const { chromium } = require("playwright-core");
const { createServer } = require("vite");

const executable = process.env.AI_LIMITS_CHROME_PATH;
const browser = await chromium.launch(executable ? { executablePath: executable, headless: true } : { headless: true });
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

const fs = require("node:fs");
fs.mkdirSync(outDir, { recursive: true });

try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 420, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await page.goto(`${base}scripts/history-v20-render.html?theme=${theme}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-ready='1']", { timeout: 20_000 });
    const shots = page.locator("[data-shot]");
    const count = await shots.count();
    for (let index = 0; index < count; index += 1) {
      const card = shots.nth(index);
      const name = await card.getAttribute("data-shot");
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: path.join(outDir, `${theme}-${name}.png`) });
    }
    console.log(`${theme}: ${count} cards`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
