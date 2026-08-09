# Privacy Policy

Last updated: August 9, 2026

AI Limits is a locally running Chrome extension by wjcjttl. This policy
describes version 0.1.0.

AI Limits is an independent project. It is not affiliated with, endorsed by,
or authorized by OpenAI, Anthropic, Moonshot AI, Cursor, or their affiliates.

## Data AI Limits accesses

AI Limits accesses data only after you connect a provider and approve its
optional Chrome permissions. Depending on what that provider returns, the
extension reads and normalizes:

- provider and access status;
- plan, subscription, or organization labels;
- quota-window labels, usage or remaining ratios and amounts, limit units,
  window start times, reset times, and durations;
- credit balances, limits, usage, units, and reset times; and
- refresh timestamps and sanitized success, retry, sign-in, challenge,
  temporary-error, or response-change status.

The extension discards email-shaped account labels and does not query the
current Claude or Cursor email endpoints. It does not read prompts,
conversations, generated responses, or rendered provider page content.

## Browser sessions and provider requests

AI Limits sends read-only requests directly from the extension to the selected
provider's own web-session services. Browser cookies may accompany requests to
that same provider origin. ChatGPT and Kimi access credentials and Claude
organization identifiers may be held in memory long enough to complete the
related collection attempt and request sequence. They are not written to
persistent extension storage or included in saved refresh results.

For Kimi, AI Limits may read the exact `kimi-auth` cookie and the exact
`access_token` entry from a matching Kimi page. It does not read other Kimi
browser-storage entries. During an interactive Connect or Refresh, a rejected
credential may cause AI Limits to create one inactive Kimi homepage tab for up
to 10 seconds. It waits for normal page startup, reads only a changed
`access_token`, retries the usage request once, and closes only the tab it
created. Scheduled refresh never creates a Kimi tab.

While that recovery is active, the extension stores only a generated lease
identifier with the temporary tab ID and creation timestamp in
`chrome.storage.session`. This transient metadata supports cleanup if the
background worker is interrupted; it is removed after recovery or cleanup.

## Local storage and retention

AI Limits stores one application-state record in `chrome.storage.local`. It
contains display and automatic-refresh preferences, provider permission state,
the normalized usage fields listed above, and sanitized refresh-attempt
metadata. It does not contain provider cookies or access credentials.

The local record remains in the current Chrome profile until you disconnect a
provider, choose **Delete all local data**, uninstall the extension, or clear
the extension's browser storage:

- **Disconnect** first revokes that provider's optional access, then deletes
  that provider's saved snapshot and refresh history. If Chrome cannot revoke
  the permission, AI Limits reports failure and keeps the local provider data
  so it does not falsely claim disconnection.
- **Delete all local data** stops refresh work, clears the refresh alarm,
  attempts to revoke every provider permission, removes saved usage, and writes
  a clean default settings record. If any permission cannot be revoked, saved
  usage is still removed and automatic refresh remains off.
- Removing a provider permission in Chrome also causes AI Limits to remove that
  provider's local snapshot and refresh history when the change is observed.

## Automatic refresh

Automatic refresh is enabled in the default settings. A repeating Chrome alarm
is created only when automatic refresh is enabled and at least one provider is
connected. About every 15 minutes, AI Limits checks only providers whose
optional permission is still granted. You can turn automatic refresh off in
Settings at any time.

## Data transfer, sale, and sharing

AI Limits has no developer-operated backend, advertising SDK, analytics, crash
reporting, or telemetry. The extension does not sell personal data and does not
share it with the developer, advertisers, data brokers, or unrelated third
parties. Provider requests go only to the provider service you selected, which
processes those requests under its own terms and privacy policy.

The extension does not log session credentials or saved usage data. Opening a
GitHub link or filing an issue is a separate action you take outside the
extension.

## Limited use

AI Limits uses accessed data only to display and refresh provider usage, report
bounded refresh health, and carry out the user's permission, retention, and
display choices. It does not use or transfer that data for advertising,
profiling outside the extension's single purpose, creditworthiness, lending, or
other unrelated purposes. Because AI Limits has no developer-operated backend,
the developer and other humans cannot read locally stored extension data. A
user may separately choose to disclose information in a support issue.

## Security and limitations

Optional access lets the extension interact with sensitive signed-in provider
sessions. AI Limits minimizes that access and stores normalized results
locally, but no browser extension or local profile is risk-free. Anyone who can
access your unlocked Chrome profile may be able to access extension data.

Provider web-session endpoints are private, unsupported interfaces and may
change or stop working without notice. Provider security controls, account
rules, and policies still apply. See [SECURITY.md](SECURITY.md) for reporting
guidance.

## Contact

Use [GitHub Issues](https://github.com/wjcjttl/ai-limits/issues) for public
privacy questions or requests. Do not include cookies, access credentials,
private usage details, or other secrets in an issue.
