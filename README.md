# AI Limits

## Product summary

AI Limits is a Chrome side-panel cockpit for keeping subscription usage limits
visible in one calm view. Runtime starts with no usage data: provider cards are
populated only by live checks against an opted-in browser session.

## Privacy and data access model

Provider data stays in browser extension storage. Connecting ChatGPT, Claude,
Kimi, or Cursor is an explicit per-provider action: the extension requests
only that provider's optional host permission (and Kimi's optional cookies
and scripting permissions). Live session credentials are request-local and are
not persisted or logged.

AI Limits does not scrape rendered page HTML. It makes low-frequency,
read-only requests to the same private JSON services used by the providers'
web applications, using the user's opted-in signed-in browser session. A
background refresh runs every 15 minutes only for providers whose permissions
have already been granted; the header refresh button triggers the same bounded
collection manually.

## Current POC coverage

- Four-provider cockpit with empty, permission-required starting state.
- Local persistence for display preferences and provider state.
- An explicit `Check session` flow for each standalone web provider (ChatGPT,
  Claude, Kimi, and Cursor).
- A background worker that refreshes only providers with their optional
  permissions already granted.
- Unified Used/Left quota and wall-clock bars with provider reset timestamps.
- An in-place loading spinner on the global refresh button while existing data
  remains visible.
- Separate ChatGPT credits, Kimi monthly/5-hour/weekly usage, and both Cursor
  monthly model pools when those values are present in the provider response.

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
/Users/tianjiang/open-source/ai-limits/.output/chrome-mv3
```

On macOS, if the file chooser hides `.output`, press **Command-Shift-G**, paste
the full path above, and press Return before choosing the folder.

Chrome should show **AI Limits** without manifest or service-worker errors. Use
the extension toolbar action to open its side panel.

## Check provider sessions

Click **Check session** only when you want to grant access to that provider.
Chrome requests only the selected provider's optional permission, after which
the extension performs a best-effort live browser-session usage check.
Declining leaves that provider in the permission-required state with no
fabricated usage snapshot.

Kimi's current web session may keep its access token in the signed-in page
rather than the legacy cookie. The extension first reads only the exact
`access_token` key from an already-open Kimi tab and does not store it. If Kimi
rejects that sampled credential, the extension rereads the key once. If it is
still stale, the extension opens one new inactive Kimi homepage tab for less
than about five seconds so Kimi's own page can refresh its session, samples
only a changed `access_token`, retries usage once, and closes exactly that
temporary tab. It never reads or exchanges Kimi's `refresh_token` and never
reloads an existing tab.

This recovery is best-effort because it depends on Kimi's normal page startup.
If it fails, open or reload `https://www.kimi.com/` once, confirm that it is
signed in, and click **Check session** again.

Kimi's subscription title comes from its companion subscription response. Its
monthly pacing boundary is calculated from the exact reset timestamp by moving
back one calendar month while preserving the billing day and time; it is never
treated as a fixed 30-day window. A reset on September 6 at 11:11 AM therefore
has an August 6 at 11:11 AM start.

## Private-endpoint risk

These providers' session and usage endpoints are private, unsupported
interfaces. Their response shape or availability can change without notice. The
POC represents malformed or unavailable responses as provider health states,
but cannot guarantee live compatibility.

For a personally sideloaded, read-only extension, the practical account-
enforcement risk appears low but is not zero; endpoint breakage is the more
likely day-to-day problem. This project is not provider-authorized, and provider
terms restrict various forms of automated access or extraction. A public Chrome
Web Store release needs a separate privacy, disclosure, consent, and terms
review. Relevant primary policies include the [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/),
[Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms),
[Cursor Terms of Service](https://cursor.com/terms-of-service), [Kimi User
Agreement](https://www.kimi.com/user/agreement/modelUse?version=v2), and
[Chrome Web Store user-data policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

Antigravity is intentionally excluded. It has no credible standalone browser-
session quota route, and its [Additional Terms](https://antigravity.google/terms)
explicitly prohibit third-party tools from accessing the service.

## Next provider milestones

1. Prefer stable, documented provider APIs where they exist.
2. Add per-provider refresh controls and health guidance.

## License

[MIT](LICENSE) © 2026 wjcjttl
