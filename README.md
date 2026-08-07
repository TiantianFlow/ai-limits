# AI Limits

## Product summary

AI Limits is a Chrome side-panel cockpit for keeping subscription usage limits
visible in one calm view. The POC starts with five provider cards and can
combine local demo data with a connected ChatGPT usage snapshot.

## Privacy model

Provider data stays in the browser's extension storage. Connecting ChatGPT is
an explicit user action: the extension requests only the optional
`https://chatgpt.com/*` permission, uses the resulting session token for the
collection request, and does not persist or log that token.

## Current POC coverage

- Five-provider demo cockpit with quota windows, usage, and health state.
- Local persistence for display preferences and provider state.
- An explicit `Connect live` flow for a best-effort ChatGPT usage snapshot.
- A background worker that refreshes only after the optional ChatGPT permission
  has been granted.

## Local development

Use Node 24 or newer, then install dependencies and start the development
build:

```bash
pnpm install
pnpm dev
```

Run the production handoff check before loading the unpacked extension:

```bash
pnpm verify
```

`pnpm verify` runs the unit tests, TypeScript check, production build, and a
manifest/output verifier.

## Load unpacked

After `pnpm verify`, open `chrome://extensions`, enable **Developer mode**, and
choose **Load unpacked**. Select this exact directory:

```text
/Users/tianjiang/open-source/ai-limits/.worktrees/poc/.output/chrome-mv3
```

Chrome should show **AI Limits** without manifest or service-worker errors. Use
the extension toolbar action to open its side panel.

## Connect live ChatGPT

The initial side panel uses the local five-provider demo. Click **Connect live**
only when you want to grant ChatGPT access. Chrome will request the optional
ChatGPT origin permission, after which the extension can collect a current
ChatGPT usage snapshot. Declining the request leaves the demo data in place.

## Known private-endpoint fragility

ChatGPT's session and usage endpoints are private, unsupported provider
interfaces. Their response shape or availability can change without notice. The
POC contains malformed or unavailable responses as provider health states, but
it cannot guarantee live ChatGPT compatibility.

## Next provider milestones

1. Add explicit, opt-in adapters for the remaining provider cards.
2. Prefer stable, documented provider APIs where they exist.
3. Add per-provider refresh controls, health guidance, and coverage for each
   opt-in integration.
