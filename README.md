# AI Limits

English | [简体中文](README.zh-CN.md)

[![Chrome Web Store version](https://img.shields.io/chrome-web-store/v/hcfdchpajckemcdflcjhigngpipdkdeo.svg?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo)
[![CI](https://github.com/TiantianFlow/ai-limits/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/TiantianFlow/ai-limits/actions/workflows/ci.yml?query=branch%3Amain)
[![GitHub release](https://img.shields.io/github/v/release/TiantianFlow/ai-limits.svg?display_name=release&sort=semver)](https://github.com/TiantianFlow/ai-limits/releases/latest)
[![MIT license](https://img.shields.io/github/license/TiantianFlow/ai-limits.svg)](LICENSE)

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/ai-limits/hcfdchpajckemcdflcjhigngpipdkdeo)**

Chrome Web Store releases can lag while review or publishing is pending; the
Store badge shows the currently published version. GitHub Releases preserve
the corresponding source and validated upload archive.

AI Limits supports six providers: ChatGPT, Claude, Kimi, Cursor, ElevenLabs,
and New API. It is a Chrome side-panel extension that shows their current
subscription usage and local quota-history graphs in one compact view. It
normalizes provider-specific reporting into one **Used** or **Left** display
and, when a provider exposes a complete reset window, compares quota
consumption with elapsed time to show a pace signal. It starts empty and reads
usage only after you connect an individual provider and approve that
provider's optional access.

AI Limits is an independent project by TiantianFlow. It is not affiliated with,
endorsed by, or authorized by OpenAI, Anthropic, Moonshot AI, Cursor,
ElevenLabs, the New API project, or their affiliates.

![AI Limits Chrome side panel showing representative subscription usage in Used mode, reset timing, pace indicators, and provider navigation](store-assets/chrome-web-store/screenshot-overview-1280x800.png)

## How it works

- Each provider is opt-in. Chrome asks for only that provider's exact host
  access.
- ChatGPT, Claude, Kimi, and Cursor use the signed-in browser session. The
  extension sends low-frequency, read-only requests to their own web-session
  usage services and does not scrape rendered page content.
- ElevenLabs uses a user-created API key because its documented public API does
  not offer the same zero-setup web-session route used by the other providers.
  The extension sends that key only to the ElevenLabs API for its read-only
  subscription request.
- New API uses one user-provided instance URL and relay key. AI Limits reads
  only that key's usage endpoint; it supports capped and unlimited keys, but
  not account wallet, subscriptions, admin data, or multiple instances yet.
- The latest normalized quota, credit, plan, refresh-status, and preference data
  is stored in Chrome extension storage on the local browser profile.
- After each successful normalized refresh, quota observations are stored
  locally for up to 30 days for the History graphs, subject to a
  1,024-observation per-provider safety cap. Within that cap, observations from
  the newest 48 hours are kept at collection resolution; older retained history
  keeps only the latest value in each UTC hour. On upgrade, one valid current
  snapshot can become the first observation at its original fetch time; the
  extension does not reconstruct earlier provider history and does not store
  credit-balance history.
- Browser-session cookies and access credentials are used only for the current
  provider collection attempt and are not saved in persistent extension
  storage. Successfully validated ElevenLabs and New API keys are stored separately in
  local extension storage so manual and scheduled refresh can run without
  reopening the setup page.
- Automatic refresh is enabled by default and runs about every 15 minutes only
  while at least one connected provider remains. It can be disabled in
  Settings.

Kimi may require extra recovery during an interactive Connect or Refresh. The
extension checks the legacy Kimi cookie first, then the exact `access_token`
entry in an already-open Kimi page. If no credential is available or Kimi
rejects it, interactive recovery may create one inactive Kimi homepage tab.
Recovery stops waiting for a credential after 10 seconds and then attempts
best-effort cleanup of the tab it owns; browser shutdown or API errors can
delay or prevent that cleanup. Scheduled refresh never creates a Kimi tab.

ElevenLabs setup opens its official API-keys page in a normal tab. If you need
to sign in first, the guide remains open and lets you reopen that page. It asks
you to create a key with **User → Read** and no generation or write permissions,
then validates the read-only subscription request before saving the key. The
exact endpoint-to-scope mapping is not formally documented by ElevenLabs, so
the connection check is the authority; AI Limits does not silently broaden
permissions. Once connected, ElevenLabs manual and scheduled refreshes run in
the background without opening tabs. See [Privacy](PRIVACY.md) for the saved
key's local-storage boundary and limitations.

See the [FAQ](FAQ.md) for refresh and History behavior,
[Supported providers](SUPPORTED_PROVIDERS.md) for each connection mode and its
limitations,
[Privacy](PRIVACY.md) for the complete data lifecycle, and
[Security](SECURITY.md) for security reporting and limitations.

## Permissions

AI Limits requires `storage`, `alarms`, and `sidePanel` for local state,
scheduled refresh, and its interface. Provider origins are optional and are
requested one at a time when you click **Connect** or validate an API-key
connection. New API declares dynamic optional host capability because it can be
self-hosted, but Chrome is asked only for the exact instance origin entered in
onboarding. The optional `cookies` and `scripting` permissions are
requested only for Kimi session access and interactive recovery. ElevenLabs
receives only optional access to `https://api.elevenlabs.io/*`; the public
setup page is opened normally and does not receive extension host access. The
extension does not request the broad `tabs` permission.

For exact permission justifications and reviewer steps, see the
[store-listing draft](STORE_LISTING.md).

## Local development

Use Node 24 and the Corepack-managed pnpm version pinned in `package.json`.
From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Run the full test, typecheck, build, and build-layout verification:

```bash
pnpm verify
```

## Load unpacked

After `pnpm verify`, open `chrome://extensions`, enable **Developer mode**, and
choose **Load unpacked**. From the repository root, select:

```text
dist/chrome-mv3
```

`pnpm build` stages this visible directory from WXT's generated `.output`
directory, so it appears normally in the macOS file chooser. Use the extension
toolbar action to open the side panel.

## Build the upload ZIP

Create and validate the Chrome Web Store upload artifact with:

```bash
pnpm verify:zip
```

The command rebuilds the extension, creates
`.output/ai-limits-0.2.3-chrome.zip`, opens the archive, and verifies its
manifest, entrypoints, permissions, and forbidden-file rules.

## Provider compatibility

The browser-session providers use private, unsupported session and usage
interfaces. ElevenLabs and New API use documented APIs, but response
shapes, authorization scopes, security challenges, or availability can still
change without notice. AI Limits converts malformed or unavailable responses
into bounded health states, but cannot guarantee continuous compatibility.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. This project
uses [GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) for public
support and bug reports. Do not include cookies, access credentials, private
usage data, or other secrets in an issue.

## Community

Thanks to [LINUX DO](https://linux.do/) for providing a space for Chinese
developers to exchange ideas and feedback. This acknowledgement does not imply
affiliation or official endorsement.

## License

[MIT](LICENSE) © 2026 TiantianFlow
