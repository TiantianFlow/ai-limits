# Privacy Policy

Last updated: August 14, 2026

AI Limits is a locally running Chrome extension by TiantianFlow. This policy
describes version 0.3.1.

AI Limits is an independent project. It is not affiliated with, endorsed by,
or authorized by OpenAI, Anthropic, Moonshot AI, Cursor, ElevenLabs, the New
API project, or their affiliates.

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

ChatGPT, Claude, Kimi, and Cursor use signed-in browser sessions. AI Limits
sends read-only requests directly from the extension to those providers' own
web-session services, and browser cookies may accompany requests to the same
provider origin. ChatGPT and Kimi access credentials, the derived ChatGPT
account identifier, and the selected Claude organization UUID and capabilities
may be held in memory long enough to complete the related collection attempt
and request sequence. Those values are not written to persistent extension
storage or included in saved refresh results. The selected Claude organization
name may separately be stored as the visible plan label.

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

## Local storage and retention

AI Limits stores one application-state record in `chrome.storage.local`. It
contains display and automatic-refresh preferences, per-instance nonsecret
configuration such as a normalized New API base URL and label, provider
permission state, the normalized usage fields listed above, History, and
sanitized refresh-attempt metadata. It does not contain provider cookies,
browser-session credentials, or ElevenLabs/New API keys.

ElevenLabs and New API keys are stored separately in chrome.storage.local,
which AI Limits restricts to trusted extension contexts through Chrome's
storage access level. Each New API instance has one separately keyed credential
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
latest observation in each UTC hour. In version 0.3.0, History graphs plot
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
connected. About every 15 minutes, AI Limits checks browser-session providers
whose optional permission is still granted. ElevenLabs additionally requires
its exact API permission and an active saved key. New API requires an active
saved key, normalized instance URL, and the exact runtime host permission for
that instance. A rejected API key stops that provider's scheduled requests
while stale normalized usage and history remain until replacement or deletion.
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
sessions and with the ElevenLabs or New API key you provide. AI Limits minimizes that
access and stores normalized results locally, but no browser extension or local
profile is risk-free. Anyone who can access your unlocked Chrome profile may
be able to access extension data, including the separately saved API key.

Browser-session provider endpoints are private, unsupported interfaces and may
change or stop working without notice. ElevenLabs and New API use documented
endpoints, but their response and authorization behavior can also change. Provider security
controls, account rules, and policies still apply. See
[SECURITY.md](SECURITY.md) for reporting guidance.

## Contact

Use [GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) for public
privacy questions or requests. Never include cookies, access credentials,
private usage details, or other secrets in an issue.
