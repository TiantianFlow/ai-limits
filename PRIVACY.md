# Privacy Policy

Last updated: August 26, 2026

AI Limits is a locally running Chrome extension by TiantianFlow. This policy
describes version 0.4.3.

AI Limits is an independent project. It is not affiliated with, endorsed by,
or authorized by any supported provider, its parent company, or its affiliates.

## Data AI Limits accesses

AI Limits accesses data only after you connect a provider and approve its
optional Chrome permissions. Depending on what that provider returns, the
extension reads and normalizes:

- provider and access status;
- plan, subscription, or organization labels;
- quota labels, usage or remaining ratios and amounts, limit units, window
  start times, reset times, durations, and segments;
- cumulative counters or spend with their value, semantic, unit, optional
  limit, and cycle;
- remaining balances with their value, unit, optional original limit, and
  cycle;
- per-instance History made from successful normalized observations of those
  quota, counter/spend, and balance fields; and
- refresh timestamps and sanitized success, retry, sign-in, challenge,
  temporary-error, or response-change status.

The extension also handles provider session, usage, subscription, and
organization-response JSON in memory. A ChatGPT account identifier derived
from its access credential and the selected Claude organization UUID and
capabilities are request-local and are not persisted. A Claude organization
name may be normalized and stored as the visible plan label. The extension
discards email-shaped account labels and does not query the current Claude or
Cursor email endpoints. For ElevenLabs, the extension retains only normalized
monthly credit and voice-capacity fields from the subscription response; it
does not retain invoices, payment attempts, coupons, payment identifiers, or
currency overage fields. It does not read prompts, conversations, generated
responses, or rendered provider page content.

For each New API instance, the extension retains an opaque instance ID, the
normalized base URL, optional user label, relay-key name, instance display
name, independent access/refresh state, and key-specific granted, used, and
remaining quota. Unlimited keys retain an absolute consumed counter without an
invented limit or ratio. It does not retain model-limit maps or key expiry as a
quota reset and does not read account wallet, subscriptions, usage logs, admin
data, or other relay keys.

## Provider authentication and requests

ChatGPT, Claude, Kimi, Cursor, Grok, Mistral, and Perplexity use signed-in
browser sessions. AI Limits sends read-only requests to those providers' own
web-session services, and browser cookies may accompany requests to the same
provider origin. Requests normally run directly from the extension; the Cursor
and Grok page-origin reads described below run in an already-open exact-origin
page or, if none is open during Connect or manual Refresh, in one inactive tab
created for that attempt. ChatGPT
and Kimi access credentials, the derived ChatGPT account identifier, and the
selected Claude organization UUID and capabilities may be held in memory long
enough to complete the related collection attempt and request sequence. Those
values are not written to persistent extension storage or included in saved
refresh results. The selected Claude organization name may separately be
stored as the visible plan label.

For Kimi, AI Limits checks the exact legacy `kimi-auth` cookie first, then the
exact `access_token` entry from an already-open matching Kimi page. It does not
read other Kimi browser-storage entries. During an interactive Connect or
Refresh, either a missing credential or a credential rejected by Kimi may
cause AI Limits to create one inactive Kimi homepage tab. Recovery has a
10-second deadline for obtaining a credential. When recovery finishes or times
out, the extension attempts best-effort cleanup of only the tab and lease it
owns; browser shutdown or API errors can delay or prevent cleanup. Scheduled
refresh never creates a Kimi tab.

While that recovery is active, the extension stores only a generated lease
identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted. AI Limits attempts to remove it when
recovery finishes and also performs best-effort abandoned-lease cleanup when
the background worker starts.

For Grok, grok.com rejects extension-background session and usage requests
when the Origin is not `https://grok.com`. AI Limits therefore does not fetch
grok.com from the extension worker. It checks for one already-open tab matching
`https://grok.com/*` and uses the optional `scripting` permission to run a
bundled function in that page's main JavaScript world. During Connect or an
explicit manual Refresh only, if none exists, the same path may create one
inactive `https://grok.com/` tab. That create-wait-read path has a 10-second
deadline. When it finishes or times out, the extension attempts best-effort
cleanup of only the tab and lease it owns; browser shutdown or API errors can
delay or prevent cleanup. The function verifies the exact `https://grok.com`
origin, sends the signed-in session, usage-pool, subscription, and chat-mode
rate-limit requests, and returns only those responses for schema validation in
the extension context. It does not read rendered page content, local or session
storage, or cookie values directly. Chrome does attach the signed-in Grok
cookies to these fixed same-origin requests. AI Limits never activates a Grok
tab. Scheduled refresh may inject into an already-open grok.com tab and never
opens a new one. Raw page-probe bodies are request-local and are not persisted.

While that owned Grok tab is active, the extension stores only a generated lease
identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted. AI Limits attempts to remove it when the
owned tab is released and also performs best-effort abandoned-lease cleanup
when the background worker starts.

For Cursor, the base monthly and on-demand request runs from the extension.
During Connect or an explicit manual Refresh only, AI Limits checks for one
already-open tab matching `https://cursor.com/*`. If one exists, it uses the
optional `scripting` permission to run a bundled function in that page's main
JavaScript world. If none exists, the same interactive path may create one
inactive `https://cursor.com/dashboard/spending` tab. That create-wait-read
path has a 10-second deadline. When it finishes or times out, the extension
attempts best-effort cleanup of only the tab and lease it owns; browser
shutdown or API errors can delay or prevent cleanup. The function verifies the
exact `https://cursor.com` origin, sends POST requests with the fixed `{}`
body only to the Grok Bot, credit-grant, and aggregated-usage dashboard
endpoints, and returns only their JSON responses for schema validation in the
extension context. It
does not read rendered page content, local or session storage, or cookie
values directly. Chrome does attach the signed-in Cursor cookies to these
fixed same-origin requests. AI Limits never activates a Cursor tab. Scheduled
refresh never queries for, opens, or injects into a Cursor page. Page-only
Grok Bot and extra-credit metrics are refreshed only by Connect or manual
Refresh; last-good normalized values may remain visible until Grok Bot's
weekly reset. Raw dashboard JSON is request-local and is not persisted.

While that owned Cursor tab is active, the extension stores only a generated
lease identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted. AI Limits attempts to remove it when the
owned tab is released and also performs best-effort abandoned-lease cleanup
when the background worker starts.

For conservative Chrome Web Store disclosure, AI Limits classifies its
current-tab exact-provider-origin checks as **Web history** access. For Kimi,
Cursor, and Grok, the extension learns only whether a tab at that fixed
provider origin is currently open so it can complete the user-requested
provider operation.
This open-state result is used locally for that attempt and is never retained,
transmitted, or assembled into a list of visited pages.

ElevenLabs uses a user-created API key and its documented public subscription
API instead of a browser-session credential. The guided connection opens the
official API-keys page as a normal page; the extension does not inspect it. The
guide recommends **User → Read** without generation or write permissions, but
ElevenLabs does not formally document the exact endpoint-to-scope mapping. AI
Limits therefore validates the real read-only subscription request and never
enables broader scopes for the user.

AI Limits sends the saved key only to https://api.elevenlabs.io as the
xi-api-key header for the read-only subscription request. It is not sent to
the developer or any other provider. Only the user's explicit setup or reopen
action opens the ElevenLabs API-keys page; manual and scheduled refresh do not
open or inspect provider tabs.

Each New API instance uses a user-provided URL and relay key rather than a
browser session. AI Limits removes recognized console and API suffixes,
validates the normalized base URL with its public `/api/status` response, then
sends that instance's key as an Authorization Bearer header only to the same
base URL's read-only `/api/usage/token/` endpoint. The request AI Limits makes
is read-only, but the relay key itself may still authorize model calls; AI
Limits cannot reduce the key's server-side authority. Multiple instances,
including same-origin instances with different keys and labels, remain
independent. AI Limits does not use management PAT or admin APIs.

LiteLLM, ClawRouter, sub2api, and LLM Proxy also use a user-provided instance
URL and API key. AI Limits sends the key only to the same normalized instance
origin for the read-only `/key/info`, `/v1/usage`,
`/v1/usage?days=30&timezone=UTC`, or `/v1/quota-stats` request associated with
the selected provider. Each configured instance keeps independent
credentials, nonsecret configuration, normalized usage, and History.

DeepSeek, Moonshot, DeepInfra, Fireworks, OpenAI, GroqCloud, and OpenRouter use
user-created API keys at fixed provider API origins. OpenAI here is the
Platform organization and developer billing API, not the ChatGPT consumer
session. AI Limits sends those keys
only to
`api.deepseek.com/user/balance`, `api.moonshot.ai/v1/users/me/balance`,
DeepInfra's `api.deepinfra.com/payment/checklist` and `/payment/usage`
endpoints, Fireworks' `api.fireworks.ai/v1/accounts` and selected-account
`/billing/summary` endpoint, OpenAI's organization cost and completion-usage
endpoints or legacy credit-grants fallback, GroqCloud's Prometheus query
endpoint, or OpenRouter's `/api/v1/credits` and `/api/v1/key` endpoints. These
read-only responses are normalized into balance, quota, counter, or spend
metrics; raw provider responses are not persisted.

## Local storage and retention

AI Limits stores one application-state record in `chrome.storage.local`. It
contains display, language, and automatic-refresh preferences, per-instance nonsecret
configuration such as a normalized configurable-provider base URL and label, provider
permission state, the normalized usage fields listed above, History, and
sanitized refresh-attempt metadata. It does not contain provider cookies,
browser-session credentials, or API keys.

API keys are stored separately in chrome.storage.local,
which AI Limits restricts to trusted extension contexts through Chrome's
storage access level. Each configured instance has one separately keyed credential
record; same-origin instances never share it. Ordinary websites, other
extensions, and this extension's content scripts cannot read that record
through Chrome extension APIs. The saved key is not OS-keychain encrypted and
may be inspectable by someone with access to the unlocked Chrome profile,
extension DevTools, or profile files. The saved key is never included in usage
state, History, screenshots, reports, logs, analytics, or a developer backend.

Disconnect, Delete all local data, uninstall, or clearing extension storage
deletes the saved API key. If Chrome cannot revoke a final-owner host
permission, local instance deletion remains authoritative and durable cleanup
evidence is retained for retry.

Successful normalized quota, counter or spend, and balance observations are
stored per instance for up to 30 days, subject to a 1,024-observation
per-instance safety cap. Within that cap, the newest 48 hours remain at
collection resolution and older retained observations are compacted to the
latest observation in each UTC hour. History graphs plot
quota metrics only; counter or spend and balance observations remain stored but
are not graphed. Currency-denominated spend counters and balances are
normalized usage data, not raw payment transaction history. History never
stores credentials or raw provider responses. Failed, deferred, skipped, or
malformed refresh results do not add observations.
When existing extension state is upgraded for this feature, one valid normalized
current snapshot can become the first observation at its original `fetchedAt`
time. The extension does not query a provider to reconstruct or backfill any
earlier history.

The local records remain in the current Chrome profile until you disconnect an
instance, choose **Delete all local data**, uninstall the extension, or clear
the extension's browser storage. Those actions delete affected saved API keys.
External permission removal does not delete instance data or saved API keys;
it prevents their use until access is restored or the instance is explicitly
disconnected/deleted. A successful **Replace key** overwrites only that
instance's prior key after the new key validates; a failed replacement leaves
the prior key unchanged.

- **Disconnect** invalidates active work and unconditionally deletes that
  instance's saved credential, nonsecret configuration, snapshot, History, and
  refresh-attempt metadata before separately attempting permission cleanup.
  Disconnect deletes that instance's credential, configuration, usage, refresh
  status, and History before permission cleanup; a shared origin remains
  granted while another active instance owns it, and final-owner removal is
  best-effort with durable retry evidence. If Chrome cannot revoke the final
  permission, local deletion remains authoritative and the extension reports
  and retries that cleanup problem.
- **Delete all local data** stops refresh work, clears the refresh alarm,
  attempts to revoke every provider permission, removes saved usage, and writes
  a clean default settings record with no History. It also deletes the
  credential record. If any permission cannot be revoked, local usage,
  credentials, and History are still removed, affected providers remain
  locally suppressed, and automatic refresh remains off.
- Externally removing a permission marks every affected instance
  permission-required while retaining its nonsecret configuration, normalized
  usage, refresh status, and History. Saved API keys also remain stored but are
  not used without permission. Active work is invalidated immediately. If the
  background worker is asleep, startup reconciliation applies the same access
  state. Reconnect can restore access; explicit Disconnect/Delete all performs
  the deletion lifecycle above.

## Automatic refresh

Automatic refresh is enabled in the default settings. A repeating Chrome alarm
is created only when automatic refresh is enabled and at least one provider is
connected. About every 15 minutes, AI Limits checks providers whose optional
permission is still granted. Cursor automatic refresh collects base monthly and
on-demand usage only and never injects into a page. API-key providers
additionally require an active saved key; configurable-origin providers also
require a normalized instance URL and exact runtime host permission. A rejected
API key stops that provider's scheduled requests while stale normalized usage
and history remain until replacement or deletion.
You can turn automatic refresh off in Settings at any time.

## Data transfer, sale, and sharing

AI Limits has no developer-operated backend, advertising SDK, analytics, crash
reporting, or telemetry. The extension does not sell personal data and does not
share it with the developer, advertisers, data brokers, or unrelated third
parties. Provider requests go only to the provider service you selected, which
processes those requests under its own terms and privacy policy.

History remains in the local Chrome profile and is never transmitted to
the developer.

The extension does not log session credentials or saved usage data. Opening a
support link or filing an issue is a separate action you take outside the
extension.

## Limited use

AI Limits complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

AI Limits uses accessed data only to display and refresh provider usage, report
bounded refresh health, and carry out the user's permission, retention, and
display choices. It does not use or transfer that data for advertising,
profiling outside the extension's single purpose, creditworthiness, lending, or
other unrelated purposes. Because AI Limits has no developer-operated backend,
the developer and other humans cannot read locally stored extension data. A
user may separately choose to disclose information in a support issue.

## Security and limitations

Optional access lets the extension interact with sensitive signed-in provider
sessions and with API keys you provide. AI Limits minimizes that access and
stores normalized results locally, but no browser extension or local profile
is risk-free. Anyone who can access your unlocked Chrome profile may be able to
access extension data, including separately saved API keys.

Browser-session provider endpoints are private, unsupported interfaces and may
change or stop working without notice. API-key providers use documented or
reverse-engineered HTTP endpoints, but their response and authorization
behavior can also change. Provider security controls, account rules, and
policies still apply. See
[SECURITY.md](SECURITY.md) for reporting guidance.

## Contact

Use [GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) for public
privacy questions or requests. Never include cookies, access credentials,
private usage details, or other secrets in an issue.
