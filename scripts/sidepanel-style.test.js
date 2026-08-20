import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// jsdom has no CSS box model, so these tests guard the layout-critical
// declarations in the stylesheet source instead of measuring rendered
// geometry. They are regression guards on the source of truth, not visual
// proof (visual verification at 340/400/460 CSS px happens in Chrome).

const css = readFileSync(
  path.join(process.cwd(), "entrypoints/sidepanel/styles.css"),
  "utf8",
);

// Splits the stylesheet into selector/declaration pairs. Media-query blocks
// are flattened, so a rule nested inside `@media` is found the same way as a
// top-level rule. Adequate for this stylesheet (no nested braces inside
// declaration blocks).
function rules() {
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    found.push({
      selector: match[1].trim(),
      declarations: match[2],
    });
  }
  return found;
}

function rulesFor(selector) {
  return rules().filter((rule) =>
    rule.selector
      .split(",")
      .map((part) => part.trim())
      .includes(selector),
  );
}

describe("side panel layout stylesheet", () => {
  it("takes the summary dismiss button out of the banner flow", () => {
    // The global `button { min-width/min-height: 44px }` accessibility sizing
    // stays in effect; the dismiss button must not let that 44px target
    // inflate the refresh-summary banner height, so it is positioned
    // absolutely inside a relatively-positioned bar (out of flow).
    const bar = rulesFor(".summary-bar");
    expect(bar.length).toBeGreaterThan(0);
    expect(bar.some((rule) => /position:\s*relative/.test(rule.declarations))).toBe(
      true,
    );

    const dismiss = rulesFor(".summary-bar__dismiss");
    expect(dismiss.length).toBeGreaterThan(0);
    expect(
      dismiss.some((rule) => /position:\s*absolute/.test(rule.declarations)),
    ).toBe(true);

    // The dismiss target retains the global 44px minimum width. Reserve that
    // full target plus its small right offset so the transparent target and
    // hover state do not cover the end of the summary message.
    const message = rulesFor(".summary-bar p");
    expect(message.length).toBeGreaterThan(0);
    expect(
      message.some((rule) => /padding-right:\s*46px/.test(rule.declarations)),
    ).toBe(true);
  });

  it("keeps the history filter groups coherent without space-between", () => {
    // `justify-content: space-between` pushed Used/Left and 48H/7D/30D to
    // opposite edges (blank middle at 400/460px) and, once inherited by the
    // narrow column override, created blank vertical gaps at 340px. No
    // `.history-controls` rule — base or inside any breakpoint — may use it.
    const controls = rulesFor(".history-controls");
    expect(controls.length).toBeGreaterThan(0);
    for (const rule of controls) {
      expect(rule.declarations).not.toMatch(
        /justify-content:\s*space-between/,
      );
    }
    // The group wraps tightly instead of splitting into spaced-out rows.
    expect(
      controls.some((rule) => /flex-wrap:\s*wrap/.test(rule.declarations)),
    ).toBe(true);
  });

  it("paints stacked meter segments above the generic fill, including patterns", () => {
    // `.meter > span { background: var(--quota) }` is 0,1,1 and resets
    // background-image. Segment paint must use `.meter > .meter__segment--N`
    // (0,2,0), matching `.meter > .meter__fill--accent`, and must restore
    // the colourblind stripe/dot images the legend already shows.
    const first = rulesFor(".meter > .meter__segment--1");
    const second = rulesFor(".meter > .meter__segment--2");
    const third = rulesFor(".meter > .meter__segment--3");
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(third.length).toBeGreaterThan(0);
    expect(
      first.some((rule) =>
        /background-color:\s*#a78bfa/.test(rule.declarations) &&
        /repeating-linear-gradient/.test(rule.declarations),
      ),
    ).toBe(true);
    expect(
      second.some((rule) => /background-color:\s*#7c3aed/.test(rule.declarations)),
    ).toBe(true);
    expect(
      third.some(
        (rule) =>
          /background-color:\s*#5b21b6/.test(rule.declarations) &&
          /radial-gradient/.test(rule.declarations),
      ),
    ).toBe(true);
  });
});
