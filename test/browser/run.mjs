/**
 * Real-browser suite. Each spec in `specs/` names a page in `pages/`; the
 * harness serves the pages with Vite, opens each in headless Chromium and runs
 * the spec against it. Unlike the Vitest suite (jsdom, no layout or paint),
 * this one measures and draws, so it can check geometry and take screenshots.
 *
 * Run: pnpm test:browser [--only <spec>] [--screenshots [dir]]
 *
 *   --only <spec>        run one spec, by file name without `.mjs`
 *   --screenshots [dir]  write `<spec>.png` per spec (default artifacts/browser)
 *
 * A failing spec always writes `<spec>-failure.png` to the screenshot folder.
 * AI_LIMITS_CHROME_PATH points at a Chromium binary when the one bundled
 * with playwright-core is not installed.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "node_modules/vite/package.json"));
const { chromium } = require("playwright-core");
const { createServer } = require("vite");

function parseArgs(argv) {
  const options = { only: undefined, screenshots: false, screenshotDir: path.join(root, "artifacts/browser") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--only") {
      options.only = argv[++index];
      if (!options.only || options.only.startsWith("--")) throw new Error("--only needs a spec name");
    } else if (arg === "--screenshots") {
      options.screenshots = true;
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) options.screenshotDir = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return options;
}

/** Vite server for `pages/`, with the extension i18n module swapped for a stand-in. */
export async function startPageServer() {
  const server = await createServer({
    root,
    configFile: false,
    plugins: [],
    esbuild: { jsx: "automatic" },
    resolve: {
      alias: [
        { find: "#i18n", replacement: path.join(here, "pages/i18n.ts") },
        { find: "@", replacement: root },
      ],
    },
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await server.listen();
  const base = server.resolvedUrls?.local?.[0];
  if (!base) throw new Error("Vite did not report a local URL");
  return { server, pageUrl: (name, query = "") => `${base}test/browser/pages/${name}.html${query}` };
}

export async function launchBrowser() {
  const executable = process.env.AI_LIMITS_CHROME_PATH;
  try {
    return await chromium.launch(executable ? { executablePath: executable, headless: true } : { headless: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Chromium is not installed (${reason})`);
    console.error("Install it with: pnpm exec playwright-core install chromium, or set AI_LIMITS_CHROME_PATH");
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const specDir = path.join(here, "specs");
  const names = fs.readdirSync(specDir)
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => file.slice(0, -".mjs".length))
    .filter((name) => options.only === undefined || name === options.only)
    .sort();
  if (names.length === 0) throw new Error(`No spec matches ${options.only ?? "specs/*.mjs"}`);

  const browser = await launchBrowser();
  const { server, pageUrl } = await startPageServer();
  const failed = [];
  try {
    for (const name of names) {
      const spec = await import(pathToFileURL(path.join(specDir, `${name}.mjs`)).href);
      const context = await browser.newContext({
        viewport: spec.viewport ?? { width: 520, height: 1400 },
        deviceScaleFactor: 2,
        colorScheme: spec.colorScheme ?? "light",
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const failures = [];
      const shoot = async (file) => {
        fs.mkdirSync(options.screenshotDir, { recursive: true });
        const target = path.join(options.screenshotDir, file);
        await page.mouse.move(0, 0).catch(() => undefined);
        await page.screenshot({ path: target, fullPage: true });
        return target;
      };
      try {
        await page.goto(pageUrl(spec.page), { waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-ready='1']", { timeout: 20_000 });
        await spec.run({
          page,
          fail: (message) => failures.push(message),
          log: (message) => console.log(`  ${message}`),
        });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
      failures.push(...pageErrors.map((message) => `page error: ${message}`));
      if (failures.length > 0) {
        const shot = await shoot(`${name}-failure.png`).catch(() => undefined);
        failed.push(name);
        console.log(`✗ ${name}`);
        for (const message of failures) console.log(`    ${message}`);
        if (shot) console.log(`    screenshot: ${path.relative(root, shot)}`);
      } else {
        fs.rmSync(path.join(options.screenshotDir, `${name}-failure.png`), { force: true });
        console.log(`✓ ${name}`);
        if (options.screenshots) console.log(`    screenshot: ${path.relative(root, await shoot(`${name}.png`))}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`${names.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
