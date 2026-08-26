# Chrome Web Store listing

This document describes AI Limits version 0.4.3. It is the complete
Chrome Web Store submission pack, including the paste-ready listing copy
and the reviewer reference material. It is not a claim that any provider
has approved the extension.

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
[`store-assets/README.md`](../README.md).

## Single purpose

AI Limits gives a user one Chrome side panel for viewing current subscription
usage as **Used** or **Left**, reset timing, pace, and local quota-history
graphs across twenty supported providers (see the supported-providers document
for the full roster). Browser-session providers use an account already signed in within the
user's browser profile; API-key providers use a key the user connects through
guided setup.

## Short description

Track subscription usage, resets, pace, and local history for your connected AI providers in one Chrome side panel.

## Detailed description

AI Limits puts your AI subscription usage in one place, right in Chrome's side
panel — no more opening a separate account page for each provider just to
check whether you're about to hit a limit.

Connect the providers you use, one at a time. Each one shows its usage windows,
reset times, credits, and plan at a glance. Switch between **Used** and
**Left**, whichever view makes more sense to you. For quota windows with a
reliable reset time plus either a start time or window duration, a pace signal
compares quota consumed with elapsed time.

Every quota window can open its own local History screen, so you can see how
your usage has trended over time, right on your device.

**ChatGPT** and **Claude** show your plan, usage windows, resets, and available
credits straight from your signed-in account. **Kimi** reads your usage and
subscription status directly, with a brief, visible recovery step if your
session ever needs refreshing. **Cursor** shows monthly Cursor-model and
Other-model limits plus weekly Grok Bot usage, and a per-model included-usage
breakdown grouped into Cursor Models and Other Models with input, output, cost,
and provider totals. That detail view is a generic per-provider surface; today
only Cursor fills it. **Grok** reads your signed-in consumer plan and
weekly or monthly usage pool; short per-mode windows are not shown.
**Mistral** shows month-to-date spend and available credits,
while **Perplexity** shows recurring, purchased, and promotional credit pools.
**ElevenLabs** connects with a scoped, read-only API key you create yourself.
**New API** connects self-hosted or third-party API-compatible instances with a
key you provide. AI Limits supports multiple independent New API instances,
including multiple separately labeled keys on the same origin.
**LiteLLM**, **ClawRouter**, **sub2api**, and **LLM Proxy** connect configurable
instances with a key you provide. **DeepSeek** and **Moonshot** show developer
platform balances, **DeepInfra** shows monthly spend against a limit or its
reported balance, and **Fireworks** shows rated spend over the last 30 days.
**OpenAI** reads the Platform organization and developer billing surface
(organization costs and completion usage, with a credit-grants fallback),
**GroqCloud** shows five-minute usage rates, and **OpenRouter** shows credits and
an optional key budget.

The side panel supports English and Simplified Chinese. It follows Chrome when
Chrome is set to one of those languages, and falls back to English for other
Chrome languages. Settings can pin English or Simplified Chinese for this panel.
Chrome's own menus and the extension name stay in Chrome's language.

AI Limits keeps everything local: your usage history stays on your device and
is never sent anywhere else. No ads, no AI Limits account to create, no
analytics or telemetry.

AI Limits is an independent project by TiantianFlow. It is not affiliated with,
endorsed by, or authorized by any of the connected service providers, their
parent companies, or their affiliates.

## Permission justifications

### Required permissions

- `storage`: saves display, language, and refresh preferences, provider access state,
  normalized quota/counter/balance snapshots, up to 30 days of typed
  per-instance History, and sanitized refresh status in
  `chrome.storage.local`. It also holds temporary Kimi and Cursor tab-cleanup
  lease metadata in `chrome.storage.session`. Browser-session cookies and access
  credentials are not persisted. After validation, the user-created ElevenLabs
  or New API key is persisted in a separate `chrome.storage.local` credential
  record whose Chrome storage access level is restricted to trusted extension
  contexts. The same boundary applies to every validated provider API key. It
  is not OS-keychain encrypted and may be inspectable from an
  unlocked Chrome profile, extension DevTools, or profile files.
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
- `https://cursor.com/*`: reads the signed-in user's base Cursor usage. During
  Connect or manual Refresh only, it can also run bundled read-only code in one
  already-open exact-origin page, or briefly open one inactive spending tab if
  none is open, to request Grok Bot, credit-grant, and aggregated included-usage
  JSON.
- `https://grok.com/*`: reads the signed-in user's Grok session, rate-limit, and
  subscription responses. This is consumer Grok on grok.com, not Cursor's Grok Bot.
- `https://admin.mistral.ai/*` and `https://console.mistral.ai/*`: read
  month-to-date usage and credits from the signed-in Mistral session.
- `https://www.perplexity.ai/*`: reads credit pools from the signed-in
  Perplexity session.
- `https://api.elevenlabs.io/*`: sends the user-created API key as the
  `xi-api-key` header only to the read-only subscription request, then
  normalizes monthly credits and supported voice limits. The extension does
  not request `https://elevenlabs.io/*`; the setup page opens as a normal page
  without extension host access.
- `https://api.deepseek.com/*`, `https://api.moonshot.ai/*`,
  `https://api.deepinfra.com/*`, `https://api.fireworks.ai/*`,
  `https://api.openai.com/*`, `https://api.groq.com/*`, and
  `https://openrouter.ai/*`: send the selected provider's saved key only to its
  fixed read-only balance, usage, metrics, or billing endpoints.
- `https://*/*`: optional dynamic host capability for New API, LiteLLM,
  ClawRouter, sub2api, and LLM Proxy instances. The extension never requests
  this wildcard at runtime; after URL normalization, Chrome is asked only for
  that instance's exact HTTPS origin.
- `http://localhost/*` and `http://127.0.0.1/*`: optional dynamic capability
  for local New API development. Runtime permission remains limited to the
  exact localhost origin and port entered by the user. Public HTTP origins are
  rejected.

### Optional API permissions

- `cookies`: requested only with Kimi access; reads only Kimi's exact legacy
  `kimi-auth` cookie when available. This is checked before Kimi page storage.
- `scripting`: requested with Kimi or Cursor access. For Kimi, it reads only
  the exact `access_token` browser-storage entry from an already-open or
  recovery-created matching Kimi page. If a credential is missing or rejected,
  interactive recovery may create one inactive Kimi homepage tab. Recovery
  stops waiting for a credential after 10 seconds and attempts best-effort
  cleanup of only its owned tab; shutdown or browser API errors can delay or
  prevent cleanup. For Cursor, Connect or manual Refresh can run a bundled
  exact-origin function in one already-open `cursor.com` page. If none is open,
  that interactive path may create one inactive
  `https://cursor.com/dashboard/spending` tab, wait up to 10 seconds, and close
  only the tab it created. It never activates a tab and never closes a tab the
  user opened. That function sends POST requests with the fixed `{}` body only
  to the Grok Bot, credit-grant, and aggregated-usage dashboard endpoints,
  returns only their JSON, and does not inspect rendered content, browser
  storage, or cookie values directly. Chrome attaches the signed-in Cursor
  cookies to those same-origin requests. Scheduled refresh never opens or
  injects into a Cursor page.

The manifest does not request the broad `tabs` permission. Scheduled refresh
does not create or activate provider tabs and never injects into provider pages.

## Data-disclosure answers

- **Authentication information:** Yes. This includes provider API keys that
  the user creates and AI Limits saves locally after successful
  validation. Browser-session JSON, cookies, and access credentials for the
  other providers are handled only for the selected collection sequence and
  are not persisted. API keys are stored in the separate
  trusted-context credential record, sent only to the selected provider API,
  and never sent to the developer.
- **Website content:** Yes. AI Limits handles private provider session, usage,
  subscription, and organization-response JSON plus Kimi's exact
  `access_token` browser-storage entry and Cursor's manual page-context
  dashboard JSON responses (Grok Bot, credit-grant, and aggregated included
  usage). It does not read rendered page text, prompts,
  conversations, or generated responses.
- **Account identifiers and personally identifiable information:** Yes,
  narrowly handled. A ChatGPT account identifier derived from the access
  credential and a Claude organization UUID/capabilities are request-local and
  not persisted. A Claude organization name may be normalized and stored as the
  visible plan label. Email-shaped account labels are discarded, and current
  adapters do not query Claude or Cursor email endpoints.
- **Financial and payment information:** Yes, limited to provider-reported
  usage-credit balances, extra-usage amounts or limits, and on-demand spend
  values/limits included in a usage response. These normalized counters and
  balances may be retained in local per-instance History. Payment cards, bank
  details, raw provider responses, and transaction histories are not accessed
  or retained.
- **Web history:** Yes, narrowly and conservatively classified. During Kimi
  collection, AI Limits may check for an already-open tab matching the exact
  Kimi origin. During Cursor Connect or manual Refresh, it may check for one
  already-open tab matching the exact Cursor origin. This reveals only whether
  that fixed provider-origin tab is currently open, is used locally for the
  requested provider operation, and is never retained, transmitted, or
  assembled into a list of visited pages. AI Limits does not query arbitrary
  page URLs, titles, or Chrome browsing history.
- **User activity:** No clicks, keystrokes, pointer movement, scrolling, or
  general browsing activity is monitored.
- **Health information, personal communications, and location:** No.
- **Sale or unrelated sharing:** No. Data is not sold and is not sent to the
  developer, advertisers, data brokers, or unrelated third parties.
- **Analytics, advertising, telemetry, or remote backend:** None.
- **Retention and controls:** Successful normalized quota, counter or spend, and
  balance observations are retained per instance; History graphs quota metrics,
  while counter or spend and balance observations remain stored but ungraphed.
  Successful normalized quota, counter/spend, and
  balance observations stay in the local Chrome profile per instance for up to
  30 days, subject to a 1,024-observation per-instance safety cap. Within that
  cap, observations from the newest 48 hours stay at collection resolution;
  older retained History keeps the latest value in each UTC hour. Disconnect
  removes that instance's key/configuration/usage/History before best-effort
  permission cleanup; **Delete all local data** removes every instance even if
  a permission cannot be revoked. External permission removal instead retains
  instance data and saved keys but marks affected instances permission-required.
  Extension uninstall or browser-storage clearing removes the local records.
  Users can disable automatic refresh at any time. A rejected API key stops
  that instance's scheduled requests while stale normalized usage and History
  remain until replacement or deletion.
- **Use limitation:** Data is used only to provide the usage dashboard, refresh
  health, permission lifecycle, and user-requested settings. It is not used for
  advertising, credit decisions, or purposes unrelated to the single purpose.

The full policy is in [PRIVACY.md](../../PRIVACY.md).

## Reviewer prerequisites

- Chrome 116 or newer.
- The validated `ai-limits-0.4.3-chrome.zip` upload artifact.
- Reviewer-owned test accounts signed in to the desired browser-session
  provider sites in the same Chrome profile, plus temporary reviewer-created
  keys for each API-key provider under test. ElevenLabs should use
  **User → Read**. No credentials or provider accounts are embedded or supplied
  by the extension.
- Network access to the provider origins. Private endpoint behavior and account
  entitlements can affect which usage windows appear.
- After the repository is public and before Chrome Web Store submission, verify
  the homepage, privacy policy, and support URLs are reachable in a signed-out
  browser.

## Twenty-provider test flow

1. Install the submitted build, or extract the ZIP and load its root as an
   unpacked extension. Pin AI Limits if desired, select its toolbar action, and
   confirm First Run opens with twenty opt-in provider rows and no prefilled usage.
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
5. **Cursor:** sign in at `cursor.com`. You do **not** need to leave a Cursor
   tab open. Click **Connect** on Cursor and approve the Cursor origin plus
   `scripting`. Confirm monthly Cursor-model and Other-model limits plus weekly
   Grok Bot usage may appear, along with a detail view of included usage grouped
   into Cursor Models and Other Models (input, output, cost, and provider
   totals). If no `cursor.com` tab was already open, one inactive
   `https://cursor.com/dashboard/spending` tab may appear, be read, and close;
   confirm it is never activated and that no tab the reviewer opened is closed.
   Use the card's **Refresh** action once with a Cursor tab already open and
   confirm the existing tab is reused rather than a second tab being created.
   Then close all Cursor tabs and start a **scheduled** cycle (or wait for
   automatic refresh): base monthly/on-demand usage should remain available,
   no Cursor tab should open, and no page injection should occur. Previously
   collected Grok Bot, extra-credit, and detail values may remain visible as
   earlier page values until Grok Bot's weekly reset, and the card should
   explain why they were not refreshed.
6. **Grok:** sign in at `grok.com`, click **Connect** on Grok, approve only the
   Grok origin, and confirm a SuperGrok-family or Free plan plus the reported
   query window appears. Use the card's **Refresh** action once. No extra
   `cookies` or `scripting` permission should be requested.
7. **Mistral:** sign in at `admin.mistral.ai`, click **Connect** on Mistral,
   approve only the Mistral origins, and confirm month-to-date spend and any
   available credits. Record whether the service accepts the request without an
   `X-CSRFTOKEN` header.
8. **Perplexity:** sign in at `www.perplexity.ai`, click **Connect** on
   Perplexity, approve only that origin, and confirm recurring, purchased, and
   promotional credit pools.
9. **ElevenLabs:** click **Connect ElevenLabs** while signed out if practical.
   Sign in, use **Open API keys page** in the still-open guide, create a key
   named **AI Limits** with **User → Read** and no generation/write scopes,
   paste it, then select **Validate & connect** and approve only
   `https://api.elevenlabs.io/*`. Confirm the plan, monthly credits, and
   available voice limits. Close all ElevenLabs tabs and refresh again; no tab
   should open. If possible, revoke the key at ElevenLabs and confirm AI Limits
   stops scheduled attempts, preserves stale data, and offers **Replace key**.
10. **New API:** click **Connect New API** twice, use two nonpersonal labels, and
   connect two reviewer-controlled keys for the same origin (a site URL or a
   `/v1/messages` URL is accepted). Confirm onboarding normalizes each URL,
   Chrome asks only for that exact origin, both independent cards appear, and
   each shows its own capped quota or unlimited-key absolute usage. Refresh and
   replace one without changing the other. Confirm no provider tab opens.
   Disconnect one and confirm the sibling plus shared grant remain; disconnect
   the final owner and confirm permission cleanup. Reconnect both, remove the
   origin permission externally, and confirm both become permission-required
   while nonsecret configuration, normalized usage, refresh state, and History
   remain. Account wallet, subscriptions, admin data, and other keys remain out
   of scope.
11. **LiteLLM:** connect a reviewer-controlled instance and virtual key. Confirm
   `/key/info` spend appears, with a budget quota only when `max_budget` is
   reported, and no user/team follow-up requests occur.
12. **ClawRouter:** connect a reviewer-controlled instance and policy key.
    Confirm monthly remaining budget appears for metered policies, otherwise
    this-month actual cost appears.
13. **sub2api:** connect a reviewer-controlled HTTPS instance and group key.
    Confirm the available key, subscription-window, balance, and optional
    rate-limit metrics reported by `/v1/usage?days=30&timezone=UTC`.
14. **LLM Proxy:** connect a reviewer-controlled instance and API key. Confirm
    the lowest remaining credential quota percent, or request/token counters
    when no remaining percent is reported.
15. **DeepSeek:** connect a temporary key, approve only
    `https://api.deepseek.com/*`, and confirm the reported account balance.
16. **Moonshot:** connect an international-platform key, approve only
    `https://api.moonshot.ai/*`, and confirm the available USD balance.
17. **DeepInfra:** connect a temporary key, approve only
    `https://api.deepinfra.com/*`, and confirm current-month spend against its
    spending limit, or the provider-reported balance when no limit is present.
18. **Fireworks:** connect a temporary key with exactly one accessible account,
    approve only `https://api.fireworks.ai/*`, and confirm rated spend over the
    last 30 days.
19. **OpenAI:** connect a temporary key, approve only
    `https://api.openai.com/*`, and confirm organization costs/completion usage
    or the legacy available-credit fallback. Note any required organization or
    project scope.
20. **GroqCloud:** connect a temporary key, approve only
    `https://api.groq.com/*`, and confirm Prometheus rates when the key has the
    required scope. A standard key returning 404 should show a scope-required
    state.
21. **OpenRouter:** connect a temporary key, approve only
    `https://openrouter.ai/*`, and confirm credit balance plus key budget when
    reported.
22. Use the header refresh and confirm connected providers retain their previous
   visible data while refreshing. Open a quota window's **History** action and
   confirm the dedicated screen appears, then confirm a successful refresh adds
   quota history while counter/spend and balance samples remain ungraphed. From a
   provider detail screen, Disconnect asks for confirmation before deleting
   credentials, configuration, usage, and history. In Settings, turn automatic
   refresh off and on, disconnect one provider after confirming the same
   deletion, then use **Delete all local data** and confirm the cards return to
   the permission-required state. For
   API-key providers, inspect extension storage after Disconnect and after
   Delete all to confirm the credential record no longer contains a key.
