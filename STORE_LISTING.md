# Chrome Web Store listing draft

This document describes AI Limits version 0.1.0. It is submission copy and a
review checklist, not a claim that any provider has approved the extension.

## Store configuration

- Category: Productivity
- Primary language: English
- Mature content: No
- Distribution: Public, all regions
- Pricing: Free
- Homepage: https://github.com/wjcjttl/ai-limits
- Privacy policy: https://github.com/wjcjttl/ai-limits/blob/main/PRIVACY.md
- Support: https://github.com/wjcjttl/ai-limits/issues
- Remote hosted code: No

## Artwork inventory and upload order

All artwork is generated from the production side-panel UI with deterministic,
representative fixture data. Upload the files in this order:

1. `store-assets/chrome-web-store/screenshot-overview-1280x800.png` — product
   overview screenshot, 1280×800.
2. `store-assets/chrome-web-store/screenshot-pacing-1280x800.png` — quota,
   timing, and pace screenshot, 1280×800.
3. `store-assets/chrome-web-store/screenshot-privacy-1280x800.png` — Settings
   and local-data controls screenshot, 1280×800.
4. `store-assets/chrome-web-store/small-promo-440x280.png` — small promotional
   tile, 440×280; upload it to the small promotional tile slot rather than the
   screenshot carousel.

Regeneration and validation instructions are in
[`store-assets/README.md`](store-assets/README.md).

## Single purpose

AI Limits gives a user one Chrome side panel for viewing subscription usage and
reset timing from four provider accounts already signed in within that user's
browser profile.

## Short description

See ChatGPT, Claude, Kimi, and Cursor subscription usage in one Chrome side
panel.

## Detailed description

AI Limits keeps subscription limits visible without switching among provider
account pages. Connect ChatGPT, Claude, Kimi, or Cursor individually, approve
that provider's optional access, and view the usage windows, reset times,
credits, and plan labels that the provider makes available to the signed-in web
session.

The extension stores normalized results in the local Chrome profile. Refresh
can be manual or automatic about every 15 minutes. Settings let the user turn
automatic refresh off, disconnect one provider and remove its saved usage, or
delete all saved usage and attempt to revoke every provider permission.

AI Limits is an independent project by wjcjttl. It is not affiliated with,
endorsed by, or authorized by OpenAI, Anthropic, Moonshot AI, Cursor, or their
affiliates. Provider web-session endpoints are private and unsupported, so
compatibility may change without notice.

## Permission justifications

### Required permissions

- `storage`: saves display and refresh preferences, provider access state,
  normalized quota/credit snapshots, and sanitized refresh status in
  `chrome.storage.local`. It also holds temporary Kimi tab-cleanup lease
  metadata in `chrome.storage.session`. Session cookies and access credentials
  are not persisted.
- `alarms`: schedules the approximately 15-minute refresh cycle only while
  automatic refresh is enabled and at least one provider is connected.
- `sidePanel`: displays the extension's only application interface in Chrome's
  side panel.

### Optional host permissions

These origins are requested one provider at a time after the user clicks
**Connect**. None is required at installation.

- `https://chatgpt.com/*`: reads the signed-in user's ChatGPT session and usage
  responses.
- `https://claude.ai/*`: reads the signed-in user's Claude organization usage
  response.
- `https://www.kimi.com/*`: reads Kimi usage/subscription responses and supports
  the bounded interactive session-access and recovery flow.
- `https://cursor.com/*`: reads the signed-in user's Cursor usage summary.

### Optional API permissions

- `cookies`: requested only with Kimi access; reads only Kimi's exact legacy
  `kimi-auth` cookie when available. This is checked before Kimi page storage.
- `scripting`: requested only with Kimi access; reads only the exact
  `access_token` browser-storage entry from an already-open or recovery-created
  matching Kimi page. If a credential is missing or rejected, interactive
  recovery may create one inactive Kimi homepage tab. Recovery stops waiting
  for a credential after 10 seconds and attempts best-effort cleanup of only
  its owned tab; shutdown or browser API errors can delay or prevent cleanup.

The manifest does not request the broad `tabs` permission. Scheduled refresh
does not create or activate provider tabs.

## Data-disclosure answers

- **Authentication information:** Yes, accessed transiently. Provider session
  JSON, cookies, and access credentials are handled only for the selected
  provider collection sequence and are not stored in persistent extension
  storage or sent to the developer.
- **Website content:** Yes. AI Limits handles private provider session, usage,
  subscription, and organization-response JSON plus Kimi's exact
  `access_token` browser-storage entry. It does not read rendered page text,
  prompts, conversations, or generated responses.
- **Account identifiers and personally identifiable information:** Yes,
  narrowly handled. A ChatGPT account identifier derived from the access
  credential and a Claude organization UUID/capabilities are request-local and
  not persisted. A Claude organization name may be normalized and stored as the
  visible plan label. Email-shaped account labels are discarded, and current
  adapters do not query Claude or Cursor email endpoints.
- **Financial and payment information:** Yes, limited to provider-reported
  usage-credit balances, extra-usage amounts or limits, and on-demand spend
  limits included in a usage response. Payment cards, bank details, and
  transaction histories are not accessed.
- **Web history:** No browsing history or list of visited pages is collected or
  retained. During Kimi collection, AI Limits may check for an already-open tab
  matching the exact Kimi origin.
- **User activity:** No clicks, keystrokes, pointer movement, scrolling, or
  general browsing activity is monitored.
- **Health information, personal communications, and location:** No.
- **Sale or unrelated sharing:** No. Data is not sold and is not sent to the
  developer, advertisers, data brokers, or unrelated third parties.
- **Analytics, advertising, telemetry, or remote backend:** None.
- **Retention and controls:** Normalized data stays in the local Chrome profile
  until provider disconnect, **Delete all local data**, extension uninstall, or
  browser-storage clearing. Users can disable automatic refresh at any time.
- **Use limitation:** Data is used only to provide the usage dashboard, refresh
  health, permission lifecycle, and user-requested settings. It is not used for
  advertising, credit decisions, or purposes unrelated to the single purpose.

The full policy is in [PRIVACY.md](PRIVACY.md).

## Reviewer prerequisites

- Chrome 116 or newer.
- The validated `ai-limits-0.1.0-chrome.zip` upload artifact.
- Reviewer-owned test accounts signed in to the desired provider sites in the
  same Chrome profile. No credentials or provider accounts are embedded or
  supplied by the extension.
- Network access to the provider origins. Private endpoint behavior and account
  entitlements can affect which usage windows appear.
- After the repository is public and before Chrome Web Store submission, verify
  the homepage, privacy policy, and support URLs are reachable in a signed-out
  browser.

## Four-provider test flow

1. Install the submitted build, or extract the ZIP and load its root as an
   unpacked extension. Pin AI Limits if desired, select its toolbar action, and
   confirm the side panel opens with four permission-required cards.
2. **ChatGPT:** sign in at `chatgpt.com`, click **Connect** on ChatGPT, approve
   only the ChatGPT origin, and confirm a plan plus available quota windows or
   credits appears. Use the card's **Refresh** action once.
3. **Claude:** sign in at `claude.ai`, click **Connect** on Claude, approve only
   the Claude origin, and confirm organization plan and available usage windows
   or extra-usage credits appears. Use the card's **Refresh** action once.
4. **Kimi:** sign in at `www.kimi.com`, click **Connect** on Kimi, approve the
   Kimi origin plus `cookies` and `scripting`, and confirm available usage and
   subscription data appears. If session recovery is required during an
   interactive refresh, an inactive Kimi tab may appear. Confirm recovery stops
   waiting for a credential after 10 seconds and attempts best-effort cleanup;
   do not treat delayed cleanup during shutdown or browser API errors as a
   guarantee violation.
5. **Cursor:** sign in at `cursor.com`, click **Connect** on Cursor, approve only
   the Cursor origin, and confirm available monthly model usage and on-demand
   credit data appears. Use the card's **Refresh** action once.
6. Use the header refresh and confirm connected providers retain their previous
   visible data while refreshing. In Settings, turn automatic refresh off and
   on, disconnect one provider, then use **Delete all local data** and confirm
   the cards return to the permission-required state.
