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

AI Limits supports twenty providers: ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, Perplexity, ElevenLabs, New API, LiteLLM, ClawRouter, sub2api, LLM Proxy, DeepSeek, Moonshot, DeepInfra, Fireworks, OpenAI, GroqCloud, and OpenRouter.
It is a Chrome side-panel extension that shows their current
subscription usage and local quota-history graphs in one compact view. It
normalizes provider-specific reporting into one **Used** or **Left** display
and, when a provider exposes a complete reset window, compares quota
consumption with elapsed time to show a pace signal. Cursor also shows weekly
Grok Bot usage next to its monthly Cursor-model and Other-model limits, plus a
per-model included-usage breakdown. It starts empty and reads usage only after
you connect an individual provider and approve that provider's optional access.
The side panel supports English and Simplified Chinese. Follow Chrome uses those
languages when Chrome is set to one of them, and falls back to English for every
other Chrome language. Settings can pin English or Simplified Chinese for this
panel.

AI Limits is an independent project by TiantianFlow. It is not affiliated with,
endorsed by, or authorized by any supported provider, its parent company, or
its affiliates.

![AI Limits Chrome side panel showing representative subscription usage in Used mode, reset timing, pace indicators, and provider navigation](store-assets/chrome-web-store/screenshot-overview-1280x800.png)

## How it works

- Each provider is opt-in. Chrome asks for only that provider's exact host
  access.
- ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, and Perplexity use the signed-in
  browser session. The extension sends low-frequency, read-only requests to
  their own web-session usage services and does not scrape rendered page
  content. Cursor's base
  usage refresh remains a background request; Connect or manual Refresh may
  additionally run bundled read-only code in one already-open `cursor.com`
  page, or briefly open one inactive spending tab if none is open, to request
  Grok Bot, extra-credit, and per-model included-usage JSON.
- ElevenLabs, DeepSeek, Moonshot, DeepInfra, Fireworks, OpenAI, GroqCloud, and
  OpenRouter use user-created API keys against their fixed provider APIs. OpenAI
  is the Platform organization and developer billing surface (organization
  costs, completion usage, or legacy credit grants), not the ChatGPT consumer
  session. New
  API, LiteLLM, ClawRouter, sub2api, and LLM Proxy support multiple
  independently configured instances at user-selected origins. The extension
  sends each key only to its selected provider API for the read-only usage or
  balance requests described in
  [Supported providers](SUPPORTED_PROVIDERS.md).
  AI Limits supports multiple New API instances. Each instance keeps its own
  normalized base URL, label, relay key, current usage, refresh state, and
  History.
- The latest normalized quota, counter or spend, balance, plan, refresh-status,
  and preference data is stored in Chrome extension storage on the local
  browser profile.
- After each successful normalized refresh, quota, counter or spend, and
  balance observations are stored per instance for up to 30 days, subject to a
  1,024-observation per-instance safety cap. The newest 48 hours stay at
  collection resolution; older retained observations keep the latest value in
  each UTC hour. History graphs quota metrics only. It does not graph the
  retained counters or balances, reconstruct earlier provider history, or
  store raw provider responses or credentials in History.
- Browser-session cookies and access credentials are used only for the current
  provider collection attempt and are not saved in persistent extension
  storage. Successfully validated API keys are stored separately in local
  extension storage so manual and scheduled refresh can run without reopening
  the setup page.
- Automatic refresh is enabled by default and runs about every 15 minutes only
  while at least one connected provider remains. It can be disabled in
  Settings.

Kimi scheduled refresh never opens a tab. An interactive Connect or Refresh
may open at most one inactive temporary Kimi tab, waits up to 10 seconds for
recovery, and closes only the tab it created. The extension checks the legacy
Kimi cookie first, then the exact `access_token` entry in an already-open Kimi
page. Browser shutdown or API errors can delay or prevent best-effort cleanup.

Cursor Connect or manual Refresh prefer one already-open `cursor.com` tab. If
none is open, they may briefly open one inactive
`https://cursor.com/dashboard/spending` tab, wait up to 10 seconds, read from
it, and close only the tab they created. That owned-tab path uses the same
shared helper as Kimi. AI Limits never activates a tab and never closes a tab
the user opened. It does not inspect rendered content, browser storage, or
cookie values directly; Chrome still attaches the signed-in Cursor cookies to
those fixed same-origin requests. Scheduled or automatic refresh never opens
or injects into a Cursor page. The card shows monthly Cursor-model and
Other-model limits plus weekly Grok Bot usage. A detail view lists included
usage by model, grouped into Cursor Models and Other Models, with input,
output, and cost plus provider totals. That detail surface is generic so other
providers can adopt it later; today only Cursor fills it. Last-good Grok Bot,
extra-credit, and detail values stay until Grok Bot's weekly reset, without
presenting them as a new observation.

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
connection. New API, LiteLLM, ClawRouter, sub2api, and LLM Proxy declare dynamic
optional host capability because they can use configurable origins, but Chrome
is asked only for the exact instance origin entered in onboarding. Same-origin
instances share that browser-global grant only; their credentials, labels,
usage, and History remain independent. The optional
`cookies` is requested only for Kimi session access. `scripting` is requested
for Kimi interactive recovery, Cursor's manual/connect-only page enrichment,
and Grok page-origin session and usage reads. Fixed API-key providers receive only optional access to their own
API origins. Public setup pages are opened normally and do not receive
extension host access. The extension does not request the broad `tabs`
permission.

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
`.output/ai-limits-0.4.3-chrome.zip`, opens the archive, and verifies its
manifest, entrypoints, permissions, and forbidden-file rules.

## Provider compatibility

The browser-session providers use private, unsupported session and usage
interfaces. API-key providers use documented or reverse-engineered HTTP
endpoints, but response shapes, authorization scopes, security challenges, or
availability can still change without notice. AI Limits converts malformed or
unavailable responses into bounded health states, but cannot guarantee
continuous compatibility.

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
