# Chrome Web Store listing draft

This document describes AI Limits version 0.2.1. It is submission copy and a
review checklist, not a claim that any provider has approved the extension.

## Store configuration

- Category: Productivity
- Primary language: English
- Mature content: No
- Distribution: Public, all regions
- Pricing: Free
- Homepage: https://github.com/TiantianFlow/ai-limits
- Privacy policy: https://github.com/TiantianFlow/ai-limits/blob/main/PRIVACY.md
- Support: https://github.com/TiantianFlow/ai-limits/issues
- Remote hosted code: No

## Artwork inventory and upload order

All artwork is generated from the production side-panel UI with deterministic,
representative fixture data. Upload the files in this order:

1. `store-assets/chrome-web-store/screenshot-overview-1280x800.png` — product
   overview screenshot, 1280×800.
2. `store-assets/chrome-web-store/screenshot-pacing-1280x800.png` — quota,
   timing, and pace screenshot, 1280×800.
3. `store-assets/chrome-web-store/screenshot-history-1280x800.png` — dedicated
   local quota-History screen, 1280×800.
4. `store-assets/chrome-web-store/screenshot-privacy-1280x800.png` — Settings
   and local-data controls screenshot, 1280×800.
5. `store-assets/chrome-web-store/small-promo-440x280.png` — small promotional
   tile, 440×280; upload it to the small promotional tile slot rather than the
   screenshot carousel.

Regeneration and validation instructions are in
[`store-assets/README.md`](store-assets/README.md).

## Single purpose

AI Limits gives a user one Chrome side panel for viewing current subscription
usage as **Used** or **Left**, reset timing, pace, and local quota-history
graphs from five providers. ChatGPT, Claude, Kimi, and Cursor use accounts
already signed in within the user's browser profile; ElevenLabs uses an API key
the user creates and connects through the guided setup.

## Short description

Track ChatGPT, Claude, Kimi, Cursor, and ElevenLabs usage, resets, pace, and local history in one Chrome side panel.

## Detailed description

AI Limits keeps subscription limits visible without switching among provider
account pages. Connect ChatGPT, Claude, Kimi, Cursor, or ElevenLabs
individually, approve that provider's optional access, and view the usage
windows, reset times, credits, and plan labels that the provider makes
available. The first four providers use the signed-in browser session.
ElevenLabs uses a user-created API key and its documented read-only
subscription request.

Providers use different conventions: some report quota consumed, while others
report quota remaining. AI Limits normalizes them into a single display and lets
the user switch between **Used** and **Left** without changing stored data. For
quota windows with a reliable reset time plus either a start time or window
duration, a pace signal compares quota consumed with elapsed time. When that
timing information is unavailable, the extension leaves pace unavailable
instead of estimating it.

Each quota window can open a dedicated History screen with a local quota graph.

ElevenLabs' legacy `character_*` subscription fields are presented as monthly
credits. Voice slots and professional voice slots are shown as current
occupancy/capacity, so deleting a voice can free a slot. Voice add/edit counts
are shown only when the response includes a valid used/maximum pair. AI Limits
does not attach the monthly credit reset or a pace signal to these voice limits
because the response does not provide their own reset boundary. Invoice,
payment-attempt, coupon, payment-identifier, and currency-overage fields are
excluded.

Successful normalized quota observations are stored locally for
up to 30 days, subject to a 1,024-observation per-provider safety cap. Within
that cap, observations from the newest 48 hours are kept at collection
resolution; older retained history keeps only the latest value in each UTC
hour. History begins with one valid locally stored current snapshot on upgrade
or with subsequent successful refreshes. The extension does not reconstruct
earlier provider history and does not store credit-balance history. History is
never transmitted to the developer.

The extension stores normalized results in the local Chrome profile. Refresh
can be manual or automatic about every 15 minutes. ElevenLabs setup opens the
official API-keys page and allows the user to reopen it after signing in. The
guide asks for **User → Read** without generation or write permissions and
validates the real request because ElevenLabs does not formally document the
exact endpoint-to-scope mapping. Once connected, ElevenLabs refreshes in the
background without opening tabs. Settings let the user turn automatic refresh
off, disconnect one provider and remove its saved usage and credential, or
delete all saved usage and credentials while attempting to revoke every
provider permission.

AI Limits is an independent project by TiantianFlow. It is not affiliated with,
endorsed by, or authorized by OpenAI, Anthropic, Moonshot AI, Cursor,
ElevenLabs, or their affiliates. Browser-session provider endpoints are private
and unsupported. ElevenLabs uses a documented endpoint, but provider response
and authorization behavior can still change without notice.

## Permission justifications

### Required permissions

- `storage`: saves display and refresh preferences, provider access state,
  normalized quota/credit snapshots, up to 30 days of quota-only history, and
  sanitized refresh status in `chrome.storage.local`. It also holds temporary
  Kimi tab-cleanup lease metadata in `chrome.storage.session`. Browser-session
  cookies and access credentials are not persisted. After validation, the
  user-created ElevenLabs API key is persisted in a separate
  `chrome.storage.local` credential record whose Chrome storage access level is
  restricted to trusted extension contexts. It is not OS-keychain encrypted
  and may be inspectable from an unlocked Chrome profile, extension DevTools,
  or profile files.
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
- `https://api.elevenlabs.io/*`: sends the user-created API key as the
  `xi-api-key` header only to the read-only subscription request, then
  normalizes monthly credits and supported voice limits. The extension does
  not request `https://elevenlabs.io/*`; the setup page opens as a normal page
  without extension host access.

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

- **Authentication information:** Yes. This includes the ElevenLabs API key
  that the user creates and AI Limits saves locally after successful
  validation. Browser-session JSON, cookies, and access credentials for the
  other providers are handled only for the selected collection sequence and
  are not persisted. The ElevenLabs key is stored in the separate
  trusted-context credential record, sent only to `https://api.elevenlabs.io`,
  and never sent to the developer.
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
  transaction histories are not accessed. The local history feature does not
  retain these credit fields over time.
- **Web history:** No browsing history or list of visited pages is collected or
  retained. During Kimi collection, AI Limits may check for an already-open tab
  matching the exact Kimi origin.
- **User activity:** No clicks, keystrokes, pointer movement, scrolling, or
  general browsing activity is monitored.
- **Health information, personal communications, and location:** No.
- **Sale or unrelated sharing:** No. Data is not sold and is not sent to the
  developer, advertisers, data brokers, or unrelated third parties.
- **Analytics, advertising, telemetry, or remote backend:** None.
- **Retention and controls:** Successful normalized quota observations stay in
  the local Chrome profile for up to 30 days, subject to a 1,024-observation
  per-provider safety cap. Within that cap, observations from the newest 48
  hours stay at collection resolution; older retained history keeps the latest
  value in each UTC hour. Disconnect or permission revocation removes that
  provider's history; **Delete all local data** removes every provider's history
  even if a permission cannot be revoked. Extension uninstall or browser-storage
  clearing also removes the local record. Users can disable automatic refresh
  at any time. A rejected ElevenLabs key stops scheduled ElevenLabs requests
  while stale normalized usage and History remain until replacement or
  deletion. Disconnect, external permission removal, **Delete all local
  data**, uninstall, or clearing extension storage deletes the key. Local
  key/data deletion remains authoritative even if Chrome cannot revoke the
  host permission.
- **Use limitation:** Data is used only to provide the usage dashboard, refresh
  health, permission lifecycle, and user-requested settings. It is not used for
  advertising, credit decisions, or purposes unrelated to the single purpose.

The full policy is in [PRIVACY.md](PRIVACY.md).

## Reviewer prerequisites

- Chrome 116 or newer.
- The validated `ai-limits-0.2.1-chrome.zip` upload artifact.
- Reviewer-owned test accounts signed in to the desired browser-session
  provider sites in the same Chrome profile. ElevenLabs review additionally
  requires the reviewer to create a temporary **User → Read** API key in their
  own account. No credentials or provider accounts are embedded or supplied by
  the extension.
- Network access to the provider origins. Private endpoint behavior and account
  entitlements can affect which usage windows appear.
- After the repository is public and before Chrome Web Store submission, verify
  the homepage, privacy policy, and support URLs are reachable in a signed-out
  browser.

## Five-provider test flow

1. Install the submitted build, or extract the ZIP and load its root as an
   unpacked extension. Pin AI Limits if desired, select its toolbar action, and
   confirm the side panel opens with five permission-required cards.
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
6. **ElevenLabs:** click **Connect ElevenLabs** while signed out if practical.
   Sign in, use **Open API keys page** in the still-open guide, create a key
   named **AI Limits** with **User → Read** and no generation/write scopes,
   paste it, then select **Validate & connect** and approve only
   `https://api.elevenlabs.io/*`. Confirm the plan, monthly credits, and
   available voice limits. Close all ElevenLabs tabs and refresh again; no tab
   should open. If possible, revoke the key at ElevenLabs and confirm AI Limits
   stops scheduled attempts, preserves stale data, and offers **Replace key**.
7. Use the header refresh and confirm connected providers retain their previous
   visible data while refreshing. Open a quota window's **History** action and
   confirm the dedicated screen appears, then confirm a successful refresh adds
   quota history without adding credit history. In Settings, turn automatic
   refresh off and on, disconnect one provider, then use **Delete all local
   data** and confirm the cards return to the permission-required state. For
   ElevenLabs, inspect extension storage after Disconnect and after Delete all
   to confirm its credential record no longer contains a key.
