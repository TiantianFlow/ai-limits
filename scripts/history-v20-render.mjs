/**
 * Renders every synthetic fixture meter at 360px for 48h, 7d and 30d, Used and
 * Left, light and dark. Writes one PNG per card plus a contact sheet.
 * Run: node scripts/history-v20-render.mjs [output directory]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser, startPageServer } from "../test/browser/run.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = process.argv[2] ?? path.join(root, "artifacts/history-v20");
const browser = await launchBrowser();
const { server, pageUrl } = await startPageServer();

fs.mkdirSync(outDir, { recursive: true });
const only = process.env.HISTORY_V20_ONLY;

try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 420, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await page.goto(pageUrl("history-v20-render", `?theme=${theme}`), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-ready='1']", { timeout: 20_000 });
    const shots = page.locator("[data-shot]");
    const count = await shots.count();
    let written = 0;
    for (let index = 0; index < count; index += 1) {
      const card = shots.nth(index);
      const name = await card.getAttribute("data-shot");
      if (only && !`${theme}-${name}`.includes(only)) continue;
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: path.join(outDir, `${theme}-${name}.png`) });
      written += 1;
    }
    console.log(`${theme}: ${written} cards`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
