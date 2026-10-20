/**
 * Renders the balance chart from a synthetic 30-day fixture at three panel
 * widths and checks the status line, the top-up readout and the no-readings
 * readout under a real mouse.
 */
export const page = "balance-history";
export const viewport = { width: 520, height: 1400 };

export async function run({ page, fail, log }) {
  const fixture = await page.locator("main").evaluate((main) => ({
    start: Number(main.dataset.rangeStart),
    end: Number(main.dataset.rangeEnd),
    topUpAt: Number(main.dataset.topupAt),
    gapAt: Number(main.dataset.gapAt),
    net: Number(main.dataset.net),
  }));
  const expectedStatus = `${fixture.net < 0 ? "−" : "+"}$${Math.abs(fixture.net).toFixed(2)} in 30 days`;

  for (const width of [340, 400, 460]) {
    const card = page.locator(`[data-width="${width}"]`);
    await card.scrollIntoViewIfNeeded();
    const status = (await card.locator(".history-chart__status").innerText()).trim();
    if (status !== expectedStatus) fail(`${width}px status was "${status}", expected "${expectedStatus}"`);
    if ((await card.locator(".history-chart__line").count()) < 2) fail(`${width}px line is not broken at the gap`);
    if ((await card.locator(".history-chart__gap").count()) !== 1) fail(`${width}px has no gap mark`);

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
        fail(`${width}px tooltip spills the plot`);
      }
      return text;
    };
    const topUp = await readout(fixture.topUpAt);
    if (!topUp.includes("Top-up +$20.00")) fail(`${width}px top-up readout was "${topUp}"`);
    const gap = await readout(fixture.gapAt);
    if (!gap.includes("No readings")) fail(`${width}px gap readout was "${gap}"`);
    log(`${width}px ok`);
  }
}
