import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewRoot = path.join(repositoryRoot, "store-assets", "preview");
const outputDirectory = path.join(
  repositoryRoot,
  "store-assets",
  "chrome-web-store",
);
const defaultChromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePath = process.env.AI_LIMITS_CHROME_PATH || defaultChromePath;

const assets = [
  {
    view: "overview",
    name: "screenshot-overview-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    view: "pacing",
    name: "screenshot-pacing-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    view: "privacy",
    name: "screenshot-privacy-1280x800.png",
    viewport: { width: 1280, height: 800 },
  },
  {
    view: "promo",
    name: "small-promo-440x280.png",
    viewport: { width: 440, height: 280 },
  },
];

let browser;
let vite;

try {
  await access(chromePath);
  await mkdir(outputDirectory, { recursive: true });

  vite = await createServer({
    configFile: false,
    root: previewRoot,
    publicDir: path.join(repositoryRoot, "public"),
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      fs: { allow: [repositoryRoot] },
    },
  });
  await vite.listen();

  const previewUrl = vite.resolvedUrls?.local[0];
  if (!previewUrl) {
    throw new Error("Vite did not publish a local preview URL.");
  }

  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });

  for (const asset of assets) {
    const context = await browser.newContext({
      colorScheme: "light",
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "America/Toronto",
      viewport: asset.viewport,
    });

    try {
      const page = await context.newPage();
      await page.goto(`${previewUrl}?view=${asset.view}`, {
        waitUntil: "networkidle",
      });
      await page.locator("[data-preview-ready]").waitFor();

      if (asset.view === "pacing") {
        await page.evaluate(() => {
          const frame = document.querySelector("[data-panel-frame]");
          const heading = document.getElementById("provider-Kimi");
          const card = heading?.closest(".provider-card");

          if (!(frame instanceof HTMLElement) || !(card instanceof HTMLElement)) {
            throw new Error("Pacing capture could not find the Kimi card.");
          }

          const cardTop =
            card.getBoundingClientRect().top -
            frame.getBoundingClientRect().top +
            frame.scrollTop;
          frame.scrollTop = Math.min(
            cardTop - 1,
            frame.scrollHeight - frame.clientHeight,
          );

          for (const name of ["Kimi", "Cursor"]) {
            const featuredCard = document
              .getElementById(`provider-${name}`)
              ?.closest(".provider-card");

            if (!(featuredCard instanceof HTMLElement)) {
              throw new Error(`Pacing capture could not find the ${name} card.`);
            }

            const frameBounds = frame.getBoundingClientRect();
            const cardBounds = featuredCard.getBoundingClientRect();
            if (
              cardBounds.top < frameBounds.top ||
              cardBounds.bottom > frameBounds.bottom
            ) {
              throw new Error(
                `Pacing capture requires the complete ${name} card inside the panel frame.`,
              );
            }
          }
        });
      }

      if (asset.view === "privacy") {
        await page.getByRole("button", { name: "Settings" }).click();
        await page.getByRole("heading", { name: "Provider settings" }).waitFor();
      }

      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(outputDirectory, asset.name),
        animations: "disabled",
        caret: "hide",
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await vite?.close();
}
