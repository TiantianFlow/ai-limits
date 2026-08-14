import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { createServer } from "vite";

import {
  FIDELITY_FIXED_CLOCK,
  MARKETING_ASSET_CAPTURES,
  buildFidelityPreviewQuery,
  createFidelityCaptureMatrix,
  fidelityScreenHasModeControl,
  pacingCardScrollTop,
  waitForDocumentFonts,
} from "./store-assets-contract.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const previewRoot = path.join(repositoryRoot, "store-assets", "preview");
const storeOutputDirectory = path.join(repositoryRoot, "store-assets");
const fidelityOutputDirectory = path.join(
  repositoryRoot,
  ".superpowers",
  "sdd",
  "2026-08-11-magic-patterns-fidelity",
  "task-5-production",
);
const defaultChromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePath = process.env.AI_LIMITS_CHROME_PATH || defaultChromePath;
const fidelityMode = process.argv.includes("--fidelity");
const assets = fidelityMode
  ? createFidelityCaptureMatrix().map((capture) => ({
      ...capture,
      relativePath: `${capture.id}.png`,
    }))
  : MARKETING_ASSET_CAPTURES;
const outputDirectory = fidelityMode
  ? fidelityOutputDirectory
  : storeOutputDirectory;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertStorePreviewContract(page, asset) {
  const metadata = await page.locator("[data-preview-ready]").evaluate((node) => ({
    dataSource: node.getAttribute("data-data-source"),
    fixedClock: node.getAttribute("data-fixed-clock"),
  }));
  assert(metadata.dataSource === "fixture", `${asset.relativePath} did not use fixture data.`);
  assert(
    metadata.fixedClock === asset.fixedClock,
    `${asset.relativePath} did not use its explicit fixed clock.`,
  );
}

async function prepareStoreAsset(page, asset) {
  if (asset.view === "overview") {
    const partialCards = await page.evaluate(() => {
      const frame = document.querySelector("[data-panel-frame]");
      const stickyHeader = document.querySelector(".app-header");
      if (!(frame instanceof HTMLElement)) {
        throw new Error("Overview capture could not find its panel frame.");
      }
      const frameBounds = frame.getBoundingClientRect();
      const visibleTop =
        stickyHeader instanceof HTMLElement
          ? stickyHeader.getBoundingClientRect().bottom
          : frameBounds.top;

      return [...frame.querySelectorAll(".provider-card")].flatMap((card) => {
        const bounds = card.getBoundingClientRect();
        const intersects =
          bounds.bottom > visibleTop + 0.5 &&
          bounds.top < frameBounds.bottom - 0.5;
        const contained =
          bounds.top >= visibleTop - 0.5 &&
          bounds.bottom <= frameBounds.bottom + 0.5;
        return intersects && !contained
          ? [
              {
                name:
                  card.querySelector('[role="heading"]')?.textContent?.trim() ??
                  "provider",
                top: bounds.top,
                bottom: bounds.bottom,
                visibleTop,
                frameBottom: frameBounds.bottom,
              },
            ]
          : [];
      });
    });
    assert(
      partialCards.length === 0,
      `${asset.relativePath} clips provider cards inside the visible panel frame: ${JSON.stringify(partialCards)}.`,
    );
  }

  if (asset.view === "pacing") {
    const pacingGeometry = await page.evaluate(() => {
      const frame = document.querySelector("[data-panel-frame]");
      const heading = document.getElementById("provider-name-kimi-default");
      const card = heading?.closest(".provider-card");
      const stickyHeader = document.querySelector(".app-header");
      if (!(frame instanceof HTMLElement) || !(card instanceof HTMLElement)) {
        throw new Error("Pacing capture could not find the Kimi card.");
      }

      const frameBounds = frame.getBoundingClientRect();
      const cardOffsetTop =
        card.getBoundingClientRect().top -
        frameBounds.top +
        frame.scrollTop;
      const stickyHeight =
        stickyHeader instanceof HTMLElement
          ? Math.max(
              0,
              stickyHeader.getBoundingClientRect().bottom - frameBounds.top,
            )
          : 0;
      return {
        cardOffsetTop,
        stickyHeight,
        scrollHeight: frame.scrollHeight,
        clientHeight: frame.clientHeight,
      };
    });
    const scrollTop = pacingCardScrollTop(pacingGeometry);
    await page.locator("[data-panel-frame]").evaluate((frame, targetScrollTop) => {
      frame.scrollTop = targetScrollTop;
    }, scrollTop);

    await page.evaluate(() => {
      const frame = document.querySelector("[data-panel-frame]");
      const stickyHeader = document.querySelector(".app-header");
      if (!(frame instanceof HTMLElement)) {
        throw new Error("Pacing capture could not find its panel frame.");
      }
      const visibleTop =
        stickyHeader instanceof HTMLElement
          ? stickyHeader.getBoundingClientRect().bottom
          : frame.getBoundingClientRect().top;

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
          cardBounds.top < visibleTop - 0.5 ||
          cardBounds.bottom > frameBounds.bottom
        ) {
          throw new Error(
            `Pacing capture requires the complete ${name} card inside the panel frame.`,
          );
        }
      }
    });
  }

  if (asset.view === "history") {
    await page
      .getByRole("button", {
        name: "Open ChatGPT history for 5-hour messages",
      })
      .click();
    await page.getByRole("heading", { name: "ChatGPT history" }).waitFor();
    await page
      .getByRole("img", { name: /ChatGPT .* usage history/ })
      .waitFor();
    await page.locator("[data-panel-frame]").evaluate((frame) => {
      frame.scrollTop = 0;
    });
    const historyGeometry = await page.evaluate(() => {
      const frame = document.querySelector("[data-panel-frame]");
      const historySurface = document.querySelector(".history-surface");
      const currentCycle = document.querySelector(".current-cycle-surface");
      const stickyHeader = document.querySelector(".page-header");
      if (
        !(frame instanceof HTMLElement) ||
        !(historySurface instanceof HTMLElement) ||
        !(currentCycle instanceof HTMLElement)
      ) {
        throw new Error("History capture could not find its complete view.");
      }
      const frameBounds = frame.getBoundingClientRect();
      const historyBounds = historySurface.getBoundingClientRect();
      const cycleBounds = currentCycle.getBoundingClientRect();
      return {
        visibleTop:
          stickyHeader instanceof HTMLElement
            ? stickyHeader.getBoundingClientRect().bottom
            : frameBounds.top,
        frameBottom: frameBounds.bottom,
        historyTop: historyBounds.top,
        historyBottom: historyBounds.bottom,
        cycleTop: cycleBounds.top,
        cycleBottom: cycleBounds.bottom,
      };
    });
    assert(
      historyGeometry.historyTop >= historyGeometry.visibleTop - 0.5 &&
        historyGeometry.historyBottom <= historyGeometry.frameBottom + 0.5 &&
        historyGeometry.cycleTop >= historyGeometry.visibleTop - 0.5 &&
        historyGeometry.cycleBottom <= historyGeometry.frameBottom + 0.5,
      `${asset.relativePath} must show the complete History chart and current-cycle surfaces.`,
    );
  }

  if (asset.view === "privacy") {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await page.locator("[data-panel-frame]").evaluate((frame) => {
      const elevenLabs = [...document.querySelectorAll("strong")].find(
        (element) => element.textContent === "ElevenLabs",
      )?.closest("li");
      const deleteButton = [...document.querySelectorAll("button")].find(
        (element) => element.textContent === "Delete all local data",
      );
      if (
        !(frame instanceof HTMLElement) ||
        !(elevenLabs instanceof HTMLElement) ||
        !(deleteButton instanceof HTMLElement)
      ) {
        throw new Error(
          "Privacy capture could not find the ElevenLabs row and local-data action.",
        );
      }

      const frameBounds = frame.getBoundingClientRect();
      const deleteBounds = deleteButton.getBoundingClientRect();
      frame.scrollTop = Math.min(
        frame.scrollTop + deleteBounds.bottom - frameBounds.bottom + 12,
        frame.scrollHeight - frame.clientHeight,
      );

      const visibleFrameBounds = frame.getBoundingClientRect();
      for (const [label, element] of [
        ["ElevenLabs", elevenLabs],
        ["Delete all local data", deleteButton],
      ]) {
        const bounds = element.getBoundingClientRect();
        if (
          bounds.top < visibleFrameBounds.top ||
          bounds.bottom > visibleFrameBounds.bottom
        ) {
          throw new Error(
            `Privacy capture requires ${label} inside the panel frame.`,
          );
        }
      }
    });
  }
}

async function fidelityMeasurements(page, asset) {
  return page.evaluate(({ expected }) => {
    const root = document.querySelector("[data-fidelity-preview]");
    if (!(root instanceof HTMLElement)) {
      throw new Error("Fidelity root is missing.");
    }
    const rendered = (node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        bounds.width > 0 &&
        bounds.height > 0
      );
    };
    const nameOf = (node) => {
      const labelledBy = node.getAttribute("aria-labelledby");
      if (labelledBy) {
        return labelledBy
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
      }
      if (node instanceof HTMLInputElement && node.labels?.length) {
        return [...node.labels]
          .map((label) => label.textContent ?? "")
          .join(" ")
          .trim();
      }
      return (
        node.getAttribute("aria-label") ??
        node.getAttribute("title") ??
        node.textContent ??
        ""
      ).trim();
    };
    const targetSelector =
      'button, a[href], input, select, textarea, [role="button"], [role="switch"]';
    const targets = [...root.querySelectorAll(targetSelector)].filter(rendered);
    const focusableTargets = targets.filter(
      (node) => !node.matches(":disabled") && node.tabIndex >= 0,
    );
    const undersizedTargets = targets.flatMap((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.width < 43.5 || bounds.height < 43.5
        ? [{ name: nameOf(node), width: bounds.width, height: bounds.height }]
        : [];
    });
    const clippedTargets = targets.flatMap((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.left < -0.5 || bounds.right > innerWidth + 0.5
        ? [{ name: nameOf(node), left: bounds.left, right: bounds.right }]
        : [];
    });
    const unnamedTargets = targets
      .filter((node) => nameOf(node).length === 0)
      .map((node) => node.outerHTML.slice(0, 160));
    const invalidMeters = [...root.querySelectorAll('[role="meter"]')]
      .filter(rendered)
      .flatMap((node) => {
        const value = Number(node.getAttribute("aria-valuenow"));
        const minimum = Number(node.getAttribute("aria-valuemin"));
        const maximum = Number(node.getAttribute("aria-valuemax"));
        return nameOf(node) &&
          Number.isFinite(value) &&
          Number.isFinite(minimum) &&
          Number.isFinite(maximum) &&
          value >= minimum &&
          value <= maximum
          ? []
          : [node.outerHTML.slice(0, 160)];
      });
    const brokenImages = [...root.querySelectorAll("img")]
      .filter(rendered)
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.getAttribute("src"));
    const rootStyle = getComputedStyle(document.documentElement);
    const appHeaders = root.querySelectorAll(".app-header").length;
    const pageHeaders = root.querySelectorAll(".page-header").length;
    const firstRunHeaders = root.querySelectorAll(".first-run__header").length;
    const expectedSelector = {
      "first-run": '[aria-labelledby="first-run-title"]',
      overview: ".app-header",
      "provider-detail": '[aria-label="Kimi detail"]',
      history: '[aria-label="Kimi history"]',
      "add-provider": '[aria-label="Add provider"]',
      settings: '[aria-label="Provider settings"]',
      "api-key-connect": '[aria-label="Replace ElevenLabs API key"]',
    }[expected.screen];
    const exactScreen =
      Boolean(expectedSelector && root.querySelector(expectedSelector)) &&
      (expected.screen === "overview"
        ? appHeaders === 1 && pageHeaders === 0 && firstRunHeaders === 0
        : expected.screen === "first-run"
          ? appHeaders === 0 && pageHeaders === 0 && firstRunHeaders === 1
          : appHeaders === 0 && pageHeaders === 1 && firstRunHeaders === 0);
    const liveRegions = [...root.querySelectorAll('[aria-live], [role="status"]')]
      .filter(rendered)
      .map((node) => nameOf(node));
    const selectedMode = root
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.textContent?.trim()
      .toLowerCase();
    const compactOverview = (() => {
      if (expected.screen !== "overview") {
        return null;
      }

      const violations = [];
      const controlPairs = [
        ...root.querySelectorAll(".segmented-control button"),
        ...root.querySelectorAll(".app-header .icon-button"),
      ].map((target) => ({
        target,
        surface: target.querySelector(
          ".segmented-control__option, .control-surface",
        ),
      }));
      for (const { target, surface } of controlPairs) {
        const name = nameOf(target);
        if (!(surface instanceof HTMLElement)) {
          violations.push(`${name} is missing its painted surface`);
          continue;
        }
        const targetBounds = target.getBoundingClientRect();
        const surfaceBounds = surface.getBoundingClientRect();
        if (targetBounds.width < 43.5 || targetBounds.height < 43.5) {
          violations.push(`${name} target is smaller than 44px`);
        }
        if (surfaceBounds.height < 27.5 || surfaceBounds.height > 32.5) {
          violations.push(
            `${name} painted surface is ${surfaceBounds.height}px tall`,
          );
        }
      }

      const statuses = [...root.querySelectorAll(".provider-card .status-chip")];
      let freshStatusCount = 0;
      for (const status of statuses) {
        const dot = status.querySelector(".status-chip__dot");
        const label = status.querySelector(".status-chip__label");
        if (!(dot instanceof HTMLElement) || !(label instanceof HTMLElement)) {
          violations.push("provider status is missing its dot or label");
          continue;
        }
        const statusBounds = status.getBoundingClientRect();
        const dotBounds = dot.getBoundingClientRect();
        const labelBounds = label.getBoundingClientRect();
        const isFreshStatus =
          label.textContent?.trim() === "Updated just now" &&
          getComputedStyle(dot).backgroundColor === "rgb(34, 197, 94)";
        if (isFreshStatus) {
          freshStatusCount += 1;
        } else {
          violations.push(`${nameOf(status)} is not the expected fresh status token`);
        }
        const dotCenter = dotBounds.top + dotBounds.height / 2;
        const labelCenter = labelBounds.top + labelBounds.height / 2;
        if (Math.abs(dotCenter - labelCenter) > 1) {
          violations.push(`${nameOf(status)} split its dot and label across lines`);
        }
        if (
          statusBounds.left < -0.5 ||
          statusBounds.right > innerWidth + 0.5 ||
          status.scrollWidth > status.clientWidth + 1
        ) {
          violations.push(`${nameOf(status)} clipped or overflowed`);
        }
      }

      const marks = [...root.querySelectorAll(".provider-card .provider-mark")];
      let markGeometryCount = 0;
      let narrowMarkAlignmentCount = 0;
      let narrowMarkAlignmentVerified = true;
      for (const mark of marks) {
        const style = getComputedStyle(mark);
        const markBounds = mark.getBoundingClientRect();
        const frame = mark.closest(".provider-mark-frame");
        const frameStyle =
          frame instanceof HTMLElement ? getComputedStyle(frame) : undefined;
        const frameBounds =
          frame instanceof HTMLElement ? frame.getBoundingClientRect() : undefined;
        const hasBorder = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ].some((width) => Number.parseFloat(width) > 0);
        const frameHasBorder = frameStyle
          ? [
              frameStyle.borderTopWidth,
              frameStyle.borderRightWidth,
              frameStyle.borderBottomWidth,
              frameStyle.borderLeftWidth,
            ].some((width) => Number.parseFloat(width) > 0)
          : true;
        if (
          hasBorder ||
          frameHasBorder ||
          !["rgba(0, 0, 0, 0)", "transparent"].includes(style.backgroundColor) ||
          !frameStyle ||
          !["rgba(0, 0, 0, 0)", "transparent"].includes(
            frameStyle.backgroundColor,
          )
        ) {
          violations.push(`${mark.getAttribute("src")} is still rendered as a tile`);
        }
        const chatGpt = mark.classList.contains("provider-mark--provider-chatgpt");
        const expectedImageSize = chatGpt ? 40 : 24;
        if (
          frameBounds &&
          Math.abs(frameBounds.width - 24) <= 0.5 &&
          Math.abs(frameBounds.height - 24) <= 0.5 &&
          Math.abs(markBounds.width - expectedImageSize) <= 0.5 &&
          Math.abs(markBounds.height - expectedImageSize) <= 0.5
        ) {
          markGeometryCount += 1;
        } else {
          violations.push(
            `${mark.getAttribute("src")} does not use the expected optical sizing`,
          );
        }
        if (innerWidth <= 380) {
          const identity = mark.closest(".provider-card__identity");
          if (!(identity instanceof HTMLElement) || !frameBounds) {
            narrowMarkAlignmentVerified = false;
            violations.push("narrow provider mark is missing its identity geometry");
          } else {
            const identityBounds = identity.getBoundingClientRect();
            const frameCenter = frameBounds.top + frameBounds.height / 2;
            const identityCenter = identityBounds.top + identityBounds.height / 2;
            if (Math.abs(frameCenter - identityCenter) <= 1) {
              narrowMarkAlignmentCount += 1;
            } else {
              narrowMarkAlignmentVerified = false;
              violations.push(
                `${mark.getAttribute("src")} is top-biased in the narrow identity`,
              );
            }
          }
        }
      }

      let wideIdentityCount = 0;
      let wideIdentityVerified = true;
      if (innerWidth > 380) {
        const claudeName = root.querySelector("#provider-name-claude-default");
        const claudeCard = claudeName?.closest(".provider-card");
        const plan = claudeCard?.querySelector(".provider-card__plan");
        const details = claudeCard?.querySelector(".provider-card__details");
        if (
          !(claudeName instanceof HTMLElement) ||
          !(plan instanceof HTMLElement) ||
          !(details instanceof HTMLElement)
        ) {
          wideIdentityVerified = false;
          violations.push("roomy Claude identity is missing required anatomy");
        } else {
          wideIdentityCount = 1;
          const previousPlan = plan.textContent;
          plan.textContent = "Example Account's Extended Organization";
          const nameStyle = getComputedStyle(claudeName);
          const nameBounds = claudeName.getBoundingClientRect();
          wideIdentityVerified =
            nameStyle.whiteSpace === "nowrap" &&
            nameBounds.height <= 20 &&
            claudeName.scrollWidth <= claudeName.clientWidth + 1 &&
            details.scrollWidth <= details.clientWidth + 1;
          if (!wideIdentityVerified) {
            violations.push("Claude name wraps or overflows with a long account label");
          }
          plan.textContent = previousPlan;
        }
      }

      const quotaMetadata = [...root.querySelectorAll(".quota-bars__meta")];
      let resetCount = 0;
      let untimedCount = 0;
      for (const metadata of quotaMetadata) {
        const primary = metadata.querySelector(".quota-bars__meta-primary");
        const reset = metadata.querySelector(".quota-bars__reset");
        if (!(primary instanceof HTMLElement)) {
          violations.push("quota metadata is missing its primary row");
          continue;
        }
        if (!(reset instanceof HTMLElement)) {
          const timing = primary.querySelector(".quota-bars__timing");
          if (timing?.textContent?.trim() !== "No reset timing") {
            violations.push("quota metadata has neither a reset row nor an untimed label");
          } else {
            untimedCount += 1;
          }
          continue;
        }
        resetCount += 1;
        const primaryBounds = primary.getBoundingClientRect();
        const resetBounds = reset.getBoundingClientRect();
        const before = getComputedStyle(reset, "::before").content;
        if (resetBounds.top < primaryBounds.bottom - 0.5) {
          violations.push(`${reset.textContent} is not below the primary row`);
        }
        if (!["none", "normal", "\"\""].includes(before)) {
          violations.push(`${reset.textContent} still has generated punctuation`);
        }
      }

      if (root.querySelectorAll(".app-header h1").length > 0) {
        violations.push("Overview still renders a duplicate product masthead");
      }

      return {
        verified: violations.length === 0,
        targetCount: controlPairs.length,
        statusCount: statuses.length,
        freshStatusCount,
        markCount: marks.length,
        markGeometryCount,
        narrowMarkAlignmentCount,
        narrowMarkAlignmentVerified,
        quotaCount: quotaMetadata.length,
        resetCount,
        untimedCount,
        wideIdentityCount,
        wideIdentityVerified,
        violations,
      };
    })();

    const apiKeyGuide = (() => {
      if (expected.screen !== "api-key-connect") {
        return null;
      }

      const violations = [];
      const input = root.querySelector("#elevenlabs-api-key");
      const primary = root.querySelector(".api-key-guide .button--primary");
      const mark = root.querySelector(
        '.api-key-guide .provider-mark--provider-elevenlabs',
      );
      const parseRgb = (color) =>
        (color.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
      const luminance = (color) => {
        const channels = parseRgb(color).map((value) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return (
          0.2126 * channels[0] +
          0.7152 * channels[1] +
          0.0722 * channels[2]
        );
      };
      let contrastRatio = 0;
      if (!(input instanceof HTMLInputElement) || input.value.length === 0) {
        violations.push("fixture API-key input is not populated");
      }
      if (!(primary instanceof HTMLButtonElement) || primary.disabled) {
        violations.push("primary action is not enabled");
      } else {
        const style = getComputedStyle(primary);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        contrastRatio =
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05);
        if (contrastRatio < 4.5) {
          violations.push(
            `primary action contrast is ${contrastRatio.toFixed(2)}:1`,
          );
        }
      }
      const markPath = mark?.getAttribute("src") ?? "";
      if (markPath !== "/provider-marks/elevenlabs.svg") {
        violations.push("ElevenLabs setup is missing its official local symbol");
      }
      return {
        verified: violations.length === 0,
        inputPopulated:
          input instanceof HTMLInputElement && input.value.length > 0,
        primaryEnabled:
          primary instanceof HTMLButtonElement && !primary.disabled,
        contrastRatio: Number(contrastRatio.toFixed(3)),
        markPath,
        violations,
      };
    })();

    return {
      metadata: {
        dataSource: root.dataset.dataSource,
        fixedClock: root.dataset.fixedClock,
        screen: root.dataset.screen,
        state: root.dataset.state,
        mode: root.dataset.mode,
        theme: root.dataset.theme,
        width: Number(root.dataset.panelWidth),
      },
      viewportWidth: innerWidth,
      scrollWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
        root.scrollWidth,
      ),
      scrollTop: Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
        document.body.scrollTop,
        root.scrollTop,
      ),
      targetCount: targets.length,
      focusableCount: focusableTargets.length,
      undersizedTargets,
      clippedTargets,
      unnamedTargets,
      meterCount: root.querySelectorAll('[role="meter"]').length,
      invalidMeters,
      brokenImages,
      exactScreen,
      liveRegions,
      selectedMode,
      compactOverview,
      apiKeyGuide,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      darkMode: matchMedia("(prefers-color-scheme: dark)").matches,
      backgroundToken: rootStyle.getPropertyValue("--bg").trim(),
    };
  }, { expected: asset });
}

async function focusControlForKeyboard(page, locator, label) {
  await locator.waitFor();
  await locator.focus();
  const result = await locator.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    let visibleTop = 0;
    let visibleBottom = innerHeight;
    let ancestor = node.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (
        /^(auto|scroll|hidden|clip)$/u.test(style.overflowY) &&
        ancestor.scrollHeight > ancestor.clientHeight
      ) {
        const ancestorBounds = ancestor.getBoundingClientRect();
        visibleTop = Math.max(visibleTop, ancestorBounds.top);
        visibleBottom = Math.min(visibleBottom, ancestorBounds.bottom);
      }
      ancestor = ancestor.parentElement;
    }
    return {
      focused: document.activeElement === node,
      visible:
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left >= -0.5 &&
        bounds.right <= innerWidth + 0.5 &&
        bounds.top >= visibleTop - 0.5 &&
        bounds.bottom <= visibleBottom + 0.5,
      bounds: {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        visibleTop,
        visibleBottom,
      },
    };
  });
  assert(result.focused, `${label} did not receive keyboard focus.`);
  assert(
    result.visible,
    `${label} was clipped after focus: ${JSON.stringify(result.bounds)}.`,
  );
  return result;
}

async function prepareFidelityKeyboardRoute(page, asset) {
  await page.locator("[data-fidelity-preview]").waitFor();
  const results = [];
  for (const step of asset.keyboardNavigation) {
    const action = page.locator(step.selector);
    const focus = await focusControlForKeyboard(
      page,
      action,
      `${asset.id} route control ${step.selector}`,
    );
    await page.keyboard.press(step.key);
    const replacement = page.locator(step.readySelector);
    await replacement.waitFor();
    const replaced = await replacement.isVisible();
    assert(
      replaced,
      `${asset.id} did not replace the screen after ${step.key} on ${step.selector}.`,
    );
    results.push({
      ...step,
      focused: focus.focused,
      visible: focus.visible,
      replaced,
    });
  }
  if (asset.screen === "api-key-connect") {
    await page.locator("#elevenlabs-api-key").fill("fixture-only-api-key");
  }
  return results;
}

async function assertKeyboardTraversal(page, asset, focusableCount) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const previousTabIndex = document.body.getAttribute("tabindex");
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    if (previousTabIndex === null) {
      document.body.removeAttribute("tabindex");
    } else {
      document.body.setAttribute("tabindex", previousTabIndex);
    }
  });

  const visited = [];
  const failures = [];
  for (let step = 0; step < focusableCount; step += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const root = document.querySelector("[data-fidelity-preview]");
      const active = document.activeElement;
      if (!(root instanceof HTMLElement) || !(active instanceof HTMLElement)) {
        return { index: -1, name: "", visible: false, outlined: false };
      }
      const rendered = (node) => {
        const style = getComputedStyle(node);
        const bounds = node.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      };
      const selector =
        'button, a[href], input, select, textarea, [role="button"], [role="switch"]';
      const targets = [...root.querySelectorAll(selector)].filter(
        (node) => rendered(node) && !node.matches(":disabled") && node.tabIndex >= 0,
      );
      const index = targets.indexOf(active);
      const indicator =
        active instanceof HTMLInputElement &&
        active.nextElementSibling?.classList.contains("settings-toggle__track")
          ? active.nextElementSibling
          : active;
      const style = getComputedStyle(indicator);
      const bounds = indicator.getBoundingClientRect();
      let visibleTop = 0;
      let visibleBottom = innerHeight;
      let visibleContainer = "viewport";
      let ancestor = active.parentElement;
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (
          /^(auto|scroll|hidden|clip)$/u.test(ancestorStyle.overflowY) &&
          ancestor.scrollHeight > ancestor.clientHeight
        ) {
          const ancestorBounds = ancestor.getBoundingClientRect();
          visibleTop = Math.max(visibleTop, ancestorBounds.top);
          visibleBottom = Math.min(visibleBottom, ancestorBounds.bottom);
          visibleContainer = `${ancestor.tagName.toLowerCase()}.${ancestor.className}`;
        }
        ancestor = ancestor.parentElement;
      }
      const labelledBy = active.getAttribute("aria-labelledby");
      const label =
        labelledBy
          ?.split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim() ||
        (active instanceof HTMLInputElement && active.labels?.length
          ? [...active.labels]
              .map((node) => node.textContent ?? "")
              .join(" ")
              .trim()
          : "") ||
        active.getAttribute("aria-label") ||
        active.getAttribute("title") ||
        active.textContent?.trim() ||
        "";
      return {
        index,
        name: label,
        bounds: {
          top: bounds.top,
          bottom: bounds.bottom,
          visibleTop,
          visibleBottom,
          visibleContainer,
        },
        visible:
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= -0.5 &&
          bounds.right <= innerWidth + 0.5 &&
          bounds.top >= visibleTop - 0.5 &&
          bounds.bottom <= visibleBottom + 0.5,
        outlined:
          style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) >= 2,
      };
    });

    visited.push(focus.index);
    if (focus.index < 0) {
      failures.push(`step ${step + 1} did not focus an in-screen control`);
    }
    if (!focus.name) {
      failures.push(`step ${step + 1} focused an unnamed control`);
    }
    if (!focus.visible) {
      failures.push(
        `step ${step + 1} clipped ${focus.name || "control"} ${JSON.stringify(focus.bounds)}`,
      );
    }
    if (!focus.outlined) {
      failures.push(`step ${step + 1} did not outline ${focus.name || "control"}`);
    }
  }

  if (new Set(visited).size !== focusableCount) {
    failures.push(
      `visited ${new Set(visited).size} of ${focusableCount} focusable controls`,
    );
  }
  assert(
    failures.length === 0,
    `${asset.id} failed keyboard traversal: ${failures.join("; ")}.`,
  );
  return {
    focusableCount,
    visitedCount: new Set(visited).size,
    verticalVisibility: true,
    failures,
  };
}

async function assertFocusReturn(page, asset) {
  if (asset.state === "delete-confirmation") {
    const cancel = page.getByRole("button", {
      name: "Cancel delete all local data",
    });
    const focus = await focusControlForKeyboard(
      page,
      cancel,
      `${asset.id} cancel-delete control`,
    );
    await page.keyboard.press("Space");
    await page.locator(".danger-zone__trigger").waitFor();
    const restored = await page.locator(".danger-zone__trigger").evaluate(
      (node) => document.activeElement === node,
    );
    assert(restored, `${asset.id} did not return focus after cancelling delete.`);
    return {
      control: "cancel-delete",
      key: "Space",
      focused: focus.focused,
      restoredTarget: ".danger-zone__trigger",
      restored,
    };
  }

  const expectedTarget = {
    "provider-detail": 'button[aria-label="Open Kimi details"]',
    history: 'button[aria-label="Open Kimi history for 5-hour usage"]',
    "add-provider": ".add-provider-action",
    settings: 'button[aria-label="Settings"]',
    "api-key-connect":
      'button[aria-label="Replace ElevenLabs API key"]',
  }[asset.screen];
  if (!expectedTarget) {
    return null;
  }

  const back = page.locator(".page-header__back");
  const focus = await focusControlForKeyboard(
    page,
    back,
    `${asset.id} back control`,
  );
  await page.keyboard.press("Enter");
  await page.locator(expectedTarget).waitFor();
  const restored = await page
    .locator(expectedTarget)
    .evaluate((node) => document.activeElement === node);
  assert(restored, `${asset.id} did not return focus to ${expectedTarget}.`);
  return {
    control: "back",
    key: "Enter",
    focused: focus.focused,
    restoredTarget: expectedTarget,
    restored,
  };
}

async function assertLongCopyGeometry(page, asset) {
  if (asset.viewport.width !== 340) {
    return null;
  }

  const result = await page.evaluate(async () => {
    const root = document.querySelector("[data-fidelity-preview]");
    if (!(root instanceof HTMLElement)) {
      throw new Error("Long-copy geometry could not find the fidelity root.");
    }
    const descriptors = [
      [".provider-card__name", "Provider name translated into a substantially longer localized label"],
      [".provider-card__plan", "Professional subscription plan with extended localized wording"],
      [".quota-bars__history", "Rolling subscription allowance with a long localized window name"],
      [".quota-bars__heading h3", "Rolling subscription allowance with a long localized window name"],
      [".quota-bars__timing > span", "Twenty three of thirty one localized days elapsed"],
      [".quota-bars__reset", "Resets on September 30 at 11:59 PM local time"],
      [".compact-select > span", "Subscription provider selection"],
      [".history-surface__heading h2", "Rolling subscription allowance with a long localized window name"],
      [".history-surface__heading > span", "Recurring provider-defined rolling window"],
      [".settings-provider-copy p", "Provider name with an extended localized subscription plan"],
      [".api-key-guide__steps h3", "Paste a provider credential and validate the read only subscription connection"],
      [".provider-connect-row h3", "Provider name translated into a substantially longer localized label"],
    ];
    const mutations = [];
    for (const [selector, text] of descriptors) {
      for (const node of root.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        mutations.push({ node, html: node.innerHTML });
        node.textContent = text;
      }
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

    const violations = [];
    for (const { node } of mutations) {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      const selector = `.${[...node.classList].join(".")}`;
      if (style.whiteSpace === "nowrap") {
        violations.push(`${selector} still forces nowrap`);
      }
      if (style.textOverflow === "ellipsis") {
        violations.push(`${selector} still hides long copy behind ellipsis`);
      }
      if (style.overflowX === "hidden" || style.overflowX === "clip") {
        violations.push(`${selector} still clips long copy`);
      }
      if (bounds.left < -0.5 || bounds.right > innerWidth + 0.5) {
        violations.push(
          `${selector} escaped the 340px viewport (${bounds.left}/${bounds.right})`,
        );
      }
      if (node.scrollWidth > node.clientWidth + 1) {
        violations.push(
          `${selector} overflowed horizontally (${node.scrollWidth}/${node.clientWidth})`,
        );
      }
    }
    const viewportOverflow = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      root.scrollWidth,
    );
    if (viewportOverflow > innerWidth) {
      violations.push(
        `long copy widened the viewport (${viewportOverflow}/${innerWidth})`,
      );
    }
    const actions = [
      ...root.querySelectorAll(
        ".provider-card__refresh, .quota-bars__value, .pace, .provider-connect-row__action, .settings-provider-list button, .page-header__right",
      ),
    ];
    for (const action of actions) {
      const bounds = action.getBoundingClientRect();
      if (bounds.left < -0.5 || bounds.right > innerWidth + 0.5) {
        violations.push(
          `long copy clipped an adjacent value or action (${bounds.left}/${bounds.right})`,
        );
      }
    }

    for (const { node, html } of mutations) {
      node.innerHTML = html;
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return {
      verified: violations.length === 0,
      targetCount: mutations.length,
      violations,
    };
  });

  assert(
    result.targetCount > 0 && result.violations.length === 0,
    `${asset.id} failed long-copy 340px geometry: ${result.violations.join("; ")}.`,
  );
  return result;
}

async function captureFidelityAsset(page, asset, assetPath) {
  await page.locator('[data-fidelity-ready="true"]').waitFor();
  await waitForDocumentFonts(page);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        const root = document.querySelector("[data-fidelity-preview]");
        if (root instanceof HTMLElement) {
          root.scrollTop = 0;
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(undefined)),
        );
      }),
  );
  const measurements = await fidelityMeasurements(page, asset);
  assert(
    measurements.metadata.dataSource === "fixture" &&
      measurements.metadata.fixedClock === FIDELITY_FIXED_CLOCK,
    `${asset.id} leaked a non-fixture or non-fixed-clock state.`,
  );
  for (const field of ["screen", "state", "mode", "theme"]) {
    assert(
      measurements.metadata[field] === asset[field],
      `${asset.id} rendered the wrong ${field}.`,
    );
  }
  assert(
    measurements.metadata.width === asset.viewport.width,
    `${asset.id} rendered the wrong panel width.`,
  );
  assert(
    measurements.scrollWidth <= measurements.viewportWidth,
    `${asset.id} has horizontal overflow (${measurements.scrollWidth}/${measurements.viewportWidth}).`,
  );
  assert(measurements.scrollTop === 0, `${asset.id} did not reset scroll position.`);
  assert(measurements.exactScreen, `${asset.id} did not replace the prior screen exactly.`);
  assert(
    measurements.undersizedTargets.length === 0,
    `${asset.id} has controls below 44px: ${JSON.stringify(measurements.undersizedTargets)}.`,
  );
  assert(
    measurements.clippedTargets.length === 0,
    `${asset.id} has clipped controls: ${JSON.stringify(measurements.clippedTargets)}.`,
  );
  assert(
    measurements.unnamedTargets.length === 0,
    `${asset.id} has unnamed controls: ${JSON.stringify(measurements.unnamedTargets)}.`,
  );
  assert(
    measurements.invalidMeters.length === 0,
    `${asset.id} has invalid accessible meter values.`,
  );
  assert(
    measurements.brokenImages.length === 0,
    `${asset.id} has broken local images: ${measurements.brokenImages.join(", ")}.`,
  );
  assert(measurements.reducedMotion, `${asset.id} did not request reduced motion.`);
  assert(
    measurements.darkMode === (asset.theme === "dark"),
    `${asset.id} rendered the wrong color scheme.`,
  );
  if (fidelityScreenHasModeControl(asset.screen)) {
    assert(
      measurements.selectedMode === asset.mode,
      `${asset.id} did not select ${asset.mode}.`,
    );
  }
  if (asset.state === "refresh-pending") {
    assert(
      measurements.liveRegions.some((text) => /refreshing providers/i.test(text)),
      `${asset.id} did not expose live refresh progress.`,
    );
  }
  if (asset.state === "partial-refresh") {
    assert(
      measurements.liveRegions.some((text) => /needs attention/i.test(text)),
      `${asset.id} did not expose the partial refresh announcement.`,
    );
  }
  if (asset.screen === "api-key-connect") {
    assert(
      measurements.apiKeyGuide?.verified === true,
      `${asset.id} failed the API-key setup visual contract: ${measurements.apiKeyGuide?.violations?.join("; ")}.`,
    );
  }

  const longCopyGeometry = await assertLongCopyGeometry(page, asset);

  await page.mouse.move(0, 0);
  const buffer = await page.screenshot({
    path: assetPath,
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
  const png = PNG.sync.read(buffer, { checkCRC: true });
  const keyboardTraversal = await assertKeyboardTraversal(
    page,
    asset,
    measurements.focusableCount,
  );
  const focusReturn = await assertFocusReturn(page, asset);
  return {
    ...measurements,
    longCopyGeometry,
    keyboardTraversal,
    focusReturn,
    sha256: sha256(buffer),
    dimensions: { width: png.width, height: png.height },
  };
}

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

  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const fidelityCaptures = [];

  for (const asset of assets) {
    const assetPath = path.join(outputDirectory, asset.relativePath);
    await mkdir(path.dirname(assetPath), { recursive: true });
    const context = await browser.newContext({
      colorScheme: asset.theme ?? "light",
      deviceScaleFactor: 1,
        locale: "en-US",
      reducedMotion: "reduce",
      timezoneId: "America/Toronto",
      viewport: asset.viewport,
    });

    try {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const query = fidelityMode
        ? buildFidelityPreviewQuery(asset)
        : new URLSearchParams({
            view: asset.view,
            locale: asset.locale,
            dataSource: asset.dataSource,
            fixedClock: asset.fixedClock,
          }).toString();
      await page.goto(`${previewUrl}?${query}`, { waitUntil: "networkidle" });

      if (fidelityMode) {
        const keyboardRoute = await prepareFidelityKeyboardRoute(page, asset);
        const result = await captureFidelityAsset(page, asset, assetPath);
        assert(pageErrors.length === 0, `${asset.id} page errors: ${pageErrors.join("; ")}`);
        fidelityCaptures.push({
          id: asset.id,
          screen: asset.screen,
          state: asset.state,
          mode: asset.mode,
          theme: asset.theme,
          viewport: asset.viewport,
          fixedClock: asset.fixedClock,
          dataSource: asset.dataSource,
          locale: asset.locale,
          path: asset.relativePath,
          keyboardRoute,
          ...result,
        });
      } else {
        await page.locator("[data-preview-ready]").waitFor();
        await waitForDocumentFonts(page);
        await assertStorePreviewContract(page, asset);
        await prepareStoreAsset(page, asset);
        assert(pageErrors.length === 0, `${asset.relativePath} page errors: ${pageErrors.join("; ")}`);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: assetPath,
          animations: "disabled",
          caret: "hide",
        });
      }
    } finally {
      await context.close();
    }
  }

  if (fidelityMode) {
    const manifest = {
      schemaVersion: 1,
      dataSource: "fixture",
      fixedClock: FIDELITY_FIXED_CLOCK,
      captures: fidelityCaptures,
    };
    await writeFile(
      path.join(outputDirectory, "production-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.log(`Captured ${fidelityCaptures.length} production fidelity states.`);
  }
} finally {
  await browser?.close();
  await vite?.close();
}
