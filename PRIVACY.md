# Privacy Policy

Last updated: August 12, 2026

AI Limits is a locally running Chrome extension by TiantianFlow. This policy
describes version 0.2.3.

AI Limits is an independent project. It is not affiliated with, endorsed by,
or authorized by OpenAI, Anthropic, Moonshot AI, Cursor, ElevenLabs, the New
API project, or their affiliates.

## Data AI Limits accesses

AI Limits accesses data only after you connect a provider and approve its
optional Chrome permissions. Depending on what that provider returns, the
extension reads and normalizes:

- provider and access status;
- plan, subscription, or organization labels;
- quota-window labels, usage or remaining ratios and amounts, limit units,
  window start times, reset times, and durations;
- quota history made from successful normalized observations of those
  quota-window fields;
- credit balances, limits, usage, units, and reset times; and
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

For New API, the extension retains the normalized instance URL, relay-key
name, instance display name, and key-specific granted, used, and remaining
quota. Unlimited keys retain absolute used quota without an invented limit or
ratio. It does not retain model-limit maps or key expiry as a quota reset and
does not read account wallet, subscriptions, usage logs, or admin data.

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

New API uses a user-provided instance URL and relay key rather than a browser
session. AI Limits removes recognized console and API suffixes, validates the
normalized instance with its public `/api/status` response, then sends the key
as an Authorization Bearer header only to that same instance's read-only
`/api/usage/token/` endpoint. The request AI Limits makes is read-only, but the
relay key itself may still authorize model calls; AI Limits cannot reduce the
key's server-side authority. Current support is limited to one instance and
one relay key and does not use management PAT or admin APIs.

## Local storage and retention

AI Limits stores one application-state record in `chrome.storage.local`. It
contains display and automatic-refresh preferences, provider permission state,
the normalized usage fields listed above, and sanitized refresh-attempt
metadata. It does not contain provider cookies, browser-session credentials,
or the ElevenLabs or New API key. The normalized New API instance URL is stored
with its key in the separate credential record.

ElevenLabs and New API keys are stored separately in chrome.storage.local, which AI
Limits restricts to trusted extension contexts through Chrome's storage access
level. Ordinary websites, other extensions, and this extension's content
scripts cannot read that record through Chrome extension APIs. The saved key
is not OS-keychain encrypted and may be inspectable by someone with access to
the unlocked Chrome profile, extension DevTools, or profile files. The saved
key is never included in usage state, quota history, screenshots, reports,
logs, analytics, or a developer backend.

Successful normalized quota observations are stored locally for up to 30 days,
subject to a 1,024-observation per-provider safety cap. Within that cap,
observations from the newest 48 hours are kept at collection resolution. Older
retained history is compacted to the latest observation in each UTC hour until
it ages out. This history contains quota-window usage only: it does not retain
credit balances, limits, usage, or reset times. Failed, deferred, skipped, or
malformed refresh results do not add observations.
When existing extension state is upgraded for this feature, one valid normalized
current snapshot can become the first observation at its original `fetchedAt`
time. The extension does not query a provider to reconstruct or backfill any
earlier history.

The local records remain in the current Chrome profile until you disconnect a
provider, choose **Delete all local data**, uninstall the extension, or clear
the extension's browser storage. Disconnect, external permission removal,
Delete all local data, uninstall, or clearing extension storage deletes the
saved API key. A successful **Replace key** overwrites the prior key
only after the new key validates; a failed replacement leaves the prior key
unchanged.

- **Disconnect** invalidates active work and unconditionally deletes that
  provider's saved credential, snapshot, quota history, and refresh-attempt
  history before separately attempting permission cleanup. If Chrome cannot
  revoke the host permission, local key and usage deletion remains
  authoritative; the provider stays locally suppressed until explicit
  reconnect or later successful permission removal. The extension also reports
  that cleanup problem.
- **Delete all local data** stops refresh work, clears the refresh alarm,
  attempts to revoke every provider permission, removes saved usage, and writes
  a clean default settings record with no quota history. It also deletes the
  credential record. If any permission cannot be revoked, local usage,
  credentials, and quota history are still removed, affected providers remain
  locally suppressed, and automatic refresh remains off.
- An exact provider-permission removal event first invalidates that provider's
  active refresh and unconditionally clears its local credential, snapshot,
  quota history, and refresh-attempt history. Only then does AI Limits sample
  authoritative permission state to set the final access flag. A rapid regrant
  can therefore restore browser-session access, but it cannot restore deleted
  usage history or a saved API key.
  If permission is revoked while the background worker is asleep, the next
  reconciliation clears data when a stored grant is authoritatively absent; it
  also clears any legacy permission-required record that still contains a
  snapshot or history. Empty never-connected permission-required records remain
  unchanged.

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

Quota history remains in the local Chrome profile and is never transmitted to
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
