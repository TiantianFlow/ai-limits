# Security Policy

## Supported version

Security fixes are made against the current source and latest 0.2.x release.
Older development builds may not receive separate fixes.

## Report a vulnerability

Never include session cookies, access credentials, private usage data, or
account-identifying screenshots in a public report.

Use [GitHub Issues](https://github.com/TiantianFlow/ai-limits/issues) for ordinary,
non-sensitive security concerns. If GitHub private vulnerability reporting is
available in the repository's **Security** tab, use it for sensitive reports.
If that feature is unavailable, open a minimal issue requesting a private
contact route without disclosing the vulnerability or sensitive details.

Include the affected version, browser version, expected behavior, actual
behavior, and a minimal reproduction that contains no real credentials.

## Security boundary

AI Limits runs inside the user's Chrome profile and uses optional access to
signed-in provider origins or, for ElevenLabs, its exact API origin. It stores
normalized usage locally and does not operate a remote backend. Browser-session
credentials are request-local. A successfully validated ElevenLabs API key is
stored separately in chrome.storage.local after that storage area is restricted
to trusted extension contexts; it is sent only to the ElevenLabs subscription
API. Background command responses and application state never include the
ElevenLabs key, and AI Limits does not render it or copy it into reports, logs,
or History.

Chrome's trusted extension contexts include the background worker and the side
panel. The side-panel code does not request or read the credential record, but
Chrome storage change events can expose local change objects to trusted
extension contexts even when the current listener ignores that record. The
release check verifies that built side-panel assets do not contain the
credential-storage record name, trusted-context setup constant, request header,
or subscription endpoint. This is a code-ownership check, not cryptographic
isolation.

This local boundary is not OS-keychain encryption. Someone with access to the
unlocked Chrome profile, extension DevTools, or local profile files may be able
to inspect the saved key. Browser-session provider endpoints are private and
unsupported; ElevenLabs uses a documented endpoint, but provider responses,
authorization behavior, and security flows can still change without notice.
Reports about a provider's own service should be sent to that provider rather
than this project.
