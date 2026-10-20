# Real-browser tests

AI Limits has two test suites.

| Suite | Command | Runs in | Use it for |
| --- | --- | --- | --- |
| Unit and component | `pnpm test` / `pnpm test:run` | Vitest with jsdom, a simulated DOM with no layout or paint | Logic, state, rendered text and roles |
| Real browser | `pnpm test:browser` | Headless Chromium against pages served by Vite | Geometry, hover and pointer behavior, anything that needs pixels, screenshots |

The browser suite is not part of `pnpm verify` or CI yet. It needs a local
Chromium: the one bundled with `playwright-core`
(`pnpm exec playwright-core install chromium`), or any Chromium binary named
by `AI_LIMITS_CHROME_PATH`.

## Running

```bash
pnpm test:browser                         # every spec
pnpm test:browser --only balance-history  # one spec
pnpm test:browser --screenshots           # also write artifacts/browser/<spec>.png
pnpm test:browser --screenshots artifacts/review  # same, to another folder
```

A failing spec always writes `<spec>-failure.png`, so there is a picture of
what the browser showed.

## Layout

- `run.mjs` is the harness: it starts Vite and Chromium once, opens each spec's
  page in a fresh context, runs the spec, collects failures and page errors,
  and takes screenshots.
- `pages/<name>.html` and `pages/<name>.tsx` render real components from
  synthetic data. Each page imports `./setup` first, which stands in for the
  extension's i18n, runtime and storage APIs, and sets `data-ready="1"` once it
  has rendered.
- `specs/<name>.mjs` exports `page` (the page name), an optional `viewport`,
  and `run({ page, fail, log })`. `page` is a Playwright page; call `fail` for
  each check that does not hold and throw only when the spec cannot continue.

## Adding a spec

1. Add `pages/<name>.html` and `pages/<name>.tsx`. Copy an existing pair and
   keep the data synthetic.
2. Add `specs/<name>.mjs` with the checks.
3. Break the behavior on purpose once and confirm the spec fails.

`scripts/history-v20-render.mjs` reuses the same page server to write a
gallery of every History chart variant. It is a render tool, not a test.
