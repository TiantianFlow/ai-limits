# AI Limits

## Product summary

AI Limits is a Chrome side-panel cockpit for keeping subscription usage limits
visible in one calm view. Runtime starts with no usage data: provider cards are
populated only by live checks against an opted-in browser session.

## Privacy model

Provider data stays in browser extension storage. Connecting ChatGPT, Claude,
Kimi, or Cursor is an explicit per-provider action: the extension requests
only that provider's optional host permission (and Kimi's optional cookies
permission). Live session credentials are not persisted or logged.

## Current POC coverage

- Five-provider cockpit with empty, permission-required starting state.
- Local persistence for display preferences and provider state.
- An explicit `Check session` flow for each standalone web provider (ChatGPT,
  Claude, Kimi, and Cursor).
- A background worker that refreshes only providers with their optional
  permissions already granted.

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

## Check provider sessions

Click **Check session** only when you want to grant access to that provider.
Chrome requests only the selected provider's optional permission, after which
the extension performs a best-effort live browser-session usage check.
Declining leaves that provider in the permission-required state with no
fabricated usage snapshot.

## Known private-endpoint fragility

These providers' session and usage endpoints are private, unsupported
interfaces. Their response shape or availability can change without notice. The
POC represents malformed or unavailable responses as provider health states,
but cannot guarantee live compatibility.

## Next provider milestones

1. Prefer stable, documented provider APIs where they exist.
2. Add per-provider refresh controls and health guidance.
