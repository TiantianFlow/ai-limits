# AI Limits

AI Limits is a Chrome side-panel extension that shows subscription usage for
ChatGPT, Claude, Kimi, and Cursor in one compact view. It starts empty and reads
usage only after you connect an individual provider and approve that provider's
optional access.

AI Limits is an independent project by wjcjttl. It is not affiliated with,
endorsed by, or authorized by OpenAI, Anthropic, Moonshot AI, Cursor, or their
affiliates.

## How it works

- Each provider is opt-in. Chrome asks for only that provider's site access.
- The extension sends low-frequency, read-only requests to the provider's own
  web-session usage services. It does not scrape rendered page content.
- Normalized quota, credit, plan, refresh-status, and preference data is stored
  in Chrome extension storage on the local browser profile.
- Session cookies and access credentials are used only for the current provider
  collection attempt and are not saved in persistent extension storage.
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

See [Privacy](PRIVACY.md) for the complete data lifecycle and
[Security](SECURITY.md) for security reporting and limitations.

## Permissions

AI Limits requires `storage`, `alarms`, and `sidePanel` for local state,
scheduled refresh, and its interface. Provider origins are optional and are
requested one at a time when you click **Connect**. The optional `cookies` and
`scripting` permissions are requested only for Kimi session access and
interactive recovery. The extension does not request the broad `tabs`
permission.

For exact permission justifications and reviewer steps, see the
[store-listing draft](docs/store-listing.md).

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
`.output/ai-limits-0.1.0-chrome.zip`, opens the archive, and verifies its
manifest, entrypoints, permissions, and forbidden-file rules.

## Provider compatibility

Provider session and usage endpoints are private, unsupported interfaces.
Response shapes, security challenges, or availability can change without
notice. AI Limits converts malformed or unavailable responses into bounded
health states, but cannot guarantee continuous compatibility. Prefer a stable,
documented provider API if one becomes available.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. This project
uses [GitHub Issues](https://github.com/wjcjttl/ai-limits/issues) for public
support and bug reports. Do not include cookies, access credentials, private
usage data, or other secrets in an issue.

## License

[MIT](LICENSE) © 2026 wjcjttl
